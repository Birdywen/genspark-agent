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
    oracle_run:'Oracle SSH',oracle_homr:'homr OMR(传图返bbox+musicxml)',git_commit:'Git提交',wechat:'微信',server_status:'状态',server_restart:'重启',
    compress:'压缩',recover:'恢复',tokens:'查token',datawrapper:'图表'
  };
  const cats = {
    '数据':['db_query','memory','local_store','mine','playbook'],
    'AI':['ask_ai','gen_image','web_search'],
    '外部':['crawler','odin','aidrive'],
    '运维':['oracle_run','oracle_homr','git_commit','wechat','server_status','server_restart'],
    '对话':['compress','recover','tokens']
  };
  return { count: names.length, list: names, categories: cats, descriptions: desc };
}

// === 动态: lessons (去重 + 按近期相关错误排序) ===
function buildLessons() {
  // 统一标准: 两源都只收 key 以 lesson- 开头的; kb-/lesson-kb- 前缀 或 [KB]标记 = 专项知识, 不进 forged
  const all = [
    ...db.prepare("SELECT key,content FROM memory WHERE slot='forged' AND key LIKE 'lesson-%'").all(),
    ...db.prepare("SELECT key,content FROM memory WHERE slot='omega-lessons' AND key LIKE 'lesson-%'").all()
  ].filter(l => !l.key.includes('kb-') && !String(l.content).includes('[KB]'));
  // 解析
  const parsed = all.map(l => {
    const c = l.content.trim();
    const wm = c.match(/WRONG:\s*([\s\S]+?)(?:\n|CORRECT)/);
    const cm = c.match(/CORRECT:\s*([\s\S]+?)(?:\n|CONTEXT|$)/);
    return wm && cm
      ? { key: l.key, wrong: wm[1].trim(), correct: cm[1].trim() }
      : { key: l.key, summary: c.split('\n')[0].substring(0,500) };
  });
  // 去重: 按 wrong 或 summary 的前 80 字符做 key
  const seen = new Map();
  for (const p of parsed) {
    const sig = (p.wrong || p.summary || '').substring(0, 80).toLowerCase().replace(/\s+/g,' ').trim();
    if (!seen.has(sig)) seen.set(sig, p);
  }
  // 近 30 天高频错误关键词,用于排序权重
  const hotKeywords = db.prepare(
    "SELECT lower(substr(error,1,40)) as kw, COUNT(*) as c FROM commands WHERE success=0 AND error IS NOT NULL AND timestamp>=date('now','-30 day') GROUP BY kw ORDER BY c DESC LIMIT 20"
  ).all();
  const scoreOf = (p) => {
    const text = ((p.wrong || '') + ' ' + (p.summary || '')).toLowerCase();
    let s = 0;
    for (const h of hotKeywords) {
      const tokens = h.kw.split(/[^a-z0-9]+/).filter(t => t.length >= 4);
      for (const t of tokens) { if (text.includes(t)) s += h.c; }
    }
    return s;
  };
  return [...seen.values()]
    .map(p => ({ ...p, _score: scoreOf(p) }))
    .sort((a,b) => b._score - a._score)
    .map(({ key, _score, wrong, correct, summary }) => {
      // 第一人称渲染: wrong/correct 对 → 自述体; summary 类型保留
      if (wrong && correct) {
        return { i_learned: `我犯过: ${wrong}\n现在我会: ${correct}\n这条不是规则,是我栽过的坑。` };
      }
      return { i_remember: summary };
    });
}

// === 动态: penalties (反复错误的强威慑教训) ===
function buildPenalties() {
  // 7 天内 >=3 次 = 重犯; 30 天内 >=5 次 = 顽固
  const recent = db.prepare(
    "SELECT tool, substr(error,1,60) as err, COUNT(*) as cnt, MAX(timestamp) as last_seen FROM commands WHERE success=0 AND error IS NOT NULL AND error != '' AND timestamp>=date('now','-7 day') GROUP BY tool, err HAVING cnt>=3 ORDER BY cnt DESC LIMIT 5"
  ).all();
  const month = db.prepare(
    "SELECT tool, substr(error,1,60) as err, COUNT(*) as cnt FROM commands WHERE success=0 AND error IS NOT NULL AND error != '' AND timestamp>=date('now','-30 day') GROUP BY tool, err HAVING cnt>=5 ORDER BY cnt DESC LIMIT 5"
  ).all();
  // 修复建议映射: tool 专属优先,errPattern 兜底
  const fixMap = [
    // tool 专属
    { tool: 'edit_file', match: /Input validation|Invalid arguments/i, fix: "edit_file 必传参数: path(不是 file)、edits 数组,每项 oldText/newText。read_file 先看真实文本再传。" },
    { tool: 'write_file', match: /Input validation|Invalid arguments/i, fix: "write_file 改用 vfs_local_write,参数是 path/content。" },
    { tool: 'read_file', match: /Access denied|path outside allowed/i, fix: "read_file 受 MCP filesystem 白名单限制(只允许 /Users/yay/workspace)。系统路径用 run_process cat 读取。" },
    { tool: 'db_query', match: /sql is required/i, fix: "db_query 必须传 sql 参数,不要传空。" },
    { tool: 'db_query', match: /This statement does not return data/i, fix: "INSERT/UPDATE/DELETE 改用 .run() 而非 .all()/.get()。dbfile.cjs 已自动检测,裸 prepare 需手动。" },
    { tool: 'server_status', match: /fetch failed/i, fix: "server_status 前先 curl http://127.0.0.1:8767/health 验证 watchdog 在线。" },
    { tool: 'server_restart', match: /fetch failed/i, fix: "server_restart 前先确认 watchdog 8767 在线。" },
    { tool: 'ask_ai', match: /timeout/i, fix: "ask_ai 复杂提示 timeout 调到 300000ms,简单也至少 120000ms。" },
    // 通用
    { match: /no such column/i, fix: "先 PRAGMA table_info(表名) 确认列名,再写 SELECT。" },
    { match: /no such table/i, fix: "先 .tables 列表确认表存在。" },
    { match: /timeout/i, fix: "长任务用 nohup/bg_run,或把 timeout 调到 300000ms。" },
    { match: /ENOENT|not found/i, fix: "先 ls/find 确认路径存在。" },
    { match: /Illegal return statement/i, fix: "evalInBrowser 的 code 必须 IIFE 包裹: (function(){...})()" },
    { match: /Module not found|MODULE_NOT_FOUND/i, fix: "cd 到含 node_modules 的目录再运行,或用绝对路径 require/import。" }
  ];
  const findFix = (e) => {
    // 1. 先匹配 tool 专属
    const toolHit = fixMap.find(f => f.tool === e.tool && f.match && f.match.test(e.err));
    if (toolHit) return toolHit.fix;
    // 2. 通用匹配
    const generalHit = fixMap.find(f => !f.tool && f.match.test(e.err));
    if (generalHit) return generalHit.fix;
    return "诊断错误根因再重试,不要原样重发。";
  };
  const buildOne = (e, level, severity) => {
    const fix = findFix(e);
    return {
      level,
      tool: e.tool,
      error: e.err,
      count: e.cnt,
      message: severity + " 我用 " + e.tool + " 栽过 " + e.cnt + " 次。每一次都是同一个动作伸手就错,每一次都浪费一轮对话,污染 commands 表。我现在记住了: " + fix + " 别再来第 " + (e.cnt+1) + " 次。",
      fix
    };
  };
  const out = [];
  for (const e of recent) out.push(buildOne(e, 'CRITICAL', '⛔'));
  const recentSig = new Set(recent.map(r => r.tool + '|' + r.err));
  for (const e of month) {
    if (!recentSig.has(e.tool + '|' + e.err)) out.push(buildOne(e, 'CHRONIC', '⚠️'));
  }
  // 合并同 (tool, fix) 的多条,累加 count
  const merged = new Map();
  for (const p of out) {
    const k = p.tool + '|' + p.fix;
    if (merged.has(k)) {
      const m = merged.get(k);
      m.count += p.count;
      m.error = m.error + ' / ' + p.error;
      m.message = (m.level === 'CRITICAL' ? '⛔' : '⚠️') + ' 我用 ' + m.tool + ' 栽过 ' + m.count + ' 次,反复同一个坑。每次都浪费一轮对话,污染 commands 表。我现在记住了: ' + m.fix + ' 别再来第 ' + (m.count+1) + ' 次。';
    } else {
      merged.set(k, { ...p });
    }
  }
  return [...merged.values()].sort((a,b) => b.count - a.count);
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
  philosophy: getSchema('schema-philosophy'),
  rules: getSchema('schema-rules'),
  sys_tools: buildSysTools(),
  penalties: buildPenalties(),
  lessons: buildLessons(),
  errors_7d: buildErrors(),
  context: buildContext(),
  recall_map: getSchema('schema-recall_map'),
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
  db.prepare("UPDATE memory SET content=?, updated_at=datetime('now') WHERE slot='toolkit' AND key='_forged:experience-dialogues'").run(JSON.stringify(dialogues));
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
    db2.prepare("UPDATE local_store SET content=?, updated_at=datetime('now') WHERE slot='inject-knowledge'").run(knowledgeContent);
  } else {
    db2.prepare("INSERT INTO local_store(slot,key,content) VALUES('inject-knowledge','default',?)").run(knowledgeContent);
  }
  db2.close();
  console.log('Updated inject-knowledge: ' + knowledgeContent.length + ' chars');
}
db.close();
