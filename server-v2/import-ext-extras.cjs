const fs = require('fs');
const path = require('path');
const db = require('better-sqlite3')('/Users/yay/workspace/genspark-agent/project.db');

const baseDir = '/Users/yay/workspace/genspark-agent/extension';
const files = [
  'background.js', 'manifest.json', 'panel-enhancer.js',
  'smart_tips.js', 'sse-hook.js', 'vfs-cache.js', 'video-generator.js',
  'build.sh', 'build-from-db.sh'
];

const insert = db.prepare("INSERT OR REPLACE INTO project (project, path, content, updated_at) VALUES (?, ?, ?, datetime('now'))");

let count = 0;
for (const f of files) {
  const fullPath = path.join(baseDir, f);
  if (!fs.existsSync(fullPath)) { console.log('  SKIP', f); continue; }
  const content = fs.readFileSync(fullPath, 'utf8');
  insert.run('extension', f, content);
  console.log('  +', f, content.length, 'chars');
  count++;
}
console.log('imported', count, 'files');
db.close();
