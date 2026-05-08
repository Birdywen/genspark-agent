// queue-watcher.js — agent.db.commands 主动轮询执行器 (ADR-004 Day 1)
//
// 职责:
//   每 N 秒 SELECT WHERE status='pending' AND parsed_command IS NOT NULL
//   抢锁(UPDATE WHERE status='pending') → 调 sys-tool → 写回 result_preview / success / status
//
// 不做:
//   不解析 content → parsed_command (那是 parser 层的事,Day 2 写)
//   不接管现有同步路径(WebSocket/HTTP) (那些继续走 pipeline.js)
//
// 使用:
//   独立启动: node queue-watcher.js
//   或被 index.js import startQueueWatcher() 接入

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSysHandler, isSysTool } from './sys-tools.js';
import { parseCommand, PARSER_VERSION } from './command-parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, 'data', 'agent.db');

const WORKER_ID = `worker-${process.pid}-${Date.now().toString(36)}`;
const POLL_INTERVAL_MS = 1000;
const MAX_RESULT_PREVIEW = 2000;

let db = null;
let stopped = false;
let inflight = 0;
let pollTimer = null;

function openDb() {
  const d = new Database(DB_PATH);
  d.pragma('journal_mode = WAL');
  d.pragma('busy_timeout = 5000');
  return d;
}

function claimNextTask() {
  const claim = db.prepare(`
    UPDATE commands
    SET status='running', worker_id=?, timestamp=datetime('now')
    WHERE id = (
      SELECT id FROM commands
      WHERE status='pending'
        AND parsed_command IS NOT NULL
        AND (scheduled_at IS NULL OR scheduled_at <= datetime('now'))
      ORDER BY priority DESC, id ASC
      LIMIT 1
    )
    RETURNING id, parsed_command, depends_on
  `);
  return claim.get(WORKER_ID);
}

function dependencyMet(depends_on) {
  if (!depends_on) return true;
  const dep = db.prepare(`SELECT status, success FROM commands WHERE id=?`).get(depends_on);
  return dep && dep.status === 'done' && dep.success === 1;
}

function finishTask(id, success, result, errorMsg, durationMs) {
  const finalStatus = success ? 'done' : 'failed';
  let preview = '';
  if (result !== undefined && result !== null) {
    try { preview = typeof result === 'string' ? result : JSON.stringify(result); }
    catch (e) { preview = String(result); }
    if (preview.length > MAX_RESULT_PREVIEW) preview = preview.slice(0, MAX_RESULT_PREVIEW) + '…[truncated]';
  }
  db.prepare(`
    UPDATE commands
    SET status=?, success=?, result_preview=?, error=?, duration_ms=?
    WHERE id=?
  `).run(finalStatus, success ? 1 : 0, preview || null, errorMsg || null, durationMs, id);
}

function releaseTaskBack(id, reason) {
  db.prepare(`UPDATE commands SET status='pending', worker_id=NULL, error=? WHERE id=?`)
    .run(`requeued: ${reason}`, id);
}

async function executeTask(row) {
  const startedAt = Date.now();
  let parsed;
  try {
    parsed = JSON.parse(row.parsed_command);
  } catch (e) {
    finishTask(row.id, false, null, `parsed_command not valid JSON: ${e.message}`, Date.now() - startedAt);
    return;
  }

  const tool = parsed.tool;
  const params = parsed.params || {};

  if (!tool || !isSysTool(tool)) {
    finishTask(row.id, false, null, `unknown tool: ${tool}`, Date.now() - startedAt);
    return;
  }

  const handler = getSysHandler(tool);
  if (typeof handler !== 'function') {
    finishTask(row.id, false, null, `tool '${tool}' is not directly invokable (browser/native?)`, Date.now() - startedAt);
    return;
  }

  try {
    const result = await handler(params, { source: 'queue-watcher', commandId: row.id });
    const ok = result && result.success !== false;
    finishTask(row.id, ok, result, ok ? null : (result && result.error) || 'tool returned failure', Date.now() - startedAt);
  } catch (e) {
    finishTask(row.id, false, null, e && e.message ? e.message : String(e), Date.now() - startedAt);
  }
}

async function tick() {
  if (stopped) return;
  try {
    parserTick();
    while (!stopped) {
      const row = claimNextTask();
      if (!row) break;
      if (!dependencyMet(row.depends_on)) {
        releaseTaskBack(row.id, 'dependency not met yet');
        break;
      }
      inflight++;
      executeTask(row).finally(() => { inflight--; });
    }
  } catch (e) {
    console.error('[queue-watcher] tick error:', e.message);
  }
  if (!stopped) pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
}

// 扫 content 非空但 parsed_command 还没解析的行
function parserTick() {
  const rows = db.prepare(`
    SELECT id, content FROM commands
    WHERE content IS NOT NULL AND parsed_command IS NULL AND parser_version IS NULL
    LIMIT 20
  `).all();
  if (rows.length === 0) return 0;
  let parsed = 0, failed = 0;
  for (const row of rows) {
    const cmd = parseCommand(row.content);
    if (cmd) {
      db.prepare(`
        UPDATE commands
        SET parsed_command=?, parser_version=?, tool=?, status='pending'
        WHERE id=? AND parsed_command IS NULL
      `).run(JSON.stringify(cmd), PARSER_VERSION, cmd.tool, row.id);
      parsed++;
    } else {
      // 不是命令,只标记 parser_version 防重扫,不污染 error/success
      db.prepare(`
        UPDATE commands
        SET parser_version=?
        WHERE id=? AND parsed_command IS NULL
      `).run(PARSER_VERSION + '-no-match', row.id);
      failed++;
    }
  }
  if (parsed > 0 || failed > 0) console.log(`[queue-watcher] parser: ${parsed} parsed, ${failed} no-match`);
  return parsed;
}

function recoverOrphans() {
  const r = db.prepare(`
    UPDATE commands
    SET status='pending', worker_id=NULL, error='recovered from running on restart'
    WHERE status='running'
  `).run();
  if (r.changes > 0) console.log(`[queue-watcher] recovered ${r.changes} orphan running tasks → pending`);
}

export function startQueueWatcher() {
  if (db) return;
  db = openDb();
  recoverOrphans();
  console.log(`[queue-watcher] started worker=${WORKER_ID} db=${DB_PATH} poll=${POLL_INTERVAL_MS}ms`);
  tick();
}

export function stopQueueWatcher() {
  stopped = true;
  if (pollTimer) clearTimeout(pollTimer);
  if (db) { db.close(); db = null; }
  console.log('[queue-watcher] stopped');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startQueueWatcher();
  process.on('SIGINT', () => { stopQueueWatcher(); process.exit(0); });
  process.on('SIGTERM', () => { stopQueueWatcher(); process.exit(0); });
}
