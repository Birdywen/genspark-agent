// content.js v32 - 添加 Agent 心跳机制，确保跨 Tab 通信可靠
(function() {
  'use strict';

  // 防止脚本重复加载
  if (window.__GENSPARK_AGENT_LOADED__) {
    console.log('[Agent] 已加载，跳过重复初始化');
    return;
  }
  window.__GENSPARK_AGENT_LOADED__ = true;

  const CONFIG = {
    SCAN_INTERVAL: 200,
    TIMEOUT_MS: 30000,
    MAX_RESULT_LENGTH: 50000,
    MAX_LOGS: 50,
    DEBUG: false,
    // Agent 协作：自动检查任务
    AUTO_CHECK_ENABLED: false,
    AUTO_CHECK_INTERVAL: 60000,  // 60秒检查一次
    AGENT_ID: null  // 由用户在对话中设定，如 'code_agent'
  };

  const state = {
    wsConnected: false,
    agentRunning: false,
    availableTools: [],
    availableSkills: [],
    skillsPrompt: "",
    executedCalls: new Set(),
    pendingCalls: new Map(),
    lastMessageText: '',
    lastStableTime: 0,
    execTimer: null,
    execStartTime: 0,
    // 消息队列
    messageQueue: [],
    isProcessingQueue: false,
    // 本地命令缓存（用于发送失败时重试）
    lastToolCall: null
  };

  function log(...args) {
    if (CONFIG.DEBUG) console.log('[Agent]', ...args);
  }

  // ============== AI 生成状态检测 ==============
  
  function isAIGenerating() {
    const stopBtnSelectors = [
      'button[aria-label*="stop" i]', 'button[aria-label*="停止" i]',
      'button.stop-button', 'button[class*="stop"]', '.stop-generating',
      '[data-testid="stop-button"]', '.generating-indicator', '.typing-indicator'
    ];
    for (const sel of stopBtnSelectors) {
      try {
        const btn = document.querySelector(sel);
        if (btn && btn.offsetParent !== null) return true;
      } catch (e) {}
    }
    const lastMsg = document.querySelector('.conversation-statement.assistant:last-child');
    if (lastMsg) {
      const cl = lastMsg.className.toLowerCase();
      if (cl.includes('streaming') || cl.includes('generating') || cl.includes('loading') || cl.includes('typing')) return true;
      if (lastMsg.querySelectorAll('.loading, .typing, .cursor, .blink, [class*="loading"], [class*="typing"]').length > 0) return true;
    }
    const globalInd = document.querySelectorAll('.generating, .loading-response, [class*="generating"], [class*="streaming"]');
    for (const el of globalInd) { if (el.offsetParent !== null) return true; }
    return false;
  }

  function waitForGenerationComplete(callback, maxWait = 30000) {
    const startTime = Date.now();
    const check = () => {
      if (Date.now() - startTime > maxWait) { callback(); return; }
      if (isAIGenerating()) { setTimeout(check, 200); }
      else { setTimeout(() => { if (!isAIGenerating()) callback(); else setTimeout(check, 200); }, 500); }
    };
    check();
  }

  // ============== 系统提示词模板 ==============
  
  function generateSystemPrompt() {
    const toolCount = state.availableTools.length || 67;
    const toolSummary = `本系统提供 ${toolCount} 个工具，分为 4 大类：
- **文件系统** (14个): read_file, write_file, edit_file, list_directory 等
- **浏览器自动化** (26个): navigate_page, click, fill, take_screenshot, evaluate_script 等  
- **命令执行** (1个): run_command
- **代码分析** (26个): register_project_tool, find_text, get_symbols 等

**需要查看完整工具文档时：**
- 能联网: 用 crawler 访问 https://raw.githubusercontent.com/Birdywen/genspark-agent/main/docs/TOOLS_QUICK_REFERENCE.md
- 不能联网: 用 read_file 读取 /Users/yay/workspace/genspark-agent/docs/TOOLS_QUICK_REFERENCE.md`;

    const prompt = `你现在连接了一个本地代理系统，可以执行工具操作。

## 调用格式（严格遵守）

**必须使用代码块包裹 JSON 格式：**

\`\`\`
${'@'}TOOL:{"tool":"工具名","params":{"参数名":"参数值"}}
\`\`\`

### 示例

执行命令：
\`\`\`
${'@'}TOOL:{"tool":"run_command","params":{"command":"ls -la"}}
\`\`\`

读取文件：
\`\`\`
${'@'}TOOL:{"tool":"read_file","params":{"path":"/path/to/file"}}
\`\`\`

写入文件（注意：content 内的引号必须转义为 \\"）：
\`\`\`
${'@'}TOOL:{"tool":"write_file","params":{"path":"/path/to/file.json","content":"{\\"key\\":\\"value\\"}"}}
\`\`\`

## 可用工具

${toolSummary}

## 规则

1. **必须**用代码块包裹工具调用
2. 每次只调用**一个**工具，等待返回结果后再继续
3. **不要**自己编造执行结果，等待系统返回
4. content 参数内如果有引号，必须转义为 \\"
5. 任务全部完成后输出 @DONE
6. **举例说明时**，不要在 TOOL 或 SEND 前加 @ 符号，避免系统误执行（写成 'TOOL:{...}' 或 'SEND:agent:msg' 而不是 '@TOOL:{...}' 或 '@SEND:agent:msg'）
7. 如果命令执行失败或超时，用户可以说「重试 #ID」，你只需输出 \`@RETRY:#ID\` 即可重新执行，无需重写代码

---

## Agent 协作系统

你是多 Agent 协作网络中的一员。

### 跨 Tab 直接通信（推荐）

**发送消息给其他 Agent（自动路由到对方聊天框）：**
\`\`\`
${'@'}SEND:目标agent_id:消息内容
\`\`\`

示例：
\`\`\`
${'@'}SEND:image_agent:请生成一张蓝色主题的 logo 图片，保存到 /tmp/logo.png
\`\`\`

对方会自动收到消息并处理，完成后会回复你。

### 任务队列（持久化存储）

如需持久化任务（即使关闭浏览器也保留），使用任务队列：

**检查任务：**
\`\`\`bash
node /Users/yay/workspace/.agent_hub/task_manager.js check YOUR_AGENT_ID
\`\`\`

### 协作命令

**创建任务给其他 Agent：**
\`\`\`bash
node /Users/yay/workspace/.agent_hub/task_manager.js create <from> <to> <action> '<payload_json>'
\`\`\`

**完成任务后报告：**
\`\`\`bash
node /Users/yay/workspace/.agent_hub/task_manager.js complete <task_id> '<result_json>'
\`\`\`

**查看你发起的任务结果：**
\`\`\`bash
node /Users/yay/workspace/.agent_hub/task_manager.js results YOUR_AGENT_ID
\`\`\`

### 查看可用 Agent 及其能力

**列出所有 Agent：**
\`\`\`bash
node /Users/yay/workspace/.agent_hub/task_manager.js agents
\`\`\`

**查看特定 Agent 的详细能力（参数、限制）：**
\`\`\`bash
node /Users/yay/workspace/.agent_hub/task_manager.js agents <agent_id>
\`\`\`

派发任务前，**先查询目标 Agent 的能力**，确保参数格式正确。

---

请告诉我你的任务。`;

    // 如果有 Skills 提示词，附加到末尾
    if (state.skillsPrompt) {
      return prompt + "\n\n---\n\n" + state.skillsPrompt;
    }
    return prompt;
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

  // ============== 消息队列处理 ==============
  
  function enqueueMessage(msg) {
    state.messageQueue.push(msg);
    addLog(`📥 消息入队 (队列长度: ${state.messageQueue.length})`, 'info');
    processMessageQueue();
  }
  
  function processMessageQueue() {
    if (state.isProcessingQueue || state.messageQueue.length === 0) {
      return;
    }
    
    state.isProcessingQueue = true;
    const msg = state.messageQueue.shift();
    
    addLog(`📤 处理队列消息 (剩余: ${state.messageQueue.length})`, 'info');
    sendMessageSafe(msg);
    
    // 等待 3 秒后处理下一条，给 AI 足够时间响应
    setTimeout(() => {
      state.isProcessingQueue = false;
      processMessageQueue();
    }, 3000);
  }

  function sendMessage(text) {
    const input = getInputBox();
    if (!input) {
      addLog('❌ 找不到输入框', 'error');
      return false;
    }

    input.focus();
    
    if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
      input.value = "";
      if (nativeSetter) { nativeSetter.call(input, text); } else { input.value = text; }
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
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

    const trySend = (attempt = 1) => {
      const btnSelectors = [
        '.enter-icon-wrapper',
        'div[class*=enter-icon]',
        'button[type="submit"]',
        'button.send-button',
        'button[aria-label*="send" i]',
        'button[aria-label*="发送"]',
        '.search-input-container button',
        'form button:not([type="button"])'
      ];
      
      // 按 Enter 发送
      const pressEnter = () => {
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
      };
      
      // v31.1: 先尝试 Enter，失败后多次重试点击按钮
      pressEnter();
      addLog('📤 Enter 发送', 'info');
      
      // 检查并重试发送的函数
      const checkAndRetry = (retryCount) => {
        const inp = getInputBox();
        if (!inp || !inp.value || inp.value.length <= 5) {
          // 发送成功了
          return;
        }
        
        if (retryCount <= 0) {
          addLog('⚠️ 发送失败，请手动点击', 'error');
          return;
        }
        
        // 尝试点击按钮
        let clicked = false;
        for (const sel of btnSelectors) {
          const btn = document.querySelector(sel);
          if (btn && !btn.disabled && btn.offsetParent !== null) {
            btn.click();
            clicked = true;
            addLog(`📤 点击按钮 (剩余重试: ${retryCount - 1})`, 'info');
            break;
          }
        }
        
        if (!clicked) {
          // 没找到按钮，再试 Enter
          pressEnter();
          addLog(`📤 重试 Enter (剩余: ${retryCount - 1})`, 'info');
        }
        
        // 500ms 后再检查
        setTimeout(() => checkAndRetry(retryCount - 1), 500);
      };
      
      // 300ms 后开始检查，最多重试 3 次
      setTimeout(() => checkAndRetry(3), 300);
      
      return true;  // Enter 已发送
    };

    // 第一次尝试发送（延迟 800ms 等待页面就绪）
    setTimeout(() => {
      const sent = trySend(1);
      if (!sent) {
        // 800ms 后检查输入框是否还有内容，有则重试
        setTimeout(() => {
          const currentInput = getInputBox();
          if (currentInput && currentInput.value && currentInput.value.length > 10) {
            addLog('🔄 重试发送...', 'info');
            trySend(2);
            // 再次检查
            setTimeout(() => {
              const inp = getInputBox();
              if (inp && inp.value && inp.value.length > 10) {
                addLog('⚠️ 请手动点击发送', 'error');
              } else {
                addLog('📤 已发送', 'info');
              }
            }, 500);
          } else {
            addLog('📤 已发送(Enter)', 'info');
          }
        }, 800);
      }
    }, 800);

    return true;
  }

  function sendMessageSafe(text) {
    if (isAIGenerating()) {
      addLog('⏳ 等待 AI 完成输出...', 'info');
      waitForGenerationComplete(() => sendMessage(text));
    } else {
      setTimeout(() => sendMessage(text), 300);
    }
  }

  // ============== 工具调用解析 ==============

  function isExampleToolCall(text, matchStart) {
    // 检查工具调用前 100 个字符
    const beforeText = text.substring(Math.max(0, matchStart - 20), matchStart).toLowerCase();
    // 检查工具调用后 50 个字符
    const afterText = text.substring(matchStart, Math.min(text.length, matchStart + 100)).toLowerCase();
    
    // 1. 示例关键词检测
    const exampleIndicators = [
      '示例：', '示例:', '例如：', '例如:',
      'example:', 'e.g.:', 'e.g.：',
      '格式如下', '格式为：', '格式为:',
      '比如', '譬如', 'such as', 'like this'
    ];
    
    for (const indicator of exampleIndicators) {
      if (beforeText.includes(indicator)) {
        return true;
      }
    }
    
    // 2. 检查是否在行内代码块中（被反引号包裹）
    // 查找匹配位置前最近的反引号情况
    const textBeforeMatch = text.substring(0, matchStart);
    const lastBacktick = textBeforeMatch.lastIndexOf('`');
    if (lastBacktick !== -1) {
      // 检查这个反引号后面到 matchStart 之间是否有配对的反引号
      const betweenText = textBeforeMatch.substring(lastBacktick + 1);
      // 如果没有配对的反引号，说明我们在代码块内
      if (!betweenText.includes('`')) {
        // 但要排除 ``` 代码块的情况（那是真正要执行的）
        const tripleBacktickBefore = textBeforeMatch.lastIndexOf('```');
        if (tripleBacktickBefore === -1 || tripleBacktickBefore < lastBacktick - 2) {
          return true;  // 在单反引号内，是示例
        }
      }
    }
    
    // 3. 检查是否是占位符格式（如 xxx, agent_id, 目标agent 等）
    const placeholderPatterns = [
      /:xxx:/i, /:agent_id:/i, /:目标/i, /:your/i,
      /\[.*agent.*\]/i, /<.*agent.*>/i
    ];
    for (const pattern of placeholderPatterns) {
      if (pattern.test(afterText)) {
        return true;
      }
    }
    
    // 4. 检查前文是否有解释性文字（通常示例前有冒号或解释）
    if (beforeText.match(/[：:。.]/)) {
      // 检查是否像是在解释格式
      if (beforeText.includes('格式') || beforeText.includes('写法') || 
          beforeText.includes('语法') || beforeText.includes('format')) {
        return true;
      }
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

  function extractJsonFromText(text, startIndex) {
    let depth = 0, inString = false, escapeNext = false, start = -1;
    for (let i = startIndex; i < text.length; i++) {
      const c = text[i];
      if (escapeNext) { escapeNext = false; continue; }
      if (c === "\\" && inString) { escapeNext = true; continue; }
      if (c === '"' && !escapeNext) { inString = !inString; continue; }
      if (inString) continue;
      if (c === '{') { if (depth === 0) start = i; depth++; }
      else if (c === '}') { depth--; if (depth === 0 && start !== -1) return { json: text.substring(start, i + 1), end: i + 1 }; }
    }
    return null;
  }

  // 解析新的代码块格式: @TOOL:name ... @TOOL:END
  function parseCodeBlockFormat(text) {
    const toolCalls = [];
    const regex = /@TOOL:(\w+)\s*\n([\s\S]*?)@TOOL:END/g;
    let match;
    
    while ((match = regex.exec(text)) !== null) {
      if (!isRealToolCall(text, match.index, match.index + match[0].length)) {
        continue;
      }
      
      const toolName = match[1];
      const body = match[2];
      const params = {};
      
      const pathMatch = body.match(/@PATH:\s*(.+)/);
      if (pathMatch) params.path = pathMatch[1].trim();
      
      const cmdMatch = body.match(/@COMMAND:\s*(.+)/);
      if (cmdMatch) params.command = cmdMatch[1].trim();
      
      const urlMatch = body.match(/@URL:\s*(.+)/);
      if (urlMatch) params.url = urlMatch[1].trim();
      
      const contentMatch = body.match(/@CONTENT:\s*\n```[\w]*\n([\s\S]*?)\n```/);
      if (contentMatch) {
        params.content = contentMatch[1];
      }
      
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

  function parseToolCalls(text) {
    // 优先尝试代码块格式 @TOOL:name ... @TOOL:END
    const codeBlockCalls = parseCodeBlockFormat(text);
    if (codeBlockCalls.length > 0) return codeBlockCalls;

    const toolCalls = [];
    let searchStart = 0;
    while (true) {
      const marker = '@TOOL:';
      const idx = text.indexOf(marker, searchStart);
      if (idx === -1) break;
      const extracted = extractJsonFromText(text, idx + marker.length);
      if (extracted) {
        try {
          // Fix Chinese quotes that break JSON parsing
          let jsonStr = extracted.json
            .replace(/[“”]/g, '"')  // Chinese double quotes to ASCII
            .replace(/[‘’]/g, "'"); // Chinese single quotes to ASCII
          const parsed = JSON.parse(jsonStr);
          if (parsed.tool && isRealToolCall(text, idx, idx + marker.length + extracted.json.length)) {
            toolCalls.push({ name: parsed.tool, params: parsed.params || {}, raw: marker + extracted.json, start: idx, end: idx + marker.length + extracted.json.length });
          }
        } catch (e) {
          console.error('[Agent] JSON parse error:', e.message);
          console.error('[Agent] Raw JSON:', extracted.json.slice(0, 300));
          addLog('JSON parse error: ' + e.message, 'error');
        }
        searchStart = extracted.end;
      } else { searchStart = idx + marker.length; }
    }
    if (toolCalls.length > 0) return toolCalls;

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
    
    const bracketRegex = /(\w+):\s*<<<([\s\S]*?)>>>/g;
    let bm;
    while ((bm = bracketRegex.exec(body)) !== null) {
      params[bm[1]] = bm[2].trim();
    }
    if (Object.keys(params).length > 0) {
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

  // ============== 执行指示器 ==============

  function showExecutingIndicator(toolName) {
    const el = document.getElementById("agent-executing");
    if (!el) return;
    state.execStartTime = Date.now();
    el.querySelector(".exec-tool").textContent = toolName;
    el.querySelector(".exec-time").textContent = "0.0s";
    el.classList.add("active");
    if (state.execTimer) clearInterval(state.execTimer);
    state.execTimer = setInterval(() => {
      const elapsed = ((Date.now() - state.execStartTime) / 1000).toFixed(1);
      const timeEl = document.querySelector("#agent-executing .exec-time");
      if (timeEl) timeEl.textContent = elapsed + "s";
    }, 100);
  }

  function hideExecutingIndicator() {
    const el = document.getElementById("agent-executing");
    if (el) el.classList.remove("active");
    if (state.execTimer) { clearInterval(state.execTimer); state.execTimer = null; }
  
  }

  // ============== 工具执行 ==============

  function executeRetry(historyId) {
    const callId = `retry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    
    state.agentRunning = true;
    showExecutingIndicator(`retry #${historyId}`);
    updateStatus();
    
    chrome.runtime.sendMessage({
      type: 'SEND_TO_SERVER',
      payload: { 
        type: 'retry', 
        historyId: historyId,
        id: callId 
      }
    });
    
    addLog(`🔄 重试 #${historyId}...`, 'tool');
    
    // 超时处理
    setTimeout(() => {
      if (state.agentRunning) {
        state.agentRunning = false;
        hideExecutingIndicator();
        updateStatus();
        addLog(`⏱️ 重试 #${historyId} 超时`, 'error');
        
        const timeoutResult = `**[重试结果]** \`#${historyId}\` ✗ 超时\n\n请稍后再试，或检查服务器状态。`;
        sendMessageSafe(timeoutResult);
      }
    }, CONFIG.TIMEOUT_MS);
  }

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
    showExecutingIndicator(tool.name);
    updateStatus();
    
    // 保存到本地缓存（发送失败时可用 retryLast 重试）
    state.lastToolCall = { tool: tool.name, params: tool.params, timestamp: Date.now() };
    
    // 检测消息大小（超过 500KB 可能有问题）
    const payloadSize = JSON.stringify(tool.params).length;
    if (payloadSize > 500000) {
      addLog(`⚠️ 内容过大 (${Math.round(payloadSize/1024)}KB)，可能发送失败`, 'error');
      addLog('💡 建议: 用 run_command + echo/cat 写入，或拆分内容', 'info');
    }
    
    try {
      chrome.runtime.sendMessage({
        type: 'SEND_TO_SERVER',
        payload: { 
          type: 'tool_call', 
          tool: tool.name, 
          params: tool.params, 
          id: callId 
        }
      }, (response) => {
        if (chrome.runtime.lastError) {
          addLog(`❌ 发送失败: ${chrome.runtime.lastError.message}`, 'error');
          state.pendingCalls.delete(callId);
          state.agentRunning = false;
          hideExecutingIndicator();
          updateStatus();
        } else if (!response?.success) {
          addLog('❌ 服务器未连接', 'error');
        }
      });
    } catch (e) {
      addLog(`❌ 消息发送异常: ${e.message}`, 'error');
      state.agentRunning = false;
      hideExecutingIndicator();
      updateStatus();
    }
    
    addLog(`🔧 ${tool.name}(${Object.keys(tool.params).join(',')})`, 'tool');
    
    setTimeout(() => {
      if (state.pendingCalls.has(callId)) {
        state.pendingCalls.delete(callId);
        state.agentRunning = false;
        hideExecutingIndicator();
        updateStatus();
        hideExecutingIndicator();
        addLog(`⏱️ ${tool.name} 超时`, "error");
        
        const timeoutResult = formatToolResult({
          tool: tool.name,
          success: false,
          error: `执行超时 (${CONFIG.TIMEOUT_MS / 1000}秒)`
        });
        sendMessageSafe(timeoutResult);
      }
    }, CONFIG.TIMEOUT_MS);
  }

  // ============== 扫描工具调用 ==============

  function scanForToolCalls() {
    if (state.agentRunning) return;
    
    // 如果 AI 正在生成中，跳过扫描
    if (isAIGenerating()) {
      log('AI 正在生成中，跳过扫描');
      return;
    }
    
    const { text, index } = getLatestAIMessage();
    
    if (index < 0 || !text) return;
    
    if (text.includes('**[执行结果]**') || text.includes('[执行结果]')) {
      return;
    }
    
    const toolStartCount = (text.match(/\[\[TOOL:/g) || []).length;
    const toolEndCount = (text.match(/\[\[\/TOOL\]\]/g) || []).length;
    
    if (toolStartCount > toolEndCount) {
      log('等待工具调用输出完成...');
      return;
    }
    
    if (state.lastMessageText !== text) {
      state.lastMessageText = text;
      state.lastStableTime = Date.now();
      return;
    }
    
    if (Date.now() - state.lastStableTime < 500) {
      return;
    }
    
    const { text: textNow } = getLatestAIMessage();
    if (textNow !== text) {
      state.lastMessageText = textNow;
      state.lastStableTime = Date.now();
      return;
    }
    
    // 检查重试命令 @RETRY:#ID
    const retryMatch = text.match(/@RETRY:\s*#?(\d+)/);
    if (retryMatch) {
      const retryId = parseInt(retryMatch[1]);
      const retryHash = `${index}:retry:${retryId}`;
      if (!state.executedCalls.has(retryHash)) {
        state.executedCalls.add(retryHash);
        addLog(`🔄 重试命令 #${retryId}`, 'tool');
        executeRetry(retryId);
        return;
      }
    }
    
    // 先检查跨 Tab 发送命令 @SEND:agent_id:message
    // 排除示例、代码块内、引用中的 @SEND
    const sendMatch = text.match(/@SEND:([\w_]+):([\s\S]+?)(?=@SEND:|@TOOL:|@DONE|$)/);
    const isExampleSend = sendMatch && isExampleToolCall(text, sendMatch.index);
    if (sendMatch && !isExampleSend) {
      const sendHash = `${index}:send:${sendMatch[1]}:${sendMatch[2].slice(0,50)}`;
      if (!state.executedCalls.has(sendHash)) {
        state.executedCalls.add(sendHash);
        const toAgent = sendMatch[1];
        const message = sendMatch[2].trim();
        addLog(`📨 发送给 ${toAgent}...`, 'tool');
        sendToAgent(toAgent, message);
        setTimeout(() => {
          sendMessageSafe(`**[跨Tab通信]** 已发送消息给 \`${toAgent}\`\n\n请继续其他任务，或等待对方回复。`);
        }, 500);
        return;
      }
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
    
    if (text.includes('@DONE') || text.includes('[[DONE]]')) {
      const doneHash = `done:${index}`;
      if (!state.executedCalls.has(doneHash)) {
        state.executedCalls.add(doneHash);
        state.agentRunning = false;
        hideExecutingIndicator();
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
    
    const tips = [
      '举例时不加@: 写 TOOL:{...} 而非 @TOOL:{...}',
      '每次只调用一个工具，等结果后再继续',
      '工具详情: read_file /Users/yay/workspace/genspark-agent/docs/TOOLS_QUICK_REFERENCE.md',
      '浏览器操作前先 take_snapshot 获取 uid',
      '跨Agent通信: @SEND:agent_id:消息',
      'edit_file 比 write_file 更安全(只改局部)'
    ];
    const tip = tips[Math.floor(Math.random() * tips.length)];
    
    return `**[执行结果]** \`${msg.tool}\` ${status}:
\`\`\`
${content}
\`\`\`
${tip}
请根据上述结果继续。如果任务已完成，请输出 @DONE`;
  }

  // ============== UI ==============

  function createPanel() {
    if (document.getElementById('agent-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'agent-panel';
    panel.innerHTML = `
      <div id="agent-header">
        <span id="agent-title">🤖 Agent v32</span>
        <span id="agent-id" title="点击查看在线Agent" style="cursor:pointer;font-size:10px;color:#9ca3af;margin-left:4px"></span>
        <span id="agent-status">初始化</span>
      </div>
      <div id="agent-executing"><span class="exec-spinner">⚙️</span><span class="exec-tool">工具名</span><span class="exec-time">0.0s</span></div>
      <div id="agent-tools"></div>
      <div id="agent-logs"></div>
      <div id="agent-actions">
        <button id="agent-copy-prompt" title="复制系统提示词给AI">📋 提示词</button>
        <button id="agent-clear" title="清除日志">🗑️</button>
        <button id="agent-retry-last" title="重试上一个命令">🔁 重试</button>
        <button id="agent-reconnect" title="重连服务器">🔄</button>
        <button id="agent-list" title="查看在线Agent">👥</button>
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
      #agent-executing { display: none; padding: 10px 12px; margin-bottom: 10px; background: linear-gradient(90deg, #1e3a5f 0%, #2d4a6f 50%, #1e3a5f 100%); background-size: 200% 100%; animation: shimmer 2s infinite linear; border-radius: 8px; font-size: 12px; color: #93c5fd; border: 1px solid #3b82f6; }
      #agent-executing.active { display: flex; align-items: center; gap: 8px; }
      #agent-executing .exec-spinner { animation: spin 1s linear infinite; font-size: 14px; }
      #agent-executing .exec-tool { flex: 1; font-weight: 600; color: #60a5fa; }
      #agent-executing .exec-time { font-family: monospace; color: #fbbf24; font-weight: 600; font-size: 13px; }
      @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
      @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
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
        hideExecutingIndicator();
      state.lastMessageText = '';
      updateStatus();
      addLog('🗑️ 已重置', 'info');
    };
    
    document.getElementById('agent-retry-last').onclick = () => {
      if (!state.lastToolCall) {
        addLog('❌ 没有可重试的命令', 'error');
        return;
      }
      const { tool, params, timestamp } = state.lastToolCall;
      const age = Math.round((Date.now() - timestamp) / 1000);
      addLog(`🔁 重试 ${tool} (${age}秒前)`, 'info');
      
      // 重新执行
      const callId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      state.agentRunning = true;
      showExecutingIndicator(tool);
      updateStatus();
      
      chrome.runtime.sendMessage({
        type: 'SEND_TO_SERVER',
        payload: { type: 'tool_call', tool, params, id: callId }
      }, (response) => {
        if (chrome.runtime.lastError || !response?.success) {
          addLog('❌ 重试发送失败', 'error');
          state.agentRunning = false;
          hideExecutingIndicator();
          updateStatus();
        }
      });
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

    // 查看在线 Agent 列表
    document.getElementById('agent-list').onclick = () => {
      chrome.runtime.sendMessage({ type: 'GET_REGISTERED_AGENTS' }, (resp) => {
        if (chrome.runtime.lastError) {
          addLog(`❌ 查询失败: ${chrome.runtime.lastError.message}`, 'error');
          return;
        }
        if (resp?.success && resp.agents) {
          if (resp.agents.length === 0) {
            addLog('📭 暂无在线 Agent', 'info');
          } else {
            const list = resp.agents.map(a => `${a.agentId}(Tab:${a.tabId})`).join(', ');
            addLog(`👥 在线: ${list}`, 'info');
          }
        } else {
          addLog('❌ 查询失败', 'error');
        }
      });
    };

    // 点击 Agent ID 也显示在线列表
    document.getElementById('agent-id').onclick = () => {
      document.getElementById('agent-list').click();
    };

    makeDraggable(panel);
  }

  // 更新面板上的 Agent ID 显示
  function updateAgentIdDisplay() {
    const el = document.getElementById('agent-id');
    if (el) {
      el.textContent = agentId ? `[${agentId}]` : '[未设置]';
      el.style.color = agentId ? '#10b981' : '#9ca3af';
    }
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
    const cats = {};
    state.availableTools.forEach(t => {
      const name = t.name || t;
      const p = name.includes('_') ? name.split('_')[0] : 'other';
      cats[p] = (cats[p] || 0) + 1;
    });
    const sum = Object.entries(cats).map(([k,v]) => k + ':' + v).join(' ');
    el.style.display = 'block';
    el.innerHTML = '🔧 ' + state.availableTools.length + ' 工具 | ' + sum;
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
        if (msg.skills) { state.availableSkills = msg.skills; }
        if (msg.skillsPrompt) { state.skillsPrompt = msg.skillsPrompt; }
        break;

      case 'update_tools':
        if (msg.tools && msg.tools.length > 0) {
          state.availableTools = msg.tools;
          updateToolsDisplay();
          addLog(`📦 加载了 ${msg.tools.length} 个工具`, 'info');
        }
        if (msg.skills) { state.availableSkills = msg.skills; }
        if (msg.skillsPrompt) { state.skillsPrompt = msg.skillsPrompt; }
        break;

      case 'tool_result':
        // 去重：用 tool + 结果内容生成 hash
        const resultHash = `result:${msg.tool}:${msg.id || ''}:${JSON.stringify(msg.result || msg.error).slice(0,100)}`;
        if (state.executedCalls.has(resultHash)) {
          log('跳过重复的 tool_result:', msg.tool);
          break;
        }
        state.executedCalls.add(resultHash);
        
        // 用 msg.id 精确匹配，而不是用 tool 名称
        if (msg.id && state.pendingCalls.has(msg.id)) {
          state.pendingCalls.delete(msg.id);
        } else {
          // 回退：按 tool 名称匹配（兼容旧版本）
          for (const [id, call] of state.pendingCalls) {
            if (call.tool === msg.tool) {
              state.pendingCalls.delete(id);
              break;
            }
          }
        }
        
        addLog(`📥 ${msg.tool}: ${msg.success ? '成功' : '失败'}`, msg.success ? 'result' : 'error');
        
        state.agentRunning = false;
        hideExecutingIndicator();
        updateStatus();
        
        const resultText = formatToolResult(msg);
        // 发送去重：同样内容 5 秒内不重复发送
        const sendHash = `send:${resultText.slice(0, 100)}`;
        if (state.executedCalls.has(sendHash)) {
          log('跳过重复发送');
          break;
        }
        state.executedCalls.add(sendHash);
        setTimeout(() => {
          state.executedCalls.delete(sendHash);  // 5秒后允许再次发送
        }, 5000);
        sendMessageSafe(resultText);
        break;

      case 'error':
        addLog(`❌ ${msg.message || '未知错误'}`, 'error');
        state.agentRunning = false;
        hideExecutingIndicator();
        updateStatus();
        break;
      
      // 跨 Tab 消息
      case 'CROSS_TAB_MESSAGE':
        // 检查是否是回执消息（不注入聊天框，只显示日志）
        if (msg.message && msg.message.startsWith('✅ [回执]')) {
          addLog(`📬 ${msg.message}`, 'success');
          break;
        }
        
        addLog(`📩 收到来自 ${msg.from} 的消息`, 'success');
        
        // 发送回执给发送方
        chrome.runtime.sendMessage({
          type: 'CROSS_TAB_SEND',
          to: msg.from,
          message: `✅ [回执] ${agentId || '对方'} 已收到消息，正在处理...`
        });
        
        const crossTabMsg = `**[来自 ${msg.from} 的消息]**\n\n${msg.message}\n\n---\n请处理上述消息。完成后可以用 @SEND:${msg.from}:回复内容 来回复。`;
        // 使用消息队列，避免多条消息同时到达时互相覆盖
        setTimeout(() => {
          enqueueMessage(crossTabMsg);
        }, 500);
        break;
    }

    sendResponse({ ok: true });
    return true;
  });

  // ============== 初始化 ==============

  // ============== 自动检查任务 ==============

  let autoCheckTimer = null;
  let agentId = null;

  // ============== 跨 Tab 通信 ==============

  let heartbeatTimer = null;
  const HEARTBEAT_INTERVAL = 30000; // 30秒心跳

  // 向 background 注册（内部函数，不显示日志）
  function doRegister(id, silent = false) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'REGISTER_AGENT',
        agentId: id
      }, (resp) => {
        if (chrome.runtime.lastError) {
          if (!silent) addLog(`❌ 注册失败: ${chrome.runtime.lastError.message}`, 'error');
          resolve(false);
        } else if (resp?.success) {
          if (!silent) addLog(`🏷️ 已注册为 ${id}`, 'success');
          resolve(true);
        } else {
          if (!silent) addLog(`❌ 注册失败: ${resp?.error}`, 'error');
          resolve(false);
        }
      });
    });
  }

  function registerAsAgent(id) {
    agentId = id;
    CONFIG.AGENT_ID = id;
    
    // 保存到 sessionStorage（每个 Tab 独立）和 chrome.storage（持久化备份）
    sessionStorage.setItem('agentId', id);
    chrome.storage.local.set({ ['agentId_' + id]: true }, () => {
      console.log('[Agent] 身份已保存:', id);
    });
    
    doRegister(id);
    startHeartbeat();
  }

  // 心跳机制：定期重新注册，防止 background 重启后丢失
  function startHeartbeat() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      if (agentId) {
        doRegister(agentId, true); // 静默注册
        console.log('[Agent] 💓 心跳注册:', agentId);
      }
    }, HEARTBEAT_INTERVAL);
    console.log('[Agent] 心跳已启动，间隔', HEARTBEAT_INTERVAL/1000, '秒');
  }

  // Tab 可见性变化时重新注册
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && agentId) {
      console.log('[Agent] Tab 恢复可见，重新注册');
      doRegister(agentId, true);
    }
  });

  // 从 storage 恢复 Agent ID
  function restoreAgentId() {
    // 优先从 sessionStorage 读取（Tab 独立）
    const savedId = sessionStorage.getItem('agentId');
    if (savedId) {
      agentId = savedId;
      CONFIG.AGENT_ID = savedId;
      addLog(`🔄 已恢复身份: ${savedId}`, 'info');
      doRegister(savedId);
      startHeartbeat();
      updateAgentIdDisplay();
    }
  }

  // 发送前确保自己已注册，然后发送消息
  async function sendToAgent(toAgentId, message) {
    // 先确保自己已注册
    if (agentId) {
      await doRegister(agentId, true);
    }
    
    chrome.runtime.sendMessage({
      type: 'CROSS_TAB_SEND',
      to: toAgentId,
      message: message
    }, (resp) => {
      if (chrome.runtime.lastError) {
        addLog(`❌ 发送失败: ${chrome.runtime.lastError.message}`, 'error');
      } else if (resp?.success) {
        addLog(`📨 已发送给 ${toAgentId}`, 'success');
      } else {
        addLog(`❌ 发送失败: ${resp?.error}`, 'error');
      }
    });
  }

  function startAutoCheck() {
    if (!CONFIG.AUTO_CHECK_ENABLED) return;
    if (autoCheckTimer) clearInterval(autoCheckTimer);
    
    autoCheckTimer = setInterval(() => {
      if (state.agentRunning) return;  // 正在执行中，跳过
      if (!agentId) return;  // 未设置 Agent ID，跳过
      if (!state.wsConnected) return;  // 未连接，跳过
      
      // 检查是否有待处理任务
      addLog(`🔍 自动检查任务 (${agentId})`, 'info');
      sendMessageSafe(`检查是否有分配给我的任务：\n\`\`\`\n@TOOL:{"tool":"run_command","params":{"command":"node /Users/yay/workspace/.agent_hub/task_manager.js check ${agentId}"}}\n\`\`\``);
    }, CONFIG.AUTO_CHECK_INTERVAL);
    
    addLog(`⏰ 自动检查已启动 (${CONFIG.AUTO_CHECK_INTERVAL/1000}秒)`, 'info');
  }

  function setAgentId(id) {
    agentId = id;
    CONFIG.AGENT_ID = id;
    registerAsAgent(id);  // 向 background.js 注册
    updateAgentIdDisplay();
    startAutoCheck();
  }

  // 监听页面内容，检测 Agent ID 设置
  function detectAgentId(text) {
    // 匹配 "你是 xxx_agent" 或 "I am xxx_agent" 等模式
    const patterns = [
      /你是\s*[`'"]?(\w+_agent)[`'"]?/i,
      /我是\s*[`'"]?(\w+_agent)[`'"]?/i,
      /I am\s*[`'"]?(\w+_agent)[`'"]?/i,
      /agent.?id[：:=]\s*[`'"]?(\w+_agent)[`'"]?/i,
      /设置.*身份.*[`'"]?(\w+_agent)[`'"]?/i
    ];
    
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1] && match[1] !== agentId) {
        setAgentId(match[1]);
        return true;
      }
    }
    return false;
  }

  function init() {
    log('初始化 Agent v31 (Genspark)');
    
    createPanel();

    setInterval(scanForToolCalls, CONFIG.SCAN_INTERVAL);
    
    // 监听用户消息，检测 Agent ID（只检测用户自己发的消息，不检测系统注入的消息）
    let lastCheckedUserMsgCount = 0;
    setInterval(() => {
      const userMessages = document.querySelectorAll('.conversation-statement.user');
      if (userMessages.length > lastCheckedUserMsgCount) {
        const lastUserMsg = userMessages[userMessages.length - 1];
        const text = lastUserMsg.innerText || '';
        // 排除跨 Tab 消息的内容
        if (!text.includes('[来自') && !text.includes('[跨Tab通信]')) {
          detectAgentId(text);
        }
        lastCheckedUserMsgCount = userMessages.length;
      }
    }, 1000);

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
          if (resp.skills) { state.availableSkills = resp.skills; }
          if (resp.skillsPrompt) { state.skillsPrompt = resp.skillsPrompt; }
          updateStatus();
        }
      });
    }, 500);

    addLog('🚀 Agent v31 已启动', 'success');
    addLog('💡 点击「📋 提示词」复制给AI', 'info');
    
    // 恢复之前保存的 Agent 身份
    restoreAgentId();
    
    // 初始化 Agent ID 显示
    setTimeout(updateAgentIdDisplay, 100);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 100);
  }

})();
