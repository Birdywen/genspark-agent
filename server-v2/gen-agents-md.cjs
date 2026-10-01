#!/usr/bin/env node
// Render the forged rules from agent.db into an AGENTS.md that opencode loads
// automatically. update-forged.cjs writes only to the database; this projects the
// same content onto disk without touching that script.
//
// Usage: node gen-agents-md.cjs [--out PATH] [--dry-run]

const Database = require('better-sqlite3');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DB = process.env.OMEGA_DB
  || path.join(os.homedir(), 'workspace/genspark-agent/server-v2/data/agent.db');
const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const outIdx = argv.indexOf('--out');
const OUT = outIdx >= 0 ? argv[outIdx + 1] : path.join(os.homedir(), 'AGENTS.md');

const db = new Database(DB, { readonly: true });

function schema(key) {
  const r = db.prepare("SELECT content FROM memory WHERE slot='forged' AND key=?").get(key);
  if (!r) return null;
  try { return JSON.parse(r.content); } catch { return r.content; }
}

const meta = schema('schema-meta') || {};
const philosophy = schema('schema-philosophy');
const rules = schema('schema-rules') || {};
const params = schema('schema-params') || {};
const infra = schema('schema-infra') || {};
const recall = schema('schema-recall_map') || {};
const batch = schema('schema-batch') || {};

const lessons = db.prepare(
  "SELECT key, content FROM memory WHERE slot='forged' AND key LIKE 'lesson-%' AND key NOT IN ('lesson-bash-tempfile-escaping','lesson-edit-file-refresh-before-patch','lesson-json-over-csv','lesson-long-prompts-need-higher-timeout','lesson-missing-logs-dir-kills-nohup','lesson-nohup-setsid-fake-pid','lesson-omega-no-html-tags','lesson-expect-keyword-too-broad') ORDER BY key"
).all();

const out = [];
const p = (s) => out.push(s);

p('# Operating rules');
p('');
p(`Generated from agent.db forged memory on ${new Date().toISOString().slice(0, 19)}Z.`);
p(`Source of truth is the database, not this file. Regenerate with gen-agents-md.cjs.`);
p(`Modules: ${(meta.modules || []).join(', ') || 'n/a'}`);
p('');

if (philosophy) {
  p('## Approach');
  p('');
  p(String(philosophy).split('\\n').join('\n'));
  p('');
}

p('## Hard-won lessons');
p('');
p(`${lessons.length} lessons recorded. Each one cost a failed attempt.`);
p('');
for (const l of lessons) {
  const body = String(l.content).split('\\n').join('\n').trim();
    // OPENCODE_SUPERSEDED / nesting fix (2026-09-27): some lesson bodies begin with
    // their own '# Title'. Emitted verbatim they outranked the '### key' heading above
    // and silently reparented every later lesson. Demote body headings by three levels.
    const safeBody = body.replace(/^(#{1,6})([ \t])/gm, (m, h, s) =>
      '#'.repeat(Math.min(6, h.length + 3)) + s);
  p(`### ${l.key.replace(/^lesson-/, '')}`);
  p('');
  p(safeBody);
  p('');
}

if (rules.daily) {
  p('## Daily working rules');
  p('');
  for (const d of rules.daily) p(`- ${d}`);
  p('');
}

if (rules.tool_format || rules.error_fix) {
  p('## Tool usage and error recovery');
  p('');
  for (const [k, v] of Object.entries(rules.tool_format || {})) p(`- **${k}**: ${v}`);
  for (const [k, v] of Object.entries(rules.error_fix || {})) p(`- **${k}**: ${v}`);
  p('');
}

if (Object.keys(params).length) {
  p('## Parameter gotchas');
  p('');
  for (const [k, v] of Object.entries(params)) p(`- **${k}**: ${v}`);
  p('');
}

if (recall.where_to_look) {
  p('## Check before building');
  p('');
  p(recall.law || '');
  p('');
  for (const [k, v] of Object.entries(recall.where_to_look)) p(`- ${k}: \`${v}\``);
  p('');
}

if (batch.law || (batch.notes || []).length) {
  p('## Running batches (omega_batch)');
  p('');
  if (batch.law) { p(batch.law); p(''); }
  for (const n of batch.notes || []) p(`- ${n}`);
  p('');
}

if (Object.keys(infra).length) {
  p('## Infrastructure');
  p('');
  for (const [k, v] of Object.entries(infra)) {
    if (typeof v === 'object') continue;
    p(`- **${k}**: ${v}`);
  }
  p('');
}

const content = out.join('\n');
// `content.length` counts UTF-16 code units, NOT bytes. This file is mostly
// Chinese, where each char is 1 unit but 3 UTF-8 bytes -- so the two numbers
// differ by ~50%. That gap caused a near-miss on 2026-10-01: the dry-run printed
// "bytes=15402" next to a 23506-byte on-disk file, which reads as "regeneration
// would destroy 8KB of constitution". Nothing would have been lost. A safety
// tool that mislabels its own output size is worse than no label at all.
const byteSize = Buffer.byteLength(content, 'utf8');
console.log(`lessons=${lessons.length} bytes=${byteSize} units=${content.length} out=${OUT}`);
if (dryRun) {
  console.log('--- first 40 lines ---');
  console.log(content.split('\n').slice(0, 40).join('\n'));
  console.log('DRY_RUN_DONE');
} else {
  // Always keep a timestamped copy before overwriting. The old rule only backed
  // up when the file LACKED the generated marker -- so a hand-edited AGENTS.md
  // (which still carries the marker from an earlier run) was silently
  // overwritten with no backup at all. Backups are cheap; a lost constitution
  // is not. Skip the backup when nothing would actually be lost.
  //
  // The comparison must IGNORE the "Generated from ... on <ISO>." line: it is a
  // fresh timestamp on every run, so a plain byte compare reports a change on
  // every regen and litters a backup each time. Verified 2026-10-01: two
  // consecutive identical runs produced two backups differing only in that
  // stamp. Once backups are routine they stop being read, and a directory of
  // noise is how a real backup gets missed.
  if (fs.existsSync(OUT)) {
    const prev = fs.readFileSync(OUT, 'utf8');
    const stripStamp = (s) => s.replace(/^Generated from agent\.db forged memory on .*$/m, '');
    if (stripStamp(prev).trim() !== stripStamp(content).trim()) {
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z');
      const backup = `${OUT}.${stamp}.bak`;
      fs.writeFileSync(backup, prev);
      console.log(`content changed -> backup ${backup}`);
    } else {
      console.log('content unchanged (ignoring generated-at stamp) -> no backup needed');
    }
  }
  fs.writeFileSync(OUT, content, 'utf8');
  console.log(`WROTE ${OUT} (${byteSize} bytes)`);
}
db.close();
