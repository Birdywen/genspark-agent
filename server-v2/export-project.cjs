const fs = require('fs');
const path = require('path');
const db = require('better-sqlite3')('/Users/yay/workspace/genspark-agent/project.db');

const projectName = process.argv[2] || 'extension';
const rows = db.prepare('SELECT path, content FROM project WHERE project = ? ORDER BY path').all(projectName);

if (rows.length === 0) {
  console.log('No modules found for project:', projectName);
  process.exit(1);
}

const baseDir = '/Users/yay/workspace/genspark-agent/extension';
let count = 0;
for (const row of rows) {
  const fullPath = path.join(baseDir, row.path);
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(fullPath, row.content);
  console.log('  >', row.path, row.content.length, 'chars');
  count++;
}
console.log('exported', count, 'modules from project:', projectName);
db.close();
