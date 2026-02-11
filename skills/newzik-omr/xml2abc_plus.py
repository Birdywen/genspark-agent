#!/usr/bin/env python3
"""xml2abc_plus - 增强版 MusicXML → ABC 转换器

在标准 xml2abc 转换前，自动修复 Newzik OMR 常见错误：
1. Direction 里的和弦文本 → 转为 <harmony>
2. Garbled 后缀清理 (®, ?, !, 方括号)
3. 复合和弦拆分 (AmE → Am + E)
4. 斜杠和弦识别 (CE → C/E)
5. Copyright 文本删除
6. 元数据修正 (composer, instrument names)
7. Key mode 补全
8. 排练标记修复 ([Al → A, [C] → C, El → E)

用法:
  python3 xml2abc_plus.py input.musicxml              # 输出到 stdout
  python3 xml2abc_plus.py input.musicxml -o output.abc # 输出到文件
  python3 xml2abc_plus.py input.musicxml --fix-only     # 只修复 XML，不转 ABC
  python3 xml2abc_plus.py *.musicxml -o dir/            # 批量转换
"""

import xml.etree.ElementTree as ET
import re
import sys
import os
import subprocess
import argparse

# ============ 和弦识别 ============

CHORD_PATTERN = re.compile(
    r'^([A-G][b#]?)'
    r'(m|min|dim|aug|maj7?|M7|7|9|sus[24]?|add[0-9]*|6)?'
    r'(/([A-G][b#]?))?$'
)

# 常见 garbled 文本 → 清理映射
GARBLED_CLEANUP = {
    '®': '', '©': '', '?': '', '!': '',
    '\u00ae': '', '\u00a9': '',
}

# 复合和弦拆分 (连写的两个和弦)
COMPOUND_CHORDS = re.compile(
    r'^([A-G][b#]?(?:m|min|dim|aug|maj7?|7|sus[24]?)?)'
    r'([A-G][b#]?(?:m|min|dim|aug|maj7?|7|sus[24]?)?)$'
)

# 排练标记 garbled 模式
REHEARSAL_PATTERNS = {
    '[Al': 'A', '[A]': 'A', '[Bl': 'B', '[B]': 'B',
    '[Cl': 'C', '[C]': 'C', '[Dl': 'D', '[D]': 'D',
    '[El': 'E', '[E]': 'E', '[Fl': 'F', '[F]': 'F',
    'Al': None, 'Bl': None, 'El': None,  # 需要上下文判断
}

# 合法的演奏指示 (不要当成和弦处理)
LEGIT_DIRECTIONS = {
    'cresc.', 'decresc.', 'dim.', 'rit.', 'rall.', 'accel.',
    'ten.', 'a tempo', 'poco a poco', 'molto', 'simile',
    'mf', 'mp', 'f', 'ff', 'fff', 'p', 'pp', 'ppp',
    'fp', 'sfz', 'sf', 'fz', 'dolce', 'espressivo',
    'legato', 'staccato', 'pizz.', 'arco',
    'D.C.', 'D.S.', 'Fine', 'Coda', 'Segno',
    'N.C.', 'tacet',
}


def clean_chord_text(text):
    """Clean garbled suffixes from chord text."""
    cleaned = text.strip()
    for char, repl in GARBLED_CLEANUP.items():
        cleaned = cleaned.replace(char, repl)
    cleaned = cleaned.strip()
    return cleaned


def parse_chord(text):
    """Parse chord text into (root, kind, bass_step, bass_alter) or None.
    Returns list of tuples for compound chords."""
    cleaned = clean_chord_text(text)
    if not cleaned:
        return None
    
    # Direct match
    m = CHORD_PATTERN.match(cleaned)
    if m:
        return [_chord_to_harmony(m)]
    
    # Compound text: prefer slash chord over two independent chords
    # OMR often swallows '/' so "AmE" = Am/E, "CE" = C/E, "DmA" = Dm/A
    mc = COMPOUND_CHORDS.match(cleaned)
    if mc:
        c1, c2 = mc.group(1), mc.group(2)
        m1 = CHORD_PATTERN.match(c1)
        # If second part is a single note name (A-G, maybe with b/#), treat as bass
        if m1 and re.match(r'^[A-G][b#]?$', c2):
            h = _chord_to_harmony(m1)
            h['bass_step'] = c2[0]
            if len(c2) > 1:
                h['bass_alter'] = '1' if c2[1] == '#' else '-1'
            h['needs_review'] = True
            h['original_text'] = text
            return [h]
        # Otherwise two independent chords (rare)
        m2 = CHORD_PATTERN.match(c2)
        if m1 and m2:
            return [_chord_to_harmony(m1), _chord_to_harmony(m2)]
    
    return None


def _chord_to_harmony(match):
    """Convert regex match to harmony dict."""
    root = match.group(1)
    quality = match.group(2) or ''
    bass_step = match.group(4) if match.lastindex >= 4 and match.group(4) else None
    
    # Map quality to MusicXML kind
    kind_map = {
        '': 'major', 'm': 'minor', 'min': 'minor',
        '7': 'dominant', 'maj7': 'major-seventh', 'M7': 'major-seventh',
        'dim': 'diminished', 'aug': 'augmented',
        '9': 'dominant-ninth', '6': 'major-sixth',
        'sus2': 'suspended-second', 'sus4': 'suspended-fourth', 'sus': 'suspended-fourth',
    }
    kind = kind_map.get(quality, 'major')
    
    # Parse root
    root_step = root[0]
    root_alter = None
    if len(root) > 1:
        root_alter = '1' if root[1] == '#' else '-1'
    
    # Parse bass
    bass_alter = None
    if bass_step and len(bass_step) > 1:
        bass_alter = '1' if bass_step[1] == '#' else '-1'
        bass_step = bass_step[0]
    
    result = {'root': root_step, 'kind': kind}
    if root_alter:
        result['root_alter'] = root_alter
    if bass_step:
        result['bass_step'] = bass_step
    if bass_alter:
        result['bass_alter'] = bass_alter
    return result


def make_harmony_element(chord_dict):
    """Create a MusicXML <harmony> element."""
    h = ET.Element('harmony')
    
    root_el = ET.SubElement(h, 'root')
    rs = ET.SubElement(root_el, 'root-step')
    rs.text = chord_dict['root']
    if 'root_alter' in chord_dict:
        ra = ET.SubElement(root_el, 'root-alter')
        ra.text = chord_dict['root_alter']
    
    kind = ET.SubElement(h, 'kind')
    kind.text = chord_dict['kind']
    
    if 'bass_step' in chord_dict:
        bass = ET.SubElement(h, 'bass')
        bs = ET.SubElement(bass, 'bass-step')
        bs.text = chord_dict['bass_step']
        if 'bass_alter' in chord_dict:
            ba = ET.SubElement(bass, 'bass-alter')
            ba.text = chord_dict['bass_alter']
    
    return h


def make_rehearsal_element(letter):
    """Create a <direction> with <rehearsal>."""
    direction = ET.Element('direction', placement='above')
    dt = ET.SubElement(direction, 'direction-type')
    rehearsal = ET.SubElement(dt, 'rehearsal', attrib={
        'font-size': '14', 'font-weight': 'bold', 'enclosure': 'square'
    })
    rehearsal.text = letter
    return direction


# ============ XML 预处理 ============

def fix_metadata(root):
    """Fix common metadata errors."""
    fixes = []
    
    # Fix composer names
    composer_fixes = {
        'ROLF Dowland': 'Rolf Lovland',
        'ROLF DOWLAND': 'Rolf Lovland',
        'Rolf Dowland': 'Rolf Lovland',
    }
    for creator in root.findall('.//creator[@type="composer"]'):
        if creator.text in composer_fixes:
            old = creator.text
            creator.text = composer_fixes[creator.text]
            fixes.append(f'Composer: "{old}" → "{creator.text}"')
    
    # Fix work title
    for title in root.findall('.//work-title'):
        if title.text:
            # Clean up common OCR artifacts in titles
            cleaned = title.text.strip()
            cleaned = re.sub(r'\s+', ' ', cleaned)  # normalize whitespace
            if cleaned != title.text:
                fixes.append(f'Title cleaned: "{title.text}" → "{cleaned}"')
                title.text = cleaned
    
    # Fix instrument names (remove trailing colons)
    for elem in root.findall('.//part-name') + root.findall('.//instrument-name'):
        if elem.text and elem.text.endswith(':'):
            old = elem.text
            elem.text = elem.text.rstrip(':')
            fixes.append(f'Instrument: "{old}" → "{elem.text}"')
    
    return fixes


def fix_key_mode(root):
    """Add mode to key signatures if missing."""
    fixes = []
    for key in root.findall('.//key'):
        mode = key.find('mode')
        fifths = key.findtext('fifths', '0')
        if mode is None:
            mode = ET.SubElement(key, 'mode')
            # Heuristic: check harmonies to guess mode
            mode.text = 'minor'  # default for OMR pieces (most are minor)
            fixes.append(f'Key mode added: {fifths} fifths → minor')
    return fixes


def fix_directions(root):
    """Fix direction elements: convert chord text to harmony, fix rehearsal marks."""
    fixes = []
    
    for part in root.findall('part'):
        pid = part.get('id')
        
        for measure in part.findall('measure'):
            mnum = measure.get('number')
            dirs_to_remove = []
            harmonies_to_add = []
            rehearsals_to_add = []
            
            for direction in measure.findall('direction'):
                words_el = direction.find('.//words')
                if words_el is None or not words_el.text:
                    continue
                
                words = words_el.text.strip()
                
                # Skip legitimate directions
                if words.lower() in {d.lower() for d in LEGIT_DIRECTIONS}:
                    continue
                
                # Remove copyright text
                if 'copyright' in words.lower() or '©' in words or '\u00a9' in words:
                    dirs_to_remove.append(direction)
                    fixes.append(f'{pid} M{mnum}: Removed copyright: "{words}"')
                    continue
                
                # Check for rehearsal mark
                if words in REHEARSAL_PATTERNS:
                    letter = REHEARSAL_PATTERNS[words]
                    if letter:
                        dirs_to_remove.append(direction)
                        rehearsals_to_add.append(letter)
                        fixes.append(f'{pid} M{mnum}: Rehearsal mark: "{words}" → [{letter}]')
                        continue
                
                # Single letter at start of section could be rehearsal
                if len(words) <= 2 and words.rstrip('l') in 'ABCDEFGH':
                    letter = words.rstrip('l')
                    dirs_to_remove.append(direction)
                    rehearsals_to_add.append(letter)
                    fixes.append(f'{pid} M{mnum}: Rehearsal mark: "{words}" → [{letter}]')
                    continue
                
                # Try to parse as chord
                chords = parse_chord(words)
                if chords:
                    dirs_to_remove.append(direction)
                    harmonies_to_add.extend(chords)
                    chord_names = [f"{c['root']}{c['kind']}{'/'+c['bass_step'] if 'bass_step' in c else ''}{'  [REVIEW]' if c.get('needs_review') else ''}" for c in chords]
                    fixes.append(f'{pid} M{mnum}: Chord from direction: "{words}" → {", ".join(chord_names)}')
                    continue
                
                # Unknown - log but don't remove
                fixes.append(f'{pid} M{mnum}: Unknown direction kept: "{words}"')
            
            # Apply removals
            for d in dirs_to_remove:
                measure.remove(d)
            
            # Add rehearsal marks
            for letter in rehearsals_to_add:
                rehearsal_el = make_rehearsal_element(letter)
                measure.insert(0, rehearsal_el)
            
            # Add harmonies (before first note)
            if harmonies_to_add:
                first_note_idx = None
                for i, child in enumerate(measure):
                    if child.tag == 'note':
                        first_note_idx = i
                        break
                
                for j, chord_dict in enumerate(harmonies_to_add):
                    harmony_el = make_harmony_element(chord_dict)
                    if first_note_idx is not None:
                        measure.insert(first_note_idx + j, harmony_el)
                    else:
                        measure.append(harmony_el)
    
    return fixes


def fix_musicxml(xml_path):
    """Apply all fixes to a MusicXML file. Returns (tree, fixes_list)."""
    tree = ET.parse(xml_path)
    root = tree.getroot()
    
    all_fixes = []
    all_fixes.extend(fix_metadata(root))
    all_fixes.extend(fix_key_mode(root))
    all_fixes.extend(fix_directions(root))
    
    return tree, all_fixes



def post_process_abc(abc_text, fixes):
    """Add review comments to ABC output for items needing human/AI verification."""
    lines = abc_text.split('\n')
    review_items = []
    
    # Collect review markers from fixes
    review_chords = [f for f in fixes if '[REVIEW]' in f]
    for rc in review_chords:
        review_items.append(f'%! REVIEW: {rc}')
    
    # Detect anomalous measures
    anomalies = detect_note_anomalies(abc_text)
    for a in anomalies:
        review_items.append(f'%! CHECK: {a}')
    
    if review_items:
        insert_idx = 0
        for i, line in enumerate(lines):
            if line.startswith('K:'):
                insert_idx = i + 1
                break
        
        review_block = ['%', '% === AI REVIEW NEEDED ===']
        review_block.extend(review_items)
        review_block.append('% ===========================')
        review_block.append('%')
        
        lines = lines[:insert_idx] + review_block + lines[insert_idx:]
    
    return '\n'.join(lines)


def detect_note_anomalies(abc_text):
    """Detect measures with potential missing notes."""
    anomalies = []
    import re as _re
    
    for line in abc_text.split('\n'):
        if line.startswith(('V:', '%', 'w:', 'X:', 'T:', 'C:', 'L:', 'Q:', 'M:', 'K:', 'I:', '%%')):
            continue
        # Find x (placeholder/spacer) - often means OMR lost a note
        if ' x' in line or line.startswith('x'):
            mnum_match = _re.search(r'%\s*(\d+)', line)
            mnum = mnum_match.group(1) if mnum_match else '?'
            anomalies.append(f'M{mnum}: placeholder (x) detected - possible missing note')
    
    return anomalies

def xml_to_abc(xml_path, abc_path=None, fix=True, verbose=False):
    """Convert MusicXML to ABC with automatic fixes.
    
    Args:
        xml_path: Input MusicXML file path
        abc_path: Output ABC file path (None = stdout)
        fix: Apply automatic fixes before conversion
        verbose: Print fix details
    
    Returns:
        (abc_text, fixes_list)
    """
    fixes = []
    
    if fix:
        tree, fixes = fix_musicxml(xml_path)
        # Write fixed XML to temp file
        import tempfile
        with tempfile.NamedTemporaryFile(suffix='.musicxml', delete=False, mode='wb') as tmp:
            tree.write(tmp, encoding='UTF-8', xml_declaration=True)
            tmp_path = tmp.name
        convert_path = tmp_path
    else:
        convert_path = xml_path
        tmp_path = None
    
    try:
        # Run xml2abc
        result = subprocess.run(
            ['xml2abc', convert_path],
            capture_output=True, text=True, timeout=30
        )
        abc_text = result.stdout
        
        if result.returncode != 0 and verbose:
            print(f'xml2abc warnings: {result.stderr}', file=sys.stderr)
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)
    
    # Post-process: add review comments
    if fix:
        abc_text = post_process_abc(abc_text, fixes)
    
    # Write output
    if abc_path:
        os.makedirs(os.path.dirname(abc_path) or '.', exist_ok=True)
        with open(abc_path, 'w') as f:
            f.write(abc_text)
    
    return abc_text, fixes


def batch_convert(input_dir, output_dir=None, fix=True, verbose=False):
    """Convert all MusicXML files in a directory."""
    if output_dir is None:
        output_dir = input_dir
    
    files = sorted(f for f in os.listdir(input_dir) if f.endswith('.musicxml'))
    results = []
    
    for fname in files:
        xml_path = os.path.join(input_dir, fname)
        abc_name = os.path.splitext(fname)[0] + '.abc'
        abc_path = os.path.join(output_dir, abc_name)
        
        print(f'Converting: {fname}', file=sys.stderr)
        abc_text, fixes = xml_to_abc(xml_path, abc_path, fix=fix, verbose=verbose)
        
        if verbose and fixes:
            for f in fixes:
                print(f'  {f}', file=sys.stderr)
        
        results.append({
            'file': fname,
            'fixes': len(fixes),
            'abc_lines': len(abc_text.splitlines()),
            'output': abc_path,
        })
        print(f'  → {abc_name} ({len(fixes)} fixes, {len(abc_text.splitlines())} lines)', file=sys.stderr)
    
    return results


# ============ CLI ============

def main():
    parser = argparse.ArgumentParser(
        description='xml2abc_plus - Enhanced MusicXML to ABC converter with auto-fix'
    )
    parser.add_argument('input', nargs='+', help='MusicXML file(s) or directory')
    parser.add_argument('-o', '--output', help='Output file or directory')
    parser.add_argument('--no-fix', action='store_true', help='Skip auto-fixes')
    parser.add_argument('--fix-only', action='store_true', help='Only fix XML, no ABC conversion')
    parser.add_argument('-v', '--verbose', action='store_true', help='Show fix details')
    parser.add_argument('--batch', action='store_true', help='Batch convert directory')
    
    args = parser.parse_args()
    fix = not args.no_fix
    
    # Batch mode
    if args.batch or (len(args.input) == 1 and os.path.isdir(args.input[0])):
        input_dir = args.input[0]
        output_dir = args.output or input_dir
        results = batch_convert(input_dir, output_dir, fix=fix, verbose=args.verbose)
        print(f'\nConverted {len(results)} files', file=sys.stderr)
        total_fixes = sum(r['fixes'] for r in results)
        print(f'Total fixes applied: {total_fixes}', file=sys.stderr)
        return
    
    # Fix-only mode
    if args.fix_only:
        for xml_path in args.input:
            tree, fixes = fix_musicxml(xml_path)
            output = args.output or xml_path.replace('.musicxml', '_fixed.musicxml')
            tree.write(output, encoding='UTF-8', xml_declaration=True)
            print(f'{xml_path} → {output} ({len(fixes)} fixes)', file=sys.stderr)
            if args.verbose:
                for f in fixes:
                    print(f'  {f}', file=sys.stderr)
        return
    
    # Single/multi file mode
    for xml_path in args.input:
        if args.output and len(args.input) == 1:
            abc_path = args.output
        elif args.output and os.path.isdir(args.output):
            abc_name = os.path.splitext(os.path.basename(xml_path))[0] + '.abc'
            abc_path = os.path.join(args.output, abc_name)
        else:
            abc_path = None  # stdout
        
        abc_text, fixes = xml_to_abc(xml_path, abc_path, fix=fix, verbose=args.verbose)
        
        if not abc_path:
            print(abc_text)
        
        if fixes:
            print(f'Applied {len(fixes)} fixes', file=sys.stderr)
            if args.verbose:
                for f in fixes:
                    print(f'  {f}', file=sys.stderr)


if __name__ == '__main__':
    main()
