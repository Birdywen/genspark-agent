#!/usr/bin/env node
// update-forged.cjs - 自动更新 forged dialogue 的工具清单
// 用法: node update-forged.cjs [--dry-run]

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'agent.db');
const db = new Database(dbPath);
const dryRun = process.argv.includes('--dry-run');

// 1. 读取当前 forged dialogue
const forgedRow = db.prepare("SELECT content FROM memory WHERE slot='toolkit' AND key='_forged:experience-dialogues'").get();
if (!forgedRow) { console.error('No forged dialogue found!'); process.exit(1); }
const dialogues = JSON.parse(forgedRow.content);
const assistantIdx = dialogues.findIndex(d => d.role === 'assistant');
if (assistantIdx === -1) { console.error('No assistant message!'); process.exit(1); }
let content = dialogues[assistantIdx].content;

// 2. 从 sys-tools.js 提取实际 handler 名称
const fs = require('fs');
const sysCode = fs.readFileSync(path.join(__dirname, 'sys-tools.js'), 'utf8');
const handlerNames = [];
const re = /handlers\.set\(['"]([^'"]+)['"]/g;
let m;
while ((m = re.exec(sysCode)) !== null) {
  if (m[1] !== 'eval_js' && m[1] !== 'list_tabs' && m[1] !== 'take_screenshot') {
    handlerNames.push(m[1]);
  }
}

// 3. 定义工具分类和简介
const toolDescriptions = {
  db_query: '数据库查询',
  memory: '记忆存取(slot/key/value)',
  local_store: '本地存储(slot/key/value)',
  mine: '知识挖掘',
  playbook: '流程剧本',
  ask_ai: 'AI对话(gsk API, 10-20credit/次)',
  gen_image: '生图(nano-banana-pro)',
  web_search: '搜索(gsk, 1credit/次)',
  crawler: 'Diffbot结构化/GSK文本/KG知识图谱/NER(7模式)',
  odin: 'Odin平台(search/summarize/translate/classify/chat/workflow/code,免费)',
  aidrive: 'GSK AI Drive云存储(ls/mkdir/rm/upload/download,免费)',
  oracle_run: 'Oracle服务器SSH',
  git_commit: 'Git提交',
  wechat: '微信(send/read/history/members)',
  server_status: '查agent服务状态',
  server_restart: '重启agent服务',
  compress: '对话压缩',
  recover: '恢复历史对话',
  tokens: '查token用量',
};

const categories = {
  '数据/记忆': ['db_query', 'memory', 'local_store', 'mine', 'playbook'],
  'AI/生成': ['ask_ai', 'gen_image', 'web_search'],
  '外部平台': ['crawler', 'odin', 'aidrive'],
  '系统/运维': ['oracle_run', 'git_commit', 'wechat', 'server_status', 'server_restart'],
  '对话管理': ['compress', 'recover', 'tokens'],
};

// 4. 生成新工具清单
const lines = [];
lines.push(`=== SYS-TOOLS (${handlerNames.length}个，ΩCODE内直接调) ===`);
for (const [cat, tools] of Object.entries(categories)) {
  const descs = tools.map(t => {
    const desc = toolDescriptions[t];
    return desc ? `${t}(${desc})` : t;
  });
  lines.push(`--- ${cat} --- ${descs.join(' | ')}`);
}
// 关键用法速查
lines.push('速查:');
lines.push('  crawler: {tool:"crawler",params:{url:"..."}}) // diffbot默认 mode:gsk|both|kg|enhance|nl');
lines.push('  odin: {tool:"odin",params:{action:"search",query:"..."}}) // 还有summarize|translate|classify|code|workflow');
lines.push('  odin code: {tool:"odin",params:{action:"code",sub:"execute",id:1,kwargs:{}}} // 云端Lambda(E2B,免费,~11s冷启动)');
lines.push('  aidrive: {tool:"aidrive",params:{action:"ls",path:"/"}} // 云存储中转站');
lines.push('WRONG: 手动curl API，浏览器console调__mine CORRECT: ΩCODE里直接用sys-tool');

const newToolText = lines.join('\n');

// 5. 替换 SYS-TOOLS 段落
const sysStart = content.indexOf('=== SYS-TOOLS');
const sysEnd = content.indexOf('=== ASK_AI MODELS');
if (sysStart === -1 || sysEnd === -1) {
  console.error('Cannot find SYS-TOOLS or ASK_AI MODELS markers');
  process.exit(1);
}

const newContent = content.substring(0, sysStart) + newToolText + '\n\n' + content.substring(sysEnd);

console.log('--- NEW SYS-TOOLS SECTION ---');
console.log(newToolText);
console.log('--- END ---');
console.log(`\nContent: ${content.length} -> ${newContent.length} chars`);

// 6. 检查有没有新 handler 没在分类里
const allCategorized = Object.values(categories).flat();
const uncategorized = handlerNames.filter(h => !allCategorized.includes(h));
if (uncategorized.length) {
  console.log(`\n⚠️  未分类的 handler: ${uncategorized.join(', ')}`);
}

if (!dryRun) {
  dialogues[assistantIdx].content = newContent;
  db.prepare("UPDATE memory SET content = ? WHERE slot='toolkit' AND key='_forged:experience-dialogues'").run(JSON.stringify(dialogues));
  console.log('\n✅ Forged dialogue updated!');
} else {
  console.log('\n[DRY RUN] No changes written.');
}

db.close();
