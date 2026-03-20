#!/usr/bin/env node
// Birdy Standalone - Independent process, calls tools via HTTP 8766
// Usage: node birdy-standalone.js

import https from 'https';
import http from 'http';
import { execSync } from 'child_process';

const CONFIG = {
  ccBase: 'https://1670754dd7dd407a4.apiclient-us.cometchat.io/v3.0',
  appId: '1670754dd7dd407a4',
  myUid: '180ee88d-516d-45e1-aa63-272c7ad3186d',
  myToken: '180ee88d-516d-45e1-aa63-272c7ad3186d_177187404381eed77145044b5996ac9c53bacd70',
  birdyUid: '94abdf9e-04cd-40ce-883d-fdc8b445d132',
  birdyToken: '94abdf9e-04cd-40ce-883d-fdc8b445d132_1771874125707e8907dd7750b3a7545da9cefae1',
  birdyApiKey: 'bab30f6b0190d0c04d36a40a40dd37fc0cc1e39f',
  pollInterval: 3000,
  maxToolLoops: 10,
  toolApiUrl: 'http://127.0.0.1:8766/tool',
  memoryApiUrl: 'http://127.0.0.1:8766/memory',
};

// ============ LOGGING ============
function log(msg) {
  const ts = new Date().toLocaleTimeString();
  console.log(`[Birdy ${ts}] ${msg}`);
}

// ============ FORGED EXPERIENCE ============
function loadForged() {
  try {
    const dbPath = new URL('./data/agent.db', import.meta.url).pathname;
    const raw = execSync('sqlite3 "' + dbPath + '" "SELECT content FROM memory WHERE slot=\'toolkit\' AND key=\'_forged:birdy-experience\'"', {encoding:'utf8', timeout:5000}).trim();
    if (!raw) return [];
    const msgs = JSON.parse(raw);
    log('Forged loaded: ' + msgs.length + ' messages');
    return Array.isArray(msgs) ? msgs : [];
  } catch(e) {
    log('Failed to load forged: ' + e.message);
    return [];
  }
}

let FORGED_MSGS = loadForged();

const SYSTEM_PROMPT = `You are Birdy, a helpful AI assistant in a team chat. You have access to tools. When you need to execute commands, use this exact format:

TOOL_CALL
tool: tool_name
params:
key1: value1
key2: value2
END_TOOL_CALL

Available tools: run_process (command_line, mode=shell), vfs_local_read (path), vfs_local_write (path, content), eval_js (code).
You run on macOS. Working directory: /Users/yay/workspace/genspark-agent/server-v2.
agent.db path: /Users/yay/workspace/genspark-agent/server-v2/data/agent.db
Always be concise. Execute tasks directly, don't ask for confirmation.`;

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
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('Parse error: ' + data.substring(0, 200))); }
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

function sendAsBirdy(receiverUid, text) {
  if (text.length > 4000) text = text.slice(0, 3900) + '\n...(truncated)';
  return ccRequest('POST', '/messages', {
    receiver: receiverUid,
    receiverType: 'user',
    type: 'text',
    category: 'message',
    data: { text },
    text,
  }, CONFIG.birdyToken);
}

// ============ TOOL CALL VIA HTTP 8766 ============
function callTool(tool, params) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ tool, params });
    const req = http.request(CONFIG.toolApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.result || json.error || data);
        } catch(e) {
          resolve(data);
        }
      });
    });
    req.on('error', e => reject(e));
    req.write(body);
    req.end();
  });
}

// ============ RESULT WRITEBACK ============
function writeResult(taskId, result) {
  const payload = JSON.stringify({
    tool: 'run_process',
    params: {
      command_line: 'cd /Users/yay/workspace/genspark-agent/server-v2 && sqlite3 data/agent.db "INSERT OR REPLACE INTO local_store (slot, key, content) VALUES ('birdy', 'result-' + taskId + '', '' + JSON.stringify({result: result, status: 'done', timestamp: new Date().toISOString()}).replace(/'/g, "''") + '')"',
      mode: 'shell'
    }
  });
  return new Promise((resolve, reject) => {
    const req = http.request(CONFIG.toolApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ============ AI (Kimi / Moonshot) ============
function askAI(messages, model) {
  model = model || 'deepseek-chat';
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model, messages, max_tokens: 4096, temperature: 0.3 });
    const req = https.request('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Authorization': 'Bearer sk-1bbf98eee9c3428581074dbedb711e5a',
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const content = json.choices?.[0]?.message?.content || '';
          if (!content) log('AI empty response: ' + data.substring(0, 300));
          resolve(content);
        } catch(e) {
          log('AI raw response: ' + data.substring(0, 300));
          reject(new Error('AI parse error: ' + data.substring(0, 300)));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ============ TOOL PARSER ============
function parseToolCall(text) {
  const match = text.match(/TOOL_CALL\s*\ntool:\s*(\S+)\s*\nparams:\s*\n([\s\S]*?)\nEND_TOOL_CALL/);
  if (!match) return null;
  const tool = match[1];
  const params = {};
  match[2].split('\n').forEach(line => {
    const idx = line.indexOf(':');
    if (idx > 0) params[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  });
  return { tool, params };
}

// ============ MESSAGE HANDLER ============
async function handleMessage(senderUid, text) {
  log('From ' + senderUid + ': ' + text.substring(0, 80));
  
  // Extract taskId if present: [task:abc123] actual task text
  let taskId = null;
  let taskText = text;
  const taskMatch = text.match(/^\[task:([^\]]+)\]\s*([\s\S]*)/);
  if (taskMatch) {
    taskId = taskMatch[1];
    taskText = taskMatch[2];
    log('Task ID: ' + taskId);
  }

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...FORGED_MSGS,
    { role: 'user', content: taskText },
  ];

  for (let loop = 0; loop < CONFIG.maxToolLoops; loop++) {
    let reply;
    try {
      reply = await askAI(messages);
    } catch(e) {
      log('AI error: ' + e.message);
      await sendAsBirdy(senderUid, 'AI error: ' + e.message);
      return;
    }

    log('AI reply (' + loop + '): ' + reply.substring(0, 100));
    messages.push({ role: 'assistant', content: reply });

    const toolCall = parseToolCall(reply);
    if (!toolCall) {
      // No tool call - final answer
      const finalText = reply.replace(/TOOL_CALL[\s\S]*?END_TOOL_CALL/g, '').trim();
      if (finalText) await sendAsBirdy(senderUid, finalText);
      if (taskId && finalText) {
        await writeResult(taskId, finalText);
        log('Result written for task: ' + taskId);
      }
      return;
    }

    // Execute tool
    log('Tool: ' + toolCall.tool + ' ' + JSON.stringify(toolCall.params).substring(0, 80));
    let result;
    try {
      result = await callTool(toolCall.tool, toolCall.params);
    } catch(e) {
      result = 'Tool error: ' + e.message;
    }
    const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
    log('Result: ' + resultStr.substring(0, 100));
    messages.push({ role: 'user', content: 'Tool result:\n' + resultStr });
  }

  await sendAsBirdy(senderUid, '(Max tool loops reached)');
}

// ============ POLL LOOP ============
let lastMsgId = 0;
let processing = false;

async function poll() {
  if (processing) return;
  processing = true;
  try {
    const resp = await fetchMessages();
    if (resp?.error) log('Poll API error: ' + JSON.stringify(resp.error).substring(0, 200));
    const msgs = resp?.data || [];
    if (msgs.length > 0) log('Got ' + msgs.length + ' messages');
    for (const m of msgs) {
      const id = parseInt(m.id);
      if (id <= lastMsgId) continue;
      lastMsgId = id;
      if (m.sender === CONFIG.birdyUid) continue; // skip own messages
      const text = m.data?.text;
      if (!text) continue;
      const senderUid = m.sender;
      await handleMessage(senderUid, text);
    }
  } catch(e) {
    log('Poll error: ' + e.message);
  }
  processing = false;
}

// ============ STARTUP ============
log('Birdy Standalone starting...');
log('Tool API: ' + CONFIG.toolApiUrl);
log('Forged messages: ' + FORGED_MSGS.length);



// Initial poll to set lastMsgId baseline
poll().then(() => {
  log('Initial poll done. lastMsgId=' + lastMsgId);
  setInterval(poll, CONFIG.pollInterval);
  log('Polling every ' + CONFIG.pollInterval + 'ms');
});