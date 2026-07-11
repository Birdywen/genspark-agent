#!/bin/bash
# abc_3layer_analyze.sh v4 — 修复小节对齐歧义, HARM 格式加 mN= 前缀
set -e
INPUT="$1"
OUTPUT="${2:-${INPUT%.abc}_annotated.abc}"
MODEL="${3:-gemini_3_1_pro_preview}"

if [ -z "$INPUT" ] || [ ! -f "$INPUT" ]; then
  echo "Usage: bash abc_3layer_analyze.sh <input.abc> [output.abc] [model]" >&2
  exit 1
fi

ABC=$(cat "$INPUT")
MEASURES=$(grep -oE '%[0-9]+' "$INPUT" | grep -oE '[0-9]+' | sort -n | tail -1)
echo "[INFO] input=$INPUT measures=$MEASURES model=$MODEL" >&2

SYSTEM='You are a top-tier music analyst specializing in Romantic-era piano music. You produce annotated ABC with three comment layers (HARM/FORM/PERF). STRICT CONSTRAINTS (unconditional):

== ABSOLUTE PRESERVATION ==
1. Every original character preserved VERBATIM: notes, rests, dynamics (!p!, !mp!), slurs, ornaments, chord labels ("Gm"), expression marks ("^Andante"), bar lines (|, |:, :|, ||), repeats ([1 [2), %N measure numbers, V:1/V:2 headers
2. NEVER modify existing lines. NEVER reformat. NEVER "correct" notes or chords.
3. Original line breaks MUST be preserved. Do NOT split lines at bar lines |.
4. Insert %ANALYSIS blocks ONLY before lines where a NEW measure begins at the line start. If multiple measures are on one line, that line gets ONE annotation block (before the line) covering ALL measures on that line.
5. ANY modification to original notes/rest/dynamic/expression/linebreak = task FAILED.

== COMPLETENESS ==
6. Output MUST cover ALL measures from 1 to the LAST measure number in input. NEVER stop early.
7. V:1 AND V:2 parts MUST both be preserved verbatim. V:2 bass notes MUST NOT be deleted.
8. If you stop before the last measure, task FAILED.

== THREE-LAYER COMMENTS (per line, covering all measures on that line) ==
Insert before each music line that starts a new measure:
%ANALYSIS HARM N: m<a>=<chord> -> m<b>=<chord> -> ...
%ANALYSIS FORM N: m<a>:<form> | m<b>:<form> | ...
%ANALYSIS PERF N: m<a>:<perf 25chars max> | m<b>:<perf> | ...

Where N = the FIRST measure number on this line.

%HARM rules:
- Format: m1=Dm -> m2=Bbmaj7 -> m3=Gm6 (explicit measure number prefix for each chord)
- Root uppercase, m=minor, 7=seventh, dim7=diminished seventh, m7b5=half-dim, sus4, add6
- Inversion via /bass: F/A, G7/B, F#dim7/Eb
- If a measure has internal chord change: m5=Dm Gm/Bb (chords separated by space, mN= prefix applies to first chord, subsequent chords before next mN= belong to same measure)
- Combine V:1 melody + V:2 bass to judge; bass determines root
- Identify secondary dominants, diminished passing, cadences

%FORM rules:
- Format: m5:A1 主题陈述 | m6:A1 主题陈述 | ...
- A/B/C thematic sections, 1/2 variations, T transition, Codetta, Coda
- Chinese parenthetical function 15chars max per measure
- Parallel phrases use same letter (A1/A2)
- Mark tonal return / modulation

%PERF rules:
- Format: m5:断奏伴奏 轻巧 建立基调 | m6:如歌连奏 突出旋律 | ...
- Chinese keywords 25chars max per measure, 动作+形容词+目的 format
- Combine with existing ! and ^ marks, do not repeat verbatim
- Highlight the measure key point

== OUTPUT FORMAT ==
9. Pure ABC text, no markdown, no code fences, no explanation, no preamble.
10. Start with X:1, end with original last note.
11. Comment lines on their own lines, NOT mixed into music lines.
12. After output, self-verify: original line count = your output music line count.'

USER='Analyze this ABC and produce annotated ABC with %ANALYSIS HARM/FORM/PERF layers. Follow system rules strictly. ABC:
'"$ABC"

echo "[CALL] Magica $MODEL max=16384 temp=0.4 reasoning=true" >&2
bash /Users/yay/workspace/genspark-agent/server-v2/scripts/magica_call.sh \
  "$MODEL" \
  "$USER" \
  --system "$SYSTEM" \
  --max 16384 \
  --temp 0.4 \
  --reasoning \
  --json-out /tmp/3layer_v4_resp.json \
  > "$OUTPUT" 2> /tmp/3layer_v4.log

echo "[DONE] output=$OUTPUT" >&2
cat /tmp/3layer_v4.log >&2

python3 << PYEOF 2>&1 >&2
import re
orig = open("$INPUT").read()
ann = open("$OUTPUT").read()
music_lines = [l for l in ann.split('\n') if not l.startswith('%ANALYSIS')]
print(f"[VERIFY] original lines: {len(orig.split(chr(10)))}")
print(f"[VERIFY] annotated lines: {len(ann.split(chr(10)))}")
print(f"[VERIFY] %ANALYSIS lines: {sum(1 for l in ann.split(chr(10)) if l.startswith('%ANALYSIS'))}")
print(f"[VERIFY] music lines: {len(music_lines)}")
print(f"[VERIFY] preserved? {orig.strip() == chr(10).join(music_lines).strip()}")
harm = re.findall(r'%ANALYSIS HARM (\d+):', ann)
if harm:
    print(f"[VERIFY] HARM blocks: {len(harm)}, range {min(int(h) for h in harm)}-{max(int(h) for h in harm)}")
    m_tags = re.findall(r'm(\d+)=', ann)
    print(f"[VERIFY] explicit mN= tags: {len(m_tags)}")
    if m_tags:
        covered = sorted(set(int(m) for m in m_tags))
        print(f"[VERIFY] measures covered: {covered}")
PYEOF
