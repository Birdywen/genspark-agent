// Regression suite for the omega tool surfaces that are not the guard: argument
// validation, edit commit semantics, and the write fences added 2026-09-28.
// Runs against the real modules with a temp scratch dir; touches no real file
// and no real database row.
//
// Run: node mcp/tools-ext.test.js
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspectCommand } from './batch-guard.mjs';
import { omegaEdit, omegaUndo, omegaGrep, EXTRA_TOOLS } from './tools-ext.mjs';

let pass = 0;
const failures = [];
const ok = (cond, label) => { if (cond) pass++; else failures.push(label); };
const scratch = mkdtempSync(path.join(tmpdir(), 'omega-tools-test-'));

// ---- omega_edit: same-file chaining (the 2026-09-28 correctness fix) ----
// Each oldString must stay unique ACROSS the whole file, including the text an
// earlier edit produced, or the ambiguity check (correctly) refuses. Using
// distinct tokens proves the second edit really reads the first edit's output.
{
  const f = path.join(scratch, 'chain.txt');
  writeFileSync(f, 'one\ntwo\nthree\n');
  const r = omegaEdit({ edits: [
    { path: f, oldString: 'one', newString: 'ONE' },
    { path: f, oldString: 'two', newString: 'TWO-CHAINED' },
  ] });
  ok(!r.isError, 'chained same-file edits must succeed: ' + r.text);
  ok(readFileSync(f, 'utf8') === 'ONE\nTWO-CHAINED\nthree\n',
    'both edits must survive, later one seeing the earlier: got ' + JSON.stringify(readFileSync(f, 'utf8')));
  ok(/@@ lines/.test(r.text), 'result must carry a hunk diff');
}

// ---- omega_edit: one failure voids the whole batch ----
{
  const a = path.join(scratch, 'two-phase-a.txt');
  const b = path.join(scratch, 'two-phase-b.txt');
  writeFileSync(a, 'keep\n');
  writeFileSync(b, 'keep\n');
  const r = omegaEdit({ edits: [
    { path: a, oldString: 'keep', newString: 'CHANGED' },
    { path: b, oldString: 'nope-not-present', newString: 'x' },
  ] });
  ok(r.isError, 'a missing oldString must fail the batch');
  ok(readFileSync(a, 'utf8') === 'keep\n', 'first edit must be rolled back, got ' + readFileSync(a, 'utf8'));
  ok(r.text.includes('[void]'), 'failure report must mark applied-looking lines as void');
  ok(/every \[void\] line below was NOT applied/.test(r.text), 'failure report must say the [ok] lines never landed');
}

// ---- omega_edit: createIfMissing ----
{
  const f = path.join(scratch, 'created', 'new.txt');
  const r = omegaEdit({ createIfMissing: true, edits: [{ path: f, oldString: '', newString: 'hello\n' }] });
  ok(!r.isError, 'createIfMissing must scaffold a file: ' + r.text);
  ok(existsSync(f) && readFileSync(f, 'utf8') === 'hello\n', 'scaffolded file must hold the new content');
  // A new file whose oldString is not empty is a mistake, not a partial match.
  const g = path.join(scratch, 'created', 'bad.txt');
  const r2 = omegaEdit({ createIfMissing: true, edits: [{ path: g, oldString: 'something', newString: 'x' }] });
  ok(r2.isError, 'createIfMissing must reject a non-empty oldString for a missing file');
  ok(!existsSync(g), 'a rejected create must not leave the file behind');
}

// ---- omega_undo: restores content AND deletes created files ----
{
  const f = path.join(scratch, 'undo-me.txt');
  writeFileSync(f, 'original\n');
  const r = omegaEdit({ edits: [{ path: f, oldString: 'original', newString: 'changed' }] });
  ok(!r.isError, 'edit before undo must succeed');
  const m = /undo point: (edit-[a-z0-9-]+)/.exec(r.text);
  ok(!!m, 'edit result must report an undo point id, got: ' + r.text);
  if (m) {
    ok(readFileSync(f, 'utf8') === 'changed\n', 'file must be changed before undo, got ' + readFileSync(f, 'utf8'));
    const u = omegaUndo({ batchId: m[1] });
    ok(!u.isError, 'undo must succeed: ' + u.text);
    ok(readFileSync(f, 'utf8') === 'original\n', 'undo must restore original content, got ' + readFileSync(f, 'utf8'));
    const again = omegaUndo({ batchId: m[1], dryRun: true });
    ok(!again.isError, 'undo dryRun must not error');
  }
  const created = path.join(scratch, 'undo-created.txt');
  const rc = omegaEdit({ createIfMissing: true, edits: [{ path: created, oldString: '', newString: 'temp\n' }] });
  const mc = /undo point: (edit-[a-z0-9-]+)/.exec(rc.text);
  ok(!!mc, 'create edit must also report an undo point');
  if (mc) {
    ok(existsSync(created), 'created file must exist before undo');
    omegaUndo({ batchId: mc[1] });
    ok(!existsSync(created), 'undo must DELETE a file that did not exist before, not blank it');
  }
}

// ---- omega_grep: refuses near-miss parameter names ----
{
  const wrong = await omegaGrep({ pattern: 'x', path: scratch });
  ok(wrong.isError, 'omega_grep must reject the `path` parameter instead of silently ignoring it');
  ok(wrong.text.includes('"path" -> use "dir"'), 'omega_grep must name the correct parameter: ' + wrong.text);
  const right = await omegaGrep({ pattern: 'TWO-CHAINED', dir: scratch });
  ok(!right.isError && right.text.includes('chain.txt'), 'omega_grep must still find matches with dir: ' + right.text);
}

// ---- tool registry sanity ----
// The two hosts DIVERGE on db_query by design: Mac runs the write-enabled build
// (DML + whitelist + auto .backup), Oracle keeps the original read-only build
// because its db_query is maintained separately there. The suite detects which
// build it is running against and asserts the right contract for each, so one
// file can guard both hosts instead of forking.
{
  const names = EXTRA_TOOLS.map((t) => t.name);
  for (const n of ['omega_undo', 'db_query', 'omega_edit', 'omega_batch_status', 'omega_grep']) {
    ok(names.includes(n), `EXTRA_TOOLS must advertise ${n}`);
  }
  const dbDef = EXTRA_TOOLS.find((t) => t.name === 'db_query');
  const writeEnabled = !!(dbDef && dbDef.inputSchema.properties.dryRun);
  if (writeEnabled) {
    ok(/refused/i.test(dbDef.description) && /backup/i.test(dbDef.description),
      'write-enabled db_query must state the fence and the snapshot');
    ok(/snapshot|backup/i.test(dbDef.description), 'write-enabled db_query must document the snapshot');
  } else {
    ok(/Writes are refused\./.test(dbDef.description),
      'read-only db_query must still say writes are refused');
    ok(!dbDef.inputSchema.properties.dryRun, 'read-only db_query must not advertise dryRun');
  }
  for (const t of EXTRA_TOOLS) {
    if (t.name === 'omega_undo') ok(t.inputSchema.required.includes('batchId'), 'omega_undo must require batchId');
    if (t.name === 'omega_edit') ok(t.inputSchema.properties.createIfMissing, 'omega_edit must expose createIfMissing');
    if (t.name === 'omega_batch_status') ok(t.inputSchema.properties.waitMs, 'omega_batch_status must expose waitMs');
    ok(typeof t.description === 'string' && t.description.length > 0, `${t.name} must carry a non-empty description`);
  }
  console.log(`  (db_query build on this host: ${writeEnabled ? 'write-enabled' : 'read-only'})`);
}

// ---- guard still refuses after the false-positive fix ----
ok(!inspectCommand('echo x > /etc/x').ok, 'guard must still refuse an absolute redirect');
ok(inspectCommand('node -e "x => x"').ok, 'guard must allow an arrow function');
ok(inspectCommand('echo x > /tmp/f').ok, 'guard must allow /tmp');

rmSync(scratch, { recursive: true, force: true });

console.log(`tools-ext: ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error('  FAIL ' + f);
  process.exit(1);
}