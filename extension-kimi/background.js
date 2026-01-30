// Galaxy AI Agent Bridge - Background Service Worker v1 (基于 Genspark v5)

let socket = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let cachedTools = [];
let cachedSkills = [];
let cachedSkillsPrompt = '';
let cachedAgents = {};

// 记录每个工具调用来自哪个 Tab
const pendingCallsByTab = new Map(); // callId -> tabId

// 记录已处理的 tool_result，防止重复
const processedResults = new Set();

// 记录每个 Agent 对应的 Tab
const agentTabs = new Map(); // agentId -> tabId
const tabAgents = new Map(); // tabId -> agentId

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
    broadcastToAllTabs({ type: 'WS_STATUS', connected: true });
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
      
      // 缓存 Skills 列表
      if (data.skills) {
        cachedSkills = data.skills;
        console.log('[BG] 缓存 Skills:', cachedSkills.length);
      }
      
      // 缓存 Skills 系统提示
      if (data.skillsPrompt) {
        cachedSkillsPrompt = data.skillsPrompt;
        console.log('[BG] 缓存 Skills 提示词, 长度:', cachedSkillsPrompt.length);
      }
      
      // 缓存 Agents 信息
      if (data.agents) {
        cachedAgents = data.agents;
        console.log('[BG] 缓存 Agents:', Object.keys(cachedAgents).length);
      }
      
      if (data.type === 'pong') return;
      
      // 跨扩展消息：转发给目标 agent 的 Tab
      if (data.type === 'cross_extension_message') {
        console.log('[BG] 收到跨扩展消息:', data.from, '->', data.to);
        // 查找本地是否有这个 agent
        const targetTabId = agentTabs.get(data.to);
        if (targetTabId) {
          sendToTab(targetTabId, {
            type: 'CROSS_TAB_MESSAGE',
            from: data.from,
            message: data.message,
            timestamp: data.timestamp,
            via: 'server'
          });
          console.log('[BG] 跨扩展消息已转发到 Tab:', targetTabId);
        } else {
          console.log('[BG] 目标 agent 不在本扩展:', data.to);
        }
        return;
      }
      
      // 在线 agent 列表（来自服务器）
      if (data.type === 'online_agents') {
        console.log('[BG] 服务器在线 agents:', data.agents);
        // 广播给所有 Tab，让 UI 可以显示
        broadcastToAllTabs(data);
        return;
      }
      
      // 工具执行结果：只发送给发起调用的 Tab
      if (data.type === 'tool_result' && data.id) {
        // 去重检查
        const resultKey = `${data.id}:${data.tool}`;
        if (processedResults.has(resultKey)) {
          console.log('[BG] 跳过重复的 tool_result:', resultKey);
          return;
        }
        processedResults.add(resultKey);
        // 30秒后清理，防止内存泄漏
        setTimeout(() => processedResults.delete(resultKey), 30000);
        
        const tabId = pendingCallsByTab.get(data.id);
        if (tabId) {
          console.log('[BG] 发送结果到 Tab:', tabId);
          sendToTab(tabId, data);
          pendingCallsByTab.delete(data.id);
        } else {
          // 找不到对应 Tab，回退到广播（兼容旧版本）
          console.log('[BG] 未找到 Tab，广播结果');
          broadcastToAllTabs(data);
        }
      } else {
        // 其他消息广播给所有 Tab
        broadcastToAllTabs(data);
      }
    } catch(e) {
      console.error('[BG] 解析失败:', e);
    }
  };

  socket.onclose = () => {
    console.log('[BG] 断开');
    socket = null;
    broadcastToAllTabs({ type: 'WS_STATUS', connected: false });
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

// 发送消息到指定 Tab
function sendToTab(tabId, message) {
  chrome.tabs.sendMessage(tabId, message).catch((e) => {
    console.log('[BG] 发送失败 tab ' + tabId + ':', e.message);
  });
}

// 广播给所有 Galaxy Tab
function broadcastToAllTabs(message) {
  console.log('[BG] 广播:', message.type);
  chrome.tabs.query({ url: ['https://kimi.moonshot.cn/*', 'https://kimi.com/*', 'https://www.kimi.com/*'] }, (tabs) => {
    console.log('[BG] 找到 tabs:', tabs.length);
    tabs.forEach((tab) => {
      chrome.tabs.sendMessage(tab.id, message).catch((e) => {
        console.log('[BG] 发送失败 tab ' + tab.id + ':', e.message);
      });
    });
  });
}

function sendToServer(message, tabId) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    // 记录这个调用来自哪个 Tab（包括 retry）
    if ((message.type === 'tool_call' || message.type === 'retry') && message.id && tabId) {
      pendingCallsByTab.set(message.id, tabId);
      console.log('[BG] 记录调用:', message.id, '-> Tab:', tabId);
      
      // 30秒后清理，防止内存泄漏
      setTimeout(() => {
        pendingCallsByTab.delete(message.id);
      }, 30000);
    }
    
    socket.send(JSON.stringify(message));
    console.log('[BG] 发送到服务器:', message.type);
    return true;
  }
  console.warn('[BG] 未连接');
  return false;
}

// ============== 跨 Tab 通信 ==============

// 注册 Agent
function registerAgent(agentId, tabId) {
  // 清理旧的映射
  const oldTabId = agentTabs.get(agentId);
  if (oldTabId && oldTabId !== tabId) {
    tabAgents.delete(oldTabId);
  }
  const oldAgentId = tabAgents.get(tabId);
  if (oldAgentId && oldAgentId !== agentId) {
    agentTabs.delete(oldAgentId);
  }
  
  agentTabs.set(agentId, tabId);
  tabAgents.set(tabId, agentId);
  console.log('[BG] 注册 Agent:', agentId, '-> Tab:', tabId);
  console.log('[BG] 当前 Agents:', Array.from(agentTabs.entries()));
}

// 发送跨 Tab 消息
function sendCrossTabMessage(fromAgentId, toAgentId, message) {
  const targetTabId = agentTabs.get(toAgentId);
  
  if (!targetTabId) {
    console.log('[BG] 目标 Agent 未注册:', toAgentId);
    return { success: false, error: 'Agent not found: ' + toAgentId };
  }
  
  console.log('[BG] 跨 Tab 消息:', fromAgentId, '->', toAgentId, '(Tab:', targetTabId, ')');
  
  sendToTab(targetTabId, {
    type: 'CROSS_TAB_MESSAGE',
    from: fromAgentId,
    to: toAgentId,
    message: message,
    timestamp: Date.now()
  });
  
  return { success: true, targetTabId };
}

// 获取所有已注册的 Agent
function getRegisteredAgents() {
  const agents = [];
  for (const [agentId, tabId] of agentTabs) {
    agents.push({ agentId, tabId });
  }
  return agents;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[BG] 收到请求:', message.type, 'from Tab:', sender.tab?.id);

  switch (message.type) {
    case 'SEND_TO_SERVER':
      // 传入 sender.tab.id 以便记录
      const success = sendToServer(message.payload, sender.tab?.id);
      sendResponse({ success });
      break;

    case 'GET_WS_STATUS':
      const connected = socket && socket.readyState === WebSocket.OPEN;
      console.log('[BG] 状态查询, connected:', connected, 'tools:', cachedTools.length, 'skills:', cachedSkills.length, 'agents:', Object.keys(cachedAgents).length);
      sendResponse({ 
        connected, 
        tools: cachedTools,
        skills: cachedSkills,
        skillsPrompt: cachedSkillsPrompt,
        agents: cachedAgents
      });
      
      // 如果有缓存的数据，只发送给请求的 Tab
      if (sender.tab?.id && (cachedTools.length > 0 || cachedSkills.length > 0 || Object.keys(cachedAgents).length > 0)) {
        sendToTab(sender.tab.id, { 
          type: 'update_tools', 
          tools: cachedTools,
          skills: cachedSkills,
          skillsPrompt: cachedSkillsPrompt,
          agents: cachedAgents
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
    
    // ===== 跨 Tab 通信 =====
    
    case 'REGISTER_AGENT':
      if (message.agentId && sender.tab?.id) {
        // 本地注册
        registerAgent(message.agentId, sender.tab.id);
        // 同时向服务器注册（支持跨扩展）
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({
            type: 'register_agent',
            agentId: message.agentId,
            site: 'kimi.ai'
          }));
        }
        sendResponse({ success: true, tabId: sender.tab.id });
      } else {
        sendResponse({ success: false, error: 'Missing agentId or tabId' });
      }
      break;
    
    case 'CROSS_TAB_SEND':
      if (message.to && message.message) {
        const fromAgent = tabAgents.get(sender.tab?.id) || 'unknown';
        // 优先通过服务器发送（支持跨扩展）
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({
            type: 'cross_extension_send',
            from: fromAgent,
            to: message.to,
            message: message.message
          }));
          console.log('[BG] 跨扩展消息已发送到服务器:', fromAgent, '->', message.to);
          sendResponse({ success: true, via: 'server' });
        } else {
          // 服务器不可用，尝试本地发送（同扩展内）
          const localResult = sendCrossTabMessage(fromAgent, message.to, message.message);
          if (localResult.success) {
            sendResponse(localResult);
          } else {
            sendResponse({ success: false, error: `Agent "${message.to}" 不在线且服务器未连接` });
          }
        }
      } else {
        sendResponse({ success: false, error: 'Missing to or message' });
      }
      break;
    
    case 'GET_REGISTERED_AGENTS':
      // 请求服务器的在线 agent 列表
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'list_online_agents' }));
      }
      // 同时返回本地列表
      sendResponse({ success: true, agents: getRegisteredAgents() });
      break;
    
    case 'UNREGISTER_AGENT':
      if (sender.tab?.id) {
        const agentId = tabAgents.get(sender.tab.id);
        if (agentId) {
          agentTabs.delete(agentId);
          tabAgents.delete(sender.tab.id);
          console.log('[BG] 注销 Agent:', agentId);
        }
        sendResponse({ success: true });
      }
      break;
  }

  return true;
});

// 启动
connectWebSocket();

// 定期检查连接
setInterval(() => {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    if (!reconnectTimer) {
      connectWebSocket();
    }
  }
}, 30000);

// 清理关闭的 Tab
chrome.tabs.onRemoved.addListener((tabId) => {
  // 清理 pending calls
  for (const [callId, tid] of pendingCallsByTab) {
    if (tid === tabId) {
      pendingCallsByTab.delete(callId);
      console.log('[BG] 清理已关闭 Tab 的调用:', callId);
    }
  }
  
  // 清理 Agent 注册
  const agentId = tabAgents.get(tabId);
  if (agentId) {
    agentTabs.delete(agentId);
    tabAgents.delete(tabId);
    console.log('[BG] 清理已关闭 Tab 的 Agent:', agentId);
  }
});
