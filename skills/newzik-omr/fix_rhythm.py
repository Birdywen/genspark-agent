#!/usr/bin/env python3
"""
MusicXML Rhythm Fixer for Newzik OMR output.

Fixes common OMR rhythm errors:
1. Remove grace notes
2. Fix integer-multiple duration inflation (all durations x2 or x3)
3. Fix small overflow (extra 1-2 units, likely untagged grace notes → remove shortest note)
4. Fix mixed-ratio by scaling to nearest correct pattern
5. Flag underflow measures for manual review

Usage:
    python3 fix_rhythm.py input.musicxml                        # report only
    python3 fix_rhythm.py input.musicxml -o output.musicxml     # fix and save
    python3 fix_rhythm.py input.musicxml --remove-lyrics        # also strip lyrics
"""

import xml.etree.ElementTree as ET
import sys
import argparse
import math
from copy import deepcopy


def get_time_info(measures):
    divisions = 1; beats = 4; beat_type = 4
    for m in measures[:5]:
        d = m.find('.//divisions')
        if d is not None: divisions = int(d.text)
        b = m.find('.//time/beats')
        if b is not None: beats = int(b.text)
        bt = m.find('.//time/beat-type')
        if bt is not None: beat_type = int(bt.text)
    expected = divisions * beats * (4 // beat_type)
    return divisions, beats, beat_type, expected


def measure_dur(measure):
    total = 0
    for n in measure.findall('note'):
        if n.find('chord') is not None: continue
        if n.find('grace') is not None: continue
        d = n.find('duration')
        if d is not None: total += int(d.text)
    for fw in measure.findall('forward'):
        d = fw.find('duration')
        if d is not None: total += int(d.text)
    for bk in measure.findall('backup'):
        d = bk.find('duration')
        if d is not None: total -= int(d.text)
    return total


def fix_grace_notes(measure):
    """Remove all grace notes. Returns count removed."""
    removed = 0
    for n in list(measure.findall('note')):
        if n.find('grace') is not None:
            measure.remove(n)
            removed += 1
    return removed


def fix_integer_multiple(measure, expected):
    """If total duration is integer multiple of expected, scale down."""
    total = measure_dur(measure)
    if total <= expected or total == 0:
        return False, 1
    
    ratio = total / expected
    int_ratio = round(ratio)
    
    if int_ratio >= 2 and abs(ratio - int_ratio) < 0.2:
        # Check all non-grace note durations are divisible
        notes = [(n, n.find('duration')) for n in measure.findall('note') 
                 if n.find('grace') is None and n.find('duration') is not None]
        
        all_ok = all(int(d.text) % int_ratio == 0 for _, d in notes if int(d.text) > 0)
        
        if all_ok:
            for _, d in notes:
                val = int(d.text)
                if val > 0:
                    d.text = str(val // int_ratio)
            return True, int_ratio
        else:
            # Try approximate: round each duration to nearest divisible value
            for _, d in notes:
                val = int(d.text)
                if val > 0:
                    d.text = str(max(1, round(val / int_ratio)))
            # Verify
            new_total = measure_dur(measure)
            if new_total == expected:
                return True, int_ratio
            # If close enough (within 1), adjust last note
            diff = new_total - expected
            if abs(diff) <= 2:
                # Find last non-chord non-grace note and adjust
                for n in reversed(list(measure.findall('note'))):
                    if n.find('chord') is not None or n.find('grace') is not None:
                        continue
                    d = n.find('duration')
                    if d is not None:
                        val = int(d.text)
                        new_val = val - diff
                        if new_val > 0:
                            d.text = str(new_val)
                            return True, int_ratio
                        break
    return False, 1


def fix_small_overflow(measure, expected):
    """If measure overflows by 1-2 units, remove the shortest non-rest note."""
    total = measure_dur(measure)
    overflow = total - expected
    
    if overflow <= 0 or overflow > 2:
        return False, 0
    
    # Find shortest non-chord, non-grace, non-rest note
    candidates = []
    for n in measure.findall('note'):
        if n.find('chord') is not None: continue
        if n.find('grace') is not None: continue
        if n.find('rest') is not None: continue
        d = n.find('duration')
        if d is not None:
            dur = int(d.text)
            if dur == overflow:
                candidates.append((n, dur))
    
    if candidates:
        # Remove first matching note (likely ornament)
        measure.remove(candidates[0][0])
        return True, overflow
    
    # Alternative: reduce longest note by overflow amount
    notes = []
    for n in measure.findall('note'):
        if n.find('chord') is not None: continue
        if n.find('grace') is not None: continue
        d = n.find('duration')
        if d is not None:
            notes.append((n, d, int(d.text)))
    
    if notes:
        # Find note where reducing by overflow still makes musical sense
        # Prefer notes that become a standard duration after reduction
        standard_durs = {1, 2, 3, 4, 6, 8}
        for n, d_el, dur in sorted(notes, key=lambda x: -x[2]):
            new_dur = dur - overflow
            if new_dur in standard_durs:
                d_el.text = str(new_dur)
                return True, overflow
        # Fallback: reduce longest note
        n, d_el, dur = max(notes, key=lambda x: x[2])
        if dur - overflow > 0:
            d_el.text = str(dur - overflow)
            return True, overflow
    
    return False, 0


def remove_lyrics(root):
    """Remove all lyric elements."""
    count = 0
    for lyric in root.findall('.//lyric'):
        parent = lyric.find('..')
        if parent is not None:
            parent.remove(lyric)
            count += 1
    # findall('.//') doesn't give parent, so iterate differently
    for note in root.findall('.//note'):
        for lyric in list(note.findall('lyric')):
            note.remove(lyric)
            count += 1
    return count


def remove_directions_text(root):
    """Remove direction elements that contain copyright or garbage text."""
    garbage = ['LEONARD', 'PUBLISHING', 'CORPORATION', 'COPYRIGHT', '©']
    count = 0
    for measure in root.findall('.//measure'):
        for direction in list(measure.findall('direction')):
            text = ET.tostring(direction, encoding='unicode', method='text').upper()
            if any(g in text for g in garbage):
                measure.remove(direction)
                count += 1
    return count


def analyze(filepath):
    """Analyze rhythm issues in a MusicXML file."""
    tree = ET.parse(filepath)
    root = tree.getroot()
    measures = root.findall('.//measure')
    divisions, beats, beat_type, expected = get_time_info(measures)
    
    print(f"File: {filepath}")
    print(f"Time: {beats}/{beat_type}, divisions={divisions}, expected={expected}")
    print(f"Measures: {len(measures)}")
    
    grace_count = sum(1 for m in measures for n in m.findall('note') if n.find('grace') is not None)
    print(f"Grace notes: {grace_count}")
    
    good = 0; bad_measures = []
    for i, m in enumerate(measures):
        num = m.get('number', str(i+1))
        total = measure_dur(m)
        if total == expected:
            good += 1
        elif total > 0:
            ratio = round(total / expected, 2)
            bad_measures.append((num, total, ratio))
    
    print(f"Good: {good}, Bad: {len(bad_measures)}")
    if bad_measures:
        print("Bad measures:")
        for num, total, ratio in bad_measures:
            print(f"  M{num}: dur={total} (x{ratio})")
    print()
    return len(bad_measures)


def fix(filepath, output_path=None, strip_lyrics=False):
    """Fix rhythm issues and optionally save."""
    tree = ET.parse(filepath)
    root = tree.getroot()
    measures = root.findall('.//measure')
    divisions, beats, beat_type, expected = get_time_info(measures)
    
    print(f"Fixing: {filepath}")
    print(f"Time: {beats}/{beat_type}, divisions={divisions}, expected={expected}")
    
    stats = {'grace_removed': 0, 'integer_fixed': 0, 'overflow_fixed': 0, 
             'still_bad': 0, 'underflow': 0, 'lyrics_removed': 0, 'garbage_removed': 0}
    
    # Step 0: Remove garbage directions
    stats['garbage_removed'] = remove_directions_text(root)
    if stats['garbage_removed']:
        print(f"  Removed {stats['garbage_removed']} garbage direction(s)")
    
    # Step 0.5: Remove lyrics if requested
    if strip_lyrics:
        stats['lyrics_removed'] = remove_lyrics(root)
        if stats['lyrics_removed']:
            print(f"  Removed {stats['lyrics_removed']} lyric element(s)")
    
    # Step 1: Remove grace notes
    for m in measures:
        r = fix_grace_notes(m)
        stats['grace_removed'] += r
    if stats['grace_removed']:
        print(f"  Removed {stats['grace_removed']} grace note(s)")
    
    # Step 2: Fix integer multiples
    for m in measures:
        total = measure_dur(m)
        if total > expected:
            fixed, ratio = fix_integer_multiple(m, expected)
            if fixed:
                stats['integer_fixed'] += 1
                num = m.get('number', '?')
                print(f"  M{num}: divided by {ratio} (was {total})")
    
    # Step 3: Fix small overflows
    for m in measures:
        total = measure_dur(m)
        if total > expected and total - expected <= 2:
            fixed, overflow = fix_small_overflow(m, expected)
            if fixed:
                stats['overflow_fixed'] += 1
                num = m.get('number', '?')
                print(f"  M{num}: removed overflow of {overflow}")
    
    # Step 4: Report remaining issues
    for m in measures:
        total = measure_dur(m)
        num = m.get('number', '?')
        if total > expected:
            stats['still_bad'] += 1
            print(f"  M{num}: STILL BAD dur={total} (expected {expected})")
        elif 0 < total < expected:
            stats['underflow'] += 1
            print(f"  M{num}: UNDERFLOW dur={total} (expected {expected})")
    
    # Summary
    total_fixed = stats['integer_fixed'] + stats['overflow_fixed'] + stats['grace_removed']
    remaining = stats['still_bad'] + stats['underflow']
    print(f"\nSummary: fixed {stats['integer_fixed']} integer-multiple + {stats['overflow_fixed']} overflow + {stats['grace_removed']} grace notes")
    print(f"Remaining issues: {stats['still_bad']} overflow + {stats['underflow']} underflow")
    
    if output_path:
        tree.write(output_path, encoding='UTF-8', xml_declaration=True)
        print(f"Saved: {output_path}")
    
    return stats


def main():
    parser = argparse.ArgumentParser(description='Fix MusicXML rhythm errors from OMR')
    parser.add_argument('input', help='Input MusicXML file')
    parser.add_argument('-o', '--output', help='Output MusicXML file (omit for report only)')
    parser.add_argument('--remove-lyrics', action='store_true', help='Remove lyrics')
    parser.add_argument('--dry-run', action='store_true', help='Show changes without saving')
    args = parser.parse_args()
    
    if args.output or args.dry_run:
        output = args.output if not args.dry_run else None
        fix(args.input, output, args.remove_lyrics)
    else:
        analyze(args.input)


if __name__ == '__main__':
    main()