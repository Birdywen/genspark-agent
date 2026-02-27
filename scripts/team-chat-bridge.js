/**
 * Team Chat Bridge v3.0 - CometChat WebSocket Realtime Edition
 * 
 * 架构: CometChat WS (实时推送) + REST API (发送消息) + Local WS (broadcast)
 * 零轮询，毫秒级延迟
 */

import http from 'http';
import { WebSocket as WS } from 'ws';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG = {
  // CometChat
  COMET_API: 'https://1670754dd7dd407a4.apiclient-us.cometchat.io/v3.0',
  COMET_WS: 'wss://1670754dd7dd407a4.websocket-us.cometchat.io/',
  APP_ID: '1670754dd7dd407a4',
  AUTH_TOKEN: '180ee88d-516d-45e1-aa63-272c7ad3186d_177187404381eed77145044b5996ac9c53bacd70',
  JWT: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImtpZCI6ImNjcHJvX2p3dF9yczI1Nl9rZXkxIn0.eyJpc3MiOiIxNjcwNzU0ZGQ3ZGQ0MDdhNC5hcGljbGllbnQtdXMuY29tZXRjaGF0LmlvIiwiYXVkIjoiKiIsImlhdCI6MTc3MTg3NDA0NCwic3ViIjoiWzE2NzA3NTRkZDdkZDQwN2E0XTE4MGVlODhkLTUxNmQtNDVlMS1hYTYzLTI3MmM3YWQzMTg2ZCIsIm5iZiI6MTc3MTg3MDQ0NCwiZXhwIjoxNzc3MTM0MDQ0LCJkYXRhIjp7ImFwcElkIjoiMTY3MDc1NGRkN2RkNDA3YTQiLCJyZWdpb24iOiJ1cyIsImF1dGhUb2tlbiI6IjE4MGVlODhkLTUxNmQtNDVlMS1hYTYzLTI3MmM3YWQzMTg2ZF8xNzcxODc0MDQzODFlZWQ3NzE0NTA0NGI1OTk2YWM5YzUzYmFjZDcwIiwidXNlciI6eyJ1aWQiOiIxODBlZTg4ZC01MTZkLTQ1ZTEtYWE2My0yNzJjN2FkMzE4NmQiLCJuYW1lIjoiZ2Vuc3BhcmtfZmFuIiwiYXZhdGFyIjoiaHR0cHM6Ly9jZG4xLmdlbnNwYXJrLmFpL3VzZXItdXBsb2FkLWltYWdlL3YxLzZhYjg2YjAxLTY3YmMtNDVhYy1iNmIyLWM4ODhlZjQwOWE0NSIsInN0YXR1cyI6Im9mZmxpbmUiLCJyb2xlIjoiZGVmYXVsdCJ9fX0.XxsNDqpY2kh4BXS5gAxkveVGVlY_iSJGDEoeUIAdAQR82YQI6-EQF0HBTXDjgtKu2g0h8j-M7o5uVidTkJKLTc4skSm920O1sqKd1MdKnHAJGAni9U9ecREfw6SvkuNJZ0qvt3aBAAFm4mJoROsgZ5Q5V6CdBUxYX-mCGLXeqQc',
  DEVICE_ID: '1670754dd7dd407a4_86804b96-32dd-41b4-ab7b-a8485c7f1783_1771874044137',
  GROUP_ID: 'project_c172a082-7ba2-4105-8050-a56b7cf52cf4',
  MY_UID: '180ee88d-516d-45e1-aa63-272c7ad3186d',

  // Local
  LOCAL_WS: 'ws://localhost:8765',
  REPLY_PORT: 8769,
  PREFIX: '>>>',
  PID_FILE: '/tmp/team-chat-bridge.pid',
  LOG_FILE: path.join(__dirname, '../server-v2/logs/bridge.log'),

  // Reconnect
  PING_INTERVAL: 25000,
  RECONNECT_DELAY: 3000,
  MAX_RECONNECT_DELAY: 30000,
};

// --- Logger ---
function log(msg) {
  const ts = new Date().toLocaleTimeString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try {
  } catch(e) {}
  try {
    writeFileSync(CONFIG.LOG_FILE, line + '\n', { flag: 'a' });
  } catch(e) {}
}

// --- CometChat REST API (发送消息) ---
function sendMessage(text) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      category: 'message',
      type: 'text',
      data: { text },
      receiver: CONFIG.GROUP_ID,
      receiverType: 'group'
    });

    const url = new URL(`${CONFIG.COMET_API}/messages`);
    const req = http.request({
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'appId': CONFIG.APP_ID,
        'authToken': CONFIG.AUTH_TOKEN,
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// 用 https 发送
async function sendMessageHttps(text) {
  const https = await import('https');
  const data = JSON.stringify({
    category: 'message',
    type: 'text',
    data: { text },
    receiver: CONFIG.GROUP_ID,
    receiverType: 'group'
  });

  return new Promise((resolve, reject) => {
    const req = https.default.request({
      hostname: '1670754dd7dd407a4.apiclient-us.cometchat.io',
      port: 443,
      path: '/v3.0/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'appId': CONFIG.APP_ID,
        'authToken': CONFIG.AUTH_TOKEN,
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// --- Local WebSocket (broadcast to agent) ---
let localWs = null;
let localWsConnected = false;

function connectLocalWs() {
  try {
    localWs = new WS(CONFIG.LOCAL_WS);
    localWs.on('open', () => {
      localWsConnected = true;
      log('Local WS connected to ' + CONFIG.LOCAL_WS);
    });
    localWs.on('close', () => {
      localWsConnected = false;
      log('Local WS disconnected');
      setTimeout(connectLocalWs, 3000);
    });
    localWs.on('error', (e) => {
      localWsConnected = false;
    });
  } catch(e) {
    setTimeout(connectLocalWs, 5000);
  }
}

function broadcastToAgent(text) {
  if (localWs && localWsConnected) {
    localWs.send(JSON.stringify({
      type: 'broadcast',
      payload: {
        type: 'CROSS_TAB_MESSAGE',
        from: 'phone-bridge',
        message: text
      }
    }));
    return true;
  }
  return false;
}

// --- Command execution ---
function runCommand(cmd) {
  const timeout = cmd.includes('ask2') ? 90000 : 30000;
  return new Promise((resolve) => {
    exec('setopt noglob 2>/dev/null; source ~/.zshrc 2>/dev/null; ' + cmd, { timeout, shell: '/bin/zsh' }, (err, stdout, stderr) => {
      resolve(stdout || stderr || (err ? err.message : 'done'));
    });
  });
}

// --- CometChat WebSocket (实时接收) ---
let cometWs = null;
let cometConnected = false;
let reconnectDelay = CONFIG.RECONNECT_DELAY;
let pingTimer = null;

function connectCometChat() {
  log('Connecting to CometChat WebSocket...');
  
  try {
    cometWs = new WS(CONFIG.COMET_WS);
  } catch(e) {
    log('CometChat WS create error: ' + e.message);
    scheduleReconnect();
    return;
  }

  cometWs.on('open', () => {
    log('CometChat WS connected, authenticating...');
    
    const authMsg = {
      appId: CONFIG.APP_ID,
      deviceId: 'bridge-v3-' + Date.now(),
      type: 'auth',
      sender: CONFIG.MY_UID,
      body: {
        auth: CONFIG.JWT,
        deviceId: CONFIG.DEVICE_ID,
        params: {
          appInfo: { version: '4.1.5', apiVersion: 'v3.0', resource: 'uikit-v4', platform: 'web' },
          deviceId: CONFIG.DEVICE_ID,
          platform: 'javascript'
        }
      }
    };
    
    cometWs.send(JSON.stringify(authMsg));
  });

  cometWs.on('message', (data) => {
    const msg = data.toString();
    try {
      const parsed = JSON.parse(msg);
      handleCometMessage(parsed, msg);
    } catch(e) {
      log('CometChat parse error: ' + e.message);
    }
  });

  cometWs.on('close', (code, reason) => {
    cometConnected = false;
    clearInterval(pingTimer);
    log('CometChat WS closed: ' + code + ' ' + reason.toString());
    scheduleReconnect();
  });

  cometWs.on('error', (e) => {
    log('CometChat WS error: ' + e.message);
  });
}

function handleCometMessage(parsed, raw) {
  if (parsed.type === 'auth') {
    if (parsed.body && parsed.body.code === '200') {
      cometConnected = true;
      reconnectDelay = CONFIG.RECONNECT_DELAY;
      log('CometChat authenticated! Realtime listening active.');
      
      // 启动 ping
      pingTimer = setInterval(() => {
        if (cometWs && cometWs.readyState === 1) {
          cometWs.send(JSON.stringify({ action: 'ping', ack: 'true' }));
        }
      }, CONFIG.PING_INTERVAL);
    } else {
      log('CometChat auth failed: ' + raw.substring(0, 200));
    }
    return;
  }

  if (parsed.type === 'message') {
    // 提取消息内容
    const body = parsed.body || {};
    const sender = body.sender || parsed.sender;
    const msgData = body.data || {};
    const text = msgData.text || '';
    const receiver = body.receiver || parsed.receiver;
    const category = body.category;

    // 只处理目标 group 的消息
    if (receiver !== CONFIG.GROUP_ID) return;
    
    // 忽略自己发的消息
    if (sender === CONFIG.MY_UID) return;

    // 忽略非 text 消息
    if (category !== 'message' || body.type !== 'text') return;

    const senderName = (msgData.entities && msgData.entities.sender && msgData.entities.sender.entity) 
      ? msgData.entities.sender.entity.name 
      : sender;

    log('Realtime message from ' + senderName + ': ' + text.substring(0, 100));

    // 处理命令
    if (text.startsWith(CONFIG.PREFIX)) {
      handleCommand(text.slice(CONFIG.PREFIX.length).trim(), senderName);
      return;
    }

    // 路由过滤: @local/@arm 前缀定向发送
    const BRIDGE_ID = CONFIG.DEVICE_ID.includes('arm-bridge') ? 'arm' : 'local';
    const trimmedText = text.trim();
    if (trimmedText.startsWith('@local ') && BRIDGE_ID !== 'local') { log('Skipped (not for this bridge)'); return; }
    if (trimmedText.startsWith('@arm ') && BRIDGE_ID !== 'arm') { log('Skipped (not for this bridge)'); return; }
    // 去掉路由前缀
    let routedText = trimmedText;
    if (routedText.startsWith('@local ')) routedText = routedText.slice(7);
    if (routedText.startsWith('@arm ')) routedText = routedText.slice(5);

    // 转发到 agent
    const sent = broadcastToAgent(routedText);


    
    if (sent) {
      log('Broadcast sent: ' + text.substring(0, 50));
      // 发送已送达回执
      // sendMessageHttps('📬 Delivered to AI agent.').catch(e => log('Reply error: ' + e.message));
    } else {
      log('Broadcast failed, local WS not connected');
      sendMessageHttps('⚠️ Agent 未连接，消息未送达').catch(e => {});
    }
    return;
  }

  // 忽略 receipts, pong 等
}

async function handleCommand(cmd, sender) {
  log('Command from ' + sender + ': ' + cmd);
  const result = await runCommand(cmd);
  const reply = '```\n' + result.substring(0, 3000) + '\n```';
  try {
    await sendMessageHttps(reply);
    log('Command result sent');
  } catch(e) {
    log('Command reply error: ' + e.message);
  }
}

function scheduleReconnect() {
  log('Reconnecting in ' + (reconnectDelay / 1000) + 's...');
  setTimeout(() => {
    connectCometChat();
    reconnectDelay = Math.min(reconnectDelay * 1.5, CONFIG.MAX_RECONNECT_DELAY);
  }, reconnectDelay);
}

// --- Reply HTTP server ---
const replyServer = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      version: '3.0',
      mode: 'realtime-websocket',
      running: true,
      cometConnected,
      localWsConnected,
      uptime: Math.round(process.uptime())
    }));
    return;
  }

  if (req.method === 'POST' && req.url === '/image') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { url, name } = JSON.parse(body);
        const ext = (name || url).split('.').pop().split('?')[0] || 'jpg';
        const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
        const mime = mimeMap[ext.toLowerCase()] || 'image/jpeg';
        const https = await import('https');
        const data = JSON.stringify({
          category: 'message',
          type: 'image',
          receiver: CONFIG.GROUP_ID,
          receiverType: 'group',
          data: {
            url: url,
            attachments: [{ extension: ext, mimeType: mime, name: name || 'image.' + ext, url: url }]
          }
        });
        const apiReq = https.default.request({
          hostname: '1670754dd7dd407a4.apiclient-us.cometchat.io',
          port: 443,
          path: '/v3.0/messages',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'appId': CONFIG.APP_ID,
            'authToken': CONFIG.AUTH_TOKEN,
            'Content-Length': Buffer.byteLength(data)
          }
        }, (apiRes) => {
          let respBody = '';
          apiRes.on('data', c => respBody += c);
          apiRes.on('end', () => {
            log('Image sent to team chat');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          });
        });
        apiReq.on('error', (e) => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        });
        apiReq.write(data);
        apiReq.end();
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/reply') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { text } = JSON.parse(body);
        await sendMessageHttps(text);
        log('Reply sent to team chat');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

// --- Start ---
function start() {
  log('Team Chat Bridge v3.0 (Realtime WebSocket Edition) starting...');
  
  // PID file
  writeFileSync(CONFIG.PID_FILE, process.pid.toString());
  log('PID: ' + process.pid);

  // Connect local WS
  connectLocalWs();

  // Connect CometChat realtime WS
  connectCometChat();

  // Start reply server
  replyServer.listen(CONFIG.REPLY_PORT, () => {
    log('Reply server on http://localhost:' + CONFIG.REPLY_PORT);
  });
}

// Graceful shutdown
process.on('SIGTERM', () => {
  log('Shutting down...');
  if (cometWs) cometWs.close();
  if (localWs) localWs.close();
  replyServer.close();
  process.exit(0);
});
process.on('SIGINT', () => {
  log('Shutting down...');
  if (cometWs) cometWs.close();
  if (localWs) localWs.close();
  replyServer.close();
  process.exit(0);
});

start();
