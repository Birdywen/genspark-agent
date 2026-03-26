const fs = require('fs');
const c = fs.readFileSync('/private/tmp/manual-v2.txt', 'utf8');
const db = require('better-sqlite3')('agent.db');
db.prepare('INSERT OR REPLACE INTO local_store(slot,key,content,updated_at) VALUES(?,?,?,datetime("now"))').run('guide', 'agent-db-manual', c);
console.log('OK:', c.length, 'chars');
