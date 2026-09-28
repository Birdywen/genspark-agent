// Extra tools for the omega MCP bridge: vfs_local_write, db_query (read-only),
// and an async omega_batch runner. Kept in a separate module so server.mjs stays
// readable; imported dynamically so a failure here cannot stop run_process.

import { writeFileSync, mkdirSync, readFileSync, existsSync, statSync, copyFileSync, rmSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import path from 'node:path';
import { guardSteps, inspectCommand } from './batch-guard.mjs';

const DB = process.env.OMEGA_DB
  || path.join(homedir(), 'workspace/genspark-agent/server-v2/data/agent.db');
const DBFILE_DIR = path.dirname(path.dirname(DB));

// ---------- write snapshots (pre-write backup + rollback) ----------
// Ported from the Mac bridge 2026-09-28. db_query here is INTENTIONALLY left
// read-only (this host's db_query is maintained separately), so nothing in this
// section touches SQL; it is purely the file-level undo net for omega_edit.
const SNAP_DIR = process.env.OMEGA_SNAP_DIR || '/tmp/omega-snaps';
const snapStats = new Map(); // batchId -> [{ path, snap, existed }]

function snapshotFile(abs, batchId) {
  mkdirSync(SNAP_DIR, { recursive: true });
  const sha = createHash('sha256').update(readFileSync(abs)).digest('hex').slice(0, 16);
  const snap = path.join(SNAP_DIR, `${sha}.snap`);
  if (!existsSync(snap)) copyFileSync(abs, snap);
  const list = snapStats.get(batchId) || [];
  list.push({ path: abs, snap, existed: true });
  snapStats.set(batchId, list);
  return snap;
}

function snapshotMissing(abs, batchId) {
  mkdirSync(SNAP_DIR, { recursive: true });
  const sha = createHash('sha256').update(abs).digest('hex').slice(0, 16);
  const snap = path.join(SNAP_DIR, `absent-${sha}.snap`);
  if (!existsSync(snap)) writeFileSync(snap, '');
  const list = snapStats.get(batchId) || [];
  list.push({ path: abs, snap, existed: false });
  snapStats.set(batchId, list);
}

// Restoring a file that never existed means deleting what we created, not
// writing an empty file over it -- otherwise "undo" leaves litter behind.
function restoreOne(entry) {
  if (entry.existed) {
    mkdirSync(path.dirname(entry.path), { recursive: true });
    copyFileSync(entry.snap, entry.path);
    return `restored ${entry.path}`;
  }
  rmSync(entry.path, { force: true });
  return `removed ${entry.path} (did not exist before)`;
}

function persistSnapManifest(batchId, list) {
  mkdirSync(SNAP_DIR, { recursive: true });
  writeFileSync(path.join(SNAP_DIR, `${batchId}.json`), JSON.stringify(list, null, 1));
}

export function omegaUndo(args) {
  const batchId = args.batchId;
  if (!batchId) return { isError: true, text: 'batchId is required' };
  let list = snapStats.get(batchId);
  const f = path.join(SNAP_DIR, `${batchId}.json`);
  if (!list && existsSync(f)) list = JSON.parse(readFileSync(f, 'utf8'));
  if (!list || !list.length) return { isError: true, text: `no snapshot for batch: ${batchId}` };
  const dry = args.dryRun === true;
  if (args.paths) {
    const want = new Set((Array.isArray(args.paths) ? args.paths : [args.paths]).map((p) => path.resolve(p)));
    list = list.filter((e) => want.has(e.path));
    if (!list.length) return { isError: true, text: 'no snapshot entries match the given paths' };
  }
  const lines = list.map((e) => (dry ? `[dry] ${restoreOne(e)}` : restoreOne(e)));
  return {
    isError: false,
    text: `undo ${batchId}: ${list.length} file(s) ${dry ? 'WOULD BE RESTORED (DRY-RUN)' : 'restored'}\n${lines.join('\n')}`,
  };
}

// ---------- vfs_local_write ----------
// Exists so content with quotes, $, newlines or CJK never has to survive a shell
// quoting layer: write the file, then run it.
export function vfsLocalWrite(args) {
  const p = args.path;
  if (!p) return { isError: true, text: 'path is required' };
  let body;
  if (args.content_b64 !== undefined) {
    body = Buffer.from(args.content_b64, 'base64').toString('utf8');
  } else if (args.content_file !== undefined) {
    body = readFileSync(args.content_file, 'utf8');
  } else if (args.content !== undefined) {
    body = String(args.content);
  } else {
    return { isError: true, text: 'one of content / content_b64 / content_file is required' };
  }
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, body, { encoding: 'utf8', flag: args.append ? 'a' : 'w' });
  return { isError: false, text: `written: ${p} (${body.length} chars)` };
}

// ---------- db_query (read-only) ----------
const WRITE_RE = /^\s*(insert|update|delete|drop|alter|create|replace|truncate|vacuum|attach|detach|pragma\s+\w+\s*=)/i;

export function dbQuery(args) {
  let sql = args.sql;
  if (args.sql_b64) sql = Buffer.from(args.sql_b64, 'base64').toString('utf8');
  if (!sql) return Promise.resolve({ isError: true, text: 'sql or sql_b64 is required' });
  // Read-only on purpose: the model drives these calls unattended, and this
  // database is the recovered asset store. Writes go through a human-run path.
  if (WRITE_RE.test(sql)) {
    return Promise.resolve({
      isError: true,
      text: 'refused: this bridge is read-only (SELECT/PRAGMA/EXPLAIN/WITH only). '
        + 'Run writes yourself via dbfile.cjs.',
    });
  }
  return new Promise((resolve) => {
    const child = spawn('node', ['dbfile.cjs', 'query', sql], {
      cwd: DBFILE_DIR, env: process.env,
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 60000);
    child.on('close', (code) => {
      clearTimeout(t);
      const text = (out || err || '(no output)').slice(0, 60000);
      resolve({ isError: code !== 0, text: code === 0 ? text : `exit=${code}\n${text}` });
    });
    child.on('error', (e) => { clearTimeout(t); resolve({ isError: true, text: e.message }); });
  });
}

// ---------- omega_batch (async) ----------
// MCP tools/call is request/response, but a batch can run for minutes, so the
// call returns a job id immediately and progress is polled separately.
const jobs = new Map();
const JOB_DIR = process.env.OMEGA_JOB_DIR || '/tmp/omega-jobs';

export function omegaBatch(args, runProcess) {
  // Enforced, not merely requested: MCP calls are permission-checked under their
  // own action name (permission=omega_omega_batch in the log), so a shell:deny or
  // edit:deny on the caller does not reach a batch step. Refuse content writes here.
  const objection = guardSteps(args && args.steps);
  if (objection) return { isError: true, text: objection };

  const steps = args.steps;
  if (!Array.isArray(steps) || !steps.length) {
    return Promise.resolve({ isError: true, text: 'steps must be a non-empty array' });
  }
  const id = `job-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const job = {
    id, total: steps.length, done: 0, started: new Date().toISOString(),
    state: 'running', results: [], stopOnError: args.stopOnError !== false,
  };
  jobs.set(id, job);
  mkdirSync(JOB_DIR, { recursive: true });

  (async () => {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const label = step.label || step.command_line?.slice(0, 60) || `step${i + 1}`;
      try {
        const r = await runProcess({
          command_line: step.command_line,
          timeout: step.timeout,
          cwd: step.cwd,
          stdin: step.stdin,
        });
        let ok = !r.isError;
        let note = '';
        // Semantic acceptance: a zero exit code does not mean the task succeeded.
        if (ok && step.expect) {
          const e = step.expect;
          const has = (s) => r.text.includes(s);
          const list = (v) => (Array.isArray(v) ? v : [v]);
          if (e.contains && !list(e.contains).every(has)) {
            ok = false; note = `expect.contains failed: ${list(e.contains).filter((s) => !has(s)).join(', ')}`;
          }
          if (ok && e.notContains && list(e.notContains).some(has)) {
            ok = false; note = `expect.notContains hit: ${list(e.notContains).filter(has).join(', ')}`;
          }
          if (ok && e.regex && !new RegExp(e.regex, 'm').test(r.text)) {
            ok = false; note = `expect.regex failed: ${e.regex}`;
          }
        }
        job.results.push({ i: i + 1, label, ok, note, text: r.text.slice(0, 4000) });
        job.done = i + 1;
        if (!ok && job.stopOnError) {
          job.state = 'failed';
          job.results.push({ i: i + 2, label: '(halted)', ok: false, note: 'stopOnError', text: '' });
          break;
        }
      } catch (e) {
        job.results.push({ i: i + 1, label, ok: false, note: String(e.message), text: '' });
        job.done = i + 1;
        if (job.stopOnError) { job.state = 'failed'; break; }
      }
    }
    if (job.state === 'running') {
      job.state = job.results.every((r) => r.ok) ? 'success' : 'partial';
    }
    job.finished = new Date().toISOString();
    try {
      writeFileSync(path.join(JOB_DIR, `${id}.json`), JSON.stringify(job, null, 1));
    } catch { /* best effort */ }
  })();

  return Promise.resolve({
    isError: false,
    text: `batch started: ${id} (${steps.length} steps)\n`
      + `Poll with omega_batch_status {"id":"${id}"}.`,
  });
}

export function omegaBatchStatus(args) {
  const id = args.id;
  // waitMs blocks so a caller can get the verdict in ONE call instead of
  // submit-then-poll. Capped below the host's MCP timeout on purpose: a host
  // that cuts the call at 60s would lose the reply entirely.
  const waitMs = Math.min(50000, Math.max(0, Number(args.waitMs) || 0));
  const render = (job) => {
    if (!job) return null;
    const lines = [`batch ${job.id}: ${job.state} ${job.done}/${job.total}`];
    for (const r of job.results) {
      lines.push(`  [${r.ok ? 'ok' : 'FAIL'}] ${r.i}. ${r.label}${r.note ? ` -- ${r.note}` : ''}`);
      if (!r.ok && r.text) lines.push(`      ${r.text.split('\n').slice(0, 6).join('\n      ').slice(0, 700)}`);
    }
    if (args.verbose) {
      for (const r of job.results) {
        lines.push(`--- step ${r.i} ${r.label} ---`, r.text.slice(0, 3000));
      }
    }
    return { isError: job.state === 'failed', text: lines.join('\n') };
  };
  if (waitMs) {
    const started = Date.now();
    return new Promise((resolve) => {
      const tick = () => {
        const job = jobs.get(id) || (existsSync(path.join(JOB_DIR, `${id}.json`))
          ? JSON.parse(readFileSync(path.join(JOB_DIR, `${id}.json`), 'utf8')) : null);
        const done = job && job.state !== 'running';
        if (done || Date.now() - started >= waitMs) {
          const r = render(job);
          resolve(r || { isError: true, text: `no such batch: ${id}` });
          return;
        }
        setTimeout(tick, 300);
      };
      tick();
    });
  }
  let job = jobs.get(id);
  if (!job) {
    const f = path.join(JOB_DIR, `${id}.json`);
    if (existsSync(f)) job = JSON.parse(readFileSync(f, 'utf8'));
  }
  if (!job) return { isError: true, text: `no such batch: ${id}` };
  const lines = [`batch ${job.id}: ${job.state} ${job.done}/${job.total}`];
  for (const r of job.results) {
    lines.push(`  [${r.ok ? 'ok' : 'FAIL'}] ${r.i}. ${r.label}${r.note ? ` -- ${r.note}` : ''}`);
    if (!r.ok && r.text) lines.push(`      ${r.text.split('\n').slice(0, 6).join('\n      ').slice(0, 700)}`);
  }
  if (args.verbose) {
    for (const r of job.results) {
      lines.push(`--- step ${r.i} ${r.label} ---`, r.text.slice(0, 3000));
    }
  }
  return { isError: job.state === 'failed', text: lines.join('\n') };
}

// ---------- omega_read (many files, one call) ----------
// Builtin Read does one file per call, so a 9-file recon costs 9 round trips.
// This packs N files -- each optionally sliced by line range and/or filtered by
// a regex -- into a single capped response. Pure fs, no shell quoting involved.
const READ_DEFAULT_LINES = 120;
const READ_MAX_LINES = 500;
const READ_DEFAULT_MATCHES = 30;
const READ_TOTAL_CAP = 20000;

export function omegaRead(args) {
  const list = Array.isArray(args.files) ? args.files
    : (args.path ? [{ path: args.path }] : null);
  if (!list || !list.length) {
    return { isError: true, text: 'files must be a non-empty array of {path, startLine?, lineCount?, pattern?, maxMatches?} (a plain path string also works)' };
  }
  // Relative paths resolve against baseDir, NOT the MCP server's own cwd: the
  // server is launched once with a fixed cwd while sessions come and go, so a
  // bare relative path silently resolved against the wrong root.
  const baseDir = path.resolve(
    args.baseDir || process.env.OMEGA_READ_BASE || process.cwd(),
  );
  const relMisses = [];
  const out = [];
  let total = 0;
  let okCount = 0;
  for (const item of list) {
    const spec = typeof item === 'string' ? { path: item } : (item || {});
    const p = spec.path;
    if (!p) { out.push('--- (spec without path, skipped) ---'); continue; }
    if (total >= READ_TOTAL_CAP) { out.push(`--- ${p} NOT READ: total cap ${READ_TOTAL_CAP} chars reached, narrow with startLine/lineCount/pattern ---`); continue; }
    const abs = path.isAbsolute(p) ? p : path.resolve(baseDir, p);
    if (!existsSync(abs)) {
      const why = path.isAbsolute(p)
        ? `${p} NOT FOUND`
        : `${p} NOT FOUND (relative to baseDir ${baseDir} -> ${abs}; pass an absolute path or set baseDir)`;
      if (!path.isAbsolute(p)) relMisses.push(p);
      out.push(`--- ${why} ---`);
      continue;
    }
    let st;
    try { st = statSync(abs); } catch (e) { out.push(`--- ${p} STAT FAILED: ${e.message} ---`); continue; }
    if (!st.isFile()) { out.push(`--- ${p} NOT A FILE ---`); continue; }
    let text;
    try { text = readFileSync(abs, 'utf8'); } catch (e) { out.push(`--- ${p} READ FAILED: ${e.message} ---`); continue; }
    if (text.includes('\0')) { out.push(`--- ${p} BINARY (${st.size} bytes, skipped) ---`); continue; }
    const lines = text.split('\n');
    const remain = READ_TOTAL_CAP - total;
    let chunk;
    if (spec.pattern) {
      let re;
      try { re = new RegExp(spec.pattern, 'im'); } catch (e) { out.push(`--- ${p} BAD PATTERN: ${e.message} ---`); continue; }
      const max = Math.min(spec.maxMatches || READ_DEFAULT_MATCHES, 100);
      const hits = [];
      for (let i = 0; i < lines.length && hits.length < max; i++) {
        if (re.test(lines[i])) hits.push(`${i + 1}: ${lines[i]}`.slice(0, 500));
      }
      chunk = `=== ${p} pattern=/${spec.pattern}/ ${hits.length} match(es) of ${lines.length} lines ===\n${hits.join('\n')}`;
    } else {
      const start = Math.max((spec.startLine || 1) - 1, 0);
      const count = Math.min(spec.lineCount || READ_DEFAULT_LINES, READ_MAX_LINES);
      const slice = lines.slice(start, start + count);
      chunk = `=== ${p} lines ${start + 1}..${start + slice.length} of ${lines.length} ===\n${slice.join('\n')}`;
    }
    chunk = chunk.slice(0, remain);
    out.push(chunk);
    total += chunk.length;
    okCount++;
  }
  if (okCount === 0 && relMisses.length) {
    out.push(`\nHINT: ${relMisses.length} relative path(s) missed against baseDir ${baseDir}. `
      + 'The MCP server cwd is NOT the session directory. Retry with absolute paths, '
      + 'or pass baseDir=<the project dir> / set OMEGA_READ_BASE.');
  }
  return { isError: okCount === 0, text: `omega_read: ${okCount}/${list.length} file(s), ${total} chars (cap ${READ_TOTAL_CAP}${okCount ? `, base ${baseDir}` : ''})\n\n${out.join('\n\n')}` };
}

// ---------- omega_guard_check (dry-run) ----------
// Ask the guard before spending a real run: same inspectCommand as omega_batch,
// no execution. Returns PASS/REFUSE per command so the agent fixes the
// command_line first instead of failing a batch job.
export function omegaGuardCheck(args) {
  const list = Array.isArray(args.commands) ? args.commands
    : (args.command_line ? [args.command_line] : null);
  if (!list || !list.length) {
    return { isError: true, text: 'commands must be a non-empty array of command_line strings (or a single command_line)' };
  }
  const out = [];
  let refused = 0;
  list.forEach((cmd, i) => {
    const r = inspectCommand(cmd);
    if (r.ok) out.push(`[PASS] #${i + 1}: ${String(cmd).slice(0, 120)}`);
    else { refused++; out.push(`[REFUSE] #${i + 1}: ${r.problems.join('; ')}`); }
  });
  out.unshift(`guard_check: ${list.length - refused}/${list.length} pass`);
  return { isError: refused > 0, text: out.join('\n') };
}

// ---------- omega_grep (server-side search) ----------
// Recon currently costs a subagent plus one omega_read per file. A capped
// path:line search answers "where is X" in one call without touching context.
// ripgrep when present, grep -rn fallback (Oracle has no rg). Read-only.
const GREP_MAX_MATCHES = 100;
const GREP_TOTAL_CAP = 8000;

// `dir` and `include` are the parameter names, but callers reach for the builtin
// grep/read names instead -- passing `path` here used to be silently ignored, so
// the search ran against baseDir (the server cwd) and returned a confident,
// completely unrelated result set. A wrong-but-plausible answer is worse than
// an error, so name the near-misses and refuse instead of guessing.
const GREP_ALIASES = { path: 'dir', file: 'include', glob: 'include' };

export function omegaGrep(args) {
  const pattern = args.pattern;
  if (!pattern) return Promise.resolve({ isError: true, text: 'pattern is required' });
  const wrong = Object.keys(GREP_ALIASES).filter((k) => args[k] !== undefined);
  if (wrong.length) {
    return Promise.resolve({
      isError: true,
      text: `unknown parameter(s) for omega_grep: ${wrong.join(', ')}. `
        + wrong.map((k) => `"${k}" -> use "${GREP_ALIASES[k]}"`).join('; ')
        + '. omega_grep searches with `dir` (directory to search) and `include` (glob filter); '
        + 'refusing rather than silently searching the wrong place.',
    });
  }
  const baseDir = path.resolve(args.baseDir || process.env.OMEGA_READ_BASE || process.cwd());
  const dir = path.isAbsolute(args.dir || '') ? args.dir : path.resolve(baseDir, args.dir || '.');
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return Promise.resolve({ isError: true, text: `dir not found or not a directory: ${dir} (baseDir ${baseDir})` });
  }
  const max = Math.min(args.maxMatches || 30, GREP_MAX_MATCHES);
  const include = args.include;
  return new Promise((resolve) => {
    let useRg = false;
    try { execFileSync('rg', ['--version'], { stdio: 'ignore' }); useRg = true; } catch { /* fallback */ }
    let cmd, cmdArgs;
    if (useRg) {
      cmdArgs = ['--line-number', '--no-heading', '--color=never', '-e', pattern];
      if (args.ignoreCase) cmdArgs.push('--ignore-case');
      if (include) cmdArgs.push('--glob', include);
      cmdArgs.push('--', dir);
      cmd = 'rg';
    } else {
      cmdArgs = ['-rn', '-I'];
      if (args.ignoreCase) cmdArgs.push('-i');
      if (include) cmdArgs.push(`--include=${include}`);
      cmdArgs.push('-e', pattern, '--', dir);
      cmd = 'grep';
    }
    const child = spawn(cmd, cmdArgs, { cwd: baseDir });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 30000);
    child.on('close', () => {
      clearTimeout(t);
      const all = out.split('\n').filter((l) => l.trim());
      const lines = all.slice(0, max);
      const text = lines.map((l) => l.slice(0, 500)).join('\n').slice(0, GREP_TOTAL_CAP);
      const summary = `omega_grep: ${lines.length} match(es)${all.length > lines.length ? ' (truncated, narrow pattern/dir)' : ''} via ${cmd} in ${dir}`;
      // exit 1 = no matches, not an error.
      resolve({ isError: false, text: `${summary}\n\n${text || '(no matches)' + (err ? `\nstderr: ${err.slice(0, 300)}` : '')}` });
    });
    child.on('error', (e) => { clearTimeout(t); resolve({ isError: true, text: e.message }); });
  });
}

// ---------- omega_quota (giz allowance snapshot) ----------
// Shells out to the same giz-quota script the skill uses (table output, capped).
// Script + cookie jar live on the Mac side; elsewhere this degrades to a
// pointer instead of failing obscurely. Never echoes credentials: the script
// reads its own jar, we only return its table.
export function omegaQuota() {
  const script = process.env.OMEGA_QUOTA_SCRIPT
    || path.join(homedir(), '.config/gencode/scripts/giz-quota.sh');
  if (!existsSync(script)) {
    return Promise.resolve({ isError: true, text: `quota check not configured on this host (missing ${script}). Run giz-quota on the Mac side.` });
  }
  return new Promise((resolve) => {
    const child = spawn('bash', [script], {});
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 60000);
    child.on('close', (code) => {
      clearTimeout(t);
      const text = (out || err || '(no output)').slice(0, 6000);
      resolve({ isError: code !== 0, text: code === 0 ? text : `exit=${code}\n${text}` });
    });
    child.on('error', (e) => { clearTimeout(t); resolve({ isError: true, text: e.message }); });
  });
}

// ---------- omega_health (mechanical self-check) ----------
// Turns "is my server fine?" into one call: syntax + hashes of the three
// modules, writable scratch dirs, db/rg/quota-script presence, node version.
// HEALTHY means serve-able; anything else lists exactly what is wrong.
export function omegaHealth() {
  const lines = [`node ${process.version} pid=${process.pid}`];
  let ok = true;
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const m of ['server.mjs', 'tools-ext.mjs', 'batch-guard.mjs']) {
    const f = path.join(here, m);
    try {
      const buf = readFileSync(f);
      execFileSync(process.execPath, ['--check', f], { stdio: 'ignore' });
      lines.push(`  [ok] ${m} sha256=${createHash('sha256').update(buf).digest('hex').slice(0, 20)}`);
    } catch (e) { ok = false; lines.push(`  [FAIL] ${m} BROKEN: ${String((e && e.message) || e).split('\n')[0]}`); }
  }
  for (const [name, d] of [
    ['jobs', process.env.OMEGA_JOB_DIR || '/tmp/omega-jobs'],
    ['artifacts', process.env.OMEGA_ARTIFACT_DIR || path.join(homedir(), 'workspace/genspark-agent/server-v2/data/artifacts')],
  ]) {
    try { mkdirSync(d, { recursive: true }); lines.push(`  [ok] ${name} dir writable: ${d}`); }
    catch (e) { ok = false; lines.push(`  [FAIL] ${name} dir NOT writable: ${d} (${e.message})`); }
  }
  const db = process.env.OMEGA_DB || path.join(homedir(), 'workspace/genspark-agent/server-v2/data/agent.db');
  lines.push(`  [${existsSync(db) ? 'ok' : '--'}] agent db: ${existsSync(db) ? db : 'absent (db_query degrades gracefully)'}`);
  let rg = false;
  try { execFileSync('rg', ['--version'], { stdio: 'ignore' }); rg = true; } catch { /* fallback */ }
  lines.push(`  [${rg ? 'ok' : '--'}] ripgrep: ${rg ? 'present (omega_grep full speed)' : 'absent (omega_grep uses grep fallback)'}`);
  const q = process.env.OMEGA_QUOTA_SCRIPT || path.join(homedir(), '.config/gencode/scripts/giz-quota.sh');
  lines.push(`  [${existsSync(q) ? 'ok' : '--'}] quota script: ${existsSync(q) ? q : 'absent (omega_quota points at Mac)'}`);
  lines.push(`  extras loaded: ${EXTRA_TOOLS.length} tool definitions`);
  lines.unshift(`health: ${ok ? 'HEALTHY' : 'DEGRADED'}`);
  return { isError: !ok, text: lines.join('\n') };
}

// ---------- omega_sqlite (any db, read-only, zero-dep) ----------
// db_query only knows the Mac agent.db via dbfile.cjs, which does not exist on
// Oracle -- so every query failed there regardless of SQL. This one takes the
// db path as a parameter and runs on the python3 stdlib sqlite3 module (both
// hosts have python3; Oracle has no sqlite3 CLI). Two locks: the same
// SELECT-only prefix check, plus PRAGMA query_only=ON inside the engine, plus
// a read-only URI open. opencode.db, agent.db, any sqlite file.
const SQLITE_MAX_ROWS = 200;
const SQLITE_TOTAL_CAP = 20000;

export function omegaSqlite(args) {
  let { db } = args;
  let sql = args.sql;
  if (args.sql_b64) sql = Buffer.from(args.sql_b64, 'base64').toString('utf8');
  if (!db) return Promise.resolve({ isError: true, text: 'db is required (path to a sqlite file, e.g. ~/.local/share/opencode/opencode.db)' });
  if (!sql) return Promise.resolve({ isError: true, text: 'sql or sql_b64 is required' });
  if (WRITE_RE.test(sql)) {
    return Promise.resolve({ isError: true, text: 'refused: SELECT / PRAGMA(question) / EXPLAIN / WITH only' });
  }
  if (String(db).startsWith('~/')) db = path.join(homedir(), String(db).slice(2));
  const abs = path.isAbsolute(db) ? db : path.resolve(args.baseDir || process.env.OMEGA_READ_BASE || process.cwd(), db);
  if (!existsSync(abs)) {
    return Promise.resolve({ isError: true, text: `db not found: ${abs}` });
  }
  const py = [
    'import json, sqlite3, sys',
    'db, sql = sys.argv[1], sys.argv[2]',
    "con = sqlite3.connect('file:' + db + '?mode=ro', uri=True)",
    "con.execute('PRAGMA query_only=ON')",
    'cur = con.execute(sql)',
    'cols = [d[0] for d in cur.description] if cur.description else []',
    `rows = cur.fetchmany(${SQLITE_MAX_ROWS})`,
    'print(json.dumps({"columns": cols, "rows": [dict(zip(cols, r)) for r in rows]}, ensure_ascii=False, default=str))',
  ].join('\n');
  return new Promise((resolve) => {
    const child = spawn('python3', ['-c', py, abs, sql], {});
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 30000);
    child.on('close', (code) => {
      clearTimeout(t);
      const text = (out || err || '(no output)').slice(0, SQLITE_TOTAL_CAP);
      resolve({ isError: code !== 0, text: code === 0 ? text : `exit=${code}\n${text}` });
    });
    child.on('error', (e) => { clearTimeout(t); resolve({ isError: true, text: `no python3 on this host: ${e.message}` }); });
  });
}

// ---------- omega_edit (two-phase batch edit) ----------
// The edit version of the omega philosophy: N file edits computed in memory,
// every assertion verified, and only then ALL files written. One failure --
// missing oldString, ambiguous multi-match, mustContain miss -- aborts the
// whole batch with NOTHING WRITTEN, and every problem is reported at once so
// no round is wasted. Returns a per-file diff so judgment stays with the
// caller. By prompt-level rule this is the primary model's tool; subagents
// never touch files.
const EDIT_MAX_FILE = 500000;
const EDIT_DIFF_CAP = 3000;
const EDIT_TOTAL_CAP = 20000;

function miniDiff(oldText, newText, ctx = 3) {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length - 1, eb = b.length - 1;
  while (ea >= s && eb >= s && a[ea] === b[eb]) { ea--; eb--; }
  if (s > ea && s > eb) return '(no line changes)';
  const lo = Math.max(0, s - ctx);
  const hiA = Math.min(a.length - 1, ea + ctx);
  const hiB = Math.min(b.length - 1, eb + ctx);
  const out = [`@@ lines ${lo + 1}..${hiA + 1} @@`];
  for (let i = lo; i <= hiA; i++) out.push(`${i >= s && i <= ea ? '- ' : '  '}${a[i].slice(0, 500)}`);
  out.push('---');
  for (let i = lo; i <= hiB; i++) out.push(`${i >= s && i <= eb ? '+ ' : '  '}${b[i].slice(0, 500)}`);
  return out.join('\n').slice(0, EDIT_DIFF_CAP);
}

// Hunk diff from known replacement spans (exact, no LCS needed):
// each span carries old/new text; context lines come from the final text.
function spanDiff(newText, spans, ctx = 3) {
  const lines = newText.split('\n');
  const starts = [0];
  for (let i = 0; i < newText.length; i++) if (newText[i] === '\n') starts.push(i + 1);
  const lineOf = (pos) => {
    let lo = 0, hi = starts.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (starts[m] <= pos) lo = m + 1; else hi = m; }
    return Math.max(0, lo - 1);
  };
  const ranges = spans.map((s) => {
    const endPos = s.len > 0 ? s.at + s.len - 1 : s.at;
    return {
      l0: Math.max(0, lineOf(s.at) - ctx),
      l1: Math.min(lines.length - 1, lineOf(endPos) + ctx),
      a0: lineOf(s.at), a1: lineOf(endPos),
      span: s,
    };
  }).sort((x, y) => x.l0 - y.l0 || x.a0 - y.a0);
  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.l0 <= last.l1 + 1) {
      last.l1 = Math.max(last.l1, r.l1);
      last.spans.push(r);
    } else merged.push({ l0: r.l0, l1: r.l1, spans: [r] });
  }
  const hunks = merged.map((h, hi) => {
    const byLine = new Map();
    for (const r of h.spans) for (let l = r.a0; l <= r.a1; l++) byLine.set(l, r.span);
    const out = [`@@ lines ${h.l0 + 1}..${h.l1 + 1} (hunk ${hi + 1}/${merged.length}) @@`];
    const emittedOld = new Set();
    for (let l = h.l0; l <= h.l1; l++) {
      const sp = byLine.get(l);
      if (sp && !emittedOld.has(sp)) {
        emittedOld.add(sp);
        for (const ol of sp.oldStr.split('\n')) out.push(`- ${ol.slice(0, 500)}`);
      }
      out.push(`${sp ? '+' : '  '}${(lines[l] ?? '').slice(0, 500)}`);
    }
    return out.join('\n');
  });
  let used = 0;
  const keptH = [];
  for (const hk of hunks) {
    if (used + hk.length > EDIT_DIFF_CAP && keptH.length) break;
    keptH.push(hk); used += hk.length;
  }
  if (keptH.length < hunks.length) keptH.push(`... (${hunks.length - keptH.length} more hunk(s) truncated, EDIT_DIFF_CAP=${EDIT_DIFF_CAP})`);
  return keptH.join('\n');
}

export function omegaEdit(args) {
  const list = Array.isArray(args.edits) ? args.edits : null;
  if (!list || !list.length) {
    return { isError: true, text: 'edits must be a non-empty array of {path, oldString, newString, replaceAll?, mustContain?, mustNotContain?}' };
  }
  const baseDir = path.resolve(args.baseDir || process.env.OMEGA_READ_BASE || process.cwd());
  const dctx = Math.min(15, Math.max(0, args.diffCtx ?? 3)); // context lines per diff hunk
  const createIfMissing = args.createIfMissing === true;
  const pending = new Map(); // abs -> { path, abs, orig, text }: same-file edits chain in order
  const report = [];
  let failed = 0;
  let applied = 0;
  // One undo point per call, so a whole batch of edits can be rolled back together.
  const batchId = `edit-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  for (let i = 0; i < list.length; i++) {
    const tag = `#${i + 1}`;
    const e = list[i] || {};
    const fail = (why) => { failed++; report.push(`[FAIL] ${tag} ${e.path || '(no path)'}: ${why}`); };
    if (!e.path || typeof e.oldString !== 'string' || typeof e.newString !== 'string') {
      fail('path/oldString/newString are all required'); continue;
    }
    if (e.oldString === e.newString) { fail('oldString and newString are identical (no-op)'); continue; }
    const abs = path.isAbsolute(e.path) ? e.path : path.resolve(baseDir, e.path);
    const fileExists = existsSync(abs);
    // An empty oldString is legal ONLY as the seed for a file that does not exist
    // yet. On an existing file it would match at every position, so the ambiguity
    // check below would reject it anyway -- say so here instead. This ordering
    // matters: an earlier blanket `if (!e.oldString)` guard made createIfMissing
    // unreachable, which is exactly the bug the regression suite caught.
    if (!e.oldString && fileExists) {
      fail('oldString is empty, which on an existing file matches everywhere; '
        + 'empty oldString is only accepted to create a missing file (createIfMissing:true)');
      continue;
    }
    if (!fileExists && !createIfMissing) {
      fail(`file not found: ${abs} (pass createIfMissing:true to scaffold a new file in the same two-phase commit)`);
      continue;
    }
    let entry = pending.get(abs);
    if (!entry) {
      let disk;
      const isNew = !fileExists;
      if (isNew) {
        if (e.oldString !== '') {
          fail('file not found and oldString is not the empty string; a new file must start from oldString:""');
          continue;
        }
        disk = '';
      } else {
        try {
          const st = statSync(abs);
          if (!st.isFile()) { fail('not a file'); continue; }
          if (st.size > EDIT_MAX_FILE) { fail(`file too large (${st.size} bytes, cap ${EDIT_MAX_FILE})`); continue; }
          disk = readFileSync(abs, 'utf8');
        } catch (err) { fail(`read failed: ${err.message}`); continue; }
        if (disk.includes('\0')) { fail('binary file, refused'); continue; }
      }
      entry = { path: e.path, abs, orig: disk, text: disk, isNew };
      pending.set(abs, entry);
    }
    const text = entry.text;
    const hits = text.split(e.oldString).length - 1;
    if (hits === 0) { fail('oldString not found (0 matches)'); continue; }
    if (hits > 1 && !e.replaceAll) { fail(`oldString matches ${hits} times, refusing to guess (pass replaceAll:true to replace every occurrence)`); continue; }
    const at = text.indexOf(e.oldString);
    // Overlap guard (same-file chaining): warn when this match lands inside a
    // region written by an earlier edit in this batch — usually a duplicated
    // oldString or a stale copy. Spans are tracked in evolving-text coordinates.
    const spans = entry.spans || (entry.spans = []);
    const matchEnd = at + e.oldString.length;
    const overlapped = spans.filter((s) => at < s.at + s.len && s.at < matchEnd);
    if (overlapped.length && !e.allowOverlap) {
      report.push(`[warn] ${tag} ${e.path}: oldString overlaps region written by ${overlapped.map((s) => s.tag).join(', ')} — chained anyway, verify intent (pass allowOverlap:true to silence)`);
    }
    const next = e.replaceAll ? text.split(e.oldString).join(e.newString)
      : text.slice(0, at) + e.newString + text.slice(at + e.oldString.length);
    const need = (v) => (Array.isArray(v) ? v : [v]);
    const missContain = e.mustContain !== undefined ? need(e.mustContain).filter((x) => !next.includes(x)) : [];
    if (missContain.length) { fail(`mustContain miss: ${missContain.join(', ')}`); continue; }
    const hitBan = e.mustNotContain !== undefined ? need(e.mustNotContain).filter((x) => next.includes(x)) : [];
    if (hitBan.length) { fail(`mustNotContain hit: ${hitBan.join(', ')}`); continue; }
    entry.text = next;
    // Map pre-existing spans through this replacement (points ascending);
    // drop spans overlapping a replaced region. New spans carry both sides for hunk diffs.
    const oldLen = e.oldString.length, newLen = e.newString.length;
    let points;
    if (e.replaceAll) {
      points = [];
      let mi = text.indexOf(e.oldString);
      while (mi !== -1) { points.push(mi); mi = text.indexOf(e.oldString, mi + oldLen); }
    } else points = [at];
    const kept = [];
    for (const s of spans) {
      let shift = 0, dead = false;
      for (const p of points) {
        if (s.at + s.len <= p) break;
        if (s.at >= p + oldLen) shift += newLen - oldLen;
        else { dead = true; break; }
      }
      if (!dead) { s.at += shift; kept.push(s); }
    }
    if (e.replaceAll) {
      const parts = text.split(e.oldString);
      let npos = 0;
      for (let k = 0; k < parts.length - 1; k++) {
        npos += parts[k].length;
        kept.push({ at: npos, len: newLen, oldStr: e.oldString, newStr: e.newString, tag });
        npos += newLen;
      }
    } else kept.push({ at, len: newLen, oldStr: e.oldString, newStr: e.newString, tag });
    entry.spans = kept;
    applied++;
    report.push(`[ok] ${tag} ${e.path} (${e.replaceAll ? `${hits} replacements` : '1 replacement'})`);
  }
  if (failed) {
    // The per-edit [ok] lines below are VOID: two-phase commit means the whole
    // batch was discarded. Printing them as plain [ok] invited reading them as
    // "some edits landed", which is how a lost schema edit went unnoticed for
    // several turns. Say it in the same line the reader already looks at.
    const voided = report.map((r) => r.replace(/^\[ok\]/, '[void]'));
    return { isError: true, text: `edit: FAILED ${applied}/${list.length}, NOTHING WRITTEN (two-phase commit) -- every [void] line below was NOT applied\n${voided.join('\n')}` };
  }
  const dry = args.dryRun === true;
  if (!dry) {
    // Snapshot BEFORE the first byte lands, so omega_undo has a real pre-image
    // for every touched file (including files this call creates from nothing).
    const snaps = [];
    for (const entry of pending.values()) {
      if (entry.isNew) snapshotMissing(entry.abs, batchId);
      else snapshotFile(entry.abs, batchId);
      mkdirSync(path.dirname(entry.abs), { recursive: true });
      writeFileSync(entry.abs, entry.text, 'utf8');
      snaps.push(entry.path);
    }
    persistSnapManifest(batchId, snapStats.get(batchId) || []);
    report.push(`undo point: ${batchId} (omega_undo {"batchId":"${batchId}"} to roll back ${snaps.length} file(s))`);
  }
  const diffs = [...pending.values()].map((s) => `--- ${s.path} ---\n${s.spans && s.spans.length ? spanDiff(s.text, s.spans, dctx) : miniDiff(s.orig, s.text, dctx)}`);
  return { isError: false, text: `edit: ${applied}/${list.length} ${dry ? 'verified (DRY-RUN, NOTHING WRITTEN)' : 'applied (two-phase commit)'}\n${report.join('\n')}\n\n${diffs.join('\n\n')}`.slice(0, EDIT_TOTAL_CAP) };
}

export const EXTRA_TOOLS = [
  {
    name: 'omega_read',
    description: 'Read MANY files in ONE call. Each entry takes path plus an optional '
      + 'startLine/lineCount slice and/or a pattern regex filter (returns numbered '
      + 'matches). Packs recon that would cost 9 separate Read calls into one; output '
      + 'capped at 20000 chars with per-file headers showing line ranges. '
      + 'Prefer absolute paths, or set baseDir: relative paths resolve against the server '
      + 'cwd, not the session directory.',
    inputSchema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          description: 'list of {path, startLine? (1-indexed), lineCount? (max 500), pattern? (regex), maxMatches?}; a plain path string also works',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              startLine: { type: 'integer' },
              lineCount: { type: 'integer' },
              pattern: { type: 'string' },
              maxMatches: { type: 'integer' },
            },
          },
        },
        path: { type: 'string', description: 'shorthand for reading a single file' },
        baseDir: { type: 'string', description: 'directory that relative paths resolve against (default: OMEGA_READ_BASE or the server cwd). The server cwd is NOT the session directory, so pass this when using relative paths.' },
      },
    },
  },
  {
    name: 'vfs_local_write',
    description: 'Write a file directly, with no shell quoting involved. Use this for any '
      + 'content containing quotes, $, newlines or non-ASCII text, then run the file. '
      + 'Accepts content, content_b64 or content_file.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
        content_b64: { type: 'string' },
        content_file: { type: 'string' },
        append: { type: 'boolean' },
      },
      required: ['path'],
    },
  },
  {
    name: 'omega_undo',
    description: 'Roll back the files an omega_edit call wrote, using the undo point it '
      + 'reported. Every omega_edit snapshots each target file before writing (and records '
      + 'files it created, which are deleted rather than blanked on undo). This is the '
      + 'cross-call safety net that the two-phase commit cannot give you: the commit only '
      + 'protects one call, this protects the next one from being wrong.',
    inputSchema: {
      type: 'object',
      properties: {
        batchId: { type: 'string', description: 'the undo point id from the omega_edit result' },
        paths: { type: 'array', items: { type: 'string' }, description: 'optional subset of absolute paths to restore' },
        dryRun: { type: 'boolean', description: 'report what would be restored without touching disk' },
      },
      required: ['batchId'],
    },
  },
  {
    name: 'db_query',
    description: 'Read-only SQL against the agent database (commands history, memory/forged '
      + 'rules, lessons, playbook, scripts, skills, local_store). Useful for finding a '
      + 'previously working command instead of writing a new one. Writes are refused.',
    inputSchema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'SELECT / PRAGMA / EXPLAIN / WITH only' },
        sql_b64: { type: 'string', description: 'base64 of the SQL, for multi-line queries' },
      },
    },
  },
  {
    name: 'omega_batch',
    description: "Run several bash steps in one call with mechanical acceptance checks. That is the point of this tool: a zero exit code only proves the command ran, not that it did what you wanted, so each step may carry expect.contains / expect.notContains / expect.regex and is reported FAIL when the assertion does not hold even though exit=0. Runs async: the call returns a job id immediately, then poll omega_batch_status for the verdict. With stopOnError (default true) the first failing step halts the rest, so order steps to put the cheap check before the destructive action. Prefer one batch over a series of separate commands when the steps belong to the same intent.",
    inputSchema: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          description: "ordered list of steps, run in sequence; each needs command_line and may add label, timeout, cwd, stdin and expect",
          items: {
            type: 'object',
            properties: {
              command_line: { type: 'string', description: 'bash command for this step' },
              label: { type: 'string', description: 'short human-readable intent, shown in the status report; write it so the log is readable later' },
              timeout: { type: 'string', description: "per-step limit, \"30s\" / \"5m\" or milliseconds; the step is marked timedOut and fails" },
              cwd: { type: 'string', description: "working directory for this step; set it here instead of prefixing the command with cd" },
              stdin: { type: 'string', description: "text piped to the command stdin, which avoids shell quoting for content with quotes, $ or newlines" },
              expect: {
                description: "acceptance check applied to this step output; without it a step only fails on a non-zero exit code",
                type: 'object',
                properties: {
                  contains: { type: 'array', items: { type: 'string' }, description: 'every string must appear in the output, else the step is FAIL; use a token the command only prints on success, not a word that also shows up in normal reports' },
                  notContains: { type: 'array', items: { type: 'string' }, description: 'none of these may appear; keep them narrow, a broad word like MISSING also occurs in healthy output and causes false failures' },
                  regex: { type: 'string', description: 'output must match this regular expression' },
                },
              },
            },
            required: ['command_line'],
          },
        },
        stopOnError: { type: 'boolean', description: 'default true: halt remaining steps once one fails its expect or exits non-zero' },
      },
      required: ['steps'],
    },
  },
  {
    name: 'omega_batch_status',
    description: "Fetch the result of an omega_batch job. Returns a summary line (\"failed 2/3\"), then one line per step marked [ok] or [FAIL] with the assertion that failed; steps not run because of stopOnError appear as (halted). Pass waitMs (max 50000) to block until the job settles and get the verdict in ONE call instead of submit-then-poll; if the wait elapses first it returns the current running state. verbose:true adds each step full captured output plus exit code, signal and timedOut.",
    inputSchema: {
      type: 'object',
      properties: {
          id: { type: 'string', description: 'job id returned by omega_batch, e.g. job-abc123' },
          waitMs: {
            type: 'number',
            description: 'block up to N ms (max 50000) waiting for the job to finish, so the verdict '
              + 'comes back in this same call. Deliberately capped below the host MCP timeout: a host '
              + 'that cuts the call at 60s would lose the reply entirely.',
          },
          verbose: { type: 'boolean', description: 'include full stdout/stderr of every step instead of just the pass/fail lines' },
        },
      required: ['id'],
    },
  },
  {
    name: 'omega_guard_check',
    description: 'Dry-run the omega_batch guard without executing anything. Pass the command_lines you intend to run; each is reported PASS or REFUSE with the reason. Use this before omega_batch when a step might write outside /tmp.',
    inputSchema: {
      type: 'object',
      properties: {
        commands: { type: 'array', items: { type: 'string' }, description: 'command_line strings to vet' },
        command_line: { type: 'string', description: 'shorthand for a single command' },
      },
    },
  },
  {
    name: 'omega_grep',
    description: 'Server-side code search returning capped path:line matches in one call. ripgrep when available, grep -rn fallback. Read-only; use to locate code before omega_read.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'regex (rg) / pattern (grep fallback)' },
        dir: { type: 'string', description: 'where to search; relative paths resolve against baseDir' },
        baseDir: { type: 'string', description: 'directory that relative paths resolve against' },
        include: { type: 'string', description: 'glob filter, e.g. "*.mjs"' },
        ignoreCase: { type: 'boolean' },
        maxMatches: { type: 'integer', description: 'default 30, max 100' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'omega_quota',
    description: 'Giz model allowance snapshot (used/limit per model, reset times) via the giz-quota script. Only configured where the script + cookie jar exist (Mac); elsewhere returns a pointer instead of failing.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'omega_health',
    description: 'Mechanical self-check: module syntax + hashes, writable scratch dirs, db/rg/quota-script presence, node version. Verdict on the first line.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'omega_sqlite',
    description: 'Read-only SQL against ANY sqlite file (opencode.db, agent.db). Takes the db path as a parameter; runs on the python3 stdlib sqlite3 module so it works where no sqlite3 CLI exists. SELECT/PRAGMA/EXPLAIN/WITH only, read-only open, max 200 rows.',
    inputSchema: {
      type: 'object',
      properties: {
        db: { type: 'string', description: "path to the sqlite file, e.g. ~/.local/share/opencode/opencode.db" },
        sql: { type: 'string', description: 'SELECT / PRAGMA / EXPLAIN / WITH only' },
        sql_b64: { type: 'string', description: 'base64 of the SQL, for multi-line queries' },
        baseDir: { type: 'string', description: 'directory that relative db paths resolve against' },
      },
      required: ['db'],
    },
  },
  {
    name: 'omega_edit',
    description: "Batch file edits with a two-phase commit: N edits are computed in memory, every assertion verified, and only then ALL files are written. Same-file edits chain in order; overlapping matches emit a [warn] (pass allowOverlap:true to silence). One failure (missing oldString, ambiguous multi-match, mustContain miss) aborts everything with NOTHING WRITTEN. Returns a per-file diff. Pass dryRun:true to verify + preview diffs without writing. Primary model only; subagents never touch files.",
    inputSchema: {
      type: 'object',
      properties: {
        edits: {
          type: 'array',
          description: 'list of {path, oldString, newString, replaceAll?, mustContain?, mustNotContain?, allowOverlap?}; oldString must match exactly once unless replaceAll:true',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              oldString: { type: 'string' },
              newString: { type: 'string' },
              replaceAll: { type: 'boolean' },
              mustContain: { type: 'array', items: { type: 'string' } },
              mustNotContain: { type: 'array', items: { type: 'string' } },
              allowOverlap: { type: 'boolean', description: 'silence the overlap warning for this edit' },
            },
            required: ['path', 'oldString', 'newString'],
          },
        },
        dryRun: { type: 'boolean', description: 'verify all edits and return diffs without writing anything' },
        diffCtx: { type: 'number', description: 'context lines around each change hunk in returned diffs (default 3, max 15)' },
        createIfMissing: {
          type: 'boolean',
          description: 'allow oldString:"" to scaffold a file that does not exist yet, so create+fill '
            + 'happens inside the same two-phase commit. A brand-new file must start from the empty '
            + 'string or the edit is rejected. Undo deletes created files rather than blanking them.',
        },
        baseDir: { type: 'string', description: 'directory that relative paths resolve against' },
      },
      required: ['edits'],
    },
  },
];
