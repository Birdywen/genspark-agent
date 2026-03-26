const Database = require('better-sqlite3');
const DB_PATH = "/Users/yay/workspace/genspark-agent/server-v2/data/agent.db";
const _db = new Database(DB_PATH);
_db.pragma('journal_mode = WAL');
_db.pragma('busy_timeout = 5000');

const db = {
  raw: _db,
  getMemory: function(slot, key) {
    const row = _db.prepare('SELECT content FROM memory WHERE slot = ? AND key = ?').get(slot, key);
    return row ? row.content : null;
  },
  setMemory: function(slot, key, content) {
    return _db.prepare('INSERT OR REPLACE INTO memory (slot, key, content, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)').run(slot, key, content);
  },
  getJSON: function(slot, key) {
    const c = db.getMemory(slot, key);
    return c ? JSON.parse(c) : null;
  },
  setJSON: function(slot, key, obj) {
    return db.setMemory(slot, key, JSON.stringify(obj, null, 2));
  },
  getLocal: function(slot, key) {
    const row = _db.prepare('SELECT content FROM local_store WHERE slot = ? AND key = ?').get(slot, key);
    return row ? row.content : null;
  },
  setLocal: function(slot, key, content) {
    return _db.prepare('INSERT OR REPLACE INTO local_store (slot, key, content, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)').run(slot, key, content);
  },
  recentCommands: function(limit) {
    limit = limit || 20;
    return _db.prepare('SELECT id, timestamp, tool, substr(params, 1, 150) as params_preview, success FROM commands ORDER BY id DESC LIMIT ?').all(limit);
  },
  todayCommands: function() {
    return _db.prepare("SELECT id, timestamp, tool, substr(params, 1, 150) as params_preview, success FROM commands WHERE timestamp >= date('now') ORDER BY id DESC").all();
  },
  todayErrors: function() {
    return _db.prepare("SELECT id, timestamp, tool, substr(params, 1, 200) as params_preview, result_preview, error FROM commands WHERE success = 0 AND timestamp >= date('now') ORDER BY id DESC").all();
  },
  toolStats: function() {
    return _db.prepare('SELECT tool, COUNT(*) as count, SUM(CASE WHEN success=1 THEN 1 ELSE 0 END) as ok, ROUND(100.0*SUM(CASE WHEN success=1 THEN 1 ELSE 0 END)/COUNT(*),1) as rate FROM commands GROUP BY tool ORDER BY count DESC').all();
  },
  searchHistory: function(keyword, limit) {
    limit = limit || 20;
    return _db.prepare('SELECT id, timestamp, tool, substr(params, 1, 200) as params_preview, success FROM commands WHERE params LIKE ? ORDER BY id DESC LIMIT ?').all('%' + keyword + '%', limit);
  },
  query: function(sql, params) {
    const stmt = _db.prepare(sql);
    return params ? stmt.all.apply(stmt, params) : stmt.all();
  },
  run: function(sql, params) {
    const stmt = _db.prepare(sql);
    return params ? stmt.run.apply(stmt, params) : stmt.run();
  }
};

module.exports = db;
