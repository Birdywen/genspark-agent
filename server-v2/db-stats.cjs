var db = require('better-sqlite3')('data/agent.db', {readonly:true});
var fs = require('fs');

['memory','local_store'].forEach(function(t) {
  var r = db.prepare('SELECT COUNT(*) as c, SUM(LENGTH(content)) as b FROM ' + t).get();
  console.log(t + ': ' + r.c + ' rows, ' + Math.round((r.b||0)/1024) + 'KB');
});

var sk = db.prepare("SELECT COUNT(*) as c, SUM(LENGTH(COALESCE(instructions,''))) + SUM(LENGTH(COALESCE(scripts,''))) + SUM(LENGTH(COALESCE(references_data,''))) as b FROM skills").get();
console.log('skills: ' + sk.c + ' rows, ' + Math.round((sk.b||0)/1024) + 'KB');

var cmd = db.prepare("SELECT COUNT(*) as c, SUM(LENGTH(COALESCE(params,''))) + SUM(LENGTH(COALESCE(result_preview,''))) + SUM(LENGTH(COALESCE(error,''))) as b FROM commands").get();
console.log('commands: ' + cmd.c + ' rows, ' + Math.round((cmd.b||0)/1024) + 'KB');

console.log('\nFile: ' + Math.round(fs.statSync('data/agent.db').size/1024/1024) + 'MB');
db.close();
