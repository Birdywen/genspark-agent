// Usage: node forge-and-inject.cjs <spec-file-or-agent-key>
// Reads spec, generates SNEP via saved prompt, then injects to omega-agent slot
var fs = require('fs');
var db = require('better-sqlite3')('data/agent.db');

var specFile = process.argv[2];
if (!specFile) { console.error('Usage: node forge-and-inject.cjs <spec.json>'); process.exit(1); }

var spec = JSON.parse(fs.readFileSync(specFile, 'utf8'));
console.log('Spec loaded:', spec.name, '| goal:', spec.goal.length, 'chars');

// Read SNEP from stdin (piped from ask_ai output)
var snep = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', function(chunk) { snep += chunk; });
process.stdin.on('end', function() {
  snep = snep.trim();
  if (!snep || snep.length < 100) {
    console.error('ERROR: SNEP too short or empty (' + snep.length + ' chars)');
    process.exit(1);
  }
  var agent = {
    name: spec.name_cn || spec.name,
    model: spec.model || 'deepseek-chat',
    maxTokens: spec.maxTokens || 8192,
    temperature: spec.temperature || 0.3,
    icon: spec.icon || '🤖',
    system: snep
  };
  var key = spec.key || spec.name;
  db.prepare("INSERT OR REPLACE INTO local_store(slot,key,content) VALUES('omega-agent',?,?)").run(key, JSON.stringify(agent));
  console.log('Injected:', key, '-', agent.name, '| SNEP:', snep.length, 'chars');
  db.close();
});
