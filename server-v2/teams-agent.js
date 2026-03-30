// Teams Agent v3 - Node-side agent with direct tool access
// Runs inside server-v2, calls handleToolCall directly
// AI: Gemini (via ask_ai) | CometChat: direct HTTPS

import https from 'https';
import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';

const CONFIG = {
  // CometChat
  ccBase: 'https://1670754dd7dd407a4.apiclient-us.cometchat.io/v3.0',
  appId: '1670754dd7dd407a4',
  myToken: '180ee88d-516d-45e1-aa63-272c7ad3186d_177187404381eed77145044b5996ac9c53bacd70',
  myUid: '180ee88d-516d-45e1-aa63-272c7ad3186d',
  birdyToken: '94abdf9e-04cd-40ce-883d-fdc8b445d132_1771874125707e8907dd7750b3a7545da9cefae1',
  birdyUid: '94abdf9e-04cd-40ce-883d-fdc8b445d132',
  
  // Agent
  pollInterval: 3000,
  maxToolLoops: 25,
};

const SYSTEM_PROMPT = `You are Birdy 🐦, an AI assistant in team chat. Mac shell access.

Tool format (ONE per response):
TOOL_CALL
tool: <name>
params:
<json>
END_TOOL_CALL

Tools: run_command({command:"bash",stdin:"script"}), read_file({path}), write_file({path,content}), list_directory({path})

== WeChat CLI (微信) ==
Path: /Users/yay/.local/bin/wechat. 名字模糊匹配。--json for scripting.
常用: unread, history 名字 N, send 名字 内容, list, search
不确定时: run_command with {"command":"bash","stdin":"wechat --help"}

== TASK_CALL (先查再处理，一轮搞定) ==
TASK_CALL
[{"tool":"run_process","params":{"command_line":"wechat unread --json","mode":"shell"},"saveAs":"s1"},{"type":"forEach","collection":"{{s1.result}}","item":"c","steps":[{"tool":"run_process","params":{"command_line":"wechat history '{{c.name}}' 3","mode":"shell"}}]}]
END_TASK
Keys: saveAs, when, forEach(collection,item,steps), if(condition,then,else), parallel:true

== BATCH (无依赖并行) ==
BATCH_TOOL_CALL
---
tool: run_command
params:
{"command":"bash","stdin":"cmd1"}
---
tool: run_command
params:
{"command":"bash","stdin":"cmd2"}
END_BATCH

Rules: 简洁回复(手机看), 用户语言回复, 微信请求直接执行不要问
⚠️ 多聊天操作→用一个shell脚本搞定(wechat unread --json | jq + while循环), 不要用TASK_CALL或多轮TOOL_CALL
示例: run_command {"command":"bash","stdin":"wechat unread --json | jq -r '.[].name' | while read n; do echo \"=== $n ==="; wechat history \"$n\" 2; done"}
禁止BATCH执行多个wechat命令(GUI不能并行)`;

const LAST_MSG_FILE = '/tmp/teams-agent-lastmsgid';
const PROCESSED_IDS_FILE = '/tmp/teams-agent-processed';
let lastMsgId = (() => { try { return parseInt(readFileSync(LAST_MSG_FILE, 'utf8').trim()) || 0; } catch(e) { return 0; } })();
let processing = false;
const processedMsgIds = (() => {
  try {
    const data = readFileSync(PROCESSED_IDS_FILE, 'utf8').trim();
    return new Set(data.split('\n').filter(Boolean).map(Number));
  } catch(e) { return new Set(); }
})();
function persistProcessedIds() {
  try {
    const ids = [...processedMsgIds].slice(-200).join('\n');
    writeFileSync(PROCESSED_IDS_FILE, ids);
  } catch(e) {}
}
let pollTimer = null;
let handleToolCallFn = null;
let loggerRef = null;
let clientsRef = null;
let browserToolPendingRef = null;
let getTaskEngineRef = null;

function log(msg) {
  const ts = new Date().toLocaleTimeString();
  const line = `[TeamsAgent ${ts}] ${msg}`;
  if (loggerRef) loggerRef.info(line);
  else console.log(line);
}

// Load forged experience from agent.db
function loadForged() {
  try {
    const dbPath = new URL('./data/agent.db', import.meta.url).pathname;
    const raw = execSync('sqlite3 "' + dbPath + '" "SELECT content FROM memory WHERE slot=\'toolkit\' AND key=\'_forged:birdy-experience\'"', {encoding:'utf8', timeout:5000}).trim();
    if (!raw) return [];
    const msgs = JSON.parse(raw);
    return Array.isArray(msgs) ? msgs : [];
  } catch(e) {
    console.log('[Birdy] Failed to load forged:', e.message);
    return [];
  }
}

let FORGED_MSGS = loadForged();

// ============ COMETCHAT API ============
function ccRequest(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(CONFIG.ccBase + path);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'accept': 'application/json',
        'appid': CONFIG.appId,
        'authtoken': token || CONFIG.myToken,
        'content-type': 'application/json',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { resolve({ error: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function fetchMessages() {
  let p = '/users/' + CONFIG.birdyUid + '/messages?per_page=5';
  if (lastMsgId) p += '&affix=append&id=' + lastMsgId;
  return ccRequest('GET', p);
}

function sendAsBirdy(text) {
  text = text + '\n— 🐦';  // signature to distinguish from platform AI
  if (text.length > 4000) text = text.slice(0, 3900) + '\n...(truncated)';
  return ccRequest('POST', '/messages', {
    type: 'text',
    receiverType: 'user',
    category: 'message',
    data: { text },
    text,
    receiver: CONFIG.myUid,
  }, CONFIG.birdyToken);
}

// ============ ASK AI (direct Anthropic API via apipod) ============
const AI_BASE = 'https://api.apipod.ai';
const AI_KEY = process.env.ANTHROPIC_AUTH_TOKEN || 'sk-1f56c0aa134c1f3ce9dbb5a9df53c600291bcd617a2b116a340252b8c8579cad';
const AI_MODEL = 'claude-sonnet-4-6';

async function askViaCustomTool(messages) {
  return new Promise((resolve, reject) => {
    if (!handleToolCallFn) return reject(new Error('handleToolCall not available'));
    const callId = 'teams_ai_' + Date.now();
    let done = false;
    const fakeWs = {
      send(data) {
        if (done) return;
        try {
          const msg = JSON.parse(data);
          if (msg.id === callId || msg.type === 'tool_result') {
            done = true;
            let result = msg.result;
            if (typeof result === 'object') result = result.result || JSON.stringify(result);
            resolve(typeof result === 'string' ? result : JSON.stringify(result));
          }
        } catch(e) { done = true; resolve(data.toString()); }
      },
      readyState: 1,
    };
    setTimeout(() => { if (!done) { done = true; resolve('(AI timeout 60s)'); } }, 60000);
    handleToolCallFn(fakeWs, { id: callId, type: 'tool_call', tool: 'ask_ai', params: {
      messages,
      model: 'claude-sonnet-4-6',
    }}).catch(e => { if (!done) { done = true; resolve('AI error: ' + e.message); } });
  });
}

async function askGemini(messages) {
  try {
    const sysMsg = messages.find(m => m.role === 'system');
    const nonSys = messages.filter(m => m.role !== 'system');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    const resp = await fetch(AI_BASE + '/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': AI_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: AI_MODEL,
        max_tokens: 2048,
        system: sysMsg?.content || '',
        messages: nonSys.map(m => ({ role: m.role, content: m.content })),
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await resp.json();
    if (data.content?.[0]?.text) return data.content[0].text;
    if (data.error) return 'AI error: ' + (data.error.message || JSON.stringify(data.error));
    return JSON.stringify(data);
  } catch(e) {
    return 'AI error: ' + e.message;
  }
}

// ============ ASK_PROXY (via browser eval_js) ============
function askProxy(messages, model) {
  model = model || 'gpt-4.1-nano';
  return new Promise(function(resolve, reject) {
    if (!clientsRef || !browserToolPendingRef) {
      return reject(new Error('No browser connection'));
    }
    var callId = 'teams_proxy_' + Date.now();
    var jsBody = 'var msgs = ' + JSON.stringify(messages) + ';\n'
      + 'return fetch("/api/agent/ask_proxy", {\n'
      + '  method: "POST", credentials: "include",\n'
      + '  headers: {"Content-Type": "application/json"},\n'
      + '  body: JSON.stringify({\n'
      + '    project_id: "1876348b-72a6-405c-823d-29ffc5be35b2",\n'
      + '    messages: msgs, model: "' + model + '"\n'
      + '  })\n'
      + '}).then(function(res) { return res.text(); })\n'
      + '.then(function(raw) {\n'
      + '  var text = "";\n'
      + '  var lines = raw.split("\\n");\n'
      + '  for (var i = 0; i < lines.length; i++) {\n'
      + '    if (lines[i].indexOf("message_field_delta") !== -1) {\n'
      + '      try {\n'
      + '        var o = JSON.parse(lines[i].replace(/^data:\\s*/, ""));\n'
      + '        if (o.data && o.data.delta) text += o.data.delta;\n'
      + '      } catch(e) {}\n'
      + '    }\n'
      + '  }\n'
      + '  return text;\n'
      + '});';
    var timer = setTimeout(function() {
      browserToolPendingRef.delete(callId);
      reject(new Error('askProxy timeout (60s)'));
    }, 60000);
    browserToolPendingRef.set(callId, {
      resolve: function(r) { clearTimeout(timer); resolve(typeof r === 'string' ? r : JSON.stringify(r)); },
      reject: function(e) { clearTimeout(timer); reject(e); },
      timeout: timer
    });
    for (var c of clientsRef) {
      if (c.readyState === 1) {
        c.send(JSON.stringify({ type: 'browser_tool_call', callId: callId, tool: 'eval_js', params: { code: jsBody } }));
      }
    }
  });
}

// ============ TOOL EXECUTION ============
function parseSingleToolCall(text) {
  let match = text.match(/TOOL_CALL\s*\ntool:\s*(\S+)\s*\nparams:\s*\n([\s\S]*?)\nEND_TOOL_CALL/);
  if (!match) match = text.match(/TOOL_CALL\s*\ntool:\s*(\S+)\s*\nparams:\s*\n([\s\S]*)$/);
  if (!match) return null;
  const tool = match[1];
  const raw = match[2].trim();
  try { return { tool, params: JSON.parse(raw) }; } catch(e) {}
  try {
    const params = {};
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([\w_]+):\s*(.+)$/);
      if (m) {
        let val = m[2].trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
        params[m[1]] = val;
      }
    }
    if (Object.keys(params).length > 0) return { tool, params };
  } catch(e) {}
  return null;
}

function parseBatchToolCalls(text) {
  const batchMatch = text.match(/BATCH_TOOL_CALL\s*\n([\s\S]*?)\nEND_BATCH/);
  if (!batchMatch) return null;
  const blocks = batchMatch[1].split(/\n---\s*\n/).filter(b => b.trim());
  const calls = [];
  for (const block of blocks) {
    const toolMatch = block.match(/tool:\s*(\S+)/);
    const paramsMatch = block.match(/params:\s*\n([\s\S]*)/);
    if (toolMatch && paramsMatch) {
      const tool = toolMatch[1];
      const raw = paramsMatch[1].trim();
      let params;
      try { params = JSON.parse(raw); } catch(e) {
        params = {};
        for (const line of raw.split('\n')) {
          const m = line.match(/^\s*([\w_]+):\s*(.+)$/);
          if (m) { let v = m[2].trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1,-1); params[m[1]] = v; }
        }
      }
      if (params && Object.keys(params).length > 0) calls.push({ tool, params });
    }
  }
  return calls.length > 0 ? calls : null;
}

function parseTaskCall(text) {
  const match = text.match(/TASK_CALL\s*\n([\s\S]*?)\nEND_TASK/);
  if (!match) return null;
  try {
    const steps = JSON.parse(match[1].trim());
    if (Array.isArray(steps) && steps.length > 0) return steps;
  } catch(e) {}
  return null;
}

function parseToolCall(text) {
  // Try task engine first
  const task = parseTaskCall(text);
  if (task) return { task };
  // Try batch
  const batch = parseBatchToolCalls(text);
  if (batch) return { batch };
  // Single tool call
  return parseSingleToolCall(text);
}

function executeTool(tool, params) {
  return new Promise((resolve, reject) => {
    // Direct ask_ai handler - uses custom tool pipeline
    if (tool === 'ask_ai') {
      const askParams = {
        prompt: params.prompt || params.q || '',
        model: params.model || 'claude-sonnet-4-6',
      };
      if (!handleToolCallFn) return reject(new Error('handleToolCall not available'));
      const callId = 'teams_ask_' + Date.now();
      let done = false;
      const fakeWs = {
        send(data) {
          if (done) return;
          try {
            const msg = JSON.parse(data);
            if (msg.id === callId || msg.type === 'tool_result') {
              done = true;
              let result = msg.result;
              if (typeof result === 'object') result = result.result || JSON.stringify(result);
              resolve(typeof result === 'string' ? result : JSON.stringify(result));
            }
          } catch(e) { done = true; resolve(data.toString()); }
        },
        readyState: 1,
      };
      setTimeout(() => { if (!done) { done = true; log('askGemini TIMEOUT - conversation length: ' + JSON.stringify(messages).length + ' chars'); resolve('(AI timeout 60s)'); } }, 60000);
      handleToolCallFn(fakeWs, { id: callId, type: 'tool_call', tool: 'ask_ai', params: askParams })
        .catch(e => { if (!done) { done = true; resolve('ask_ai error: ' + e.message); } });
      return;
    }
    if (!handleToolCallFn) return reject(new Error('handleToolCall not available'));
    
    const callId = 'teams_' + Date.now();
    let resolved = false;
    
    // Create a fake ws that captures the response
    const fakeWs = {
      send(data) {
        if (resolved) return;
        try {
          const msg = JSON.parse(data);
          log('fakeWs recv: keys=' + Object.keys(msg).join(','));
          if (msg.id === callId || msg.type === 'tool_result') {
            resolved = true;
            let result = msg.result;
            if (typeof result === 'object' && result !== null) {
              result = result.result || result.stdout || result.output || JSON.stringify(result);
            }
            result = result || msg.output || msg.stdout || msg.error || JSON.stringify(msg);
            if (typeof result === 'string') {
              // Strip server-v2 prefix like "[#26263] 0\n"
              result = result.replace(/^\[#\d+\]\s*\d+\n?/, '').trim();
            }
            resolve(typeof result === 'string' ? result : JSON.stringify(result));
          }
        } catch(e) {
          resolved = true;
          resolve(data.toString());
        }
      },
      readyState: 1, // OPEN
    };
    
    // Timeout
    setTimeout(() => {
      if (!resolved) { resolved = true; resolve('Tool timeout (60s)'); }
    }, 60000);
    
    handleToolCallFn(fakeWs, { id: callId, type: 'tool_call', tool, params })
      .catch(e => { if (!resolved) { resolved = true; resolve('Tool error: ' + e.message); } });
  });
}

// ============ TASK ENGINE BRIDGE ============
async function executeTask(steps) {
  const taskEngine = getTaskEngineRef ? getTaskEngineRef() : null;
  if (!taskEngine) throw new Error('TaskEngine not available');
  const batchId = `birdy-${Date.now()}`;
  log(`TaskEngine: ${batchId}, ${steps.length} steps, available=${!!taskEngine}`);
  const result = await taskEngine.executeBatch(batchId, steps, { stopOnError: false }, (stepResult) => {
    log(`TaskEngine step ${stepResult.stepIndex}: ${stepResult.success ? '✓' : '✗'} ${stepResult.tool || stepResult.type || ''}`);
  });
  // Format results concisely
  const lines = result.results.map((r, i) => {
    const name = r.tool || r.type || `step${i}`;
    if (r.skipped) return `[${i+1}] ${name}: SKIPPED`;
    if (!r.success) return `[${i+1}] ${name}: ERROR - ${r.error || 'failed'}`;
    const raw = r.result !== undefined ? r.result : r.results || r.error || '';
    const val = typeof raw === 'string' ? raw : JSON.stringify(raw) || '';
    return `[${i+1}] ${name}: ${(val || '').substring(0, 400)}`;
  });
  return `Task ${batchId}: ${result.stepsCompleted}/${result.totalSteps} succeeded\n${lines.join('\n')}`;
}

// ============ AGENT LOOP ============
async function processMessage(text, senderUid) {
  if (processing) return;
  processing = true;
  
  try {
    log(`Processing: "${text.substring(0, 80)}"`);
    
    const conversation = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...FORGED_MSGS,
      { role: 'user', content: text },
    ];
    
    for (let loop = 0; loop < CONFIG.maxToolLoops; loop++) {
      const aiResponse = await askViaCustomTool(conversation);
      log(`AI response (loop ${loop}): ${aiResponse.substring(0, 100)}`);
      
      const toolCall = parseToolCall(aiResponse);
      
      if (!toolCall) {
        // No tool call = final response
        await sendAsBirdy(aiResponse);
        log('Sent reply to chat');
        return;
      }
      
      conversation.push({ role: 'assistant', content: aiResponse });
      
      if (toolCall.task) {
        // Task Engine execution - full control flow
        log(`Task: ${toolCall.task.length} steps`);
        try {
          log(`Calling executeTask with ${JSON.stringify(toolCall.task).substring(0, 200)}`);
          const taskResult = await executeTask(toolCall.task);
          log(`Task result (${taskResult.length} chars): ${taskResult.substring(0, 200)}`);
          let safeResult = taskResult.substring(0, 3000).replace(/[\u0000-\u001f]/g, ' ');
          conversation.push({ role: 'user', content: `Task results:\n${safeResult}` });
        } catch(e) {
          log(`Task ERROR: ${e.message}\n${e.stack}`);
          conversation.push({ role: 'user', content: `Task error: ${e.message}` });
        }
      } else if (toolCall.batch) {
        // Batch execution - run all tools in parallel
        log(`Batch: ${toolCall.batch.length} tools`);
        const results = await Promise.all(toolCall.batch.map(async (tc, i) => {
          log(`Batch[${i}]: ${tc.tool} ${JSON.stringify(tc.params).substring(0, 80)}`);
          try {
            const r = await executeTool(tc.tool, tc.params);
            return `[${i+1}] ${tc.tool}: ${r.substring(0, 500)}`;
          } catch(e) {
            return `[${i+1}] ${tc.tool}: ERROR - ${e.message}`;
          }
        }));
        const batchResult = results.join('\n');
        log(`Batch results (${batchResult.length} chars)`);
        let safeResult = batchResult.substring(0, 3000).replace(/[\u0000-\u001f]/g, ' ');
        conversation.push({ role: 'user', content: `Batch results:\n${safeResult}` });
      } else {
        // Single tool execution
        log(`Tool call: ${toolCall.tool} ${JSON.stringify(toolCall.params).substring(0, 100)}`);
        const toolResult = await executeTool(toolCall.tool, toolCall.params);
        log(`Tool result (${toolResult.length} chars): ${toolResult.substring(0, 100)}`);
        let safeResult = toolResult.substring(0, 1500).replace(/[\u0000-\u001f]/g, ' ');
        conversation.push({ role: 'user', content: `Tool result:\n${safeResult}` });
      }
    }
    
    await sendAsBirdy('(Max tool loops reached)');
  } catch(e) {
    log('Error: ' + e.message);
    try { await sendAsBirdy('Error: ' + e.message); } catch(e2) {}
  } finally {
    processing = false;
  }
}

// ============ POLLING ============
async function poll() {
  try {
    const resp = await fetchMessages();
    const messages = resp.data || resp || [];
    log(`Poll: got ${Array.isArray(messages) ? messages.length : 0} msgs, lastMsgId=${lastMsgId}`);
    
    if (Array.isArray(messages)) {
      for (const msg of messages) {
        const id = msg.id || msg.messageId;
        if (id && id > lastMsgId) {
          lastMsgId = id;
          try { writeFileSync(LAST_MSG_FILE, String(lastMsgId)); } catch(e) {}
        }
        
        const sender = msg.sender || msg.senderId;
        const senderUid = typeof sender === 'object' ? sender.uid : sender;
        
        // Only process messages from me (main account), not from Birdy
        if (senderUid === CONFIG.birdyUid) continue;
        if (senderUid !== CONFIG.myUid) continue;
        
        const text = msg.data?.text || msg.text || '';
        if (!text) continue;
        
        const msgId = id || text;
        if (processedMsgIds.has(msgId)) continue;
        processedMsgIds.add(msgId);
        if (processedMsgIds.size > 200) {
          const first = processedMsgIds.values().next().value;
          processedMsgIds.delete(first);
        }
        persistProcessedIds();
        processMessage(text, senderUid);
      }
    }
  } catch(e) {
    log('Poll error: ' + e.message);
  }
}

// ============ PUBLIC API ============
function start(deps) {
  if (deps.handleToolCall) handleToolCallFn = deps.handleToolCall;
  if (deps.logger) loggerRef = deps.logger;
  if (deps.clients) clientsRef = deps.clients;
  if (deps.browserToolPending) browserToolPendingRef = deps.browserToolPending;
  if (deps.getTaskEngine) getTaskEngineRef = deps.getTaskEngine;
  
  log('Starting Teams Agent v3 (node-side)');
  log(`Polling ${CONFIG.ccBase} every ${CONFIG.pollInterval}ms`);
  
  // Initial poll to get latest message ID (skip old messages)
  fetchMessages().then(resp => {
    const messages = resp.data || resp || [];
    if (Array.isArray(messages)) {
      for (const msg of messages) {
        const id = msg.id || msg.messageId;
        if (id && id > lastMsgId) {
          lastMsgId = id;
          try { writeFileSync(LAST_MSG_FILE, String(lastMsgId)); } catch(e) {}
        }
      }
    }
    log(`Starting from message ID: ${lastMsgId}`);
    pollTimer = setInterval(poll, CONFIG.pollInterval);
  }).catch(e => {
    log('Init error: ' + e.message);
    pollTimer = setInterval(poll, CONFIG.pollInterval);
  });
  
  return { stop, status };
}

function stop() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  log('Stopped');
}

function status() {
  return {
    running: !!pollTimer,
    lastMsgId,
    processing,
    pollInterval: CONFIG.pollInterval,
  };
}

export { start, stop, status };
export default { start, stop, status };