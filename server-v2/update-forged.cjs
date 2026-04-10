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
    if (wm && cm) return { wrong: wm[1].trim().substring(0,80), correct: cm[1].trim() };
    return { summary: c.split('\n')[0].substring(0,300) };
  });
}

// === 动态: errors ===
function buildErrors() {
  return db.prepare(
    "SELECT tool, substr(error,1,80) as err, COUNT(*) as cnt FROM commands WHERE success=0 AND error IS NOT NULL AND error != '' AND timestamp>=date('now','-7 day') GROUP BY tool, err ORDER BY cnt DESC LIMIT 8"
  ).all();
}

// === 动态: context (plans + scripts) ===
function buildContext() {
  const plans = db.prepare(
    "SELECT key, substr(content,1,500) as preview FROM memory WHERE slot='forged' AND key LIKE 'plan-%' ORDER BY rowid DESC LIMIT 3"
  ).all();
  const scripts = db.prepare(
    "SELECT key FROM local_store WHERE key LIKE 'script/%' ORDER BY key LIMIT 15"
  ).all();
  const sessionCtx = db.prepare(
    "SELECT substr(content,1,1000) as preview FROM memory WHERE slot='context' AND key='session-state'"
  ).get();
  return {
    plans: plans.map(p => ({ key: p.key, preview: p.preview })),
    scripts: scripts.map(s => s.key.replace('script/','')),
    session: sessionCtx ? sessionCtx.preview : null
  };
}

// === 组装 ===
const forgedJson = {
  meta: getSchema('schema-meta'),
  rules: getSchema('schema-rules'),
  sys_tools: buildSysTools(),
  lessons: buildLessons(),
  errors_7d: buildErrors(),
  context: buildContext(),
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

  // 同时生成 inject-knowledge（供 compress 弹窗使用）
  const knowledgeParts = [];
  const db3 = new Database(dbPath);

  // 1. 工具健康度（7天成功率最低5个）
  const toolHealth = db3.prepare(
    "SELECT tool, ROUND(100.0*SUM(CASE WHEN success=1 THEN 1 ELSE 0 END)/COUNT(*),1) as rate, COUNT(*) as total FROM commands WHERE timestamp>=date('now','-7 day') GROUP BY tool HAVING total>=5 ORDER BY rate ASC LIMIT 5"
  ).all();
  if (toolHealth.length > 0) {
    knowledgeParts.push('## 工具健康度(7天)');
    toolHealth.forEach(t => knowledgeParts.push('- ' + t.tool + ': ' + t.rate + '%成功 (' + t.total + '次)'));
  }

  // 2. 近7天高频错误
  if (forgedJson.errors_7d.length > 0) {
    knowledgeParts.push('\n## 近7天高频错误');
    forgedJson.errors_7d.forEach(e => knowledgeParts.push('- ' + e.tool + '(' + e.cnt + '次): ' + (e.err || 'null')));
  }

  // 3. Playbook速查（正确/错误方法）
  const playbooks = db3.prepare(
    "SELECT keyword, correct_method, wrong_method FROM playbook ORDER BY priority DESC, query_count DESC LIMIT 8"
  ).all();
  if (playbooks.length > 0) {
    knowledgeParts.push('\n## Playbook速查');
    playbooks.forEach(p => {
      let line = '- ' + p.keyword + ': ✓ ' + p.correct_method;
      if (p.wrong_method) line += ' (✗ ' + p.wrong_method + ')';
      knowledgeParts.push(line);
    });
  }

  // 4. 最近经验教训
  if (forgedJson.lessons.length > 0) {
    knowledgeParts.push('\n## 最近经验教训');
    forgedJson.lessons.slice(0, 8).forEach(l => {
      if (l.wrong) knowledgeParts.push('- ✗ ' + l.wrong + ' → ✓ ' + l.correct);
      else if (l.summary) knowledgeParts.push('- ' + l.summary);
    });
  }

  // 5. 今日操作概览
  const todayOps = db3.prepare(
    "SELECT tool, COUNT(*) as cnt, SUM(CASE WHEN success=1 THEN 1 ELSE 0 END) as ok FROM commands WHERE timestamp>=date('now') GROUP BY tool ORDER BY cnt DESC LIMIT 8"
  ).all();
  if (todayOps.length > 0) {
    knowledgeParts.push('\n## 今日操作概览');
    todayOps.forEach(t => knowledgeParts.push('- ' + t.tool + ': ' + t.ok + '/' + t.cnt + '次'));
  }

  // 6. 当前计划
  if (forgedJson.context && forgedJson.context.plans.length > 0) {
    knowledgeParts.push('\n## 当前计划');
    forgedJson.context.plans.forEach(p => knowledgeParts.push('- ' + p.key + ': ' + p.preview.substring(0, 400)));
  }

  // 7. 可用脚本索引
  const allScripts = db3.prepare(
    "SELECT key FROM local_store WHERE slot='script' ORDER BY key"
  ).all();
  if (allScripts.length > 0) {
    knowledgeParts.push('\n## 可用脚本(' + allScripts.length + '个)');
    knowledgeParts.push(allScripts.map(s => s.key).join(', '));
  }

  db3.close();

  const knowledgeContent = knowledgeParts.join('\n');
  db2 = new Database(dbPath);
  const existsKJ = db2.prepare("SELECT 1 FROM local_store WHERE slot='inject-knowledge'").get();
  if (existsKJ) {
    db2.prepare("UPDATE local_store SET content=? WHERE slot='inject-knowledge'").run(knowledgeContent);
  } else {
    db2.prepare("INSERT INTO local_store(slot,key,content) VALUES('inject-knowledge','default',?)").run(knowledgeContent);
  }
  db2.close();
  console.log('Updated inject-knowledge: ' + knowledgeContent.length + ' chars');
}
db.close();
