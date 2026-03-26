const fs = require('fs');
const path = require('path');
const db = require('better-sqlite3')('/Users/yay/workspace/genspark-agent/project.db');

const srcDir = '/Users/yay/workspace/genspark-agent/extension/content-src';
const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.js')).sort();

const insert = db.prepare("INSERT OR REPLACE INTO project (project, path, content, updated_at) VALUES (?, ?, ?, datetime('now'))");

let count = 0;
for (const file of files) {
  const content = fs.readFileSync(path.join(srcDir, file), 'utf8');
  insert.run('extension', 'content-src/' + file, content);
  console.log('  +', file, content.length, 'chars');
  count++;
}
console.log('imported', count, 'modules');
db.close();
