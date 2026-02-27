// Genspark Agent Bridge - Background Service Worker v5 (跨 Tab 通信)

// === Service Worker 保活 (chrome.alarms) ===
// MV3 service worker 空闲30秒会被挂起，用 alarms 定期唤醒
chrome.alarms.create("keepAlive", { periodInMinutes: 0.4 }); // 每24秒
chrome.alarms.create("wsCheck", { periodInMinutes: 1 }); // 每分钟检查连接

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "keepAlive") {
    // 仅唤醒 service worker，保持活跃
    console.log('[BG] ⏰ keepAlive alarm fired');
  }
  if (alarm.name === "wsCheck") {
    console.log('[BG] ⏰ wsCheck alarm fired');
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      console.log('[BG] WebSocket 断开，尝试重连');
      connectWebSocket();
    } else {
      socket.send(JSON.stringify({ type: 'ping' }));
    }
  }
});
// === End 保活 ===

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

// 服务器地址配置（可切换本地/云端）
const SERVERS = {
  local: 'ws://localhost:8765',
  cloud: 'ws://150.136.51.61:8765'
};
let currentServer = 'local';  // 默认云端
const WS_URL = SERVERS[currentServer];

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
    socket = new WebSocket(SERVERS[currentServer]);
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
      
      // 工具列表更新：更新缓存并广播给所有 Tab
      if (data.type === 'tools_updated') {
        cachedTools = data.tools || [];
        console.log('[BG] 工具列表已更新:', cachedTools.length);
        broadcastToAllTabs({
          type: 'tools_updated',
          tools: cachedTools,
          timestamp: data.timestamp
        });
        return;
      }
      
      // 批量任务结果
      if (data.type === 'batch_step_result' || data.type === 'batch_complete' || data.type === 'batch_error') {
        console.log('[BG] 批量任务消息:', data.type);
        broadcastToAllTabs(data);
        return;
      }

      // 浏览器工具反向调用：server 请求浏览器执行 js_flow/eval_js/list_tabs
      if (data.type === 'browser_tool_call') {
        console.log('[BG] 浏览器工具调用:', data.tool, data.callId);
        broadcastToAllTabs(data);
        return;
      }

      // 第三阶段: 任务规划、工作流、断点续传结果
      if (data.type === 'plan_result' || data.type === 'plan_error') {
        console.log('[BG] 任务规划消息:', data.type);
        broadcastToAllTabs(data);
        return;
      }
      if (data.type === 'workflow_complete' || data.type === 'workflow_step' || data.type === 'workflow_error') {
        console.log('[BG] 工作流消息:', data.type);
        broadcastToAllTabs(data);
        return;
      }
      if (data.type === 'resume_started' || data.type === 'resume_step' || data.type === 'resume_complete' || data.type === 'resume_error') {
        console.log('[BG] 断点续传消息:', data.type);
        broadcastToAllTabs(data);
        return;
      }
      if (data.type === 'checkpoint_result' || data.type === 'checkpoint_error' || data.type === 'templates_list') {
        console.log('[BG] 检查点/模板消息:', data.type);
        broadcastToAllTabs(data);
        return;
      }
      
      // 任务恢复结果
      if (data.type === 'resume_complete' || data.type === 'resume_error' || data.type === 'task_status_result') {
        console.log('[BG] 任务状态消息:', data.type);
        broadcastToAllTabs(data);
        return;
      }
      
      // 目标驱动执行结果
      if (data.type === 'goal_created' || data.type === 'goal_progress' || 
          data.type === 'goal_complete' || data.type === 'goal_status_result' ||
          data.type === 'goals_list' || data.type === 'validated_result') {
        console.log('[BG] 目标执行消息:', data.type);
        broadcastToAllTabs(data);
        return;
      }

      // 异步执行消息
      if (data.type === 'async_result' || data.type === 'async_output' ||
          data.type === 'async_status_result' || data.type === 'async_stop_result' ||
          data.type === 'async_log_result') {
        console.log('[BG] 异步执行消息:', data.type);
        broadcastToAllTabs(data);
        return;
      }
      
      // reload_tools 结果
      if (data.type === 'reload_tools_result') {
        if (data.success) {
          cachedTools = data.tools || [];
          console.log('[BG] reload_tools 成功:', cachedTools.length);
        } else {
          console.error('[BG] reload_tools 失败:', data.error);
        }
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
          // 找不到对应 Tab，不广播，只记录警告
          console.warn('[BG] 未找到 Tab 映射，callId:', data.id, '- 丢弃结果，不广播');
          // 禁用广播，避免结果发到错误的 tab
        }
      } else {
        // 其他消息（非 tool_result）广播给所有 Tab
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

// 广播给所有 Genspark Tab
function broadcastToAllTabs(message) {
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

function sendToServer(message, tabId) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    // 记录这个调用来自哪个 Tab（包括 retry）
    if ((message.type === 'tool_call' || message.type === 'retry') && message.id && tabId) {
      pendingCallsByTab.set(message.id, tabId);
      console.log('[BG] 记录调用:', message.id, '-> Tab:', tabId);
      
      // 30秒后清理，防止内存泄漏
      setTimeout(() => {
        pendingCallsByTab.delete(message.id);
      }, 120000);  // 延长到120秒
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

// Track last send time per agent to prevent spam
const lastSendTimes = new Map();
const SEND_COOLDOWN_MS = 10000; // 10 seconds

// 发送跨 Tab 消息
function sendCrossTabMessage(fromAgentId, toAgentId, message) {
  // Check cooldown
  const lastSend = lastSendTimes.get(fromAgentId) || 0;
  const now = Date.now();
  const timeSinceLastSend = now - lastSend;
  
  if (timeSinceLastSend < SEND_COOLDOWN_MS) {
    const waitTime = Math.ceil((SEND_COOLDOWN_MS - timeSinceLastSend) / 1000);
    console.log(`[BG] ${fromAgentId} 发送过于频繁，需等待 ${waitTime} 秒`);
    return { 
      success: false, 
      error: `请等待 ${waitTime} 秒后再发送`,
      cooldown: waitTime
    };
  }
  
  let targetTabId = agentTabs.get(toAgentId);
  
  // 支持 tab_xxx 格式直接路由到对应 tabId
  if (!targetTabId && toAgentId.startsWith('tab_')) {
    targetTabId = parseInt(toAgentId.replace('tab_', ''), 10);
    console.log('[BG] 使用 tabId 直接路由:', targetTabId);
  }
  
  if (!targetTabId) {
    console.log('[BG] 目标 Agent 未注册:', toAgentId);
    return { success: false, error: 'Agent not found: ' + toAgentId };
  }
  
  // Update last send time
  lastSendTimes.set(fromAgentId, now);
  
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
    
    case 'CHECK_CONNECTION':
      sendResponse({
        connected: socket && socket.readyState === WebSocket.OPEN,
        readyState: socket?.readyState,
        readyStateText: ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][socket?.readyState || 3],
        reconnectAttempts: reconnectAttempts,
        serverUrl: SERVERS[currentServer]
      });
      break;
    

    // =====================================================
    // TUTORIAL RECORD ENGINE — 教程录制引擎
    // =====================================================
    case 'TUTORIAL_RECORD': {
      const senderTabId = sender.tab?.id;
      if (!senderTabId) { sendResponse({ success: false, error: 'No tab id' }); break; }
      
      const { steps, tabId: targetTabId, outputDir } = message;
      const target = targetTabId || null;
      
      if (!steps || !Array.isArray(steps)) {
        sendResponse({ success: false, error: 'steps array required' });
        break;
      }
      
      sendResponse({ success: true, status: 'started', totalSteps: steps.length });
      
      // Spotlight 模版
      const SPOTLIGHT_STYLES = {
        blue: { color: '#4285f4', borderWidth: 3 },
        green: { color: '#34a853', borderWidth: 3 },
        red: { color: '#ea4335', borderWidth: 3 },
        yellow: { color: '#fbbc05', borderWidth: 3 },
        pulse: { color: '#4285f4', borderWidth: 3, animate: true }
      };
      
      // 生成 spotlight overlay 代码
      function makeSpotlightCode(selector, style, label, padding) {
        const s = SPOTLIGHT_STYLES[style] || SPOTLIGHT_STYLES.blue;
        const pad = padding || 8;
        const animate = s.animate ? `
          var style = document.createElement('style');
          style.textContent = '@keyframes tut-pulse{0%,100%{stroke-opacity:1;stroke-width:${s.borderWidth}}50%{stroke-opacity:0.5;stroke-width:${s.borderWidth+2}}}';
          document.head.appendChild(style);
        ` : '';
        const animAttr = s.animate ? ' style="animation:tut-pulse 1.5s infinite"' : '';
        
        return `
          var old=document.getElementById('tutorial-overlay');if(old)old.remove();
          var el=document.querySelector('${selector.replace(/'/g, "\\'")}');
          if(!el) return JSON.stringify({success:false,error:'not found: ${selector.replace(/'/g, "\\'")}'});
          ${animate}
          var rect=el.getBoundingClientRect();
          var x=rect.x-${pad},y=rect.y-${pad},w=rect.width+${pad*2},h=rect.height+${pad*2};
          var ov=document.createElement('div');ov.id='tutorial-overlay';
          ov.style.cssText='position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:999999;pointer-events:none;';
          var lbl=${label ? `'<text x="'+(x+w/2)+'" y="'+(y-14)+'" text-anchor="middle" fill="white" font-size="16" font-family="Arial,sans-serif" font-weight="bold" filter="url(#shadow)">${label.replace(/'/g, "\\'")}</text><defs><filter id="shadow"><feDropShadow dx="0" dy="1" stdDeviation="2" flood-opacity="0.5"/></filter></defs>'` : "''"};
          ov.innerHTML='<svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg"><defs><mask id="tut-hole"><rect width="100%" height="100%" fill="white"/><rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" rx="12" fill="black"/></mask></defs><rect width="100%" height="100%" fill="rgba(0,0,0,0.5)" mask="url(#tut-hole)"/><rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" rx="12" fill="none" stroke="${s.color}" stroke-width="${s.borderWidth}"${animAttr}/>'+lbl+'</svg>';
          document.body.appendChild(ov);
          return JSON.stringify({success:true,bounds:{x:x,y:y,w:w,h:h}});
        `;
      }
      
      // 执行 JS 代码在目标 tab
      function execInTab(tabId, code) {
        return chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: (c) => {
            try {
              const fn = new Function(c);
              let r = fn();
              return typeof r === 'object' ? JSON.stringify(r) : String(r === undefined ? '' : r);
            } catch(e) { return JSON.stringify({error: e.message}); }
          },
          args: [code]
        }).then(r => r?.[0]?.result || '');
      }
      
      // 截图（captureVisibleTab）
      function captureTab(tabId) {
        return new Promise((resolve) => {
          // 先激活目标 tab
          chrome.tabs.update(tabId, { active: true }, () => {
            setTimeout(() => {
              chrome.tabs.get(tabId, (tab) => {
                chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }, (dataUrl) => {
                  if (chrome.runtime.lastError) {
                    resolve({ error: chrome.runtime.lastError.message });
                  } else {
                    resolve({ dataUrl });
                  }
                });
              });
            }, 300); // 等渲染完成
          });
        });
      }
      
      // 延时
      function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
      
      // 主执行循环
      (async () => {
        const results = [];
        const screenshots = [];
        
        // 确定目标 tab
        let tTab = target;
        if (!tTab) {
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          tTab = tabs[0]?.id;
        }
        
        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];
          const action = step.action || 'spotlight';
          let result = { step: i, action };
          
          try {
            switch(action) {
              case 'spotlight': {
                const code = makeSpotlightCode(
                  step.selector, 
                  step.style || 'blue', 
                  step.label || '', 
                  step.padding || 8
                );
                result.eval = await execInTab(tTab, code);
                await delay(step.duration ? step.duration * 1000 : 1500);
                const cap = await captureTab(tTab);
                if (cap.dataUrl) screenshots.push({ step: i, dataUrl: cap.dataUrl });
                result.screenshot = !!cap.dataUrl;
                break;
              }
              case 'type': {
                const typeCode = `
                  var old=document.getElementById('tutorial-overlay');if(old)old.remove();
                  var el=document.querySelector('${(step.selector||'').replace(/'/g,"\\'")}');
                  if(!el) return 'not found';
                  el.focus();el.value='${(step.text||'').replace(/'/g,"\\'")}';
                  el.dispatchEvent(new Event('input',{bubbles:true}));
                  return 'typed';
                `;
                result.eval = await execInTab(tTab, typeCode);
                await delay(step.duration ? step.duration * 1000 : 1000);
                const cap = await captureTab(tTab);
                if (cap.dataUrl) screenshots.push({ step: i, dataUrl: cap.dataUrl });
                result.screenshot = !!cap.dataUrl;
                break;
              }
              case 'click': {
                const clickCode = `
                  var old=document.getElementById('tutorial-overlay');if(old)old.remove();
                  var el=document.querySelector('${(step.selector||'').replace(/'/g,"\\'")}');
                  if(!el) return 'not found';
                  el.click();
                  return 'clicked';
                `;
                result.eval = await execInTab(tTab, clickCode);
                if (step.wait) {
                  // 等待新元素出现
                  const waitCode = `
                    var start=Date.now();
                    while(Date.now()-start<${step.waitTimeout||5000}){
                      if(document.querySelector('${(step.wait||'').replace(/'/g,"\\'")}')) return 'found';
                      await new Promise(r=>setTimeout(r,200));
                    }
                    return 'timeout';
                  `;
                  await delay(2000);
                }
                await delay(step.duration ? step.duration * 1000 : 2000);
                const cap = await captureTab(tTab);
                if (cap.dataUrl) screenshots.push({ step: i, dataUrl: cap.dataUrl });
                result.screenshot = !!cap.dataUrl;
                break;
              }
              case 'submit': {
                const submitCode = `
                  var old=document.getElementById('tutorial-overlay');if(old)old.remove();
                  var form=document.querySelector('${(step.selector||'form').replace(/'/g,"\\'")}');
                  if(form&&form.submit){form.submit();return 'submitted';}
                  return 'no form';
                `;
                result.eval = await execInTab(tTab, submitCode);
                await delay(step.duration ? step.duration * 1000 : 3000);
                const cap = await captureTab(tTab);
                if (cap.dataUrl) screenshots.push({ step: i, dataUrl: cap.dataUrl });
                result.screenshot = !!cap.dataUrl;
                break;
              }
              case 'goto': {
                const gotoCode = `window.location.href='${(step.url||'').replace(/'/g,"\\'")}';return 'navigating';`;
                result.eval = await execInTab(tTab, gotoCode);
                await delay(step.duration ? step.duration * 1000 : 3000);
                const cap = await captureTab(tTab);
                if (cap.dataUrl) screenshots.push({ step: i, dataUrl: cap.dataUrl });
                result.screenshot = !!cap.dataUrl;
                break;
              }
              case 'scroll': {
                const scrollCode = step.selector 
                  ? `var el=document.querySelector('${(step.selector||'').replace(/'/g,"\\'")}');if(el){el.scrollIntoView({behavior:'smooth',block:'center'});return 'scrolled';}return 'not found';`
                  : `window.scrollBy({top:${step.amount||400},behavior:'smooth'});return 'scrolled';`;
                result.eval = await execInTab(tTab, scrollCode);
                await delay(step.duration ? step.duration * 1000 : 1500);
                const cap = await captureTab(tTab);
                if (cap.dataUrl) screenshots.push({ step: i, dataUrl: cap.dataUrl });
                result.screenshot = !!cap.dataUrl;
                break;
              }
              case 'wait': {
                await delay(step.duration ? step.duration * 1000 : 2000);
                const cap = await captureTab(tTab);
                if (cap.dataUrl) screenshots.push({ step: i, dataUrl: cap.dataUrl });
                result.screenshot = !!cap.dataUrl;
                break;
              }
              case 'cleanup': {
                await execInTab(tTab, `var old=document.getElementById('tutorial-overlay');if(old)old.remove();return 'cleaned';`);
                await delay(500);
                const cap = await captureTab(tTab);
                if (cap.dataUrl) screenshots.push({ step: i, dataUrl: cap.dataUrl });
                result.screenshot = !!cap.dataUrl;
                break;
              }
              default:
                result.skipped = true;
            }
          } catch(e) {
            result.error = e.message;
          }
          
          results.push(result);
        }
        
        // 清理最终的 overlay
        await execInTab(tTab, `var old=document.getElementById('tutorial-overlay');if(old)old.remove();`);
        
        // 发回结果（截图作为 base64 数组）
        chrome.tabs.sendMessage(senderTabId, {
          type: 'TUTORIAL_RECORD_RESULT',
          callId: message.callId,
          success: true,
          results,
          screenshotCount: screenshots.length,
          // 发回截图 dataUrl 列表（content.js 会保存到本地）
          screenshots: screenshots.map(s => ({ step: s.step, dataUrl: s.dataUrl }))
        });
      })();
      
      break;
    }
    case 'LIST_TABS':
      chrome.tabs.query({}, (tabs) => {
        const tabList = tabs.map(t => ({ id: t.id, title: t.title, url: t.url, active: t.active, windowId: t.windowId }));
        chrome.tabs.sendMessage(sender.tab.id, { type: 'LIST_TABS_RESULT', callId: message.callId, success: true, result: JSON.stringify(tabList, null, 2) });
      });
      sendResponse({ success: true });
      break;

    case 'CAPTURE_TAB': {
      // 截图指定 tab（用 captureVisibleTab）
      const capTabId = message.tabId;
      const capCallId = message.callId;
      const senderForCap = sender.tab.id;
      
      const doCapture = (windowId) => {
        chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, (dataUrl) => {
          if (chrome.runtime.lastError) {
            chrome.tabs.sendMessage(senderForCap, { type: 'CAPTURE_TAB_RESULT', callId: capCallId, success: false, error: chrome.runtime.lastError.message });
          } else {
            chrome.tabs.sendMessage(senderForCap, { type: 'CAPTURE_TAB_RESULT', callId: capCallId, success: true, dataUrl });
          }
        });
      };
      
      if (!capTabId) {
        doCapture(null);
      } else {
        chrome.tabs.get(capTabId, (tab) => {
          if (chrome.runtime.lastError) {
            chrome.tabs.sendMessage(senderForCap, { type: 'CAPTURE_TAB_RESULT', callId: capCallId, success: false, error: chrome.runtime.lastError.message });
            return;
          }
          // 激活目标 tab（不 focus 窗口），然后截图
          chrome.tabs.update(capTabId, { active: true }, () => {
            setTimeout(() => doCapture(tab.windowId), 300);
          });
        });
      }
      sendResponse({ success: true });
      break;
    }

    case 'EVAL_JS':
      if (sender.tab?.id) {
        const senderTabId = sender.tab.id;
        const targetTab = message.targetTabId || senderTabId;
        const codeToRun = message.code || '';
        const useAllFrames = message.allFrames === true;
        
        // 先尝试 MAIN world（能访问页面全局变量），CSP 失败则 fallback 到 ISOLATED world
        const tryExecute = async (world) => {
          const target = useAllFrames
            ? { tabId: targetTab, allFrames: true }
            : { tabId: targetTab };
          return chrome.scripting.executeScript({
            target: target,
            world: world,
            func: async (code) => {
              try {
                const fn = new Function(code);
                let result = fn();
                if (result && typeof result.then === 'function') {
                  result = await result;
                }
                const serialized = (typeof result === 'object')
                  ? JSON.stringify(result, null, 2)
                  : String(result === undefined ? '(undefined)' : result);
                return { success: true, result: serialized };
              } catch (e) {
                return { success: false, error: e.message, isCSP: e.message && e.message.includes('unsafe-eval') };
              }
            },
            args: [codeToRun]
          });
        };
        
        tryExecute('MAIN').then(results => {
          // allFrames 模式：合并所有 frame 的成功结果
          let res;
          if (useAllFrames && results && results.length > 1) {
            const frameResults = results
              .map((r, idx) => ({ frameIndex: idx, ...(r?.result || { success: false }) }))
              .filter(r => r.success && r.result && r.result !== '(undefined)');
            if (frameResults.length > 0) {
              res = { success: true, result: JSON.stringify(frameResults.map(r => r.result)), allFrames: true };
            } else {
              res = results?.[0]?.result || { success: false, error: 'No result from any frame' };
            }
          } else {
            res = results?.[0]?.result || { success: false, error: 'No result' };
          }
          if (res.isCSP) {
            // MAIN world CSP 拦截，fallback: 用页面 nonce 注入 script 标签
            console.log('[BG] MAIN world CSP blocked, trying nonce script injection...');
            const resultKey = '__agent_eval_' + Date.now() + '_' + Math.random().toString(36).slice(2);
            
            // 第一步：注入带 nonce 的 script 标签
            chrome.scripting.executeScript({
              target: { tabId: targetTab },
              world: 'MAIN',
              func: (code, rKey) => {
                const existingScript = document.querySelector('script[nonce]');
                const nonce = existingScript ? existingScript.nonce || existingScript.getAttribute('nonce') : '';
                window[rKey] = undefined;
                const wrappedCode = `(async()=>{try{const r=await(async()=>{${code}})();const s=(typeof r==='object')?JSON.stringify(r,null,2):String(r===undefined?'(undefined)':r);window['${rKey}']={success:true,result:s}}catch(e){window['${rKey}']={success:false,error:e.message}}})()`;
                const script = document.createElement('script');
                if (nonce) script.setAttribute('nonce', nonce);
                script.textContent = wrappedCode;
                document.documentElement.appendChild(script);
                script.remove();
                return { injected: true, nonce: !!nonce };
              },
              args: [codeToRun, resultKey]
            }).then(injectResults => {
              console.log('[BG] Nonce script injected:', injectResults?.[0]?.result);
              // 第二步：在 background 层轮询读取结果
              let attempts = 0;
              const poll = () => {
                chrome.scripting.executeScript({
                  target: { tabId: targetTab },
                  world: 'MAIN',
                  func: (rKey) => window[rKey],
                  args: [resultKey]
                }).then(pollResults => {
                  const val = pollResults?.[0]?.result;
                  if (val !== undefined && val !== null) {
                    // 清理
                    chrome.scripting.executeScript({ target: { tabId: targetTab }, world: 'MAIN', func: (rKey) => { delete window[rKey]; }, args: [resultKey] });
                    chrome.tabs.sendMessage(senderTabId, { type: 'EVAL_JS_RESULT', callId: message.callId, ...val });
                  } else if (attempts++ < 100) {
                    setTimeout(poll, 50);
                  } else {
                    chrome.tabs.sendMessage(senderTabId, { type: 'EVAL_JS_RESULT', callId: message.callId, success: false, error: 'Nonce injection timeout (5s)' });
                  }
                }).catch(err => {
                  chrome.tabs.sendMessage(senderTabId, { type: 'EVAL_JS_RESULT', callId: message.callId, success: false, error: 'Poll error: ' + err.message });
                });
              };
              setTimeout(poll, 30); // 给注入的脚本一点执行时间
            }).catch(err => {
              console.error('[BG] Nonce injection failed:', err);
              chrome.tabs.sendMessage(senderTabId, { type: 'EVAL_JS_RESULT', callId: message.callId, success: false, error: 'Nonce injection failed: ' + err.message });
            });
          } else {
            // 正常结果，直接发回
            delete res.isCSP;
            chrome.tabs.sendMessage(senderTabId, { type: 'EVAL_JS_RESULT', callId: message.callId, ...res });
          }
        }).catch(err => {
          chrome.tabs.sendMessage(senderTabId, { type: 'EVAL_JS_RESULT', callId: message.callId, success: false, error: err.message });
        });
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: 'No tab id' });
      }
      break;

    case 'RELOAD_TOOLS':
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'reload_tools' }));
        console.log('[BG] 发送 reload_tools 请求');
        sendResponse({ success: true, message: '已发送刷新请求' });
      } else {
        sendResponse({ success: false, error: '未连接到服务器' });
      }
      break;
    
    case 'RESTART_SERVER':
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'restart_server' }));
        console.log('[BG] 发送服务器重启请求');
        sendResponse({ success: true, message: '服务器将在2秒后重启' });
        
        // 预期连接会断开，清理状态
        reconnectAttempts = 0;
      } else {
        sendResponse({ success: false, error: '未连接到服务器' });
      }
      break;
    
    case 'RESUME_TASK':
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'resume_task', taskId: message.taskId }));
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: '未连接到服务器' });
      }
      break;
    
    case 'TASK_STATUS':
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'task_status', taskId: message.taskId }));
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: '未连接到服务器' });
      }
      break;
    
    // ===== 录制相关 =====
    case 'START_RECORDING':
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: 'start_recording',
          recordingId: message.recordingId,
          name: message.name
        }));
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: '未连接到服务器' });
      }
      break;
    
    case 'STOP_RECORDING':
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'stop_recording', recordingId: message.recordingId }));
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: '未连接到服务器' });
      }
      break;
    
    case 'LIST_RECORDINGS':
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'list_recordings' }));
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: '未连接到服务器' });
      }
      break;
    
    case 'REPLAY_RECORDING':
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'replay_recording', recordingId: message.recordingId }));
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: '未连接到服务器' });
      }
      break;
    
    // ===== 目标驱动执行 =====
    case 'CREATE_GOAL':
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ 
          type: 'create_goal', 
          goalId: message.goalId,
          definition: message.definition 
        }));
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: '未连接到服务器' });
      }
      break;
    
    case 'EXECUTE_GOAL':
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'execute_goal', goalId: message.goalId }));
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: '未连接到服务器' });
      }
      break;
    
    case 'GOAL_STATUS':
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'goal_status', goalId: message.goalId }));
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: '未连接到服务器' });
      }
      break;
    
    case 'LIST_GOALS':
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'list_goals' }));
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: '未连接到服务器' });
      }
      break;
    
    case 'VALIDATED_EXECUTE':
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ 
          type: 'validated_execute', 
          tool: message.tool,
          params: message.params,
          options: message.options
        }));
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: '未连接到服务器' });
      }
      break;

    // ===== 异步命令执行 =====
    case 'ASYNC_EXECUTE':
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ 
          type: 'async_execute', 
          command: message.command,
          forceAsync: message.forceAsync,
          timeout: message.timeout
        }));
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: '未连接到服务器' });
      }
      break;

    case 'ASYNC_STATUS':
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'async_status', processId: message.processId }));
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: '未连接到服务器' });
      }
      break;

    case 'ASYNC_STOP':
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'async_stop', processId: message.processId }));
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: '未连接到服务器' });
      }
      break;

    case 'ASYNC_LOG':
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'async_log', processId: message.processId, tail: message.tail }));
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: '未连接到服务器' });
      }
      break;
    
    // ===== 跨 Tab 通信 =====
    
    case 'REGISTER_AGENT':
      if (message.agentId && sender.tab?.id) {
        registerAgent(message.agentId, sender.tab.id);
        sendResponse({ success: true, tabId: sender.tab.id });
      } else {
        sendResponse({ success: false, error: 'Missing agentId or tabId' });
      }
      break;
    
    case 'CROSS_TAB_SEND':
      if (message.to && message.message) {
        const fromAgent = tabAgents.get(sender.tab?.id) || 'tab_' + sender.tab.id;
        const result = sendCrossTabMessage(fromAgent, message.to, message.message);
        sendResponse(result);
      } else {
        sendResponse({ success: false, error: 'Missing to or message' });
      }
      break;
    
    case 'EVAL_IN_TAB':
      // Execute code in a tab matching the given URL pattern
      (async () => {
        try {
          const tabUrl = message.tabUrl || '';
          const code = message.code || '';
          
          // Find tab matching URL
          const tabs = await chrome.tabs.query({});
          const targetTab = tabs.find(t => t.url && t.url.includes(tabUrl));
          
          if (!targetTab) {
            sendResponse({ success: false, error: 'No tab found matching: ' + tabUrl });
            return;
          }
          
          // Execute script in the target tab (supports async code)
          const results = await chrome.scripting.executeScript({
            target: { tabId: targetTab.id },
            func: async (codeStr) => {
              try {
                const fn = new Function(codeStr);
                const result = fn();
                // If result is a Promise, await it
                if (result && typeof result.then === 'function') {
                  return await result;
                }
                return result;
              } catch(e) {
                return { error: e.message };
              }
            },
            args: [code],
            world: 'MAIN'
          });
          
          const result = results && results[0] ? results[0].result : null;
          sendResponse({ success: true, result });
        } catch(e) {
          console.error('[BG] EVAL_IN_TAB error:', e);
          sendResponse({ success: false, error: e.message });
        }
      })();
      break;

    case 'SWITCH_SERVER':
      const target = message.server || 'local';
      if (SERVERS[target]) {
        currentServer = target;
        console.log('[Agent] 切换服务器:', target, SERVERS[target]);
        if (socket) socket.close();
        setTimeout(connectWebSocket, 500);
        sendResponse({ success: true, server: target, url: SERVERS[target] });
      } else {
        sendResponse({ success: false, error: 'Unknown server: ' + target });
      }
      break;

    case 'GET_SERVER_INFO':
      sendResponse({ current: currentServer, servers: SERVERS });
      break;

    case 'RELOAD_EXTENSION':
      chrome.runtime.reload();
      break;

    case 'GET_REGISTERED_AGENTS':
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

    case 'UPLOAD_PAYLOAD': {
      const url = 'http://localhost:8766/upload-payload';
      const body = message.body || '';
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: body
      })
      .then(r => r.json())
      .then(result => {
        console.log('[BG] UPLOAD_PAYLOAD success:', result.path, result.size, 'bytes');
        sendResponse(result);
      })
      .catch(e => {
        console.log('[BG] UPLOAD_PAYLOAD failed:', e.message);
        sendResponse({ success: false, error: e.message });
      });
      break;
    }

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
}, 120000);  // 延长到120秒

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
