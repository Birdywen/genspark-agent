const Database = require('better-sqlite3');
const fs = require('fs');
const db = new Database('data/agent.db');
const content = fs.readFileSync('/private/tmp/forged-sqlite3.txt', 'utf8');
db.prepare("INSERT OR REPLACE INTO memory (slot, key, content, updated_at) VALUES ('forged', 'skill-better-sqlite3', ?, datetime('now'))").run(content);
console.log('OK: skill-better-sqlite3 = ' + content.length + ' chars');
db.close();