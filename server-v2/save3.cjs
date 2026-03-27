const fs = require('fs');
const Database = require('better-sqlite3');
const db = new Database('/Users/yay/workspace/genspark-agent/server-v2/data/agent.db');
const content = fs.readFileSync('/private/tmp/spawn-v3d.txt', 'utf8');
db.prepare('INSERT OR REPLACE INTO local_store(slot,key,content) VALUES(@s,@k,@c)').run({s:'toolkit',k:'spawn-planner-v3',c:content});
console..length);
db.close();