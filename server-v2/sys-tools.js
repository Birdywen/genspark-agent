// sys-tools.js — 自定义工具，不走 MCP
import { execSync } from 'child_process';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const handlers = new Map();

// ===== db_query =====
handlers.set('db_query', async (params) => {
  const { sql } = params;
  if (!sql) return { success: false, error: 'sql is required' };
  const dbPath = path.join(__dirname, 'data', 'agent.db');
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db.prepare(sql).all();
    return { success: true, result: rows.length > 50 ? rows.slice(0, 50) : rows, count: rows.length };
  } catch (e) {
    return { success: false, error: e.message };
  } finally {
    db.close();
  }
});

// ===== git_commit =====
handlers.set('git_commit', async (params) => {
  const { message, path: repoPath } = params;
  if (!message) return { success: false, error: 'message is required' };
  const cwd = repoPath || path.join(__dirname, '..');
  try {
    execSync('git add -A', { cwd, encoding: 'utf8', timeout: 10000 });
    const result = execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd, encoding: 'utf8', timeout: 10000 });
    return { success: true, result: result.trim().split('\n').slice(-3).join('\n') };
  } catch (e) {
    return { success: false, error: e.message.substring(0, 500) };
  }
});

// ===== wechat =====
handlers.set('wechat', async (params) => {
  const { action, to, chat, content, args } = params;
  if (!action) return { success: false, error: 'action is required' };
  const parts = ['~/workspace/wechat-cli/wechat', action];
  // 位置参数格式: wechat send "联系人" "内容" / wechat read "联系人"
  if (action === 'send' && to && content) {
    parts.push(`"${to}"`, `"${content}"`);
  } else if (action === 'read' && (chat || to)) {
    parts.push(`"${chat || to}"`);
  } else if (to) {
    parts.push(`"${to}"`);
  }
  if (args) parts.push(...(Array.isArray(args) ? args : [args]));
  try {
    const result = execSync(parts.join(' '), { encoding: 'utf8', timeout: 30000, shell: true });
    return { success: true, result: result.trim() };
  } catch (e) {
    return { success: false, error: e.message.substring(0, 500) };
  }
});

// ===== oracle_run =====
handlers.set('oracle_run', async (params) => {
  const { command } = params;
  if (!command) return { success: false, error: 'command is required' };
  try {
    const result = execSync(`ssh oracle "${command.replace(/"/g, '\\"')}"`, { encoding: 'utf8', timeout: 120000, shell: true });
    return { success: true, result: result.trim().substring(0, 5000) };
  } catch (e) {
    return { success: false, error: e.message.substring(0, 500) };
  }
});

// ===== gen_image (需要浏览器转发) =====
// 标记为 browser-side，handleToolCall 检测到后走 forwardToBrowser
// gen_image 去重: 30秒内同 prompt 不重复执行
// gen_image 去重: 30秒内同 prompt 不重复执行
let _lastGenImage = { prompt: null, time: 0, result: null };
handlers.set('gen_image', async (params, context) => {
  const now = Date.now();
  if (params.prompt === _lastGenImage.prompt && now - _lastGenImage.time < 30000 && _lastGenImage.result) {
    return _lastGenImage.result;
  }
  _lastGenImage = { prompt: params.prompt, time: now, result: null };
  const { evalInBrowser } = context;
  if (!evalInBrowser) return { success: false, error: 'evalInBrowser not available' };
  
  const prompt = JSON.stringify(params.prompt || '');
  const model = params.model || 'nano-banana-pro';
  
  // Step 1: 在浏览器端发起生图请求
  const initCode = [
    'if(window.__imgState && (window.__imgState.st==="sending"||window.__imgState.st==="polling")){return "already_running"}',
    'window.__imgState={tid:null,url:null,err:null,st:"sending"};',
    'fetch("/api/agent/ask_proxy",{method:"POST",headers:{"Content-Type":"application/json"},',
    'body:JSON.stringify({messages:[{role:"user",content:'+prompt+'}],',
    'type:"image_generation_agent",auto_prompt:null,model:"'+model+'",',
    'project_id:"7e6cbd20-270d-43aa-afe0-331d1c6d7f52"})})',
    '.then(function(r){var rd=r.body.getReader(),dc=new TextDecoder(),b="";',
    'function p(){return rd.read().then(function(rs){if(rs.done){window.__imgState.err="no tid";window.__imgState.st="failed";return}',
    'b+=dc.decode(rs.value);var m=b.match(/task_id.*?([a-f0-9-]{36})/);',
    'if(m){window.__imgState.tid=m[1];rd.cancel();po(0)}else return p()})}p()});',
    'function po(n){if(n>30){window.__imgState.err="timeout";window.__imgState.st="failed";return}',
    'setTimeout(function(){',
    'fetch("/api/spark/image_generation_task_detail?task_id="+window.__imgState.tid)',
    '.then(function(r){return r.json()})',
    '.then(function(d){',
    'if(d.data&&d.data.status==="SUCCESS"){',
    'window.__imgState.url=(d.data.image_urls_nowatermark||d.data.image_urls||[])[0];window.__imgState.st="done"}',
    'else if(d.data&&d.data.status==="FAILED"){window.__imgState.err="gen failed";window.__imgState.st="failed"}',
    'else po(n+1)})},2000)}',
    'return "started"'
  ].join('');
  
  await evalInBrowser(initCode);
  
  // Step 2: 轮询 __imgState 直到完成
  for (let i = 0; i < 35; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const checkResult = await evalInBrowser('return JSON.stringify(window.__imgState)');
    try {
      const state = JSON.parse(checkResult);
      if (state.st === 'done') {
        const r = { success: true, result: { url: state.url, task_id: state.tid } }; _lastGenImage.result = r; return r;
      }
      if (state.st === 'failed') {
        return { success: false, error: state.err, task_id: state.tid };
      }
    } catch(e) { /* continue polling */ }
  }
  return { success: false, error: 'timeout 70s' };
});


handlers.set('web_search', async (params) => {
  const q = params.q || params.query || '';
  if (!q) return { success: false, error: 'No query provided' };
  const { execSync } = require('child_process');
  try {
    const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q);
    const raw = execSync('curl -s "' + url + '" -H "User-Agent: Mozilla/5.0"', { timeout: 15000, encoding: 'utf8' });
    const results = [];
    const parts = raw.split('result__a');
    for (let i = 1; i < parts.length && results.length < 5; i++) {
      const hrefM = parts[i].match(/href="([^"]+)"/);
      const textM = parts[i].match(/>([^<]+)/);
      if (hrefM && textM) {
        results.push({ url: hrefM[1], title: textM[1].trim(), snippet: '' });
      }
    }
    return { success: true, query: q, results };
  } catch(e) {
    return { success: false, error: e.message };
  }
});

// ask_ai: 通过 evalInBrowser 桥接 ask_proxy (ai_chat模式，不扣积分)
handlers.set('ask_ai', async (params, context) => {
  const { evalInBrowser } = context;
  if (!evalInBrowser) return { success: false, error: 'evalInBrowser not available' };
  const messages = params.messages || [{ role: 'user', content: params.prompt || '' }];
  const model = params.model || 'gpt-5.4';
  const projectId = params.project_id || 'face262c-60a3-49a7-b4a2-5c2f9d305316';
  const body = {
    ai_chat_model: model,
    ai_chat_enable_search: false,
    ai_chat_disable_personalization: true,
    use_moa_proxy: false,
    moa_models: [],
    type: 'ai_chat',
    project_id: projectId,
    messages: messages.map(m => ({ role: m.role, id: crypto.randomUUID(), content: m.content })),
    user_s_input: messages[messages.length - 1].content,
    is_private: true,
    push_token: ''
  };
  const bodyJson = JSON.stringify(body).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
  const code = `return fetch('/api/agent/ask_proxy',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:'${bodyJson}'}).then(r=>r.text()).then(raw=>{var t='';raw.split('\\n').forEach(l=>{if(l.includes('message_field_delta')){try{var o=JSON.parse(l.replace(/^data:\\s*/,''));if(o.delta)t+=o.delta}catch(e){}}});return t})`;
  try {
    const result = await evalInBrowser(code, 60000);
    return { success: true, result };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// datawrapper custom tool handler
// Actions: create, upload_data, publish, update, list, delete, fork
handlers.set('datawrapper', async (params, context) => {
  const { action } = params;
  if (!action) return { success: false, error: 'action is required: create|upload_data|publish|update|list|delete|fork' };
  
  const TOKEN = 'qvhi9qM49vFbj3hdJ7uvzykERnZPDDOjBnXCj2bBPCUOhqopFlz3z6UggPgyxCKj';
  const BASE = 'https://api.datawrapper.de/v3';
  
  const fetchDW = async (path, opts = {}) => {
    const url = BASE + path;
    const headers = { Authorization: 'Bearer ' + TOKEN, ...opts.headers };
    const resp = await fetch(url, { ...opts, headers });
    const text = await resp.text();
    if (!resp.ok) return { success: false, error: `${resp.status}: ${text.substring(0, 300)}` };
    try { return { success: true, result: JSON.parse(text) }; } catch { return { success: true, result: text }; }
  };

  switch (action) {
    case 'create': {
      // params: title, type, metadata (optional)
      const body = { title: params.title || 'Untitled', type: params.type || 'column-chart' };
      if (params.metadata) body.metadata = params.metadata;
      if (params.theme) body.theme = params.theme;
      return fetchDW('/charts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    }
    case 'upload_data': {
      // params: id, data (CSV string)
      if (!params.id) return { success: false, error: 'id is required' };
      if (!params.data) return { success: false, error: 'data (CSV) is required' };
      return fetchDW(`/charts/${params.id}/data`, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/csv' },
        body: params.data
      });
    }
    case 'publish': {
      // params: id
      if (!params.id) return { success: false, error: 'id is required' };
      return fetchDW(`/charts/${params.id}/publish`, { method: 'POST' });
    }
    case 'update': {
      // params: id, patch (object to PATCH)
      if (!params.id) return { success: false, error: 'id is required' };
      if (!params.patch) return { success: false, error: 'patch object is required' };
      return fetchDW(`/charts/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params.patch)
      });
    }
    case 'list': {
      // params: limit (default 10), search (optional)
      const limit = params.limit || 10;
      let path = `/charts?limit=${limit}&order=DESC&orderBy=lastModifiedAt`;
      if (params.search) path += `&search=${encodeURIComponent(params.search)}`;
      return fetchDW(path);
    }
    case 'delete': {
      // params: id
      if (!params.id) return { success: false, error: 'id is required' };
      return fetchDW(`/charts/${params.id}`, { method: 'DELETE' });
    }
    case 'fork': {
      // params: id (source chart to fork)
      if (!params.id) return { success: false, error: 'id is required' };
      return fetchDW(`/charts/${params.id}/fork`, { method: 'POST' });
    }
    case 'get': {
      // params: id
      if (!params.id) return { success: false, error: 'id is required' };
      return fetchDW(`/charts/${params.id}`);
    }
    case 'river': {
      // params: limit, search
      const limit = params.limit || 10;
      let path = `/river?limit=${limit}`;
      if (params.search) path += `&search=${encodeURIComponent(params.search)}`;
      return fetchDW(path);
    }
    default:
      return { success: false, error: `unknown action: ${action}. Use: create|upload_data|publish|update|list|delete|fork|get|river` };
  }
});

// ===== server_status: 服务状态查询 =====
handlers.set('server_status', async () => {
  try {
    const resp = await fetch('http://127.0.0.1:8767/status');
    return { success: true, result: JSON.parse(await resp.text()) };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ===== server_restart: 热重启 =====
handlers.set('server_restart', async () => {
  try {
    const resp = await fetch('http://127.0.0.1:8767/restart');
    return { success: true, result: await resp.text() };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ===== playbook: 操作手册查询/更新 =====
handlers.set('playbook', async (params) => {
  const { action, keyword } = params;
  const dbPath = path.join(__dirname, 'data', 'agent.db');
  const db = new Database(dbPath);
  try {
    if (action === 'update') {
      // 从 commands 表统计高频查询，更新 playbook
      db.exec(`INSERT OR REPLACE INTO playbook (keyword,query_count,correct_method,wrong_method,priority,last_updated)
        SELECT keyword, cnt, COALESCE((SELECT correct_method FROM playbook p2 WHERE p2.keyword = keyword),''),
        COALESCE((SELECT wrong_method FROM playbook p2 WHERE p2.keyword = keyword),''),
        ROW_NUMBER() OVER (ORDER BY cnt DESC), datetime('now')
        FROM (SELECT CASE WHEN params LIKE '%LIKE %' THEN substr(params, instr(params,'LIKE ''%')+6, instr(substr(params,instr(params,'LIKE ''%')+6),'%''')-1) ELSE 'raw' END as keyword,
        COUNT(*) as cnt FROM commands WHERE tool='run_process' AND params LIKE '%agent.db%' AND params LIKE '%LIKE%'
        GROUP BY keyword ORDER BY cnt DESC LIMIT 20)`);
      return { success: true, result: 'playbook updated' };
    }
    const sql = keyword
      ? "SELECT keyword,correct_method,wrong_method,query_count FROM playbook WHERE keyword LIKE '%" + keyword.replace(/'/g, "''") + "%' ORDER BY priority ASC"
      : "SELECT keyword,correct_method,wrong_method,query_count FROM playbook ORDER BY priority ASC";
    const rows = db.prepare(sql).all();
    return { success: true, result: rows, count: rows.length };
  } catch (e) {
    return { success: false, error: e.message };
  } finally {
    db.close();
  }
});

// ===== mine: DB 挖掘快捷查询 =====
handlers.set('mine', async (params) => {
  const { action, keyword, n } = params;
  if (!action) return { success: false, error: 'action required: how|fail|recent|today|file|struggle' };
  const dbPath = path.join(__dirname, 'data', 'agent.db');
  const db = new Database(dbPath, { readonly: true });
  try {
    let sql;
    const k = (keyword || '').replace(/'/g, "''");
    switch (action) {
      case 'how':
        if (!k) return { success: false, error: 'keyword required' };
        sql = `SELECT id,timestamp,tool,substr(params,1,200) as p,success FROM commands WHERE params LIKE '%${k}%' AND success=1 ORDER BY id DESC LIMIT 10`;
        break;
      case 'fail':
        if (!k) return { success: false, error: 'keyword required' };
        sql = `SELECT id,timestamp,tool,substr(params,1,150) as p,substr(error,1,100) as err FROM commands WHERE params LIKE '%${k}%' AND success=0 ORDER BY id DESC LIMIT 10`;
        break;
      case 'recent':
        sql = `SELECT id,timestamp,tool,substr(params,1,150) as p,success FROM commands ORDER BY id DESC LIMIT ${n || 20}`;
        break;
      case 'today':
        sql = `SELECT tool,COUNT(*) as cnt,SUM(success) as ok FROM commands WHERE date(timestamp)=date('now') GROUP BY tool ORDER BY cnt DESC`;
        break;
      case 'file':
        if (!k) return { success: false, error: 'keyword required' };
        sql = `SELECT id,timestamp,tool,substr(params,1,200) as p,success FROM commands WHERE params LIKE '%${k}%' ORDER BY id DESC LIMIT 10`;
        break;
      default:
        return { success: false, error: `unknown action: ${action}. Use: how|fail|recent|today|file` };
    }
    const rows = db.prepare(sql).all();
    return { success: true, result: rows, count: rows.length };
  } catch (e) {
    return { success: false, error: e.message };
  } finally {
    db.close();
  }
});

// ===== memory: 读写 memory 表 (slot/key/content) =====
handlers.set('memory', async (params) => {
  const { action, slot, key, value } = params;
  if (!action) return { success: false, error: 'action required: get|set|list|delete' };
  const dbPath = path.join(__dirname, 'data', 'agent.db');
  const db = new Database(dbPath);
  try {
    switch (action) {
      case 'get':
        if (!slot || !key) return { success: false, error: 'slot and key required' };
        const row = db.prepare('SELECT content,updated_at FROM memory WHERE slot=? AND key=?').get(slot, key);
        return row ? { success: true, result: row } : { success: false, error: 'not found' };
      case 'set':
        if (!slot || !key || value === undefined) return { success: false, error: 'slot, key, and value required' };
        db.prepare(`INSERT OR REPLACE INTO memory (slot, key, content, updated_at) VALUES (?, ?, ?, datetime('now'))`).run(slot, key, value);
        return { success: true, result: 'saved' };
      case 'list':
        const rows = db.prepare('SELECT slot,key,substr(content,1,100) as preview,updated_at FROM memory' + (slot ? ' WHERE slot=?' : '') + ' ORDER BY updated_at DESC').all(...(slot ? [slot] : []));
        return { success: true, result: rows, count: rows.length };
      case 'delete':
        if (!slot || !key) return { success: false, error: 'slot and key required' };
        db.prepare('DELETE FROM memory WHERE slot=? AND key=?').run(slot, key);
        return { success: true, result: 'deleted' };
      default:
        return { success: false, error: `unknown action: ${action}. Use: get|set|list|delete` };
    }
  } catch (e) {
    return { success: false, error: e.message };
  } finally {
    db.close();
  }
});

// ===== local_store: 读写 local_store 表（脚本/指南等）=====
handlers.set('local_store', async (params) => {
  const { action, slot, key, value } = params;
  if (!action) return { success: false, error: 'action required: get|set|list|delete' };
  const dbPath = path.join(__dirname, 'data', 'agent.db');
  const db = new Database(dbPath);
  try {
    switch (action) {
      case 'get':
        if (!slot || !key) return { success: false, error: 'slot and key required' };
        const row = db.prepare('SELECT content,updated_at FROM local_store WHERE slot=? AND key=?').get(slot, key);
        return row ? { success: true, result: row } : { success: false, error: 'not found' };
      case 'set':
        if (!slot || !key || value === undefined) return { success: false, error: 'slot, key, and value required' };
        db.prepare(`INSERT OR REPLACE INTO local_store (slot, key, content, updated_at) VALUES (?, ?, ?, datetime('now'))`).run(slot, key, value);
        return { success: true, result: 'saved' };
      case 'list':
        const rows = db.prepare('SELECT slot,key,length(content) as size,updated_at FROM local_store' + (slot ? ' WHERE slot=?' : '') + ' ORDER BY updated_at DESC').all(...(slot ? [slot] : []));
        return { success: true, result: rows, count: rows.length };
      case 'delete':
        if (!slot || !key) return { success: false, error: 'slot and key required' };
        db.prepare('DELETE FROM local_store WHERE slot=? AND key=?').run(slot, key);
        return { success: true, result: 'deleted' };
      default:
        return { success: false, error: `unknown action: ${action}. Use: get|set|list|delete` };
    }
  } catch (e) {
    return { success: false, error: e.message };
  } finally {
    db.close();
  }
});

// ===== compress: 压缩当前对话 =====
handlers.set('compress', async (params, context) => {
  const { evalInBrowser } = context;
  if (!evalInBrowser) return { success: false, error: 'evalInBrowser not available' };
  const headN = params.headN || 3;
  const tailN = params.tailN || 30;
  const dryRun = params.dryRun || false;
  const code = `return window.__shortcuts ? window.__shortcuts.compress({headN:${headN},tailN:${tailN},dryRun:${dryRun}}) : 'error: __shortcuts not loaded'`;
  try {
    const result = await evalInBrowser(code, 120000);
    return { success: true, result };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ===== recover: 恢复压缩前的对话 =====
handlers.set('recover', async (params, context) => {
  const { evalInBrowser } = context;
  if (!evalInBrowser) return { success: false, error: 'evalInBrowser not available' };
  const date = params.date || new Date().toISOString().split('T')[0];
  const code = `return window.__shortcuts ? window.__shortcuts.recover('${date}') : 'error: __shortcuts not loaded'`;
  try {
    const result = await evalInBrowser(code, 60000);
    return { success: true, result };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ===== tokens: 查看当前对话的 token 使用情况 =====
handlers.set('tokens', async (params, context) => {
  const { evalInBrowser } = context;
  if (!evalInBrowser) return { success: false, error: 'evalInBrowser not available' };
  const code = [
    "var pid=window.location.href.match(/id=([a-f0-9-]+)/);",
    "if(!pid)return {error:'no project id'};",
    "pid=pid[1];",
    "return fetch('/api/project/update',{method:'POST',credentials:'include',",
    "headers:{'Content-Type':'application/json'},",
    "body:JSON.stringify({id:pid,request_not_update_permission:true})})",
    ".then(function(r){return r.json()})",
    ".then(function(d){",
    "var msgs=(d.data&&d.data.session_state&&d.data.session_state.messages||[])",
    ".filter(function(m){return m.role==='assistant'&&m.session_state&&m.session_state._llm_usage});",
    "var last=msgs[msgs.length-1];",
    "if(!last)return {error:'no usage data'};",
    "var u=last.session_state._llm_usage;",
    "return {total_tokens:u.total_tokens,",
    "cached:(u.prompt_tokens_details&&u.prompt_tokens_details.cached_tokens)||u.cache_read_input_tokens||0,",
    "cache_creation:u.cache_creation_input_tokens||0,",
    "completion:u.completion_tokens,",
    "msgCount:(d.data.session_state.messages||[]).length}",
    "})"
  ].join('');
  try {
    const result = await evalInBrowser(code);
    return { success: true, result };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

export function getSysHandler(toolName) {
  return handlers.get(toolName) || null;
}

export function isSysTool(toolName) {
  return handlers.has(toolName);
}

export function isBrowserTool(toolName) {
  return handlers.get(toolName) === 'browser';
}

export const sysToolNames = [...handlers.keys()];

// ===== buildBrowserToolCode: 生成浏览器端执行代码 =====
export function buildBrowserToolCode(tool, params) {
  if (tool === 'gen_image') {
    const prompt = JSON.stringify(params.prompt || '');
    const model = params.model || 'nano-banana-pro';
    return [
      '(function(){',
      'var s={tid:null,url:null,err:null,st:"sending"};',
      'window.__imgState=s;',
      'fetch("/api/agent/ask_proxy",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({messages:[{role:"user",content:'+prompt+'}],type:"image_generation_agent",auto_prompt:null,model:"'+model+'",project_id:"7e6cbd20-270d-43aa-afe0-331d1c6d7f52"})})',
      '.then(function(r){var rd=r.body.getReader(),dc=new TextDecoder(),b="";',
      'function p(){return rd.read().then(function(rs){if(rs.done){s.err="no tid";s.st="failed";return}',
      'b+=dc.decode(rs.value);var m=b.match(/task_id.*?([a-f0-9-]{36})/);',
      'if(m){s.tid=m[1];rd.cancel();po(0)}else return p()})}p()});',
      'function po(n){if(n>30){s.err="timeout";s.st="failed";return}',
      'setTimeout(function(){',
      'fetch("/api/spark/image_generation_task_detail?task_id="+s.tid)',
      '.then(function(r){return r.json()})',
      '.then(function(d){',
      'if(d.data&&d.data.status==="SUCCESS"){',
      's.url=(d.data.image_urls_nowatermark||d.data.image_urls||[])[0];s.st="done"}',
      'else if(d.data&&d.data.status==="FAILED"){s.err="failed";s.st="failed"}',
      'else po(n+1)})},2000)}',
      'return "generating, task will be in window.__imgState"})()'
    ].join('');
  }
  return 'return "unknown browser tool: '+tool+'"';
}
