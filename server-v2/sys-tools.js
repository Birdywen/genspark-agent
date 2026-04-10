// sys-tools.js — 自定义工具，不走 MCP
import { execSync, exec as _exec } from 'child_process';
import { readFileSync } from 'fs';
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
    return { success: true, result: rows.length > 200 ? rows.slice(0, 200) : rows, count: rows.length };
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
  const { action, to, chat, content, count, args } = params;
  if (!action) return { success: false, error: 'action is required' };
  const parts = ['~/workspace/wechat-cli/wechat', action];
  // 位置参数格式: wechat send "联系人" "内容" / wechat read "联系人" -n 20
  if (action === 'send' && to && content) {
    parts.push(`"${to}"`, `"${content}"`);
  } else if ((action === 'read' || action === 'history') && (chat || to)) {
    parts.push(`"${chat || to}"`);
    if (count) parts.push('-n', String(count));
  } else if (action === 'at' && (chat || to)) {
    const member = params.member || params.who;
    if (!member) return { success: false, error: 'member is required for @mention' };
    parts.push('"'+(chat||to)+'"', '--', '"'+member+'"');
    if (content) parts.push('"'+content+'"');
  } else if (action === 'members' && (chat || to)) {
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
    return { success: true, result: result.trim().substring(0, 20000) };
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
    'type:"image_generation_agent",auto_prompt:null,model:"'+model+'"})})',
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


// ===== GSK API config =====
let _gskApiKey = null;
function getGskApiKey() {
  if (_gskApiKey) return _gskApiKey;
  try {
    const cfg = JSON.parse(readFileSync(path.join(process.env.HOME || '', '.genspark-tool-cli', 'config.json'), 'utf8'));
    _gskApiKey = cfg.api_key;
  } catch(e) { _gskApiKey = process.env.GSK_API_KEY || ''; }
  return _gskApiKey;
}

handlers.set('web_search', async (params) => {
  const q = params.q || params.query || '';
  if (!q) return { success: false, error: 'No query provided' };
  try {
    const resp = await fetch('https://www.genspark.ai/api/tool_cli/web_search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': getGskApiKey() },
      body: JSON.stringify({ q }),
      signal: AbortSignal.timeout(30000)
    });
    const data = await resp.json();
    if (data.status !== 'ok') return { success: false, error: data.message || 'API error' };
    const results = (data.data?.organic_results || []).slice(0, 10).map(r => ({
      url: r.link, title: r.title, snippet: r.snippet
    }));
    return { success: true, result: { query: q, results } };
  } catch(e) {
    return { success: false, error: e.message };
  }
});

// ===== crawler: Diffbot (structured JSON) + GSK (markdown) =====
const DIFFBOT_TOKEN = process.env.DIFFBOT_TOKEN || '0a1ccea6c5a3a8845558aebd8204c454';
handlers.set('crawler', async (params) => {
  const url = params.url;
  const mode = params.mode || 'diffbot'; // diffbot | gsk | both | kg | enhance | nl
  if (!url && !['kg','enhance','nl'].includes(mode)) return { success: false, error: 'url is required' };
  const timeout = params.timeout || 30000;

  const doDiffbot = async (type) => {
    const t = type || 'article'; // article | analyze | discussion
    const apiUrl = `https://api.diffbot.com/v3/${t}?token=${DIFFBOT_TOKEN}&url=${encodeURIComponent(url)}&timeout=${timeout}`;
    const resp = await fetch(apiUrl, { signal: AbortSignal.timeout(timeout + 5000) });
    const data = await resp.json();
    if (data.error) return { success: false, error: data.error };
    const obj = (data.objects || [])[0] || {};
    return {
      success: true, result: {
        title: obj.title, author: obj.author, date: obj.date,
        text: (obj.text || '').substring(0, 15000),
        tags: (obj.tags || []).slice(0, 10).map(t => t.label),
        images: (obj.images || []).slice(0, 5).map(i => ({ url: i.url, caption: i.caption })),
        sentiment: obj.sentiment, siteName: obj.siteName, pageUrl: obj.pageUrl,
        type: obj.type, humanLanguage: obj.humanLanguage
      }
    };
  };

  const doGsk = async () => {
    const resp = await fetch('https://www.genspark.ai/api/tool_cli/crawler', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': getGskApiKey() },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(timeout + 5000)
    });
    const data = await resp.json();
    if (data.status !== 'ok') return { success: false, error: data.message || 'GSK crawler error' };
    const text = data.data?.result || data.data?.markdown || data.data?.content || (typeof data.data === 'string' ? data.data : JSON.stringify(data.data));
    return { success: true, result: { text: text.substring(0, 20000) } };
  };

  // Knowledge Graph search (DQL syntax: strict:name:"X" type:Y)
  const doKG = async (query, size) => {
    const s = size || 3;
    const apiUrl = `https://kg.diffbot.com/kg/v3/dql?token=${DIFFBOT_TOKEN}&query=${encodeURIComponent(query)}&size=${s}`;
    const resp = await fetch(apiUrl, { signal: AbortSignal.timeout(timeout + 5000) });
    const data = await resp.json();
    if (data.error) return { success: false, error: data.error };
    const entities = (data.data || []).map(d => {
      const e = d.entity || {};
      return { name: e.name, type: (e.types||[]).join(', '), description: (e.description||'').substring(0,300), diffbotUri: e.diffbotUri, score: d.score };
    });
    return { success: true, result: { hits: data.hits, entities } };
  };

  // Enhance: enrich person/org
  const doEnhance = async (type, name) => {
    const apiUrl = `https://kg.diffbot.com/kg/v3/enhance?token=${DIFFBOT_TOKEN}&type=${type||'Person'}&name=${encodeURIComponent(name)}&size=1`;
    const resp = await fetch(apiUrl, { signal: AbortSignal.timeout(timeout + 5000) });
    const data = await resp.json();
    const e = (data.data||[{}])[0]?.entity || {};
    if (!e.name) return { success: false, error: 'No entity found' };
    return { success: true, result: {
      name: e.name, description: (e.description||'').substring(0,500),
      types: e.types, employments: (e.employments||[]).slice(0,5).map(j=>({employer:j.employer?.name,title:j.categories?.map(c=>c.name).join(', '),isCurrent:j.isCurrent})),
      educations: e.educations, skills: (e.skills||[]).slice(0,10).map(s=>s.name||s),
      location: e.location, image: e.image, importance: e.importance
    }};
  };

  // Natural Language: NER
  const doNL = async (text) => {
    const resp = await fetch(`https://nl.diffbot.com/v1/?token=${DIFFBOT_TOKEN}&lang=${params.lang||'en'}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text, format: 'plain text' }),
      signal: AbortSignal.timeout(timeout + 5000)
    });
    const data = await resp.json();
    const entities = (data.entities || []).map(e => ({
      name: e.name, type: (e.allTypes||[]).map(t=>t.name).join(', '),
      confidence: e.confidence, salience: e.salience, uri: e.diffbotUri
    }));
    return { success: true, result: { entities } };
  };

  try {
    if (mode === 'gsk') return await doGsk();
    if (mode === 'kg') return await doKG(params.query || params.q, params.size);
    if (mode === 'enhance') return await doEnhance(params.type, params.name || params.url);
    if (mode === 'nl') return await doNL(params.text || params.url);
    if (mode === 'both') {
      const [db, gs] = await Promise.allSettled([doDiffbot(params.type), doGsk()]);
      return { success: true, result: {
        diffbot: db.status === 'fulfilled' ? db.value.result : { error: db.reason?.message },
        gsk: gs.status === 'fulfilled' ? gs.value.result : { error: gs.reason?.message }
      }};
    }
    // default: diffbot
    return await doDiffbot(params.type);
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ===== odin: Odin AI platform API (免费无限调用) =====
const ODIN_KEY = process.env.ODIN_API_KEY || '';
const ODIN_SECRET = process.env.ODIN_API_SECRET || '';
const ODIN_PROJECT = process.env.ODIN_PROJECT_ID || '';
const odinFetch = async (endpoint, body, timeout = 60000) => {
  const resp = await fetch(`https://api.getodin.ai${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': ODIN_KEY, 'X-API-SECRET': ODIN_SECRET },
    body: JSON.stringify({ project_id: ODIN_PROJECT, ...body }),
    signal: AbortSignal.timeout(timeout)
  });
  const data = await resp.json();
  if (data.detail) return { success: false, error: typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail).substring(0, 300) };
  return { success: true, result: data };
};
handlers.set('odin', async (params) => {
  const action = params.action;
  if (!action) return { success: false, error: 'action required: search|summarize|translate|classify|chat|workflow|agents' };
  switch (action) {
    case 'search': {
      const body = { query: params.query || params.q, max_results: params.max_results || 5, download_pages: params.download_pages !== false, search_type: params.search_type || 'google' };
      if (params.website_white_list) body.website_white_list = params.website_white_list;
      if (params.date_range_start) { body.limit_date_range = true; body.date_range_start = params.date_range_start; body.date_range_end = params.date_range_end; }
      const r = await odinFetch('/project/search/google', body);
      if (!r.success) return r;
      const results = (r.result.results || []).map(a => ({ title: a.title, url: a.url, author: a.author, date: a.publish_date, text: (a.markdown_content || '').substring(0, 8000) }));
      return { success: true, result: { count: results.length, results } };
    }
    case 'summarize': return odinFetch('/tools/ai/summarize', { text: params.text, instructions: params.instructions || 'Summarize concisely' });
    case 'translate': return odinFetch('/tools/ai/translate', { texts: Array.isArray(params.texts) ? params.texts : [params.text || params.texts], input_language: params.from || params.input_language || 'auto', target_language: params.to || params.target_language || 'zh', translation_tone: params.tone });
    case 'classify': return odinFetch('/tools/ai/classify', { text: params.text, categories: params.categories });
    case 'chat': return odinFetch('/v3/chat/message', { message: params.message, chat_id: params.chat_id, agent_id: params.agent_id }, 120000);
    case 'workflow': return odinFetch('/tools/execute-workflow', { tool_id: params.tool_id || params.workflow_id, inputs: params.inputs || {} }, 300000);
    case 'code': {
      const sub = params.sub || 'execute'; // create|list|execute|publish|get|update|delete|versions|history
      const hdr = { 'Content-Type': 'application/json', 'X-API-KEY': ODIN_KEY, 'X-API-SECRET': ODIN_SECRET };
      const base = 'https://api.getodin.ai/code-scripts';
      if (sub === 'create') {
        const r = await odinFetch('/code-scripts', { name: params.name, description: params.description, script: params.script, runtime: params.runtime || 'python3.11', entry_point: params.entry_point || 'main', dependencies: params.dependencies || [] });
        return r;
      }
      if (sub === 'list') {
        const resp = await fetch(`${base}?project_id=${ODIN_PROJECT}&limit=${params.limit||20}`, { headers: hdr, signal: AbortSignal.timeout(10000) });
        return { success: true, result: await resp.json() };
      }
      if (sub === 'execute') {
        const sid = params.script_id || params.id;
        if (!sid) return { success: false, error: 'script_id required' };
        const resp = await fetch(`${base}/${sid}/execute`, { method: 'POST', headers: hdr, body: JSON.stringify({ args: params.args || [], kwargs: params.kwargs || {} }), signal: AbortSignal.timeout(params.timeout || 120000) });
        return { success: true, result: await resp.json() };
      }
      if (sub === 'publish') {
        const sid = params.script_id || params.id;
        const resp = await fetch(`${base}/${sid}/publish`, { method: 'POST', headers: hdr, signal: AbortSignal.timeout(10000) });
        return { success: true, result: await resp.json() };
      }
      if (sub === 'get') {
        const sid = params.script_id || params.id;
        const resp = await fetch(`${base}/${sid}`, { headers: hdr, signal: AbortSignal.timeout(10000) });
        return { success: true, result: await resp.json() };
      }
      if (sub === 'delete') {
        const sid = params.script_id || params.id;
        const resp = await fetch(`${base}/${sid}`, { method: 'DELETE', headers: hdr, signal: AbortSignal.timeout(10000) });
        return { success: true, result: await resp.json() };
      }
      if (sub === 'versions') {
        const sid = params.script_id || params.id;
        const resp = await fetch(`${base}/${sid}/versions`, { headers: hdr, signal: AbortSignal.timeout(10000) });
        return { success: true, result: await resp.json() };
      }
      if (sub === 'history') {
        const sid = params.script_id || params.id;
        const resp = await fetch(`${base}/${sid}/executions?page_size=${params.limit||10}`, { headers: hdr, signal: AbortSignal.timeout(10000) });
        return { success: true, result: await resp.json() };
      }
      return { success: false, error: `unknown sub: ${sub}. Use: create|list|execute|publish|get|update|delete|versions|history` };
    }
    case 'agents': {
      const resp = await fetch(`https://api.getodin.ai/agents/${ODIN_PROJECT}/list`, { headers: { 'X-API-KEY': ODIN_KEY, 'X-API-SECRET': ODIN_SECRET }, signal: AbortSignal.timeout(10000) });
      return { success: true, result: await resp.json() };
    }
    case 'workflows': {
      const resp = await fetch('https://api.getodin.ai/workflows/active', { headers: { 'X-API-KEY': ODIN_KEY, 'X-API-SECRET': ODIN_SECRET }, signal: AbortSignal.timeout(10000) });
      return { success: true, result: await resp.json() };
    }
    default: return { success: false, error: `unknown action: ${action}. Use: search|summarize|translate|classify|chat|workflow|agents|workflows` };
  }
});

// ===== aidrive: GSK AI Drive file storage =====
handlers.set('aidrive', async (params) => {
  const action = params.action;
  if (!action) return { success: false, error: 'action required: ls|mkdir|rm|move|upload|download_file|download_video|download_audio|get_readable_url' };
  const body = { action };
  if (params.path) body.path = params.path;
  if (params.target_path) body.target_path = params.target_path;
  if (params.target_folder) body.target_folder = params.target_folder;
  if (params.filter_type) body.filter_type = params.filter_type;
  if (params.file_type) body.file_type = params.file_type;
  if (params.file_url) body.file_url = params.file_url;
  if (params.video_url) body.video_url = params.video_url;
  if (params.audio_url) body.audio_url = params.audio_url;
  if (params.url) body.file_url = params.url; // alias
  try {
    // GSK API blocks python/node fetch (Cloudflare), must use curl
    const jsonBody = JSON.stringify(body).replace(/'/g, "'\"'\"'");
    const cmd = `curl -s -X POST 'https://www.genspark.ai/api/tool_cli/aidrive' -H 'Content-Type: application/json' -H 'X-Api-Key: ${getGskApiKey()}' -d '${jsonBody}'`;
    const result = execSync(cmd, { encoding: 'utf8', timeout: 120000, shell: true });
    // API may return multiple JSON lines (heartbeat + result), take last valid one
    const lines = result.trim().split('\n').filter(l => l.startsWith('{'));
    const data = JSON.parse(lines[lines.length - 1]);
    if (data.status !== 'ok') return { success: false, error: data.message || 'API error' };
    return { success: true, result: data.session_state?.aidrive_result || data.data };
  } catch (e) {
    return { success: false, error: e.message?.substring(0, 500) };
  }
});

// ask_ai: 通过 gsk API agent_ask (server端直调，不依赖浏览器)
handlers.set('ask_ai', async (params) => {
  const prompt = params.prompt || (params.messages && params.messages[params.messages.length - 1]?.content) || '';
  if (!prompt) return { success: false, error: 'prompt or messages required' };
  const model = params.model || null;
  const body = { message: prompt, task_type: 'super_agent' };
  if (model) body.use_model = model;
  try {
    const resp = await fetch('https://www.genspark.ai/api/tool_cli/agent_ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': getGskApiKey() },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000)
    });
    const raw = await resp.text();
    let result = '', projectId = null;
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.project_id && !projectId) projectId = obj.project_id;
        if (obj.delta) result += obj.delta;
        if (obj.data?.result_content?.last_message) {
          result = obj.data.result_content.last_message.join('\n');
        }
      } catch(e) { /* skip non-JSON lines */ }
    }
    return { success: true, result, project_id: projectId };
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
    // 方案1: 尝试 watchdog
    const resp = await fetch('http://127.0.0.1:8767/restart', { signal: AbortSignal.timeout(2000) });
    return { success: true, result: await resp.text() };
  } catch (e) {
    // 方案2: watchdog 未运行，用 spawn 启动新进程后延迟自杀
    const { spawn } = await import('child_process');
    const child = spawn('bash', ['-c', 
      'sleep 2 && lsof -ti:8765,8766 2>/dev/null | xargs kill -9 2>/dev/null; sleep 1; cd /Users/yay/workspace/genspark-agent/server-v2 && nohup node index.js > /tmp/agent-server.log 2>&1 &'
    ], { detached: true, stdio: 'ignore' });
    child.unref();
    return { success: true, result: 'Restart scheduled in 2s (watchdog unavailable). New process will start automatically.' };
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
  const { action, slot, key, value, fromFile } = params;
  if (!action) return { success: false, error: 'action required: get|set|list|delete' };
  const dbPath = path.join(__dirname, 'data', 'agent.db');
  const db = new Database(dbPath);
  try {
    switch (action) {
      case 'get':
        if (!slot || !key) return { success: false, error: 'slot and key required' };
        const row = db.prepare('SELECT content,updated_at FROM memory WHERE slot=? AND key=?').get(slot, key);
        return row ? { success: true, result: row } : { success: false, error: 'not found' };
      case 'set': {
        if (!slot || !key) return { success: false, error: 'slot and key required' };
        let val = value;
        if (fromFile) { const fs = await import('fs'); val = fs.readFileSync(fromFile, 'utf8'); }
        if (val === undefined) return { success: false, error: 'value or fromFile required' };
        db.prepare(`INSERT OR REPLACE INTO memory (slot, key, content, updated_at) VALUES (?, ?, ?, datetime('now'))`).run(slot, key, val);
        return { success: true, result: 'saved', length: val.length };
      }
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
  const { action, slot, key, value, fromFile } = params;
  if (!action) return { success: false, error: 'action required: get|set|list|delete' };
  const dbPath = path.join(__dirname, 'data', 'agent.db');
  const db = new Database(dbPath);
  try {
    switch (action) {
      case 'get':
        if (!slot || !key) return { success: false, error: 'slot and key required' };
        const row = db.prepare('SELECT content,updated_at FROM local_store WHERE slot=? AND key=?').get(slot, key);
        return row ? { success: true, result: row } : { success: false, error: 'not found' };
      case 'set': {
        if (!slot || !key) return { success: false, error: 'slot and key required' };
        let val = value;
        if (fromFile) { const fs = await import('fs'); val = fs.readFileSync(fromFile, 'utf8'); }
        if (val === undefined) return { success: false, error: 'value or fromFile required' };
        db.prepare(`INSERT OR REPLACE INTO local_store (slot, key, content, updated_at) VALUES (?, ?, ?, datetime('now'))`).run(slot, key, val);
        return { success: true, result: 'saved', length: val.length };
      }
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
  // 触发前端 fork-compress 按钮点击
  const code = `
    var btn = document.getElementById('agent-compress');
    if (!btn) return 'error: compress button not found';
    btn.click();
    return 'compress triggered';
  `;
  try {
    const result = await evalInBrowser(code, 5000);
    return { success: true, result };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ===== inject: 向当前对话注入知识 =====
handlers.set('inject', async (params, context) => {
  const { evalInBrowser } = context;
  const action = params.action || 'inject'; // inject | update | clear | preview
  // inject/update/clear need browser, preview does not
  if (action !== 'preview' && !evalInBrowser) return { success: false, error: 'evalInBrowser not available' };
  const dbPath = path.join(__dirname, 'data', 'agent.db');
  const db = new Database(dbPath);

  try {
    if (action === 'clear') {
      db.close();
      // 删除所有 injected- 开头的 messages
      const clearCode = `
        var pid = new URLSearchParams(window.location.search).get('id');
        if (!pid) return {error:'no pid'};
        return window.readSlotFull(pid).then(function(data) {
          var ss = data.session_state || {messages:[]};
          var before = ss.messages.length;
          ss.messages = ss.messages.filter(function(m) { return !m.id || !m.id.startsWith('injected-'); });
          var after = ss.messages.length;
          return fetch('/api/project/update', {
            method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include',
            body: JSON.stringify({id:pid, session_state:ss, request_not_update_permission:true})
          }).then(function(r){return r.json()}).then(function(d){
            return {cleared: before - after, remaining: after};
          });
        });
      `;
      const result = await evalInBrowser(clearCode, 30000);
      return { success: true, action: 'clear', result };
    }

    // 构建注入内容
    const sections = [];

    // 1. 核心规则
    const rulesRow = db.prepare("SELECT content FROM memory WHERE slot='forged' AND key='schema-rules'").get();
    if (rulesRow) {
      try {
        const rules = JSON.parse(rulesRow.content);
        if (rules.daily && rules.daily.length > 0) {
          sections.push('### 核心规则\n' + rules.daily.map(r => '- ' + r).join('\n'));
        }
      } catch(e) {}
    }

    // 2. 当前项目上下文
    const plans = db.prepare(
      "SELECT key, substr(content,1,200) as preview FROM memory WHERE slot='forged' AND key LIKE 'plan-%' ORDER BY rowid DESC LIMIT 3"
    ).all();
    if (plans.length > 0) {
      sections.push('### 当前项目上下文\n' + plans.map(p => '- **' + p.key + '**: ' + p.preview).join('\n'));
    }

    // 3. 近7天高频错误
    const errors = db.prepare(
      "SELECT tool, substr(error,1,60) as err, COUNT(*) as cnt FROM commands WHERE success=0 AND timestamp>=date('now','-7 day') GROUP BY tool, substr(error,1,60) ORDER BY cnt DESC LIMIT 5"
    ).all();
    if (errors.length > 0) {
      sections.push('### 近7天高频错误\n' + errors.map(e => '- ' + e.tool + '(' + e.cnt + '次): ' + e.err).join('\n'));
    }

    // 4. 最近经验教训
    const lessons = db.prepare(
      "SELECT key, substr(content,1,150) as summary FROM memory WHERE slot='forged' AND key LIKE 'lesson-%' ORDER BY key DESC LIMIT 10"
    ).all();
    if (lessons.length > 0) {
      sections.push('### 最近经验教训\n' + lessons.map(l => '- ' + l.summary).join('\n'));
    }

    // 5. 可用脚本
    const scripts = db.prepare(
      "SELECT key FROM local_store WHERE key LIKE 'script/%' ORDER BY key LIMIT 15"
    ).all();
    if (scripts.length > 0) {
      sections.push('### 可用脚本\n' + scripts.map(s => s.key.replace('script/','')).join(', '));
    }

    // 6. 自定义内容
    if (params.extra) {
      sections.push('### 补充\n' + params.extra);
    }

    db.close();

    const content = '## VFS Context (知识注入)\n' + sections.join('\n\n');

    if (action === 'preview') {
      return { success: true, action: 'preview', content, chars: content.length };
    }

    // inject or update: 先清旧的再注入新的
    const injectCode = `
      var pid = new URLSearchParams(window.location.search).get('id');
      if (!pid) return {error:'no pid'};
      return window.readSlotFull(pid).then(function(data) {
        var ss = data.session_state || {messages:[]};
        // 清除旧的注入
        ss.messages = ss.messages.filter(function(m) { return !m.id || !m.id.startsWith('injected-'); });
        // 注入新的到前面(forged后面)
        ss.messages.unshift({
          id: 'injected-knowledge-' + Date.now(),
          role: 'user',
          content: ${JSON.stringify(content)}
        });
        return fetch('/api/project/update', {
          method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include',
          body: JSON.stringify({id:pid, session_state:ss, request_not_update_permission:true})
        }).then(function(r){return r.json()}).then(function(d){
          var cnt = d.data && d.data.session_state ? d.data.session_state.messages.length : -1;
          return {injected:true, totalMsgs:cnt};
        });
      });
    `;
    const result = await evalInBrowser(injectCode, 30000);
    return { success: true, action, result, chars: content.length };
  } catch (e) {
    db.close();
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
    const result = await evalInBrowser(code, 300000);
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

// 浏览器原生工具 - 通过 forwardToBrowser 委托给 background.js 的 handleBrowserToolCall
handlers.set('eval_js', 'browser_native');
handlers.set('list_tabs', 'browser_native');
handlers.set('take_screenshot', 'browser_native');

export function isBrowserTool(toolName) {
  return handlers.get(toolName) === 'browser';
}

export function isBrowserNative(toolName) {
  return handlers.get(toolName) === 'browser_native';
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
      'fetch("/api/agent/ask_proxy",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({messages:[{role:"user",content:'+prompt+'}],type:"image_generation_agent",auto_prompt:null,model:"'+model+'"})})' ,
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
