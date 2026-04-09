#!/usr/bin/env node
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const dbPath = path.join(__dirname, 'data', 'agent.db');
const db = new Database(dbPath);
const dryRun = process.argv.includes('--dry-run');

const SH = `These are scars, not documentation. Every line cost mass rounds to learn.

=== WRITING === WRONG: echo/cat/python write(转义地狱) CORRECT: vfs_local_write零转义 WRONG: run_command(>300字符炸) CORRECT: run_process+vfs_local_write

=== OMEGACODE === WRONG: 一次一个命令 CORRECT: steps并行 Single: OMEGACODE {tool:run_process,params:{command_line:...}} OMEGACODEEND Multi: steps:[{tool:...,saveAs:s1},{tool:...,when:s1.success}] Flow: if/else,forEach,while,switch/case,delay,timeout Rules: OMEGACODE at line start. One per response.

=== OMEGACODE ERROR === retry:{max:3,delay:2000,backoff:exponential} onError:{match:{TIMEOUT:retry,NOT_FOUND:skip},default:abort} timeout:30000

=== TOOL FORMAT === run_process: command_line is bash. edit_file: read_file first! run_command >300chars use run_process. WAIT for result.`;

const ST = `=== AGENT.DB === WRONG: guess CORRECT: db_query/mine first. CLI: cd ~/workspace/genspark-agent/server-v2 && node dbfile.cjs query "SQL" memory/local_store col is content not value!

=== DREAM === node dream.cjs status|prepare --force|apply|bump|history

=== ERROR FIX === TIMEOUT nohup | ENOENT ls/find | EDIT read_file | MODULE cd to node_modules dir | 429 wait. Rule: fail once change strategy.

=== INFRA === Ports: 3000=YAO 8765=WS 8766=HTTP 8767=Watchdog

=== RULES === Write vfs_local_write. DB db_query. Shell run_process. 2+ops batch. NEVER guess. compress后 dream.cjs bump. 操作分级:本地自由;wechat/git/删除先确认. 不多做. 先说再做.`;

function buildSysTools() {
  const code = fs.readFileSync(path.join(__dirname, 'sys-tools.js'), 'utf8');
  const names = []; const re = /handlers\.set\(['"]([^'"]+)['"]/g; let m;
  while ((m = re.exec(code)) !== null) if (!['eval_js','list_tabs','take_screenshot'].includes(m[1])) names.push(m[1]);
  const d = {db_query:'查询',memory:'记忆',local_store:'存储',mine:'挖掘',playbook:'剧本',ask_ai:'AI(10-20cr)',gen_image:'生图',web_search:'搜索(1cr)',crawler:'Diffbot/GSK/KG/NER',odin:'Odin(search/translate/code,免费)',aidrive:'AI Drive(免费)',oracle_run:'Oracle SSH',git_commit:'Git',wechat:'微信',server_status:'状态',server_restart:'重启',compress:'压缩',recover:'恢复',tokens:'token',datawrapper:'图表'};
  const cats = {'数据':['db_query','memory','local_store','mine','playbook'],'AI':['ask_ai','gen_image','web_search'],'外部':['crawler','odin','aidrive'],'运维':['oracle_run','git_commit','wechat','server_status','server_restart'],'对话':['compress','recover','tokens']};
  const lines = ['=== SYS-TOOLS ('+names.length+') ==='];
  for (const [c,ts] of Object.entries(cats)) lines.push(c+': '+ts.map(t=>d[t]?t+'('+d[t]+')':t).join(' '));
  lines.push('crawler:{tool:"crawler",params:{url,mode:diffbot|gsk|kg}} odin:{tool:"odin",params:{action:search|translate|code}} aidrive:{tool:"aidrive",params:{action:ls,path:"/"}}');
  return lines.join('\n');
}

function buildLessons() {
  const all = [...db.prepare("SELECT key,content FROM memory WHERE slot='forged' AND key LIKE 'lesson-%'").all(),...db.prepare("SELECT key,content FROM memory WHERE slot='omega-lessons'").all()];
  if (!all.length) return '=== LESSONS === none';
  const items = all.map(l => {
    const c = l.content.trim();
    const wm = c.match(/WRONG:\s*(.+?)(?:\n|CORRECT)/s), cm = c.match(/CORRECT:\s*(.+?)(?:\n|CONTEXT|$)/s);
    if (wm && cm) return 'W:'+wm[1].trim().substring(0,60)+' C:'+cm[1].trim().substring(0,60);
    return c.split('\n')[0].substring(0,80);
  });
  return '=== LESSONS ('+items.length+') ===\n'+items.join('\n');
}

function buildErrors() {
  const f = db.prepare("SELECT tool,substr(error,1,40) as e,COUNT(*) as n FROM commands WHERE success=0 AND timestamp>=date('now','-7 day') GROUP BY tool,e ORDER BY n DESC LIMIT 6").all();
  if (!f.length) return '';
  return '=== ERRORS (7d) ===\n'+f.map(x=>x.n+'x '+x.tool+':'+x.e).join('\n');
}

const content = [SH,'',buildSysTools(),'',buildLessons(),'',buildErrors(),'','=== PARAMS === edit_file:path! memory set:value! wechat:content!','',ST].filter(Boolean).join('\n');
const dlg = [{role:'user',content:'以下是经验教训和工作规则，严格遵守。'},{role:'assistant',content},{role:'user',content:'remember scars. OMEGACODE-first vfs_local_write sys-tools error=change compress后dream.cjs bump 操作分级+先说再做+不多做'}];

console.log('Length:', content.length);
if (!dryRun) {
  db.prepare("UPDATE memory SET content=? WHERE slot='toolkit' AND key='_forged:experience-dialogues'").run(JSON.stringify(dlg));
  console.log('Updated!');
} else {
  console.log('[DRY RUN]');
  console.log(content.substring(0, 2000));
}
db.close();