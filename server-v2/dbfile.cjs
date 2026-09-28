// agent.db driver: spawned per-call by tools-ext.mjs dbQuery, so edits here
// take effect WITHOUT restarting the MCP server.
// Usage: node dbfile.cjs query "<SELECT/PRAGMA/EXPLAIN/WITH>"  (read-only, enforced)
//        node dbfile.cjs exec "<DDL/DML>"                      (human-run writes/seeding)
'use strict';
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB = process.env.OMEGA_DB
  || path.join(__dirname, 'data', 'agent.db');
const WRITE_RE = /^\s*(insert|update|delete|drop|alter|create|replace|truncate|vacuum|attach|detach|pragma\s+\w+\s*=)/i;
const MAX_ROWS = 200;

function fail(msg) { console.error('error: ' + msg); process.exit(1); }

function main() {
  const [mode, sql] = process.argv.slice(2);
  if (!sql) fail('usage: node dbfile.cjs (query|exec) "<sql>"');
  const db = mode === 'query' ? new DatabaseSync(DB, { readOnly: true }) : new DatabaseSync(DB);
  try {
    if (mode === 'query') {
      if (WRITE_RE.test(sql)) fail('refused: query mode is read-only (SELECT/PRAGMA/EXPLAIN/WITH only)');
      db.exec('PRAGMA query_only=ON');
      const stmt = db.prepare(sql);
      const cols = stmt.columns().map((c) => c.name);
      const rows = [];
      for (const r of stmt.iterate()) {
        if (rows.length >= MAX_ROWS) break;
        rows.push(r);
      }
      console.log(JSON.stringify({ columns: cols, rows }, null, 0));
    } else if (mode === 'exec') {
      db.exec(sql);
      const ch = db.prepare('SELECT total_changes() AS c').get();
      console.log(JSON.stringify({ ok: true, total_changes: ch.c }));
    } else {
      fail('mode must be query or exec');
    }
  } finally {
    db.close();
  }
}
main();
