var db = require('better-sqlite3')('./data/agent.db');
var content = '测试特殊字符：\n1. 中文「引号」"双引号" \'单引号\'\n2. 反斜杠 \\ \\n \\t \\\\\n3. HTML <div class="test">hello</div>\n4. JSON {"key": "value", "arr": [1,2,3]}\n5. function() { return \'hello\'; }\n6. emoji 🚀🔥✅';
db.prepare('INSERT OR REPLACE INTO local_store (slot, key, content) VALUES (?, ?, ?)').run('test', 'escape-test', content);
console.log('wrote ' + content.length + ' chars');
var row = db.prepare('SELECT content FROM local_store WHERE slot=? AND key=?').get('test', 'escape-test');
console.log('read back:');
console.log(row.content);