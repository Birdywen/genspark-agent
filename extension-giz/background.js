// background.js — Giz.AI Agent Bridge Background Service Worker v2

chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 });
chrome.alarms.create('wsCheck',   { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive') console.log('[BG] keepAlive');
  if (alarm.name === 'wsCheck') {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      console.log('[BG] WS 断开，重连...');
      connectWebSocket();
    } else {
      socket.send(JSON.stringify({ type: 'ping' }));
    }
  }
});

let socket = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let cachedTools = [];

const SERVERS = {
  local: 'ws://localhost:8765',
  cloud: 'ws://150.136.51.61:8765?token=ys8765'
};
let currentServer = 'local';

function connectWebSocket() {
  if (socket && socket.readyState === WebSocket.OPEN) return;
  if (socket) { try { socket.close(); } catch(e) {} socket = null; }
  console.log('[BG] 连接', SERVERS[currentServer]);
  try { socket = new WebSocket(SERVERS[currentServer]); } catch(e) { scheduleReconnect(); return; }

  socket.onopen = () => {
    console.log('[BG] 已连接');
    reconnectAttempts = 0;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    broadcastToAllTabs({ type: 'WS_STATUS', connected: true });
    setTimeout(() => socket && socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify({ type: 'get_tools' })), 500);
  };

  socket.onmessage = (event) => {
    console.log('[BG] 收到:', event.data.slice(0, 200));
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'pong') return;
      if (data.tools) { cachedTools = data.tools; console.log('[BG] 缓存工具:', cachedTools.length); }
      if (data.type === 'tools_updated') {
        cachedTools = data.tools || [];
        broadcastToAllTabs({ type: 'tools_updated', tools: cachedTools });
        return;
      }
      if (data.type === 'tool_result') {
        broadcastToAllTabs({ type: 'TOOL_RESULT', payload: data });
        return;
      }
      if (data.type === 'batch_step_result' || data.type === 'batch_complete' || data.type === 'batch_error') {
        broadcastToAllTabs(data);
        return;
      }
      broadcastToAllTabs(data);
    } catch(e) { console.error('[BG] parse error:', e); }
  };

  socket.onclose = () => {
    console.log('[BG] 断开');
    socket = null;
    broadcastToAllTabs({ type: 'WS_STATUS', connected: false });
    scheduleReconnect();
  };
  socket.onerror = (e) => { console.error('[BG] WS error', e); };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectAttempts++;
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
  console.log('[BG] 将在', delay, 'ms 后重连');
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connectWebSocket(); }, delay);
}

function broadcastToAllTabs(message) {
  chrome.tabs.query({}, tabs => {
    tabs.forEach(tab => { try { chrome.tabs.sendMessage(tab.id, message); } catch(e) {} });
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SEND_TO_SERVER') {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message.payload));
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: 'Server not connected' });
    }
    return true;
  }
  if (message.type === 'GET_STATUS') {
    sendResponse({ connected: !!(socket && socket.readyState === WebSocket.OPEN), server: SERVERS[currentServer] });
    return true;
  }
  if (message.type === 'SWITCH_SERVER') {
    currentServer = message.server === 'cloud' ? 'cloud' : 'local';
    if (socket) { try { socket.close(); } catch(e) {} socket = null; }
    connectWebSocket();
    sendResponse({ success: true, server: SERVERS[currentServer] });
    return true;
  }
  if (message.type === 'GET_TOOLS') {
    sendResponse({ tools: cachedTools });
    return true;
  }
  sendResponse({ received: true });
  return true;
});

connectWebSocket();
