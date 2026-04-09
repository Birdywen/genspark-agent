#!/usr/bin/env node
// update-forged.cjs v3 - JSON模块化拼接 forged dialogue
// 静态模块从 memory forged/schema-* 读取
// 动态模块(sys-tools/lessons/errors)实时生成
// 用法: node update-forged.cjs [--dry-run]

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const dbPath = path.join(__dirname, 'data', 'agent.db');
const db = new Database(dbPath);
const dryRun = process.argv.includes('--dry-run');

// === 读取静态模块 ===
function getSchema(key) {
  const r = db.prepare("SELECT content FROM memory WHERE slot='forged' AND key=?").get(key);
  return r ? JSON.parse(r.content) : null;
}

// === 动态: sys-tools ===
function buildSysTools() {
  const code = fs.readFileSync(path.join(__dirname, 'sys-tools.js'), 'utf8');
  const names = []; const re = /handlers\.set\(['"]([^'"]+)['"]/g; let m;
  while ((m = re.exec(code)) !== null) {
    if (!['eval_js','list_tabs','take_screenshot'].includes(m[1])) names.push(m[1]);
  }
  const desc = {
    db_query:'查询',memory:'记忆存取',local_store:'本地存储',mine:'知识挖掘',playbook:'流程剧本',
    ask_ai:'AI对话(10-20cr)',gen_image:'生图',web_search:'搜索(1cr)',
    crawler:'Diffbot结构化/GSK/KG/NER',odin:'Odin(search/translate/code,免费)',aidrive:'AI Drive云存储(免费)',
    oracle_run:'Oracle SSH',git_commit:'Git提交',wechat:'微信',server_status:'状态',server_restart:'重启',
    compress:'压缩',recover:'恢复',tokens:'查token',datawrapper:'图表'
  };
  const cats = {
    '数据':['db_query','memory','local_store','mine','playbook'],
    'AI':['ask_ai','gen_image','web_search'],
    '外部':['crawler','odin','aidrive'],
    '运维':['oracle_run','git_commit','wechat','server_status','server_restart'],
    '对话':['compress','recover','tokens']
  };
  return { count: names.length, list: names, categories: cats, descriptions: desc };
}

// === 动态: lessons ===
function buildLessons() {
  const all = [
    ...db.prepare("SELECT key,content FROM memory WHERE slot='forged' AND key LIKE 'lesson-%'").all(),
    ...db.prepare("SELECT key,content FROM memory WHERE slot='omega-lessons'").all()
  ];
  return all.map(l => {
    const c = l.content.trim();
    const wm = c.match(/WRONG:\s*(.+?)(?:\n|CORRECT)/s);
    const cm = c.match(/CORRECT:\s*(.+?)(?:\n|CONTEXT|$)/s);
    if (wm && cm) return { wrong: wm[1].trim().substring(0,80), correct: cm[1].trim().substring(0,80) };
    return { summary: c.split('\n')[0].substring(0,100) };
  });
}

// === 动态: errors ===
function buildErrors() {
  return db.prepare(
    "SELECT tool, substr(error,1,50) as err, COUNT(*) as cnt FROM commands WHERE success=0 AND timestamp>=date('now','-7 day') GROUP BY tool, err ORDER BY cnt DESC LIMIT 8"
  ).all();
}

// === 组装 ===
const forgedJson = {
  meta: getSchema('schema-meta'),
  rules: getSchema('schema-rules'),
  sys_tools: buildSysTools(),
  lessons: buildLessons(),
  errors_7d: buildErrors(),
  params: getSchema('schema-params'),
  infra: getSchema('schema-infra')
};

const content = JSON.stringify(forgedJson, null, 1);
console.log('Total:', content.length, 'chars');
console.log('Modules:', Object.keys(forgedJson).join(', '));
console.log('Sys-tools:', forgedJson.sys_tools.count);
console.log('Lessons:', forgedJson.lessons.length);
console.log('Errors:', forgedJson.errors_7d.length);

if (dryRun) {
  console.log('\n[DRY RUN] Preview:');
  console.log(content.substring(0, 3000));
} else {
  const dialogues = [
    {role:'user',content:'以下是JSON格式的经验教训和工作规则，严格遵守。所有模块均可通过 node update-forged.cjs 自动更新。'},
    {role:'assistant',content},
    {role:'user',content:'rules已加载。ΩCODE-first, vfs_local_write写文件, sys-tools统一入口, 错一次换策略, compress后dream.cjs bump, 操作分级+先说再做+不多做.'}
  ];
  db.prepare("UPDATE memory SET content=? WHERE slot='toolkit' AND key='_forged:experience-dialogues'").run(JSON.stringify(dialogues));
  console.log('Updated forged dialogue!');
}
db.close();
