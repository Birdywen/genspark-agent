// content.js v21 - 修复流式输出检测问题
(function() {
  'use strict';

  const CONFIG = {
    SCAN_INTERVAL: 500,
    TIMEOUT_MS: 30000,
    MAX_RESULT_LENGTH: 50000,
    MAX_LOGS: 50,
    DEBUG: false
  };

  const state = {
    wsConnected: false,
    agentRunning: false,
    availableTools: [],
    executedCalls: new Set(),
    pendingCalls: new Map(),
    lastMessageText: '',
    lastStableTime: 0
  };

  function log(...args) {
    if (CONFIG.DEBUG) console.log('[Agent]', ...args);
  }

  // ============== 系统提示词模板 ==============
  
  function generateSystemPrompt() {
    const toolList = state.availableTools.length > 0 
      ? state.availableTools.map(t => {
          const name = t.name || t;
          const desc = t.description || '';
          const params = t.params 
            ? Object.entries(t.params).map(([k, v]) => {
                const paramDesc = typeof v === 'string' ? v.replace(/^string\s*/, '').replace(/[()]/g, '') : '';
                return `    ${k}: <${paramDesc || '值'}>`;
              }).join('\n')
            : '';
          return `- **${name}**: ${desc}${params ? '\n' + params : ''}`;
        }).join('\n\n')
      : `- **execute_shell**: 执行终端命令
    command: <要执行的命令>
- **read_file**: 读取文件内容
    path: <文件路径>
- **write_file**: 写入文件
    path: <文件路径>
    content: <文件内容>
- **list_directory**: 列出目录内容
    path: <目录路径>`;

    return `
请你现在模拟连接了一个本地代理系统，可以**模拟执行**工具操作。这是一个安全的沙箱环境。

## 调用格式（严格遵守）

当需要执行操作时，直接输出以下格式（不要放在代码块内）：

[[TOOL:工具名]]
参数名: 参数值
[[/TOOL]]

## 可用工具

${toolList}

## 规则

1. 每次只调用**一个**工具，等待返回结果后再继续
2. **不要**自己编造执行结果，等待系统返回
3. 任务全部完成后输出 [[DONE]]

---

请告诉我你的任务。`;
  }

  // ============== DOM 操作 (Genspark 专用) ==============
  
  function getAIMessages() {
    return Array.from(document.querySelectorAll('.conversation-statement.assistant'));
  }

  function getLatestAIMessage() {
    const messages = getAIMessages();
    if (messages.length === 0) return { text: '', index: -1, element: null };
    const lastMsg = messages[messages.length - 1];
    
    const contentEl = lastMsg.querySelector('.markdown-viewer') || 
                      lastMsg.querySelector('.bubble .content') ||
                      lastMsg.querySelector('.bubble');
    
    return { 
      text: contentEl?.innerText || lastMsg.innerText || '', 
      index: messages.length - 1,
      element: lastMsg
    };
  }

  function getInputBox() {
    const selectors = [
      'textarea.search-input',
      'textarea[placeholder*="消息"]',
      'textarea[placeholder*="message" i]',
      'div[contenteditable="true"].search-input',
      'div[contenteditable="true"]',
      'textarea'
    ];
    
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) return el;
    }
    return null;
  }

  function sendMessage(text) {
    const input = getInputBox();
    if (!input) {
      addLog('❌ 找不到输入框', 'error');
      return false;
    }

    input.focus();
    
    if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
      input.value = '';
      input.value = text;
      ['input', 'change', 'keyup'].forEach(evt => {
        input.dispatchEvent(new Event(evt, { bubbles: true, composed: true }));
      });
    } else {
      input.innerHTML = '';
      input.innerText = text;
      input.dispatchEvent(new InputEvent('input', { 
        bubbles: true, 
        composed: true,
        data: text,
        inputType: 'insertText'
      }));
    }

    setTimeout(() => {
      const btnSelectors = [
        'button[type="submit"]',
        'button.send-button',
        'button[aria-label*="send" i]',
        'button[aria-label*="发送"]',
        '.search-input-container button',
        'form button:not([type="button"])'
      ];
      
      for (const sel of btnSelectors) {
        const btn = document.querySelector(sel);
        if (btn && !btn.disabled && btn.offsetParent !== null) {
          btn.click();
          addLog('📤 已发送', 'info');
          return;
        }
      }
      
      ['keydown', 'keypress', 'keyup'].forEach(type => {
        input.dispatchEvent(new KeyboardEvent(type, {
          key: 'Enter',
          code: 'Enter', 
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true
        }));
      });
      addLog('📤 已发送(Enter)', 'info');
    }, 250);

    return true;
  }

  // ============== 工具调用解析 ==============

  function isExampleToolCall(text, matchStart) {
    const beforeText = text.substring(Math.max(0, matchStart - 300), matchStart).toLowerCase();
    
    const exampleIndicators = [
      '示例', '例如', '比如', '例子', '格式如下', '格式为', '格式：', '格式:',
      'example', 'e.g.', 'for instance', 'such as', 'like this',
      '演示', '说明', '语法', 'syntax', 'format',
      '模板', 'template', '以下是格式', '调用格式', '使用方法',
      '## 调用', '## 格式', '## 示例', '## example',
      '可用工具', '工具列表', '支持的工具',
      '```'  // 代码块标记
    ];
    
    for (const indicator of exampleIndicators) {
      if (beforeText.includes(indicator)) {
        return true;
      }
    }
    
    // 检查是否在代码块内
    const textBeforeMatch = text.substring(0, matchStart);
    const codeBlockCount = (textBeforeMatch.match(/```/g) || []).length;
    if (codeBlockCount % 2 === 1) {
      return true;
    }
    
    return false;
  }

  function isRealToolCall(text, matchStart, matchEnd) {
    if (isExampleToolCall(text, matchStart)) {
      log('跳过示例工具调用');
      return false;
    }
    
    const afterText = text.substring(matchEnd, matchEnd + 150);
    if (afterText.includes('[执行结果]') || afterText.includes('执行结果')) {
      log('跳过已执行的工具调用');
      return false;
    }
    
    return true;
  }

  function parseToolCalls(text) {
    const toolCalls = [];
    
    // Format 1: [[TOOL:name param="value"]] 单行格式
    const inlineRegex = /\[\[TOOL:(\w+)((?:\s+\w+="[^"]*")+)\s*\]\]/g;
    let match;
    
    while ((match = inlineRegex.exec(text)) !== null) {
      if (!isRealToolCall(text, match.index, match.index + match[0].length)) {
        continue;
      }
      
      const params = {};
      const paramRegex = /(\w+)="([^"]*)"/g;
      let paramMatch;
      while ((paramMatch = paramRegex.exec(match[2])) !== null) {
        params[paramMatch[1]] = paramMatch[2];
      }
      
      if (Object.keys(params).length > 0) {
        toolCalls.push({ 
          name: match[1], 
          params, 
          raw: match[0],
          start: match.index,
          end: match.index + match[0].length
        });
      }
    }
    
    if (toolCalls.length > 0) return toolCalls;
    
    // Format 2: [[TOOL:name]]...[[/TOOL]] 块格式
    const blockRegex = /\[\[TOOL:(\w+)\]\]([\s\S]*?)\[\[\/TOOL\]\]/g;
    
    while ((match = blockRegex.exec(text)) !== null) {
      if (!isRealToolCall(text, match.index, match.index + match[0].length)) {
        continue;
      }
      
      const toolName = match[1];
      const body = match[2].trim();
      const params = parseParams(body);
      
      if (Object.keys(params).length > 0) {
        toolCalls.push({ 
          name: toolName, 
          params, 
          raw: match[0],
          start: match.index,
          end: match.index + match[0].length
        });
      }
    }
    
    return toolCalls;
  }

  function parseParams(body) {
const params = {};
body = body.trim();
// 支持 <<<>>> 边界符格式 (用于 edit_file)
const bracketRegex = /(\w+):\s*<<<([\s\S]*?)>>>/g;
let bm;
while ((bm = bracketRegex.exec(body)) !== null) {
params[bm[1]] = bm[2].trim();
}
if (Object.keys(params).length > 0) {
// 提取普通参数 (如 path: xxx)
const cleanBody = body.replace(/\w+:\s*<<<[\s\S]*?>>>/g, '');
const lines = cleanBody.split(/\n/).map(l => l.trim()).filter(Boolean);
for (const line of lines) {
const m = line.match(/^(\w+):\s*(.+)$/);
if (m && !params[m[1]]) params[m[1]] = m[2].trim();
}
return params;
}
    let lines = body.split(/\n/).map(l => l.trim()).filter(Boolean);
    
    if (lines.length >= 2) {
      // 多行模式 - 原有逻辑
      let currentKey = null;
      let currentValue = [];
      for (const line of lines) {
        const match = line.match(/^(\w+):\s*(.*)$/);
        if (match) {
          if (currentKey) { params[currentKey] = currentValue.join('\n').trim(); }
          currentKey = match[1];
          currentValue = match[2] ? [match[2]] : [];
        } else if (currentKey) { currentValue.push(line); }
      }
      if (currentKey) { params[currentKey] = currentValue.join('\n').trim(); }
    } else {
      // 单行模式 - 处理换行符串失或变空格的情况
      const text = lines[0] || '';
      const knownKeys = ['path', 'content', 'command', 'url', 'directory', 'pattern', 'body', 'headers'];
      const keyPositions = [];
      for (const key of knownKeys) {
        const regex = new RegExp('\\b' + key + ':\\s*');
        const match = regex.exec(text);
        if (match) { keyPositions.push({ key, start: match.index, valueStart: match.index + match[0].length }); }
      }
      keyPositions.sort((a, b) => a.start - b.start);
      for (let i = 0; i < keyPositions.length; i++) {
        const curr = keyPositions[i];
        const next = keyPositions[i + 1];
        const valueEnd = next ? next.start : text.length;
        params[curr.key] = text.substring(curr.valueStart, valueEnd).trim();
      }
    }
    return params;
  }

  // ============== 工具执行 ==============

  function executeToolCall(tool, callHash) {
    const callId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    
    state.pendingCalls.set(callId, {
      tool: tool.name,
      params: tool.params,
      timestamp: Date.now(),
      hash: callHash
    });
    
    state.agentRunning = true;
    state.executedCalls.add(callHash);
    updateStatus();
    
    chrome.runtime.sendMessage({
      type: 'SEND_TO_SERVER',
      payload: { 
        type: 'tool_call', 
        tool: tool.name, 
        params: tool.params, 
        id: callId 
      }
    });
    
    addLog(`🔧 ${tool.name}(${Object.keys(tool.params).join(',')})`, 'tool');
    
    setTimeout(() => {
      if (state.pendingCalls.has(callId)) {
        state.pendingCalls.delete(callId);
        state.agentRunning = false;
        updateStatus();
        addLog(`⏱️ ${tool.name} 超时`, 'error');
        
        const timeoutResult = formatToolResult({
          tool: tool.name,
          success: false,
          error: `执行超时 (${CONFIG.TIMEOUT_MS / 1000}秒)`
        });
        setTimeout(() => sendMessage(timeoutResult), 300);
      }
    }, CONFIG.TIMEOUT_MS);
  }

  // ============== 扫描工具调用 (核心修复) ==============

  function scanForToolCalls() {
    if (state.agentRunning) return;
    
    const { text, index } = getLatestAIMessage();
    
    if (index < 0 || !text) return;
    
    // 检查消息是否已处理过（用内容hash而不是index）
    const contentHash = `${index}:${text.length}:${text.slice(-100)}`;
    
    // 跳过包含执行结果的消息（这是我们发送的）
    if (text.includes('**[执行结果]**') || text.includes('[执行结果]')) {
      return;
    }
    
    // 关键修复：检查是否有未闭合的工具调用（流式输出中）
    const toolStartCount = (text.match(/\[\[TOOL:/g) || []).length;
    const toolEndCount = (text.match(/\[\[\/TOOL\]\]/g) || []).length;
    
    if (toolStartCount > toolEndCount) {
      // 工具调用还没输出完，等待
      log('等待工具调用输出完成...');
      return;
    }
    
    // 检查消息是否还在变化（流式输出）
    if (state.lastMessageText !== text) {
      state.lastMessageText = text;
      state.lastStableTime = Date.now();
      return;
    }
    // 等待 150ms 稳定期，确保流式输出完成
    if (Date.now() - state.lastStableTime < 150) {
      return;
    }
    
    const toolCalls = parseToolCalls(text);
    
    for (const tool of toolCalls) {
      const callHash = `${index}:${tool.name}:${JSON.stringify(tool.params)}`;
      
      if (state.executedCalls.has(callHash)) {
        continue;
      }
      
      log('检测到工具调用:', tool.name, tool.params);
      
      executeToolCall(tool, callHash);
      return;
    }
    
    // 检查任务完成标记
    if (text.includes('[[DONE]]')) {
      const doneHash = `done:${index}`;
      if (!state.executedCalls.has(doneHash)) {
        state.executedCalls.add(doneHash);
        state.agentRunning = false;
        state.pendingCalls.clear();
        updateStatus();
        addLog('✅ 任务完成', 'success');
      }
    }
  }

  // ============== 结果格式化 ==============

  function formatToolResult(msg) {
    let content;
    
    if (msg.success) {
      if (typeof msg.result === 'string') {
        content = msg.result;
      } else if (msg.result?.stdout !== undefined) {
        content = msg.result.stdout || '(空输出)';
        if (msg.result.stderr) {
          content += '\n[stderr]: ' + msg.result.stderr;
        }
      } else {
        content = JSON.stringify(msg.result, null, 2);
      }
    } else {
      content = `错误: ${msg.error || msg.result?.stderr || '未知错误'}`;
    }
    
    if (content.length > CONFIG.MAX_RESULT_LENGTH) {
      content = content.slice(0, CONFIG.MAX_RESULT_LENGTH) + '\n...(内容已截断)';
    }
    
    const status = msg.success ? '✓ 成功' : '✗ 失败';
    
    return `**[执行结果]** \`${msg.tool}\` ${status}:
\`\`\`
${content}
\`\`\`
请根据上述结果继续。如果任务已完成，请输出 [[DONE]]`;
  }

  // ============== UI ==============

  function createPanel() {
    if (document.getElementById('agent-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'agent-panel';
    panel.innerHTML = `
      <div id="agent-header">
        <span id="agent-title">🤖 Agent v21</span>
        <span id="agent-status">初始化</span>
      </div>
      <div id="agent-tools"></div>
      <div id="agent-logs"></div>
      <div id="agent-actions">
        <button id="agent-copy-prompt" title="复制系统提示词给AI">📋 提示词</button>
        <button id="agent-clear" title="清除日志">🗑️</button>
        <button id="agent-reconnect" title="重连服务器">🔄</button>
        <button id="agent-minimize" title="最小化">➖</button>
      </div>
    `;
    
    document.body.appendChild(panel);

    const style = document.createElement('style');
    style.textContent = `
      #agent-panel {
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 300px;
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        border: 1px solid #0f3460;
        border-radius: 12px;
        padding: 12px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 12px;
        color: #e4e4e7;
        z-index: 2147483647;
        box-shadow: 0 8px 32px rgba(0,0,0,0.4);
        transition: all 0.3s ease;
      }
      #agent-panel.minimized {
        width: auto;
        padding: 8px 12px;
      }
      #agent-panel.minimized #agent-tools,
      #agent-panel.minimized #agent-logs,
      #agent-panel.minimized #agent-actions button:not(#agent-minimize) {
        display: none !important;
      }
      #agent-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
        padding-bottom: 8px;
        border-bottom: 1px solid #0f3460;
      }
      #agent-title { font-weight: 600; font-size: 13px; }
      #agent-status {
        padding: 3px 10px;
        border-radius: 12px;
        font-size: 11px;
        font-weight: 500;
        background: #6b7280;
        color: white;
      }
      #agent-status.connected { background: #10b981; }
      #agent-status.running { background: #f59e0b; animation: pulse 1.5s infinite; }
      #agent-status.disconnected { background: #ef4444; }
      @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
      #agent-tools {
        font-size: 11px;
        color: #9ca3af;
        margin-bottom: 8px;
        padding: 6px 8px;
        background: rgba(255,255,255,0.05);
        border-radius: 6px;
        display: none;
      }
      #agent-tools code {
        background: #3730a3;
        padding: 1px 4px;
        border-radius: 3px;
        margin: 0 2px;
        font-size: 10px;
      }
      #agent-logs {
        max-height: 180px;
        overflow-y: auto;
        margin-bottom: 10px;
        padding: 8px;
        background: rgba(0,0,0,0.3);
        border-radius: 8px;
      }
      .agent-log-entry {
        margin-bottom: 4px;
        padding: 4px 6px;
        border-radius: 4px;
        background: rgba(255,255,255,0.03);
        border-left: 3px solid;
        font-size: 11px;
        line-height: 1.4;
        word-break: break-all;
      }
      .agent-log-entry.info { border-color: #3b82f6; }
      .agent-log-entry.success { border-color: #10b981; }
      .agent-log-entry.error { border-color: #ef4444; }
      .agent-log-entry.tool { border-color: #8b5cf6; }
      .agent-log-entry.result { border-color: #06b6d4; }
      .agent-log-time { color: #6b7280; font-size: 9px; margin-right: 4px; }
      #agent-actions { display: flex; gap: 6px; flex-wrap: wrap; }
      #agent-actions button {
        flex: 1;
        min-width: 60px;
        padding: 6px 8px;
        border: none;
        border-radius: 6px;
        background: #374151;
        color: #e4e4e7;
        cursor: pointer;
        font-size: 11px;
        transition: all 0.2s;
      }
      #agent-actions button:hover { background: #4b5563; }
      #agent-copy-prompt { background: #3730a3 !important; }
      #agent-copy-prompt:hover { background: #4338ca !important; }
    `;
    document.head.appendChild(style);

    document.getElementById('agent-clear').onclick = () => {
      document.getElementById('agent-logs').innerHTML = '';
      state.executedCalls.clear();
      state.pendingCalls.clear();
      state.agentRunning = false;
      state.lastMessageText = '';
      updateStatus();
      addLog('🗑️ 已重置', 'info');
    };
    
    document.getElementById('agent-reconnect').onclick = () => {
      chrome.runtime.sendMessage({ type: 'RECONNECT' });
      addLog('🔄 重连中...', 'info');
    };
    
    document.getElementById('agent-copy-prompt').onclick = () => {
      const prompt = generateSystemPrompt();
      navigator.clipboard.writeText(prompt).then(() => {
        addLog('📋 提示词已复制', 'success');
      }).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = prompt;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        addLog('📋 提示词已复制', 'success');
      });
    };
    
    document.getElementById('agent-minimize').onclick = () => {
      const panel = document.getElementById('agent-panel');
      const btn = document.getElementById('agent-minimize');
      panel.classList.toggle('minimized');
      btn.textContent = panel.classList.contains('minimized') ? '➕' : '➖';
    };

    makeDraggable(panel);
  }

  function makeDraggable(el) {
    const header = el.querySelector('#agent-header');
    let isDragging = false;
    let startX, startY, startLeft, startBottom;
    
    header.style.cursor = 'move';
    
    header.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON' || e.target.id === 'agent-status') return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      startLeft = el.offsetLeft;
      startBottom = window.innerHeight - el.offsetTop - el.offsetHeight;
      e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      el.style.left = (startLeft + e.clientX - startX) + 'px';
      el.style.bottom = (startBottom - e.clientY + startY) + 'px';
      el.style.right = 'auto';
    });
    
    document.addEventListener('mouseup', () => { isDragging = false; });
  }

  function updateStatus() {
    const el = document.getElementById('agent-status');
    if (!el) return;
    
    el.classList.remove('connected', 'running', 'disconnected');
    
    if (state.agentRunning) {
      el.textContent = '执行中...';
      el.classList.add('running');
    } else if (state.wsConnected) {
      el.textContent = '已就绪';
      el.classList.add('connected');
    } else {
      el.textContent = '未连接';
      el.classList.add('disconnected');
    }
  }

  function updateToolsDisplay() {
    const el = document.getElementById('agent-tools');
    if (!el) return;
    
    if (state.availableTools.length === 0) {
      el.style.display = 'none';
      return;
    }
    
    el.style.display = 'block';
    el.innerHTML = '🔧 ' + state.availableTools.map(t => `<code>${t.name || t}</code>`).join(' ');
  }

  function addLog(msg, type = 'info') {
    const logs = document.getElementById('agent-logs');
    if (!logs) return;
    
    const time = new Date().toLocaleTimeString('en-US', { 
      hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' 
    });
    
    const entry = document.createElement('div');
    entry.className = `agent-log-entry ${type}`;
    entry.innerHTML = `<span class="agent-log-time">${time}</span>${msg.replace(/</g, '&lt;')}`;
    
    logs.appendChild(entry);
    logs.scrollTop = logs.scrollHeight;
    
    while (logs.children.length > CONFIG.MAX_LOGS) {
      logs.removeChild(logs.firstChild);
    }
  }

  // ============== 消息监听 ==============

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    log('收到消息:', msg.type, msg);

    switch (msg.type) {
      case 'WS_STATUS':
        state.wsConnected = msg.connected;
        updateStatus();
        addLog(msg.connected ? '✓ 服务器已连接' : '✗ 服务器断开', msg.connected ? 'success' : 'error');
        break;

      case 'connected':
        state.wsConnected = true;
        if (msg.tools) {
          state.availableTools = msg.tools;
          updateToolsDisplay();
        }
        updateStatus();
        addLog('✓ 连接成功', 'success');
        break;

      case 'update_tools':
        if (msg.tools && msg.tools.length > 0) {
          state.availableTools = msg.tools;
          updateToolsDisplay();
          addLog(`📦 加载了 ${msg.tools.length} 个工具`, 'info');
        }
        break;

      case 'tool_result':
        for (const [id, call] of state.pendingCalls) {
          if (call.tool === msg.tool) {
            state.pendingCalls.delete(id);
            break;
          }
        }
        
        addLog(`📥 ${msg.tool}: ${msg.success ? '成功' : '失败'}`, msg.success ? 'result' : 'error');
        
        state.agentRunning = false;
        updateStatus();
        
        const resultText = formatToolResult(msg);
        setTimeout(() => sendMessage(resultText), 300);
        break;

      case 'error':
        addLog(`❌ ${msg.message || '未知错误'}`, 'error');
        state.agentRunning = false;
        updateStatus();
        break;
    }

    sendResponse({ ok: true });
    return true;
  });

  // ============== 初始化 ==============

  function init() {
    log('初始化 Agent v21 (Genspark)');
    
    createPanel();

    setInterval(scanForToolCalls, CONFIG.SCAN_INTERVAL);

    setTimeout(() => {
      chrome.runtime.sendMessage({ type: 'GET_WS_STATUS' }, resp => {
        if (chrome.runtime.lastError) {
          log('获取状态失败:', chrome.runtime.lastError);
          return;
        }
        if (resp) {
          state.wsConnected = resp.connected;
          if (resp.tools) {
            state.availableTools = resp.tools;
            updateToolsDisplay();
          }
          updateStatus();
        }
      });
    }, 500);

    addLog('🚀 Agent v21 已启动', 'success');
    addLog('💡 点击「📋 提示词」复制给AI', 'info');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 100);
  }

})();