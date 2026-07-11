// core/db.js - SQLite local database (replaces JSON files + Supabase)
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const dbDirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(dbDirname, '..', 'data', 'agent.db');

mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS commands (
    id INTEGER PRIMARY KEY,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    tool TEXT NOT NULL,
    params TEXT,
    success INTEGER NOT NULL DEFAULT 1,
    result_preview TEXT,
    error TEXT,
    duration_ms INTEGER,
    session_id TEXT
  );
  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    data TEXT
  );
  CREATE TABLE IF NOT EXISTS memory (
    slot TEXT NOT NULL,
    key TEXT NOT NULL,
    content TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (slot, key)
  );
  CREATE INDEX IF NOT EXISTS idx_commands_tool ON commands(tool);
  CREATE INDEX IF NOT EXISTS idx_commands_timestamp ON commands(timestamp);
  CREATE INDEX IF NOT EXISTS idx_commands_success ON commands(success);
  CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level);
  CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
`);


// commands was extended by several releases. Fresh workspaces must reach the live schema before statements are prepared.
const commandColumnDefs = {
  reusable: 'INTEGER DEFAULT 0',
  tags: 'TEXT',
  parsed_command: 'TEXT',
  status: 'TEXT',
  worker_id: 'TEXT',
  scheduled_at: 'TEXT',
  depends_on: 'INTEGER',
  priority: 'INTEGER DEFAULT 0',
  parser_version: 'TEXT',
  content: 'TEXT'
};
const commandColumns = new Set(db.prepare('PRAGMA table_info(commands)').all().map(row => row.name));
for (const [name, definition] of Object.entries(commandColumnDefs)) {
  if (!commandColumns.has(name)) db.exec(`ALTER TABLE commands ADD COLUMN ${name} ${definition}`);
}
db.exec('CREATE INDEX IF NOT EXISTS idx_commands_status ON commands(status)');

const stmts = {
  insertCommand: db.prepare('INSERT INTO commands (id, timestamp, tool, params, success, result_preview, error, duration_ms, session_id, status, tags) VALUES (@id, @timestamp, @tool, @params, @success, @result_preview, @error, @duration_ms, @session_id, @status, @tags)'),
  insertLog: db.prepare('INSERT INTO logs (timestamp, level, message, data) VALUES (@timestamp, @level, @message, @data)'),
  getRecentCommands: db.prepare('SELECT * FROM commands ORDER BY id DESC LIMIT ?'),
  getCommandById: db.prepare('SELECT * FROM commands WHERE id = ?'),
  getCommandsByTool: db.prepare('SELECT * FROM commands WHERE tool = ? ORDER BY id DESC LIMIT ?'),
  getFailedCommands: db.prepare('SELECT * FROM commands WHERE success = 0 ORDER BY id DESC LIMIT ?'),
  getCommandStats: db.prepare('SELECT tool, COUNT(*) as total, SUM(CASE WHEN success=0 THEN 1 ELSE 0 END) as errors FROM commands GROUP BY tool ORDER BY total DESC'),
  searchCommands: db.prepare('SELECT * FROM commands WHERE params LIKE ? OR result_preview LIKE ? ORDER BY id DESC LIMIT ?'),
  getRecentLogs: db.prepare('SELECT * FROM logs ORDER BY id DESC LIMIT ?'),
  getLogsByLevel: db.prepare('SELECT * FROM logs WHERE level = ? ORDER BY id DESC LIMIT ?'),
  upsertMemory: db.prepare("INSERT INTO memory (slot, key, content, updated_at) VALUES (@slot, @key, @content, datetime('now')) ON CONFLICT(slot, key) DO UPDATE SET content=@content, updated_at=datetime('now')"),
  getMemory: db.prepare('SELECT * FROM memory WHERE slot = ? AND key = ?'),
  listMemory: db.prepare('SELECT slot, key, length(content) as size, updated_at FROM memory WHERE slot = ?'),
  deleteMemory: db.prepare('DELETE FROM memory WHERE slot = ? AND key = ?'),
};

const dbApi = {
  addCommand(entry) {
    // Preserve one SQLite row per actual invocation. Time-based dedup used to desynchronise JSON and SQLite ids.
    const status = entry.status || (entry.success ? 'success' : 'failed');
    stmts.insertCommand.run({
      id: entry.id,
      timestamp: entry.timestamp || new Date().toISOString(),
      tool: entry.tool,
      params: typeof entry.params === 'string' ? entry.params : JSON.stringify(entry.params),
      success: entry.success ? 1 : 0,
      result_preview: (entry.resultPreview || '').substring(0, 500),
      error: entry.error || null,
      duration_ms: entry.duration_ms || null,
      session_id: entry.session_id || null,
      status,
      tags: entry.tags || null
    });
    return entry.id;
  },
  updateCommand(id, updates = {}) {
    const columns = {
      success: 'success',
      resultPreview: 'result_preview',
      error: 'error',
      duration_ms: 'duration_ms',
      session_id: 'session_id',
      status: 'status',
      tags: 'tags',
      content: 'content'
    };
    const sets = [];
    const values = [];
    for (const [key, column] of Object.entries(columns)) {
      if (!Object.prototype.hasOwnProperty.call(updates, key)) continue;
      sets.push(`${column}=?`);
      values.push(key === 'success' ? (updates[key] ? 1 : 0) : updates[key]);
    }
    if (sets.length === 0) return { changes: 0 };
    return db.prepare(`UPDATE commands SET ${sets.join(', ')} WHERE id=?`).run(...values, id);
  },
  getRecent(count) { return stmts.getRecentCommands.all(count || 20); },
  getById(id) { return stmts.getCommandById.get(id); },
  getByTool(tool, count) { return stmts.getCommandsByTool.all(tool, count || 50); },
  getFailed(count) { return stmts.getFailedCommands.all(count || 50); },
  getStats() { return stmts.getCommandStats.all(); },
  search(keyword, count) { var q = '%' + keyword + '%'; return stmts.searchCommands.all(q, q, count || 50); },
  addLog(level, message, data) {
    return stmts.insertLog.run({ timestamp: new Date().toISOString(), level: level, message: message, data: data ? JSON.stringify(data) : null });
  },
  getRecentLogs(count) { return stmts.getRecentLogs.all(count || 100); },
  getLogsByLevel(level, count) { return stmts.getLogsByLevel.all(level, count || 100); },
  setMemory(slot, key, content) { return stmts.upsertMemory.run({ slot: slot, key: key, content: content }); },
  getMemory(slot, key) { var row = stmts.getMemory.get(slot, key); return row ? row.content : null; },
  listMemory(slot) { return stmts.listMemory.all(slot); },
  deleteMemory(slot, key) { return stmts.deleteMemory.run(slot, key); },
  raw: db,
  exec(sql) { return db.exec(sql); },
  query(sql) { return db.prepare(sql).all(); },
  close() { db.close(); }
};

export default dbApi;
