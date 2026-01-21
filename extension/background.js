// Genspark Agent Bridge - Background Service Worker v2

let socket = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let cachedTools = [];

const WS_URL = 'ws://localhost:8765';

function connectWebSocket() {
  if (socket && socket.readyState === WebSocket.OPEN) {
    return;
  }

  if (socket) {
    try { socket.close(); } catch(e) {}
    socket = null;
  }

  console.log('[BG] 连接 WebSocket...');

  try {
    socket = new WebSocket(WS_URL);
  } catch(e) {
    console.error('[BG] 创建失败:', e);
    scheduleReconnect();
    return;
  }

  socket.onopen = () => {
    console.log('[BG] 已连接');
    reconnectAttempts = 0;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    broadcastToTabs({ type: 'WS_STATUS', connected: true });
    startPing();
  };

  socket.onmessage = (event) => {
    console.log('[BG] 收到:', event.data.slice(0, 300));
    
    try {
      const data = JSON.parse(event.data);
      
      // 缓存工具列表
      if (data.tools) {
        cachedTools = data.tools;
        console.log('[BG] 缓存工具:', cachedTools.length);
      }
      
      if (data.type === 'pong') return;
      
      broadcastToTabs(data);
    } catch(e) {
      console.error('[BG] 解析失败:', e);
    }
  };

  socket.onclose = () => {
    console.log('[BG] 断开');
    socket = null;
    broadcastToTabs({ type: 'WS_STATUS', connected: false });
    scheduleReconnect();
  };

  socket.onerror = (e) => {
    console.error('[BG] 错误:', e);
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectAttempts++;
  const delay = Math.min(1000 * reconnectAttempts, 10000);
  console.log('[BG] ' + delay + 'ms 后重连');
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWebSocket();
  }, delay);
}

function startPing() {
  setInterval(() => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'ping' }));
    }
  }, 20000);
}

function broadcastToTabs(message) {
  console.log('[BG] 广播:', message.type);
  chrome.tabs.query({ url: 'https://www.genspark.ai/*' }, (tabs) => {
    console.log('[BG] 找到 tabs:', tabs.length);
    tabs.forEach((tab) => {
      chrome.tabs.sendMessage(tab.id, message).catch((e) => {
        console.log('[BG] 发送失败 tab ' + tab.id + ':', e.message);
      });
    });
  });
}

function sendToServer(message) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
    console.log('[BG] 发送到服务器:', message.type);
    return true;
  }
  console.warn('[BG] 未连接');
  return false;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[BG] 收到请求:', message.type);

  switch (message.type) {
    case 'SEND_TO_SERVER':
      const success = sendToServer(message.payload);
      sendResponse({ success });
      break;

    case 'GET_WS_STATUS':
      const connected = socket && socket.readyState === WebSocket.OPEN;
      console.log('[BG] 状态查询, connected:', connected, 'tools:', cachedTools.length);
      sendResponse({ connected, tools: cachedTools });
      
      // 如果有缓存的工具，也发送一次
      if (cachedTools.length > 0) {
        chrome.tabs.query({ url: 'https://www.genspark.ai/*' }, (tabs) => {
          tabs.forEach((tab) => {
            chrome.tabs.sendMessage(tab.id, { 
              type: 'update_tools', 
              tools: cachedTools 
            }).catch(() => {});
          });
        });
      }
      
      if (!connected) {
        reconnectAttempts = 0;
        connectWebSocket();
      }
      break;

    case 'RECONNECT':
      reconnectAttempts = 0;
      connectWebSocket();
      sendResponse({ success: true });
      break;
  }

  return true;
});

// 启动
connectWebSocket();

// 定期检查
setInterval(() => {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    if (!reconnectTimer) {
      connectWebSocket();
    }
  }
}, 30000);
