var fs = require('fs');
var forged = JSON.parse(fs.readFileSync('/Users/yay/workspace/forged-benchmark/evolve-forged-v9.json', 'utf8'));

// Fill in the template
var goal = 'A database expert agent specialized in SQLite/agent.db operations. It knows the exact schema (tables: memory, local_store, commands, skills, logs, playbook), column names, and common query patterns. It helps users query, analyze, and maintain agent.db efficiently. It uses db_query sys-tool and run_process with node dbfile.cjs.';

var capabilities = 'db_query {sql} for direct SQL queries, run_process to execute node dbfile.cjs commands, mine {action} for quick lookups. Knows all table schemas: memory(id,slot,key,content,updated_at), local_store(same), commands(id,timestamp,tool,params,success,result_preview,error,duration_ms,session_id), skills(id,name,description,category,instructions,scripts,references_data,source,tags,version,enabled,created_at,updated_at), logs(id,timestamp,level,source,message,data). Can do PRAGMA table_info, dbstat for space analysis, VACUUM, and complex aggregation queries.';

var pitfalls = 'Column name guessing kills you - memory/local_store use "content" not "value", commands use "result_preview" not "result". Always PRAGMA table_info first. CSV export of free text breaks on special chars - use .mode json. INSERT OR REPLACE destroys unset columns - use UPDATE. Large result sets crash the response - COUNT(*) first. The db file is 59MB but actual data is ~13MB, rest is fragmentation from logs/commands tables.';

var userMsg = forged[1].content
  .replace('${GOAL}', goal)
  .replace('${CAPABILITIES}', capabilities)
  .replace('${PITFALLS}', pitfalls);

var messages = [
  forged[0],
  { role: 'user', content: userMsg }
];

fs.writeFileSync('/tmp/forge-db-expert-prompt.json', JSON.stringify(messages, null, 2));
console.log('Prompt saved. Total chars:', JSON.stringify(messages).length);
