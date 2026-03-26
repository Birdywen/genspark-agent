// db-to-file bridge: write files via SQLite to avoid tool truncation
const fs = require('fs');
const path = require('path');
const db = require('./db.cjs');

const args = process.argv.slice(2);
const cmd = args[0];

if (cmd === 'write') {
  // node lib/dbfile.cjs write <slot> <key> <filepath>
  const content = db.getLocal(args[1], args[2]);
  if (!content) { console.error('Not found:', args[1], args[2]); process.exit(1); }
  const dir = path.dirname(args[3]);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(args[3], content, 'utf8');
  console.log('Written', content.length, 'chars to', args[3]);
}
else if (cmd === 'read') {
  // node lib/dbfile.cjs read <filepath> <slot> <key>
  const content = fs.readFileSync(args[1], 'utf8');
  db.setLocal(args[2], args[3], content);
  console.log('Stored', content.length, 'chars as', args[2] + '/' + args[3]);
}
else if (cmd === 'list') {
  const rows = db.query("SELECT slot, key, LENGTH(content) as size FROM local_store WHERE slot = ? ORDER BY key", [args[1] || 'file']);
  rows.forEach(r => console.log(r.key, r.size + ' bytes'));
}
else {
  console.log('Usage:');
  console.log('  node lib/dbfile.cjs write <slot> <key> <filepath>  -- DB to file');
  console.log('  node lib/dbfile.cjs read <filepath> <slot> <key>   -- file to DB');
  console.log('  node lib/dbfile.cjs list [slot]                    -- list entries');
}
