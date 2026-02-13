#!/usr/bin/env node
/**
 * xml2abc_unified.js - 统一版 MusicXML → ABC 转换器
 * 
 * 合并了 xml2abc_plus.py (预处理/修复) + xml2abc_patched.js (转换引擎)
 * 不再依赖 Python 或系统 xml2abc 命令
 * 
 * 用法:
 *   node xml2abc_unified.js input.musicxml                # 输出到 stdout
 *   node xml2abc_unified.js input.musicxml -o output.abc  # 输出到文件
 *   node xml2abc_unified.js input.musicxml --fix-only      # 只修复 XML
 *   node xml2abc_unified.js input.musicxml --no-fix        # 不修复，直接转
 *   node xml2abc_unified.js dir/                           # 批量转换目录
 *   node xml2abc_unified.js dir/ -v                        # 显示修复详情
 */

const fs = require('fs');
const path = require('path');
const { vertaal } = require('./xml2abc_patched.js');

// ============ 和弦识别 ============

const CHORD_RE = /^([A-G][b#]?)(m|min|dim|aug|maj7?|M7|7|9|sus[24]?|add\d*|6)?(\/([A-G][b#]?))?$/;

const COMPOUND_RE = /^([A-G][b#]?(?:m|min|dim|aug|maj7?|7|sus[24]?)?)([A-G][b#]?(?:m|min|dim|aug|maj7?|7|sus[24]?)?)$/;

const GARBLED_CHARS = { '®': '', '©': '', '?': '', '!': '', '\u00ae': '', '\u00a9': '' };

const REHEARSAL_PATTERNS = {
  '[Al': 'A', '[A]': 'A', '[Bl': 'B', '[B]': 'B',
  '[Cl': 'C', '[C]': 'C', '[Dl': 'D', '[D]': 'D',
  '[El': 'E', '[E]': 'E', '[Fl': 'F', '[F]': 'F',
};

const LEGIT_DIRECTIONS = new Set([
  'cresc.', 'decresc.', 'dim.', 'rit.', 'rall.', 'accel.',
  'ten.', 'a tempo', 'poco a poco', 'molto', 'simile',
  'mf', 'mp', 'f', 'ff', 'fff', 'p', 'pp', 'ppp',
  'fp', 'sfz', 'sf', 'fz', 'dolce', 'espressivo',
  'legato', 'staccato', 'pizz.', 'arco',
  'D.C.', 'D.S.', 'Fine', 'Coda', 'Segno',
  'N.C.', 'tacet',
]);

const KIND_MAP = {
  '': 'major', 'm': 'minor', 'min': 'minor',
  '7': 'dominant', 'maj7': 'major-seventh', 'M7': 'major-seventh',
  'dim': 'diminished', 'aug': 'augmented',
  '9': 'dominant-ninth', '6': 'major-sixth',
  'sus2': 'suspended-second', 'sus4': 'suspended-fourth', 'sus': 'suspended-fourth',
};

const COMPOSER_FIXES = {
  'ROLF Dowland': 'Rolf Lovland',
  'ROLF DOWLAND': 'Rolf Lovland',
  'Rolf Dowland': 'Rolf Lovland',
};

// ============ XML 操作 (轻量级，无需外部 XML 库) ============

function cleanChordText(text) {
  let cleaned = text.trim();
  for (const [ch, repl] of Object.entries(GARBLED_CHARS)) {
    cleaned = cleaned.split(ch).join(repl);
  }
  return cleaned.trim();
}

function parseChord(text) {
  const cleaned = cleanChordText(text);
  if (!cleaned) return null;

  // Direct match
  let m = cleaned.match(CHORD_RE);
  if (m) return [chordToHarmony(m)];

  // Compound: slash chord or two independent
  const mc = cleaned.match(COMPOUND_RE);
  if (mc) {
    const c1 = mc[1], c2 = mc[2];
    const m1 = c1.match(CHORD_RE);
    // If c2 is a single note name, treat as bass
    if (m1 && /^[A-G][b#]?$/.test(c2)) {
      const h = chordToHarmony(m1);
      h.bass_step = c2[0];
      if (c2.length > 1) h.bass_alter = c2[1] === '#' ? '1' : '-1';
      h.needs_review = true;
      h.original_text = text;
      return [h];
    }
    const m2 = c2.match(CHORD_RE);
    if (m1 && m2) return [chordToHarmony(m1), chordToHarmony(m2)];
  }

  return null;
}

function chordToHarmony(match) {
  const root = match[1];
  const quality = match[2] || '';
  const bassRaw = match[4] || null;

  const result = {
    root: root[0],
    kind: KIND_MAP[quality] || 'major',
  };
  if (root.length > 1) result.root_alter = root[1] === '#' ? '1' : '-1';
  if (bassRaw) {
    result.bass_step = bassRaw[0];
    if (bassRaw.length > 1) result.bass_alter = bassRaw[1] === '#' ? '1' : '-1';
  }
  return result;
}

function harmonyToXml(chord) {
  let xml = '<harmony>\n  <root>\n    <root-step>' + chord.root + '</root-step>\n';
  if (chord.root_alter) xml += '    <root-alter>' + chord.root_alter + '</root-alter>\n';
  xml += '  </root>\n  <kind>' + chord.kind + '</kind>\n';
  if (chord.bass_step) {
    xml += '  <bass>\n    <bass-step>' + chord.bass_step + '</bass-step>\n';
    if (chord.bass_alter) xml += '    <bass-alter>' + chord.bass_alter + '</bass-alter>\n';
    xml += '  </bass>\n';
  }
  xml += '</harmony>';
  return xml;
}

function rehearsalToXml(letter) {
  return '<direction placement="above"><direction-type>' +
    '<rehearsal font-size="14" font-weight="bold" enclosure="square">' +
    letter + '</rehearsal></direction-type></direction>';
}

// ============ XML 修复 (正则方式，避免 DOM 库依赖) ============

function fixMetadata(xml, fixes) {
  // Fix composer names
  for (const [wrong, correct] of Object.entries(COMPOSER_FIXES)) {
    if (xml.includes(wrong)) {
      xml = xml.split(wrong).join(correct);
      fixes.push(`Composer: "${wrong}" → "${correct}"`);
    }
  }

  // Clean whitespace in work-title
  xml = xml.replace(/<work-title>([^<]+)<\/work-title>/g, (match, title) => {
    const cleaned = title.trim().replace(/\s+/g, ' ');
    if (cleaned !== title) {
      fixes.push(`Title cleaned: "${title}" → "${cleaned}"`);
    }
    return '<work-title>' + cleaned + '</work-title>';
  });

  // Fix instrument names (remove trailing colons)
  xml = xml.replace(/<(part-name|instrument-name)>([^<]+):<\/(part-name|instrument-name)>/g, (match, tag, name, tag2) => {
    fixes.push(`Instrument: "${name}:" → "${name}"`);
    return `<${tag}>${name}</${tag2}>`;
  });

  return xml;
}

function fixKeyMode(xml, fixes) {
  // Add mode to key signatures if missing
  // Match <key> blocks without <mode>
  xml = xml.replace(/<key>([\s\S]*?)<\/key>/g, (match, inner) => {
    if (inner.includes('<mode>')) return match; // already has mode
    const fifthsM = inner.match(/<fifths>(-?\d+)<\/fifths>/);
    const fifths = fifthsM ? fifthsM[1] : '0';
    fixes.push(`Key mode added: ${fifths} fifths → minor`);
    return match.replace('</key>', '  <mode>minor</mode>\n</key>');
  });

  return xml;
}

function fixDirections(xml, fixes) {
  // Process each measure
  xml = xml.replace(/<measure[^>]*number="(\d+)"[^>]*>([\s\S]*?)<\/measure>/g, (match, mnum, inner) => {
    let modified = inner;
    
    // Find all <direction> blocks with <words>
    const dirRe = /<direction[^>]*>([\s\S]*?)<\/direction>/g;
    let dirMatch;
    const replacements = [];
    const insertions = [];
    
    while ((dirMatch = dirRe.exec(inner)) !== null) {
      const fullDir = dirMatch[0];
      const dirInner = dirMatch[1];
      
      const wordsM = dirInner.match(/<words[^>]*>([^<]*)<\/words>/);
      if (!wordsM) continue;
      const words = wordsM[1].trim();
      if (!words) continue;
      
      // Skip legit directions
      let isLegit = false;
      for (const ld of LEGIT_DIRECTIONS) {
        if (words.toLowerCase() === ld.toLowerCase()) { isLegit = true; break; }
      }
      if (isLegit) continue;
      
      // Remove copyright
      if (words.toLowerCase().includes('copyright') || words.includes('©') || words.includes('\u00a9')) {
        replacements.push({ old: fullDir, new: '' });
        fixes.push(`M${mnum}: Removed copyright: "${words}"`);
        continue;
      }
      
      // Check rehearsal marks
      if (REHEARSAL_PATTERNS[words]) {
        const letter = REHEARSAL_PATTERNS[words];
        replacements.push({ old: fullDir, new: '' });
        insertions.push(rehearsalToXml(letter));
        fixes.push(`M${mnum}: Rehearsal mark: "${words}" → [${letter}]`);
        continue;
      }
      
      // Single letter rehearsal
      if (words.length <= 2 && 'ABCDEFGH'.includes(words.replace(/l$/,''))) {
        const letter = words.replace(/l$/,'');
        if (letter) {
          replacements.push({ old: fullDir, new: '' });
          insertions.push(rehearsalToXml(letter));
          fixes.push(`M${mnum}: Rehearsal mark: "${words}" → [${letter}]`);
          continue;
        }
      }
      
      // Try chord
      const chords = parseChord(words);
      if (chords) {
        replacements.push({ old: fullDir, new: '' });
        const chordXmls = chords.map(c => harmonyToXml(c));
        insertions.push(...chordXmls);
        const names = chords.map(c => 
          `${c.root}${c.kind}${c.bass_step ? '/' + c.bass_step : ''}${c.needs_review ? ' [REVIEW]' : ''}`
        );
        fixes.push(`M${mnum}: Chord from direction: "${words}" → ${names.join(', ')}`);
        continue;
      }
      
      fixes.push(`M${mnum}: Unknown direction kept: "${words}"`);
    }
    
    // Apply replacements
    for (const r of replacements) {
      modified = modified.replace(r.old, r.new);
    }
    
    // Insert harmonies/rehearsals before first <note>
    if (insertions.length > 0) {
      const noteIdx = modified.indexOf('<note');
      if (noteIdx >= 0) {
        modified = modified.slice(0, noteIdx) + insertions.join('\n') + '\n' + modified.slice(noteIdx);
      } else {
        modified += '\n' + insertions.join('\n');
      }
    }
    
    return match.replace(inner, modified);
  });

  return xml;
}

function fixMusicXml(xmlStr, verbose) {
  const fixes = [];
  let xml = xmlStr;
  
  xml = fixMetadata(xml, fixes);
  xml = fixKeyMode(xml, fixes);
  xml = fixDirections(xml, fixes);
  
  if (verbose && fixes.length > 0) {
    console.error(`[fixes] ${fixes.length} items:`);
    fixes.forEach(f => console.error(`  - ${f}`));
  }
  
  return { xml, fixes };
}

// ============ ABC 后处理 ============

// ============ 指法修正 (Fix #9) ============

function abcPitch(noteStr) {
  let s = noteStr.replace(/^[\^_=]+/, '');
  if (!s) return 0;
  const baseMap = {
    'C': 48, 'D': 50, 'E': 52, 'F': 53, 'G': 55, 'A': 57, 'B': 59,
    'c': 60, 'd': 62, 'e': 64, 'f': 65, 'g': 67, 'a': 69, 'b': 71,
  };
  if (!(s[0] in baseMap)) return 0;
  let pitch = baseMap[s[0]];
  for (let i = 1; i < s.length; i++) {
    if (s[i] === ',') pitch -= 12;
    else if (s[i] === "'") pitch += 12;
  }
  if (noteStr.startsWith('^')) pitch += 1;
  else if (noteStr.startsWith('_')) pitch -= 1;
  return pitch;
}

function parseChordNotes(chordStr) {
  const inner = chordStr.slice(1, -1);
  const notes = [];
  let i = 0;
  while (i < inner.length) {
    let note = '';
    if ('^_='.includes(inner[i])) { note += inner[i]; i++; }
    if (i < inner.length && /[A-Ga-g]/.test(inner[i])) { note += inner[i]; i++; }
    while (i < inner.length && (inner[i] === ',' || inner[i] === "'")) { note += inner[i]; i++; }
    if (note) notes.push(note);
  }
  return notes;
}

function fixFingeringOrder(abcText) {
  const lines = abcText.split('\n');
  let currentHand = null;
  let fixes = 0;

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (line.startsWith('V:')) {
      if (/bass/i.test(line)) currentHand = 'left';
      else if (/treble/i.test(line)) currentHand = 'right';
      else {
        const vm = line.match(/V:(\d+)/);
        if (vm) currentHand = vm[1] === '1' ? 'right' : 'left';
      }
      continue;
    }
    if (!currentHand) continue;

    lines[li] = line.replace(/((?:!\d!){2,})(\[[^\]]+\])/g, (match, fingGroup, chordStr) => {
      const fingers = [];
      const fre = /!(\d)!/g;
      let fm;
      while ((fm = fre.exec(fingGroup)) !== null) {
        fingers.push(parseInt(fm[1]));
      }
      const notes = parseChordNotes(chordStr);
      const pitches = notes.map(n => abcPitch(n));

      if (fingers.length !== notes.length) return match;

      const ascending = pitches.every((p, i) => i === 0 || p >= pitches[i - 1]);
      if (!ascending) return match;

      let sortedFingers;
      if (currentHand === 'right') {
        sortedFingers = fingers.slice().sort((a, b) => a - b);
      } else {
        sortedFingers = fingers.slice().sort((a, b) => b - a);
      }

      const changed = fingers.some((f, i) => f !== sortedFingers[i]);
      if (!changed) return match;

      fixes++;
      const newFing = sortedFingers.map(f => '!' + f + '!').join('');
      return newFing + chordStr;
    });
  }

  return { text: lines.join('\n'), fixes };
}

function detectAnomalies(abcText) {
  const anomalies = [];
  for (const line of abcText.split('\n')) {
    if (/^(V:|%|w:|X:|T:|C:|L:|Q:|M:|K:|I:|%%)/.test(line)) continue;
    if (line.includes(' x') || line.startsWith('x')) {
      const mm = line.match(/%\s*(\d+)/);
      const mnum = mm ? mm[1] : '?';
      anomalies.push(`M${mnum}: placeholder (x) detected - possible missing note`);
    }
  }
  return anomalies;
}

function postProcessAbc(abcText, fixes) {
  const lines = abcText.split('\n');
  const reviewItems = [];
  
  const reviewChords = fixes.filter(f => f.includes('[REVIEW]'));
  reviewChords.forEach(rc => reviewItems.push(`%! REVIEW: ${rc}`));
  
  const anomalies = detectAnomalies(abcText);
  anomalies.forEach(a => reviewItems.push(`%! CHECK: ${a}`));
  
  if (reviewItems.length === 0) return abcText;
  
  let insertIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('K:')) { insertIdx = i + 1; break; }
  }
  
  const block = [
    '%',
    '% === AI REVIEW NEEDED ===',
    ...reviewItems,
    '% ===========================',
    '%',
  ];
  
  lines.splice(insertIdx, 0, ...block);
  return lines.join('\n');
}

// ============ 转换核心 ============

function convertToAbc(xmlStr) {
  // xml2abc_patched.js 的 vertaal 函数需要 jQuery-like XML tree
  // 它内部用 $() 包装。我们需要提供一个 DOM 环境
  let jsdom;
  try {
    jsdom = require('jsdom');
  } catch (e) {
    // fallback: 使用系统 xml2abc 命令
    const { execSync } = require('child_process');
    const tmp = path.join('/private/tmp', `xml2abc_${Date.now()}.musicxml`);
    fs.writeFileSync(tmp, xmlStr, 'utf-8');
    try {
      const result = execSync(`xml2abc "${tmp}"`, { encoding: 'utf-8', timeout: 30000 });
      return result;
    } finally {
      try { fs.unlinkSync(tmp); } catch(e) {}
    }
  }
  
  // Use jsdom + jQuery to provide the environment xml2abc_patched.js expects
  const { JSDOM } = jsdom;
  const dom = new JSDOM(xmlStr, { contentType: 'text/xml' });
  const doc = dom.window.document;
  
  // vertaal expects a jQuery-wrapped XML tree
  // Provide minimal jQuery-like wrapper
  const $ = require('jquery')(dom.window);
  const xmltree = $(doc);
  
  const result = vertaal(xmltree, {});
  return result;
}

function convert(inputPath, options = {}) {
  const { fix = true, fixOnly = false, verbose = false, output = null } = options;
  
  let xmlStr = fs.readFileSync(inputPath, 'utf-8');
  let fixes = [];
  
  // Apply fixes
  if (fix) {
    const result = fixMusicXml(xmlStr, verbose);
    xmlStr = result.xml;
    fixes = result.fixes;
  }
  
  if (fixOnly) {
    // Output fixed XML
    const outPath = output || inputPath.replace('.musicxml', '.fixed.musicxml');
    fs.writeFileSync(outPath, xmlStr, 'utf-8');
    console.error(`Fixed XML written to: ${outPath} (${fixes.length} fixes)`);
    return { xml: xmlStr, fixes, abc: null };
  }
  
  // Convert to ABC - use system xml2abc command (reliable fallback)
  const { execSync } = require('child_process');
  const tmp = path.join('/private/tmp', `xml2abc_${Date.now()}_${Math.random().toString(36).slice(2,6)}.musicxml`);
  fs.writeFileSync(tmp, xmlStr, 'utf-8');
  
  let abcText;
  try {
    abcText = execSync(`xml2abc "${tmp}"`, { encoding: 'utf-8', timeout: 30000 });
  } catch (e) {
    console.error(`xml2abc failed for ${inputPath}: ${e.message}`);
    abcText = '';
  } finally {
    try { fs.unlinkSync(tmp); } catch(e) {}
  }
  
  // Post-process
  if (fix && abcText) {
    // Fix #9: Fingering order correction
    const fingResult = fixFingeringOrder(abcText);
    abcText = fingResult.text;
    if (fingResult.fixes > 0) {
      fixes.push(`Fingering order: ${fingResult.fixes} chord(s) corrected`);
      if (verbose) console.error(`  [fingering] ${fingResult.fixes} chord fingering orders fixed`);
    }
    abcText = postProcessAbc(abcText, fixes);
  }
  
  // Output
  if (output) {
    fs.writeFileSync(output, abcText, 'utf-8');
    if (verbose) console.error(`ABC written to: ${output}`);
  } else {
    process.stdout.write(abcText);
  }
  
  return { xml: xmlStr, fixes, abc: abcText };
}

function convertDir(dirPath, options = {}) {
  const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.musicxml'));
  const results = { total: files.length, success: 0, failed: 0, fixes: 0 };
  
  for (const file of files) {
    const inputPath = path.join(dirPath, file);
    const base = file.replace('.musicxml', '');
    const outPath = options.output 
      ? path.join(options.output, base + '.abc')
      : path.join(dirPath, base + '.abc');
    
    try {
      const result = convert(inputPath, { ...options, output: outPath });
      results.success++;
      results.fixes += result.fixes.length;
      if (options.verbose) {
        console.error(`✓ ${file} (${result.fixes.length} fixes)`);
      }
    } catch (e) {
      results.failed++;
      console.error(`✗ ${file}: ${e.message}`);
    }
  }
  
  console.error(`\nDone: ${results.success}/${results.total} converted, ${results.fixes} total fixes, ${results.failed} failed`);
  return results;
}

// ============ CLI ============

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: node xml2abc_unified.js <input.musicxml|dir/> [-o output] [--fix-only] [--no-fix] [-v]');
    process.exit(1);
  }
  
  const input = args[0];
  const options = {
    fix: !args.includes('--no-fix'),
    fixOnly: args.includes('--fix-only'),
    verbose: args.includes('-v') || args.includes('--verbose'),
  };
  
  const oIdx = args.indexOf('-o');
  if (oIdx >= 0 && args[oIdx + 1]) {
    options.output = args[oIdx + 1];
  }
  
  const stat = fs.statSync(input);
  if (stat.isDirectory()) {
    if (!options.output) options.output = input; // output to same dir
    convertDir(input, options);
  } else {
    convert(input, options);
  }
}

// Export for programmatic use
module.exports = { convert, convertDir, fixMusicXml, parseChord };

if (require.main === module) {
  main();
}
