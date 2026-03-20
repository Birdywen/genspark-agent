// Teams Agent v3 - Node-side agent with direct tool access
// Runs inside server-v2, calls handleToolCall directly
// AI: Kimi (fast, no cookie needed) | CometChat: direct HTTPS

import https from 'https';
import { execSync } from 'child_process';

const CONFIG = {
  // CometChat
  ccBase: 'https://1670754dd7dd407a4.apiclient-us.cometchat.io/v3.0',
  appId: '1670754dd7dd407a4',
  myToken: '180ee88d-516d-45e1-aa63-272c7ad3186d_177187404381eed77145044b5996ac9c53bacd70',
  myUid: '180ee88d-516d-45e1-aa63-272c7ad3186d',
  birdyToken: '94abdf9e-04cd-40ce-883d-fdc8b445d132_1771874125707e8907dd7750b3a7545da9cefae1',
  birdyUid: '94abdf9e-04cd-40ce-883d-fdc8b445d132',
  
  // Kimi AI
  kimiKey: 'sk-EB4UEHdVBmfvqjPJB8WIu6UJ9E1cplgtyByFvmG56E9BLAEe',
  kimiModel: 'moonshot-v1-8k',
  
  // Agent
  pollInterval: 3000,
  maxToolLoops: 10,
};

const SYSTEM_PROMPT = `You are Birdy, a helpful AI assistant in a team chat. You have access to tools. When you need to execute commands, read a tool call in this exact format:

TOOL_CALL
tool: <tool_name>
params:
<json params>
END_TOOL_CALL

Available tools:
- run_command: Execute shell commands. Params: {"command":"bash","stdin":"<script>"}
- read_file: Read a file. Params: {"path":"<filepath>"}
- write_file: Write a file. Params: {"path":">"}
- list_directory: List directory. Params: {"path":"<dirpath>"}
- web_search: Search web. Params: {"q":"<query>"}

Rules:
- Be concise, replies go to mobile chat
- Reply in the same language the user uses
- If a tool is needed, output exactly ONE tool call, wait for result, then respond
- After getting tool results, summarize and reply to the user`;

let lastMsgId = 0;
let processing = false;
let pollTimer = null;
let handleToolCallFn = null;
let loggerRef = null;
let clientsRef = null;
let browserToolPendingRef = null;

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

// ============ KIMI AI ============
function askKimi(messages) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: CONFIG.kimiModel,
      messages,
      temperature: 0.7,
    });
    const req = https.request({
      hostname: 'api.moonshot.ai',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.kimiKey}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        log('Kimi raw (status ' + res.statusCode + '): ' + data.substring(0, 300));
        try {
          const json = JSON.parse(data);
          resolve(json.choices?.[0]?.message?.content || '(empty response)');
        } catch(e) { reject(new Error('Kimi parse error: ' + data.substring(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
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
function parseToolCall(text) {
  const match = text.match(/TOOL_CALL\s*\ntool:\s*(\S+)\s*\nparams:\s*\n([\s\S]*?)\nEND_TOOL_CALL/);
  if (!match) return null;
  try {
    return { tool: match[1], params: JSON.parse(match[2].trim()) };
  } catch(e) {
    return null;
  }
}

function executeTool(tool, params) {
  return new Promise((resolve, reject) => {
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
      const aiResponse = await askKimi(conversation);
      log(`AI response (loop ${loop}): ${aiResponse.substring(0, 100)}`);
      
      const toolCall = parseToolCall(aiResponse);
      
      if (!toolCall) {
        // No tool call = final response
        await sendAsBirdy(aiResponse);
        log('Sent reply to chat');
        return;
      }
      
      // Execute tool
      log(`Tool call: ${toolCall.tool} ${JSON.stringify(toolCall.params).substring(0, 100)}`);
      const toolResult = await executeTool(toolCall.tool, toolCall.params);
      log(`Tool result: ${toolResult.substring(0, 100)}`);
      
      // Add to conversation and continue
      conversation.push({ role: 'assistant', content: aiResponse });
      conversation.push({ role: 'user', content: `Tool result:\n${toolResult.substring(0, 2000)}` });
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
        if (id && id > lastMsgId) lastMsgId = id;
        
        const sender = msg.sender || msg.senderId;
        const senderUid = typeof sender === 'object' ? sender.uid : sender;
        
        // Only process messages from me (main account), not from Birdy
        if (senderUid === CONFIG.birdyUid) continue;
        if (senderUid !== CONFIG.myUid) continue;
        
        const text = msg.data?.text || msg.text || '';
        if (!text) continue;
        
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
  
  log('Starting Teams Agent v3 (node-side)');
  log(`Polling ${CONFIG.ccBase} every ${CONFIG.pollInterval}ms`);
  
  // Initial poll to get latest message ID (skip old messages)
  fetchMessages().then(resp => {
    const messages = resp.data || resp || [];
    if (Array.isArray(messages)) {
      for (const msg of messages) {
        const id = msg.id || msg.messageId;
        if (id && id > lastMsgId) lastMsgId = id;
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