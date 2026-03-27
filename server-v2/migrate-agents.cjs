const Database = require('better-sqlite3');
const db = new Database('/Users/yay/workspace/genspark-agent/server-v2/data/agent.db');

// Agents to migrate to memory.agent slot
const moves = [
  // from toolkit
  {from_slot:'toolkit', key:'agent-chat-builder'},
  {from_slot:'toolkit', key:'agent-chat-planner'},
  {from_slot:'toolkit', key:'agent-default'},
  {from_slot:'toolkit', key:'agent-douyin-script'},
  {from_slot:'toolkit', key:'agent-linkedin-post'},
  {from_slot:'toolkit', key:'agent-opus-planner'},
  {from_slot:'toolkit', key:'agent-professor-zylonix'},
  {from_slot:'toolkit', key:'agent-prompt-architect'},
  {from_slot:'toolkit', key:'agent-translator'},
  {from_slot:'toolkit', key:'agent-web-builder-opus'},
  {from_slot:'toolkit', key:'agent-web-designer'},
  {from_slot:'toolkit', key:'agent-wechat-article'},
  // from default
  {from_slot:'default', key:'chart-designer', new_key:'agent-chart-designer'},
  {from_slot:'default', key:'forge-agent', new_key:'agent-forge'},
  {from_slot:'default', key:'log-analyzer-opus', new_key:'agent-log-analyzer-opus'},
  {from_slot:'default', key:'ui-designer', new_key:'agent-ui-designer'},
  {from_slot:'default', key:'ui-planner', new_key:'agent-ui-planner'},
  {from_slot:'default', key:'web-designer-v8', new_key:'agent-web-designer-v8'},
];

const insert = db.prepare('INSERT OR REPLACE INTO memory () VALUES (?, ?, ?)');
const select = db.prepare('SELECT content FROM memory WHERE slot=? AND key=?');
const del = db.prepare('DELETE FROM memory WHERE slot=? AND key=?');

let migrated = 0;
for (const m of moves) {
  const row = select.get(m.from_slot, m.key);
  if (!row) { console.log('SKIP (not found):', m.from_slot + '/' + m.key); continue; }
  const newKey = m.new_key || m.key;
  insert.run('agent', newKey, row.content);
  del.run(m.from_slot, m.key);
  console.log('MOVED:', m.from_slot + '/' + m.key, '->', 'agent/' + newKey, '(' + row.content.length + ' chars)');
  migrated++;
}

// Also move poster-designer from local_store.agent to memory.agent
const ls = db.prepare('SELECT content FROM local_store WHERE slot=? AND key=?').get('agent', 'poster-designer');
if (ls) {
  insert.run('agent', 'agent-poster-designer', ls.content);
  db.prepare('DELETE FROM local_store WHERE slot=? AND key=?').run('agent', 'poster-designer');
  console.log('MOVED: local_store.agent/poster-designer -> memory.agent/agent-poster-designer (' + ls.content.length + ' chars)');
  migrated++;
}

console.log('\nTotal migrated:', migrated);
db.close();
