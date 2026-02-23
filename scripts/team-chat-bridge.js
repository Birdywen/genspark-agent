#!/usr/bin/env node
// === Team Chat Bridge v2 - WebSocket Edition ===
// 手机 Team Chat <-> WebSocket broadcast <-> AI 对话

const http = require('http');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CONFIG = {
  COMET_API: 'https://1670754dd7dd407a4.apiclient-us.cometchat.io/v3.0',
  APP_ID: '1670754dd7dd407a4',
  AUTH_TOKEN: '180ee88d-516d-45e1-aa63-272c7ad3186d_177187404381eed77145044b5996ac9c53bacd70',
  GROUP_ID: 'project_c2a9886e-89c8-436a-b12f-1ef3da3778fe',
  MY_UID: '180ee88d-516d-45e1-aa63-272c7ad3186d',
  WS_URL: 'ws://localhost:8765',
  POLL_INTERVAL: 1500,
  PREFIX: '>>>',
  PID_FILE: '/tmp/team-chat-bridge.pid',
  LOG_FILE: path.join(__dirname, '../server-v2/logs/bridge.log'),
  REPLY_PORT: 8769
};

let running = true;
let lastMessageId = null;
let wsConnection = null;

// === Logging ===
function log(msg) {
  const ts = new Date().toLocaleTimeString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(CONFIG.LOG_FILE, line + '\n'); } catch(e) {}
}

// === HTTP Helper ===
function fetchJSON(url, options = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? require('https') : require('http');
    const parsed = new URL(url);
    const opts = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };
    const req = mod.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { reject(new Error('Parse error: ' + data.substring(0, 200))); }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

// === CometChat API ===
function getMessages() {
  let url = `${CONFIG.COMET_API}/groups/${CONFIG.GROUP_ID}/messages?per_page=10&categories=message&types=text`;
  if (lastMessageId) url += `&id=${lastMessageId}&affix=append`;
  return fetchJSON(url, {
    headers: { 'appId': CONFIG.APP_ID, 'authToken': CONFIG.AUTH_TOKEN, 'Accept': 'application/json' }
  });
}

function sendMessage(text) {
  return fetchJSON(`${CONFIG.COMET_API}/messages`, {
    method: 'POST',
    headers: {
      'appId': CONFIG.APP_ID,
      'authToken': CONFIG.AUTH_TOKEN,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      category: 'message',
      type: 'text',
      data: { text: text.substring(0, 1500) },
      receiver: CONFIG.GROUP_ID,
      receiverType: 'group'
    })
  });
}

// === WebSocket Broadcast ===
function connectWS() {
  const WebSocket = require('ws');
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(CONFIG.WS_URL);
    ws.on('open', () => {
      log('WebSocket connected to ' + CONFIG.WS_URL);
      resolve(ws);
    });
    ws.on('error', (e) => {
      log('WebSocket error: ' + e.message);
      reject(e);
    });
    ws.on('close', () => {
      log('WebSocket disconnected');
      wsConnection = null;
    });
  });
}

async function broadcastToChat(senderName, text) {
  try {
    if (!wsConnection || wsConnection.readyState !== 1) {
      wsConnection = await connectWS();
    }
    wsConnection.send(JSON.stringify({
      type: 'broadcast',
      payload: {
        type: 'CROSS_TAB_MESSAGE',
        from: 'phone-bridge',
        to: 'all',
        message: text,
        timestamp: Date.now()
      }
    }));
    log('Broadcast sent: ' + text.substring(0, 80));
    return true;
  } catch(e) {
    log('Broadcast failed: ' + e.message);
    return false;
  }
}

// === Command Execution ===
function runCommand(cmd) {
  try {
    const result = execSync(cmd, {
      timeout: 30000,
      encoding: 'utf8',
      env: { ...process.env, PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:' + process.env.PATH }
    });
    return { success: true, result: result.trim() };
  } catch(e) {
    return { success: false, error: e.message, result: (e.stdout || '').trim() };
  }
}

function handleCommand(text) {
  const cmd = text.replace(CONFIG.PREFIX, '').trim();
  if (!cmd) return;
  
  log('Executing: ' + cmd);
  
  let shellCmd = cmd;
  if (cmd.startsWith('sos ')) {
    shellCmd = `source ~/.zshrc && ${cmd}`;
  }
  
  const result = runCommand(shellCmd);
  const output = result.success
    ? '✅ ' + (result.result || '(no output)').substring(0, 800)
    : '❌ ' + (result.result || result.error).substring(0, 800);
  
  sendMessage(output).catch(e => log('Reply failed: ' + e.message));
}

// === Reply HTTP Server (for AI to send results back) ===
const replyServer = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  
  if (req.method === 'POST' && req.url === '/reply') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        sendMessage(data.text.substring(0, 1500)).then(() => {
          res.writeHead(200, {'Content-Type':'application/json'});
          res.end(JSON.stringify({ok:true}));
        }).catch(e => {
          res.writeHead(500, {'Content-Type':'application/json'});
          res.end(JSON.stringify({ok:false, error:e.message}));
        });
      } catch(e) {
        res.writeHead(400, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:false, error:'Invalid JSON'}));
      }
    });
    return;
  }
  
  if (req.url === '/status') {
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify({ running: true, wsConnected: wsConnection?.readyState === 1, lastMessageId }));
    return;
  }
  
  res.writeHead(404);
  res.end('Not found');
});

// === Main Poll Loop ===
async function pollLoop() {
  // Connect WebSocket
  try {
    wsConnection = await connectWS();
  } catch(e) {
    log('Initial WS connection failed, will retry: ' + e.message);
  }
  
  // Get latest message ID
  try {
    const init = await getMessages();
    if (init.data && init.data.length > 0) {
      lastMessageId = init.data[init.data.length - 1].id;
      log('Starting from message ID: ' + lastMessageId);
    }
  } catch(e) {
    log('Init error: ' + e.message);
  }
  
  while (running) {
    try {
      const result = await getMessages();
      const messages = result.data || [];
      
      for (const msg of messages) {
        if (msg.id <= lastMessageId) continue;
        lastMessageId = msg.id;
        
        const sender = msg.sender || '';
        const senderUid = typeof sender === 'string' ? sender : sender.uid;
        if (senderUid === CONFIG.MY_UID) continue;
        
        const senderName = (typeof sender === 'object' ? sender.name : sender) || 'Unknown';
        const text = (msg.data?.text || msg.text || '').trim();
        if (!text) continue;
        
        log('Chat from ' + senderName + ': ' + text.substring(0, 100));
        
        if (text.startsWith(CONFIG.PREFIX)) {
          handleCommand(text);
        } else {
          // 普通消息 -> WebSocket broadcast -> content.js -> enqueueMessage
          const sent = await broadcastToChat(senderName, text);
          if (sent) {
            await sendMessage('📬 Delivered to AI agent.');
          } else {
            await sendMessage('❌ Failed to deliver - WebSocket not connected.');
          }
        }
      }
    } catch(e) {
      log('Poll error: ' + e.message);
    }
    
    await new Promise(r => setTimeout(r, CONFIG.POLL_INTERVAL));
  }
}

// === Start/Stop ===
if (process.argv.includes('--stop')) {
  try {
    const pid = fs.readFileSync(CONFIG.PID_FILE, 'utf8').trim();
    process.kill(parseInt(pid));
    fs.unlinkSync(CONFIG.PID_FILE);
    console.log('Bridge stopped (PID ' + pid + ')');
  } catch(e) {
    console.log('Stop failed: ' + e.message);
  }
  process.exit(0);
}

fs.writeFileSync(CONFIG.PID_FILE, String(process.pid));
log('Team Chat Bridge v2.0 (WebSocket Edition) started, PID: ' + process.pid);

replyServer.listen(CONFIG.REPLY_PORT, 'localhost', () => {
  log('Reply server on http://localhost:' + CONFIG.REPLY_PORT);
});

process.on('SIGTERM', () => { running = false; try { fs.unlinkSync(CONFIG.PID_FILE); } catch(e) {} process.exit(0); });
process.on('SIGINT', () => { running = false; try { fs.unlinkSync(CONFIG.PID_FILE); } catch(e) {} process.exit(0); });

pollLoop().catch(e => log('Fatal: ' + e.message));
