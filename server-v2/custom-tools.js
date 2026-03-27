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
handlers.set('gen_image', async (params, context) => {
  // gen_image 需要浏览器 cookie，通过 evalInBrowser 桥接
  const { evalInBrowser } = context;
  if (!evalInBrowser) return { success: false, error: 'evalInBrowser not available' };
  
  const prompt = JSON.stringify(params.prompt || '');
  const model = params.model || 'nano-banana-pro';
  
  // Step 1: 在浏览器端发起生图请求
  const initCode = [
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
        return { success: true, result: { url: state.url, task_id: state.tid } };
      }
      if (state.st === 'failed') {
        return { success: false, error: state.err, task_id: state.tid };
      }
    } catch(e) { /* continue polling */ }
  }
  return { success: false, error: 'timeout 70s' };
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
