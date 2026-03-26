// dbfile.cjs - better-sqlite3 快捷桥接
// 用法: cd server-v2 && node dbfile.cjs <操作> [参数...]
// 
// 示例:
//   node dbfile.cjs query "SELECT key FROM local_store WHERE slot='script'"
//   node dbfile.cjs get local_store guide agent-db-manual
//   node dbfile.cjs set local_store guide agent-db-manual "新内容"
//   node dbfile.cjs get memory forged skill-shortcuts
//   node dbfile.cjs set memory forged skill-shortcuts "新经验"
//   node dbfile.cjs append local_store guide agent-db-manual "追加内容"

const Database = require('better-sqlite3');
const db = new Database('data/agent.db');
const args = process.argv.slice(2);
const cmd = args[0];

if (cmd === 'query') {
  const rows = db.prepare(args[1]).all();
  console.log(JSON.stringify(rows, null, 2));

} else if (cmd === 'get') {
  const table = args[1] || 'local_store';
  const slot = args[2];
  const key = args[3];
  const row = db.prepare('SELECT content FROM ' + table + ' WHERE slot=? AND key=?').get(slot, key);
  console.log(row ? row.content : 'NOT FOUND');

} else if (cmd === 'set') {
  const table = args[1] || 'local_store';
  const slot = args[2];
  const key = args[3];
  const content = args[4];
  db.prepare("INSERT OR REPLACE INTO " + table + " (slot, key, content, updated_at) VALUES (?, ?, ?, datetime('now'))").run(slot, key, content);
  console.log('OK: ' + table + '/' + slot + '/' + key + ' = ' + content.length + ' chars');

} else if (cmd === 'append') {
  const table = args[1] || 'local_store';
  const slot = args[2];
  const key = args[3];
  const extra = args[4];
  const row = db.prepare('SELECT content FROM ' + table + ' WHERE slot=? AND key=?').get(slot, key);
  if (row) {
    const newContent = row.content + extra;
    db.prepare("UPDATE " + table + " SET content=?, updated_at=datetime('now') WHERE slot=? AND key=?").run(newContent, slot, key);
    console.log('APPENDED: +' + extra.length + ' chars, total ' + newContent.length);
  } else {
    console.log('NOT FOUND: ' + slot + '/' + key);
  }

} else if (cmd === 'list') {
  const table = args[1] || 'local_store';
  const slot = args[2];
  const rows = db.prepare('SELECT slot, key, LENGTH(content) as len FROM ' + table + (slot ? ' WHERE slot=?' : '') + ' ORDER BY slot, key').all(slot ? [slot] : []);
  rows.forEach(r => console.log(r.slot + '/' + r.key + ' (' + r.len + ' chars)'));

} else if (cmd === 'load') {
  // 从文件读内容存入DB: node dbfile.cjs load local_store script batch-name /path/to/file.json
  const fs = require('fs');
  const table = args[1] || 'local_store';
  const slot = args[2];
  const key = args[3];
  const filePath = args[4];
  if (!slot || !key || !filePath) {
    console.log('Usage: node dbfile.cjs load <table> <slot> <key> <filepath>');
    process.exit(1);
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  db.prepare("INSERT OR REPLACE INTO " + table + " (slot, key, content, updated_at) VALUES (?, ?, ?, datetime('now'))").run(slot, key, content);
  console.log('LOADED: ' + filePath + ' -> ' + table + '/' + slot + '/' + key + ' (' + content.length + ' chars)');

} else {
  console.log('Usage: node dbfile.cjs <query|get|set|append|list|load> [args...]');
}

db.close();