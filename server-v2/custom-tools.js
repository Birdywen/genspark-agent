// custom-tools.js — 自定义工具，不走 MCP
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
  const { action, to, content, args } = params;
  if (!action) return { success: false, error: 'action is required' };
  const parts = ['~/workspace/wechat-cli/wechat', action];
  if (to) parts.push('--to', `"${to}"`);
  if (content) parts.push('--content', `"${content}"`);
  if (args) parts.push(...(Array.isArray(args) ? args : [args]));
  parts.push('--json');
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

export function getCustomHandler(toolName) {
  return handlers.get(toolName) || null;
}

export function isCustomTool(toolName) {
  return handlers.has(toolName);
}

export function isBrowserTool(toolName) {
  return handlers.get(toolName) === 'browser';
}

export const customToolNames = [...handlers.keys()];

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
