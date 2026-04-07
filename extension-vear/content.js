// content.js v35 - REC增强 - Ω标记格式 - 添加 Agent 心跳机制，确保跨 Tab 通信可靠
(function() { console.log('=== GENSPARK AGENT v35 LOADED ===');
  'use strict';

  // 防止脚本重复加载
  if (window.__GENSPARK_AGENT_LOADED__) {
    console.log('[Agent] 已加载，跳过重复初始化');
    return;
  }
  window.__GENSPARK_AGENT_LOADED__ = true;

  const CONFIG = {
    SCAN_INTERVAL: 200,
    TIMEOUT_MS: 120000,
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
    executedCalls: new Set(JSON.parse(localStorage.getItem('agent_executed_calls') || '[]')),
    pendingCalls: new Map(),
    lastMessageText: '',
    lastStableTime: 0,
    execTimer: null,
    execStartTime: 0,
    // 消息队列
    messageQueue: [],
    isProcessingQueue: false,
    roundCount: parseInt(localStorage.getItem('agent_round_count') || '0'),
    // 本地命令缓存（用于发送失败时重试）
    lastToolCall: null,
    // 批量任务状态
    batchResults: [],
    currentBatchId: null,
    currentBatchTotal: 0,
    // 输出结束确认
    generatingFalseCount: 0,
    // 统计
    totalCalls: 0,
    sessionStart: Date.now()
  };

  // 辅助函数：添加已执行命令并持久化
  function addExecutedCall(hash) {
    state.executedCalls.add(hash);
    // 只保留最近 500 条记录，防止 localStorage 膨胀
    const arr = Array.from(state.executedCalls).slice(-500);
    localStorage.setItem('agent_executed_calls', JSON.stringify(arr));
  }

  // 加载面板增强模块
  function loadPanelEnhancer() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('panel-enhancer.js');
    script.onload = () => {
      if (window.PanelEnhancer) {
        window.PanelEnhancer.init();
        console.log('[Agent] PanelEnhancer 已加载');
      }
    };
    document.head.appendChild(script);
  }

  
  // 改进的 JSON 解析函数 - 处理长内容和特殊字符
  function safeJsonParse(jsonStr) {
    let fixed = jsonStr
      .replace(/[""]/g, '"')
      .replace(/['']/g, "'");
    
    try {
      return JSON.parse(fixed);
    } catch (e1) {
      // 尝试修复字符串内的换行符
      try {
        let result = '', inString = false, escape = false;
        for (let i = 0; i < fixed.length; i++) {
          const c = fixed[i];
          if (escape) { result += c; escape = false; continue; }
          if (c === '\\') { result += c; escape = true; continue; }
          if (c === '"') { inString = !inString; result += c; continue; }
          if (inString && c === '\n') { result += '\\n'; continue; }
          if (inString && c === '\r') { result += '\\r'; continue; }
          if (inString && c === '\t') { result += '\\t'; continue; }
          result += c;
        }
        return JSON.parse(result);
      } catch (e2) {
        // 最后尝试：提取工具名和简单参数
        const toolMatch = fixed.match(/"tool"\s*:\s*"(\w+)"/);
        const pathMatch = fixed.match(/"path"\s*:\s*"([^"]+)"/);
        const cmdMatch = fixed.match(/"command"\s*:\s*"([^"]+)"/);
        if (toolMatch) {
          const params = {};
          if (pathMatch) params.path = pathMatch[1];
          if (cmdMatch) params.command = cmdMatch[1];
          console.warn('[Agent] Partial parse for tool:', toolMatch[1]);
          return { tool: toolMatch[1], params, _partialParse: true };
        }
        throw e1;
      }
    }
  }

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
    const toolCount = state.availableTools.length || 131;
    const toolSummary = `本系统提供 ${toolCount} 个工具，分为 4 大类：
- **文件系统** (14个): read_file, write_file, edit_file, list_directory, read_multiple_files 等
- **浏览器自动化** (26个): browser_navigate, browser_snapshot, browser_click, browser_type 等  
- **命令执行** (1个): run_command
- **代码分析** (26个): register_project_tool, find_text, get_symbols, find_usage 等`;

    const prompt = `## 身份

你连接了 **genspark-agent** 本地代理系统 (v1.0.52+)，可执行文件操作、命令、浏览器自动化等。

---

## 工具调用格式

所有工具调用必须用代码块包裹。文字说明和代码块之间必须留一个空行。

### 单个工具

\`\`\`
Ω{"tool":"工具名","params":{"参数":"值"}}ΩSTOP
\`\`\`

### 批量执行 (ΩBATCH) v1.0.52+

\`\`\`
ΩBATCH{"steps":[
  {"tool":"工具1","params":{...},"saveAs":"变量名"},
  {"tool":"工具2","params":{...},"when":{"var":"变量名","success":true}}
],"stopOnError":false}ΩEND
\`\`\`

when 条件: success / contains / regex（注意用 var 不是 variable）

### 高级调度

- ΩPLAN{"goal":"...","context":{...}} — 智能规划
- ΩFLOW{"template":"模板名","variables":{...}} — 工作流模板
- ΩRESUME{"taskId":"任务ID"} — 断点续传

---

## 核心规则

1. 代码块包裹所有工具调用，等待结果再继续
2. 多个独立操作用 ΩBATCH 批量执行
3. 永远不要假设或编造执行结果
4. 任务完成输出 @DONE
5. JSON 中的引号使用 \\"

---

## 实战指南

### 命令转义（避免转义地狱）

- 简单命令 → 直接写 command
- 有引号/特殊字符 → 用 stdin: {"command":"python3","stdin":"print(123)"}
- 多行脚本 → 用 stdin: {"command":"bash","stdin":"脚本内容"}
- 超长脚本 → write_file 到 /private/tmp/ 再执行

### 代码修改

- 1-20 行小修改 → edit_file
- 20+ 行或结构性修改 → write_file
- 不确定 → 先 read_file 查看再决定
- 修改后必须验证语法: JS 用 node -c，Python 用 python3 -m py_compile

### 批量执行黄金法则

适合批量: 查询操作、API调用、环境检查、简单命令
不适合批量: write_file长内容(>50行)、edit_file复杂修改、巨大输出
推荐模式: 批量收集信息 → 单独执行关键操作 → 批量验证结果

### 长内容处理

超过50行或含大量特殊字符时，用 run_command + stdin (python3/bash) 写入。

---

## 工作流程

### 新对话上下文恢复

涉及以下项目时先恢复上下文（直接写项目名，不用尖括号）:
- genspark-agent / ezmusicstore / oracle-cloud

\`\`\`
Ω{"tool":"run_command","params":{"command":"node /Users/yay/workspace/.agent_memory/memory_manager_v2.js digest 项目名"}}ΩSTOP
\`\`\`

### TODO 机制

必须创建: 用户列出多项任务、跨会话长期任务、复杂开发任务
不需要: 探索性工作、即时操作、自然延伸
位置: /Users/yay/workspace/TODO.md

### 错误处理

不编造结果，错误后先分析原因再重试，最多2次。
工具未找到→检查拼写 | 权限拒绝→检查路径 | 文件不存在→list_directory确认

---

## 环境

### 可用工具

${toolSummary}

### 系统

- macOS arm64 (Apple Silicon)
- 可用: pandoc, ffmpeg, ImageMagick, jq, sqlite3, git, python3, node/npm, rg, fd, curl, wget
- 允许目录: /Users/yay/workspace, /Users/yay/Documents, /tmp

### 远程与运维

- SSH 禁止 run_command+ssh，使用 ssh-oracle:exec / ssh-cpanel:exec
- 服务器重启: curl http://localhost:8766/restart 或 touch /tmp/genspark-restart-trigger
- 查看所有工具: node /Users/yay/workspace/genspark-agent/server-v2/list-tools.js

### 其他标记

- 重试: @RETRY:#ID
- 协作: ΩSEND:目标agent:消息内容ΩSENDEND
`;

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
    // 更新最后消息时间（用于超时唤醒检测）
    if (typeof updateLastAiMessageTime === 'function') {
      updateLastAiMessageTime();
    }
    
    if (isAIGenerating()) {
      addLog('⏳ 等待 AI 完成输出...', 'info');
      waitForGenerationComplete(() => sendMessage(text));
    } else {
      // 增加延迟到 800ms，确保页面完全稳定后再发送
      setTimeout(() => {
        // 再次检查是否正在生成
        if (isAIGenerating()) {
          addLog('⏳ 检测到 AI 开始输出，等待完成...', 'info');
          waitForGenerationComplete(() => sendMessage(text));
        } else {
          sendMessage(text);
        }
      }, 800);
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

  // 解析新的代码块格式: Ωname ... ΩEND
  function parseCodeBlockFormat(text) {
    const toolCalls = [];
    const regex = /Ω(\w+)\s*\n([\s\S]*?)ΩEND/g;
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

  
  // 方案3: 解析 ```tool 代码块
  function parseToolCodeBlock(text) {
    console.log('[Agent] parseToolCodeBlock called, text length:', text.length);
    console.log('[Agent] looking for tool blocks...');
    const calls = [];
    const re = /```tool\s*\n([\s\S]*?)\n```/g;
    console.log('[Agent] regex test:', re.test(text));
    let m;
    while ((m = re.exec(text)) !== null) {
      try {
        const json = m[1].trim().replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
        const p = safeJsonParse(json);
        if (p.tool) calls.push({ name: p.tool, params: p.params || {}, raw: m[0], start: m.index, end: m.index + m[0].length });
      } catch (e) { console.error('[Agent] tool block error:', e.message); }
    }
    return calls;
  }

  // 辅助函数: 提取平衡的 JSON 对象 (支持任意嵌套)
  function extractBalancedJson(text, marker, fromEnd = false) {
    const idx = fromEnd ? text.lastIndexOf(marker) : text.indexOf(marker);
    if (idx === -1) return null;
    const jsonStart = text.indexOf('{', idx + marker.length);
    if (jsonStart === -1) return null;
    // 严格检查: marker 和 { 之间只能有空白字符
    const between = text.slice(idx + marker.length, jsonStart);
    if (between.trim() !== '') return null;
    let depth = 0, inStr = false, esc = false;
    for (let i = jsonStart; i < text.length; i++) {
      const ch = text[i];
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{') depth++;
      if (ch === '}') { depth--; if (depth === 0) return { json: text.slice(jsonStart, i+1), start: idx, end: i+1 }; }
    }
    return null;
  }

    function parseToolCalls(text) {
    // 优先检查 ΩBATCH 批量格式（支持 ΩBATCH{...}ΩEND 或 ΩBATCH{...} 格式）
    const batchStartIdx = text.indexOf('ΩBATCH');
    if (batchStartIdx !== -1 && !state.executedCalls.has('batch:' + batchStartIdx)) {
      // 跳过示例中的 ΩBATCH
      const beforeBatch = text.substring(Math.max(0, batchStartIdx - 100), batchStartIdx);
      const isExample = /格式[：:]|示例|用法|如下|Example|前缀/.test(beforeBatch);
      if (!isExample) {
        try {
          // 尝试找 ΩEND 结束标记
          const jsonStart = text.indexOf('{', batchStartIdx);
          let jsonEnd = text.indexOf('ΩEND', jsonStart);
          let batchJson;
          if (jsonEnd !== -1) {
            // 有 ΩEND 标记，直接截取
            batchJson = text.substring(jsonStart, jsonEnd).trim();
          } else {
            // 没有 ΩEND，使用平衡括号匹配
            const batchData = extractBalancedJson(text, 'ΩBATCH');
            if (batchData) batchJson = batchData.json;
          }
          if (batchJson) {
            batchJson = batchJson.replace(/[""]/g, '"').replace(/['']/g, "'");
            const batch = safeJsonParse(batchJson);
            if (batch.steps && Array.isArray(batch.steps)) {
              const endPos = jsonEnd !== -1 ? jsonEnd + 4 : batchStartIdx + 6 + batchJson.length;
              return [{
                name: '__BATCH__',
                params: batch,
                raw: text.substring(batchStartIdx, endPos),
                start: batchStartIdx,
                end: endPos,
                isBatch: true
              }];
            }
          }
        } catch (e) {
          if (CONFIG.DEBUG) console.log('[Agent] ΩBATCH parse skip:', e.message);
        }
      }
    }

    // ========== ΩPLAN ==========
    const planData = extractBalancedJson(text, 'ΩPLAN', true);
    if (planData && !state.executedCalls.has('plan:' + planData.start)) {
      const beforePlan = text.substring(Math.max(0, planData.start - 30), planData.start);
      // 只检查紧邻的前文是否包含文档关键词
      if (!beforePlan.includes('格式') && !beforePlan.includes('示例') && !beforePlan.includes('例如')) {
        try {
          const plan = safeJsonParse(planData.json);
          if (plan) return [{ name: '__PLAN__', params: plan, raw: 'ΩPLAN' + planData.json, start: planData.start, end: planData.end, isPlan: true }];
        } catch (e) {}
      }
    }

    // ========== ΩFLOW ==========
    const flowData = extractBalancedJson(text, 'ΩFLOW', true);
    if (flowData && !state.executedCalls.has('flow:' + flowData.start)) {
      const beforeFlow = text.substring(Math.max(0, flowData.start - 30), flowData.start);
      if (!beforeFlow.includes('格式') && !beforeFlow.includes('示例') && !beforeFlow.includes('例如')) {
        try {
          const flow = safeJsonParse(flowData.json);
          if (flow) return [{ name: '__FLOW__', params: flow, raw: 'ΩFLOW' + flowData.json, start: flowData.start, end: flowData.end, isFlow: true }];
        } catch (e) {}
      }
    }

    // ========== ΩRESUME ==========
    const resumeData = extractBalancedJson(text, 'ΩRESUME', true);
    if (resumeData && !state.executedCalls.has('resume:' + resumeData.start)) {
      const beforeResume = text.substring(Math.max(0, resumeData.start - 30), resumeData.start);
      if (!beforeResume.includes('格式') && !beforeResume.includes('示例') && !beforeResume.includes('例如')) {
        try {
          const resume = safeJsonParse(resumeData.json);
          if (resume) return [{ name: '__RESUME__', params: resume, raw: 'ΩRESUME' + resumeData.json, start: resumeData.start, end: resumeData.end, isResume: true }];
        } catch (e) {}
      }
    }

    // 方案3: 优先解析 ```tool 代码块
    const toolBlockCalls = parseToolCodeBlock(text);
    if (toolBlockCalls.length > 0) return toolBlockCalls;

    // 兼容旧格式: Ωname ... ΩEND
    const codeBlockCalls = parseCodeBlockFormat(text);
    if (codeBlockCalls.length > 0) return codeBlockCalls;

    const toolCalls = [];
    let searchStart = 0;
    while (true) {
      const marker = 'Ω';
      const idx = text.indexOf(marker, searchStart);
      if (idx === -1) break;
      
      // 检查前面100字符是否包含示例关键词
      const beforeMarker = text.substring(Math.max(0, idx - 100), idx);
      const isExample = /格式[：:]|示例：|例如：|Example:|e.g./.test(beforeMarker);
      if (isExample) {
        searchStart = idx + marker.length;
        continue;
      }
      
      // 检查是否紧跟 {"tool":
      const afterMarker = text.substring(idx + marker.length, idx + marker.length + 10);
      if (!afterMarker.match(/^\s*\{\s*"tool"/)) {
        searchStart = idx + marker.length;
        continue;
      }
      const extracted = extractJsonFromText(text, idx + marker.length);
      if (extracted) {
        // Skip if extracted JSON is too short or looks invalid
        if (!extracted.json || extracted.json.length < 5 || !extracted.json.startsWith('{')) {
          searchStart = idx + marker.length;
          continue;
        }
        try {
          // Fix Chinese quotes that break JSON parsing
          let jsonStr = extracted.json
            .replace(/[“”]/g, '"')  // Chinese double quotes to ASCII
            .replace(/[‘’]/g, "'"); // Chinese single quotes to ASCII
          const parsed = safeJsonParse(jsonStr);
          if (parsed.tool) {
            // 检查是否有 ΩSTOP 结束标记
            const afterJson = text.substring(idx + marker.length + extracted.json.length, idx + marker.length + extracted.json.length + 10);
            const hasStop = afterJson.trim().startsWith('ΩSTOP');
            if (!hasStop) {
              // 强制要求 ΩSTOP 结束标记，没有则跳过
              searchStart = idx + marker.length + extracted.json.length;
              continue;
            }
            const endPos = idx + marker.length + extracted.json.length + afterJson.indexOf('ΩSTOP') + 5;
            toolCalls.push({ name: parsed.tool, params: parsed.params || {}, raw: text.substring(idx, endPos), start: idx, end: endPos, hasStopMarker: true });
          }
        } catch (e) {
          if (CONFIG.DEBUG) console.log('[Agent] JSON parse skip:', e.message);
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

  // ============== 工具调用检测 ==============
  let expectingToolCall = false;
  let toolCallWarningTimer = null;

  function startToolCallDetection() {
    if (toolCallWarningTimer) clearTimeout(toolCallWarningTimer);
    expectingToolCall = true;
    toolCallWarningTimer = setTimeout(() => {
      if (expectingToolCall) {
        // 静默失败，不显示任何提示
        expectingToolCall = false;
      }
    }, 2000);
  }

  function clearToolCallDetection() {
    if (toolCallWarningTimer) {
      clearTimeout(toolCallWarningTimer);
      toolCallWarningTimer = null;
    }
    expectingToolCall = false;
  }

  // ============== 工具执行 ==============

  function executeRetry(historyId) {
    clearToolCallDetection();
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

  // 执行批量工具调用
  function executeBatchCall(batch, callHash) {
    clearToolCallDetection();
    const batchId = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    
    state.agentRunning = true;
    addExecutedCall(callHash);
    state.batchResults = [];  // 重置批量结果
    state.currentBatchId = batchId;
    state.currentBatchTotal = batch.steps.length;
    
    showExecutingIndicator(`批量 (${batch.steps.length} 步)`);
    updateStatus();
    
    // 显示进度条
    if (window.PanelEnhancer) {
      window.PanelEnhancer.showBatchProgress(batchId, batch.steps.length);
    }
    
    addLog(`📦 开始批量执行: ${batch.steps.length} 个步骤`, 'tool');
    
    chrome.runtime.sendMessage({
      type: 'SEND_TO_SERVER',
      payload: {
        type: 'tool_batch',
        id: batchId,
        steps: batch.steps,
        options: batch.options || { stopOnError: true }
      }
    }, (response) => {
      if (chrome.runtime.lastError) {
        addLog(`❌ 批量发送失败: ${chrome.runtime.lastError.message}`, 'error');
        state.agentRunning = false;
        hideExecutingIndicator();
        updateStatus();
        if (window.PanelEnhancer) window.PanelEnhancer.hideProgress();
      } else if (response?.success) {
        addLog(`📤 批量任务已提交: ${batchId}`, 'info');
      } else {
        addLog('❌ 批量任务提交失败', 'error');
        state.agentRunning = false;
        hideExecutingIndicator();
        updateStatus();
        if (window.PanelEnhancer) window.PanelEnhancer.hideProgress();
      }
    });
  }


  function executeToolCall(tool, callHash) {
    console.log('[Agent-DEBUG] executeToolCall:', tool.name, callHash);
    clearToolCallDetection();
    const callId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    
    state.pendingCalls.set(callId, {
      tool: tool.name,
      params: tool.params,
      timestamp: Date.now(),
      hash: callHash
    });
    
    state.agentRunning = true;
    addExecutedCall(callHash);
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
    // console.log("[Agent] scanning...");
    if (state.agentRunning) return;
    
    // 如果 AI 正在生成中，重置确认计数器并跳过
    if (isAIGenerating()) {
      state.generatingFalseCount = 0;
      log('AI 正在生成中，跳过扫描');
      return;
    }
    
    // 要求连续 3 次 (约600ms) isAIGenerating()=false 才确认输出结束
    state.generatingFalseCount++;
    if (state.generatingFalseCount < 3) {
      return;
    }
    
    const { text, index } = getLatestAIMessage();
    
    if (index < 0 || !text) return;
    
    // 检测到新消息，重置所有计时器
    if (state.lastMessageText !== text) {
      state.lastMessageText = text;
      state.lastStableTime = Date.now();
      state.generatingFalseCount = 0;
      startToolCallDetection();
      return;
    }
    
    // Removed: result check (conflicts with code containing these chars)
    
    const toolStartCount = (text.match(/\[\[TOOL:/g) || []).length;
    const toolEndCount = (text.match(/\[\[\/TOOL\]\]/g) || []).length;
    
    if (toolStartCount > toolEndCount) {
      log('等待工具调用输出完成...');
      return;
    }
    
    // 文本稳定窗口: 1000ms 无变化
    if (Date.now() - state.lastStableTime < 1000) {
      return;
    }
    
    // 最终快照确认: 再取一次文本，确保真的没变
    const { text: textNow } = getLatestAIMessage();
    if (textNow !== text) {
      state.lastMessageText = textNow;
      state.lastStableTime = Date.now();
      state.generatingFalseCount = 0;
      return;
    }
    
    // 检查重试命令 @RETRY:#ID
    const retryMatch = text.match(/@RETRY:\s*#?(\d+)/);


    if (retryMatch) {
      const retryId = parseInt(retryMatch[1]);
      const retryHash = `${index}:retry:${retryId}`;
      if (!state.executedCalls.has(retryHash)) {
        addExecutedCall(retryHash);
        addLog(`🔄 重试命令 #${retryId}`, 'tool');
        executeRetry(retryId);
        return;
      }
    }
    
    // 检查录制命令 @REC:action:name
    const recMatch = text.match(/@REC:(start|stop|list|play)(?::([^:\s]+))?(?::([\{\[][^\s]*))?/);
    if (recMatch) {
      const recHash = `${index}:rec:${recMatch[0]}`;
      if (!state.executedCalls.has(recHash)) {
        addExecutedCall(recHash);
        const action = recMatch[1];
        const name = recMatch[2] || '';
        
        switch (action) {
          case 'start':
            if (name) {
              addLog(`🎬 开始录制: ${name}`, 'tool');
              chrome.runtime.sendMessage({ type: 'SEND_TO_SERVER', payload: { type: 'start_recording', name: name, description: '' } });
              state.currentRecordingId = name;
            } else {
              addLog('❌ 请指定录制名称: @REC:start:名称', 'error');
            }
            break;
          case 'stop':
            addLog('⏹️ 停止录制', 'tool');
            chrome.runtime.sendMessage({ type: 'SEND_TO_SERVER', payload: { type: 'stop_recording', recordingId: state.currentRecordingId || name } });
            state.currentRecordingId = null;
            break;
          case 'list':
            addLog('📼 获取录制列表...', 'tool');
            chrome.runtime.sendMessage({ type: 'SEND_TO_SERVER', payload: { type: 'list_recordings' } });
            break;
          case 'play':
            if (name) {
              console.log('[REC DEBUG] recMatch:', recMatch);
              const extraParam = recMatch[3];
              console.log('[REC DEBUG] extraParam:', extraParam);
              let playMsg = { type: 'replay_recording', recordingId: name };
              let paramInfo = '';
              
              if (extraParam) {
                try {
                  const parsed = JSON.parse(extraParam);
                  if (Array.isArray(parsed)) {
                    // 循环模式: @REC:play:名称:["a","b","c"]
                    playMsg.foreach = parsed;
                    paramInfo = ` (循环 ${parsed.length} 次)`;
                  } else if (typeof parsed === 'object') {
                    // 参数模式: @REC:play:名称:{"server":"oracle"}
                    playMsg.variables = parsed;
                    paramInfo = ` (参数: ${Object.keys(parsed).join(', ')})`;
                  }
                } catch (e) {
                  addLog(`⚠️ 参数解析失败: ${e.message}`, 'warning');
                }
              }
              
              addLog(`▶️ 回放录制: ${name}${paramInfo}`, 'tool');
              chrome.runtime.sendMessage({ type: 'SEND_TO_SERVER', payload: playMsg });
            } else {
              addLog('❌ 请指定录制名称: @REC:play:名称', 'error');
            }
            break;
        }
        return;
      }
    }
    
    // 先检查跨 Tab 发送命令 ΩSEND:agent_id:message
    // 排除示例、代码块内、引用中的 @SEND
    const sendMatch = text.match(/ΩSEND:([\w_]+):([\s\S]+?)ΩSENDEND/);
    const isExampleSend = sendMatch && isExampleToolCall(text, sendMatch.index);
    const timeSinceStable = Date.now() - state.lastStableTime;
    if (sendMatch && !isExampleSend && timeSinceStable >= 3000) {
      const sendHash = `${index}:send:${sendMatch[1]}:${sendMatch[2].slice(0,50)}`;
      if (!state.executedCalls.has(sendHash)) {
        addExecutedCall(sendHash);
        const toAgent = sendMatch[1];
        const message = sendMatch[2].trim();
        addLog(`📨 发送给 ${toAgent}...`, 'tool');
        sendToAgent(toAgent, message);
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
      
      // 判断是否为批量调用
      if (tool.isBatch && tool.name === '__BATCH__') {
        executeBatchCall(tool.params, callHash);
      } else if (tool.isPlan && tool.name === '__PLAN__') {
        addExecutedCall(callHash);
        chrome.runtime.sendMessage({
          type: 'SEND_TO_SERVER',
          payload: { type: 'task_plan', params: tool.params, id: Date.now() }
        }, (resp) => {
          if (resp && resp.success) addLog('📋 任务规划请求已发送', 'info');
          else addLog('❌ 任务规划请求失败', 'error');
        });
        return;
      } else if (tool.isFlow && tool.name === '__FLOW__') {
        addExecutedCall(callHash);
        chrome.runtime.sendMessage({
          type: 'SEND_TO_SERVER',
          payload: { type: 'workflow_execute', params: tool.params, id: Date.now() }
        }, (resp) => {
          if (resp && resp.success) addLog('🔄 工作流请求已发送', 'info');
          else addLog('❌ 工作流请求失败', 'error');
        });
        return;
      } else if (tool.isResume && tool.name === '__RESUME__') {
        addExecutedCall(callHash);
        chrome.runtime.sendMessage({
          type: 'SEND_TO_SERVER',
          payload: { type: 'task_resume', params: tool.params, id: Date.now() }
        }, (resp) => {
          if (resp && resp.success) addLog('▶️ 断点续传请求已发送', 'info');
          else addLog('❌ 断点续传请求失败', 'error');
        });
        return;
      } else {
        executeToolCall(tool, callHash);
      }
      return;
    }
    
    if (text.includes('@DONE') || text.includes('[[DONE]]')) {
      const doneHash = `done:${index}`;
      if (!state.executedCalls.has(doneHash)) {
        addExecutedCall(doneHash);
        state.agentRunning = false;
        hideExecutingIndicator();
        state.pendingCalls.clear();
        updateStatus();
        addLog('✅ 任务完成', 'success');
      }
    }
  }

  // ============== 结果格式化 ==============

  function incrementRound() {
    state.roundCount++;
    localStorage.setItem('agent_round_count', state.roundCount.toString());
    // 每 30 轮发出预警
    if (state.roundCount > 0 && state.roundCount % 30 === 0) {
      addLog('⚠️ 已达 ' + state.roundCount + ' 轮，考虑开新对话', 'warn');
    }
    addLog('📊 轮次: ' + state.roundCount, 'info');
    updateRoundDisplay();
  }

  function resetRound() {
    state.roundCount = 0;
    localStorage.setItem('agent_round_count', '0');
    addLog('🔄 轮次已重置', 'info');
    updateRoundDisplay();
  }

  function updateRoundDisplay() {
    const el = document.getElementById('agent-round');
    if (el) {
      el.textContent = 'R:' + state.roundCount;
      el.style.color = state.roundCount >= 30 ? '#f59e0b' : state.roundCount >= 20 ? '#eab308' : '#9ca3af';
    }
  }

  
  // ============== 智能提示系统 ==============
  const SmartTips = {
    toolTips: {
      'take_screenshot': '截图已保存，可用 read_media_file 查看',
      'take_snapshot': '快照包含 uid，用于 click/fill 等操作',
      'click': '点击后可能需要 wait_for 等待页面变化',
      'fill': '填写后通常需要 click 提交按钮',
      'navigate_page': '导航后用 take_snapshot 获取页面内容',
      'new_page': '新页面已创建，用 take_snapshot 查看内容',
      'write_file': '文件已写入，大文件建议用 run_command',
      'edit_file': '文件已修改，可用 read_file 验证',
      'register_project_tool': '项目已注册，可用 get_symbols/find_text 分析',
      'get_symbols': '符号列表可用于 find_usage 查引用',
    },
    errorTips: {
      'timeout': '超时了，可拆分任务或后台执行: nohup cmd &',
      'not found': '路径不存在，先用 list_directory 确认',
      'permission denied': '权限不足，检查是否在允许目录内',
      'enoent': '文件/目录不存在，检查路径拼写',
      'eacces': '访问被拒绝，检查文件权限',
      'no such file': '文件不存在，用 list_directory 查看目录',
      'command not found': '命令不存在，检查是否已安装',
      'not allowed': '路径不在允许目录内，检查 list_allowed_directories',
      'syntax error': '语法错误，检查代码格式',
    },
    generalTips: [
      '支持批量执行: ΩBATCH{"steps":[...]}',
      '长内容用 run_command + heredoc 写入',
      '项目记忆: memory_manager_v2.js projects',
    ],
    getTip(toolName, success, content, error) {
      const text = ((content || '') + ' ' + (error || '')).toLowerCase();
      if (!success) {
        for (const [key, tip] of Object.entries(this.errorTips)) {
          if (text.includes(key)) return tip;
        }
        return '';
      }
      if (this.toolTips[toolName]) {
        return this.toolTips[toolName];
      }
      return '';
    }
  };

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
      // 添加错误类型和修复建议
      if (msg.errorType) {
        content += `\n[错误类型]: ${msg.errorType}`;
      }
      if (msg.recoverable) {
        content += `\n[可恢复]: 是`;
      }
    }
    
    // 智能截断：根据工具类型设定不同上限
    const toolLimits = {
      'read_file': 20000,
      'read_multiple_files': 20000,
      'directory_tree': 5000,
      'run_command': 10000,
      'browser_snapshot': 3000,
      'find_text': 8000,
      'find_usage': 8000,
      'get_symbols': 8000,
      'analyze_project': 8000
    };
    const maxLen = toolLimits[msg.tool] || 15000;
    
    if (content.length > maxLen) {
      // 保留头尾，中间截断
      const headLen = Math.floor(maxLen * 0.7);
      const tailLen = Math.floor(maxLen * 0.2);
      content = content.slice(0, headLen) + `\n\n...(截断了 ${content.length - headLen - tailLen} 字符)...\n\n` + content.slice(-tailLen);
    }
    
    const status = msg.success ? '✓ 成功' : '✗ 失败';
    
    // 优先使用服务器返回的建议，否则使用本地 SmartTips
    const tip = msg.suggestion || SmartTips.getTip(msg.tool, msg.success, content, msg.error);
    
    return `**[执行结果]** \`${msg.tool}\` ${status}:
\`\`\`
${content}
\`\`\`
${tip}
`;
  }

  // ============== UI ==============

  function createPanel() {
    if (document.getElementById('agent-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'agent-panel';
    panel.innerHTML = `
      <div id="agent-header">
        <span id="agent-title">🤖 Agent v34</span>
        <span id="agent-id" title="点击查看在线Agent" style="cursor:pointer;font-size:10px;color:#9ca3af;margin-left:4px"></span>
        <span id="agent-status">初始化</span>
        <span id="agent-round" title="点击重置轮次" style="cursor:pointer;font-size:10px;color:#9ca3af;margin-left:6px">R:0</span>
      </div>
      <div id="agent-executing"><span class="exec-spinner">⚙️</span><span class="exec-tool">工具名</span><span class="exec-time">0.0s</span></div>
      <div id="agent-tools"></div>
      <div id="agent-logs"></div>
      <div id="agent-actions">
        <button id="agent-copy-prompt" title="复制系统提示词给AI">📋 提示词</button>
        <button id="agent-clear" title="清除日志">🗑️</button>
        <button id="agent-retry-last" title="重试上一个命令">🔁 重试</button>
        <button id="agent-reconnect" title="重连服务器">🔄</button>
        <button id="agent-reload-tools" title="刷新工具列表">🔧</button>
        <button id="agent-switch-server" title="切换本地/云端">🌐 云</button>
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

    // 刷新工具列表
    document.getElementById('agent-reload-tools').onclick = () => {
      chrome.runtime.sendMessage({ type: 'RELOAD_TOOLS' }, (resp) => {
        if (chrome.runtime.lastError) {
          addLog('❌ 发送刷新请求失败', 'error');
          return;
        }
        if (resp?.success) {
          addLog('🔧 正在刷新工具列表...', 'info');
        } else {
          addLog('❌ ' + (resp?.error || '刷新失败'), 'error');
        }
      });
    };

    // 切换本地/云端服务器
    document.getElementById('agent-switch-server').onclick = () => {
      chrome.runtime.sendMessage({ type: 'GET_SERVER_INFO' }, (info) => {
        if (chrome.runtime.lastError) {
          addLog('❌ 获取服务器信息失败', 'error');
          return;
        }
        const newServer = info.current === 'local' ? 'cloud' : 'local';
        chrome.runtime.sendMessage({ type: 'SWITCH_SERVER', server: newServer }, (resp) => {
          if (resp?.success) {
            const btn = document.getElementById('agent-switch-server');
            btn.textContent = newServer === 'cloud' ? '🌐 云' : '💻 本地';
            addLog('✅ 已切换到 ' + newServer + ': ' + resp.url, 'success');
          } else {
            addLog('❌ 切换失败: ' + (resp?.error || '未知错误'), 'error');
          }
        });
      });
    };

    // 初始化服务器按钮状态
    chrome.runtime.sendMessage({ type: 'GET_SERVER_INFO' }, (info) => {
      if (info?.current) {
        const btn = document.getElementById('agent-switch-server');
        if (btn) btn.textContent = info.current === 'cloud' ? '🌐 云' : '💻 本地';
      }
    });
    
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


    // 轮次显示点击重置
    document.getElementById('agent-round').onclick = () => {
      if (confirm('重置轮次计数？')) {
        resetRound();
      }
    };
    // 初始化显示
    updateRoundDisplay();
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
        const wasConnected = state.wsConnected;
        state.wsConnected = msg.connected;
        updateStatus();
        addLog(msg.connected ? '✓ 服务器已连接' : '✗ 服务器断开', msg.connected ? 'success' : 'error');
        // 自动通知 AI 服务器状态变化
        if (!msg.connected && wasConnected) {
          setTimeout(() => sendMessageSafe('[系统通知] 服务器重启中，请稍候...'), 500);
        } else if (msg.connected && !wasConnected) {
          // 重连成功：重置所有执行状态，防止卡在"执行中"
          if (state.agentRunning) {
            addLog('🔄 重连后重置执行状态', 'info');
          }
          state.agentRunning = false;
          state.pendingCalls.clear();
          hideExecutingIndicator();
          setTimeout(() => sendMessageSafe('[系统通知] 服务器已重新连接，可以继续执行任务'), 1000);
        }
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

      case 'tools_updated':
        // 服务端热刷新后推送的工具更新
        if (msg.tools && msg.tools.length > 0) {
          const oldCount = state.availableTools.length;
          state.availableTools = msg.tools;
          updateToolsDisplay();
          addLog(`🔄 工具已刷新: ${oldCount} → ${msg.tools.length}`, 'success');
        }
        break;

      case 'reload_tools_result':
        // reload_tools 请求的结果
        if (msg.success) {
          addLog(`✅ 工具刷新成功: ${msg.toolCount} 个工具`, 'success');
        } else {
          addLog(`❌ 工具刷新失败: ${msg.error}`, 'error');
        }
        break;

      // ===== 批量任务消息 =====
      case 'batch_step_result':
        state.totalCalls++;  // 统计调用次数
        if (msg.success) {
          addLog(`📦 步骤${msg.stepIndex}: ${msg.tool} ✓`, 'success');
          state.batchResults.push({
            stepIndex: msg.stepIndex,
            tool: msg.tool,
            success: true,
            result: msg.result
          });
          // 更新进度条
          if (window.PanelEnhancer) {
            window.PanelEnhancer.updateStepStatus(msg.stepIndex, 'success', msg.tool);
            window.PanelEnhancer.updateProgress(state.batchResults.length, state.currentBatchTotal);
          }
        } else if (msg.skipped) {
          addLog(`📦 步骤${msg.stepIndex}: 跳过 (${msg.reason})`, 'info');
          if (window.PanelEnhancer) {
            window.PanelEnhancer.updateStepStatus(msg.stepIndex, 'skipped', msg.tool);
          }
        } else {
          addLog(`📦 步骤${msg.stepIndex}: ${msg.tool} ✗ ${msg.error}`, 'error');
          state.batchResults.push({
            stepIndex: msg.stepIndex,
            tool: msg.tool,
            success: false,
            error: msg.error
          });
          // 更新进度条（错误状态）
          if (window.PanelEnhancer) {
            window.PanelEnhancer.updateStepStatus(msg.stepIndex, 'error', msg.tool);
            window.PanelEnhancer.updateProgress(state.batchResults.length, state.currentBatchTotal, true);
          }
        }
        break;

      case 'batch_complete':
        state.agentRunning = false;
        hideExecutingIndicator();
        updateStatus();
        // 隐藏进度条
        if (window.PanelEnhancer) {
          window.PanelEnhancer.hideProgress();
          // 显示 Toast 通知
          if (msg.success) {
            window.PanelEnhancer.showToast(`批量任务完成: ${msg.stepsCompleted}/${msg.totalSteps}`, 'success');
          } else {
            window.PanelEnhancer.showToast(`批量任务部分失败: ${msg.stepsFailed} 个错误`, 'error');
          }
        }
        if (msg.success) {
          addLog(`✅ 批量任务完成: ${msg.stepsCompleted}/${msg.totalSteps} 成功`, 'success');
        } else {
          addLog(`⚠️ 批量任务部分失败: ${msg.stepsCompleted}/${msg.totalSteps} 成功, ${msg.stepsFailed} 失败`, 'error');
        }
        // 生成包含详细结果的汇总
        let detailedResults = '';
        if (state.batchResults && state.batchResults.length > 0) {
          detailedResults = state.batchResults.map((r, i) => {
            if (r.success) {
              let content = r.result || '';
              if (content.length > 2000) content = content.slice(0, 2000) + '...(截断)';
              return `**[步骤${r.stepIndex}]** \`${r.tool}\` ✓\n\`\`\`\n${content}\n\`\`\``;
            } else {
              return `**[步骤${r.stepIndex}]** \`${r.tool}\` ✗ ${r.error}`;
            }
          }).join('\n\n');
          state.batchResults = []; // 清空
        }
        const batchSummary = `**[批量执行完成]** ${msg.success ? '✓ 成功' : '✗ 部分失败'} (${msg.stepsCompleted}/${msg.totalSteps})\n\n` +
          detailedResults +
          `\n\n`;
        sendMessageSafe(batchSummary);
        break;

      case 'batch_error':
        state.agentRunning = false;
        hideExecutingIndicator();
        updateStatus();
        addLog(`❌ 批量任务错误: ${msg.error}`, 'error');
        sendMessageSafe(`**[批量执行错误]** ${msg.error}`);
        break;

      // ===== 第三阶段: 任务规划 =====
      case 'plan_result':
        addLog('📋 收到任务规划结果', 'success');
        state.agentRunning = false;
        hideExecutingIndicator();
        updateStatus();
        sendMessageSafe('**[任务规划完成]**\n\n' + (msg.visualization || '') + '\n\n' + JSON.stringify(msg.plan, null, 2).slice(0, 2000));
        break;

      case 'plan_error':
        addLog('❌ 任务规划失败: ' + msg.error, 'error');
        state.agentRunning = false;
        hideExecutingIndicator();
        updateStatus();
        sendMessageSafe('**[任务规划失败]** ' + msg.error);
        break;

      case 'workflow_step':
        addLog('🔄 工作流步骤 ' + msg.stepIndex, msg.success ? 'info' : 'error');
        break;

      case 'workflow_complete':
        addLog('✅ 工作流完成', 'success');
        state.agentRunning = false;
        hideExecutingIndicator();
        updateStatus();
        sendMessageSafe('**[工作流完成]** ' + msg.workflowId + ' 成功: ' + msg.stepsCompleted + '/' + msg.totalSteps);
        break;

      case 'workflow_error':
        addLog('❌ 工作流失败: ' + msg.error, 'error');
        state.agentRunning = false;
        hideExecutingIndicator();
        updateStatus();
        sendMessageSafe('**[工作流失败]** ' + msg.error);
        break;

      case 'resume_complete':
        addLog('✅ 断点续传完成', 'success');
        state.agentRunning = false;
        hideExecutingIndicator();
        updateStatus();
        break;

      case 'resume_started':
        addLog('▶️ 断点续传开始', 'info');
        break;

      case 'resume_step':
        addLog('▶️ 恢复步骤 ' + msg.stepIndex, msg.success ? 'info' : 'error');
        break;

      case 'checkpoint_result':
        addLog('💾 检查点操作完成', 'success');
        state.agentRunning = false;
        hideExecutingIndicator();
        updateStatus();
        sendMessageSafe('**[检查点结果]** ' + JSON.stringify(msg, null, 2).slice(0, 1000));
        break;

      case 'checkpoint_error':
        addLog('❌ 检查点失败: ' + msg.error, 'error');
        break;

      case 'templates_list':
        addLog('📋 模板列表', 'success');
        sendMessageSafe('**[工作流模板]**\n' + msg.templates.map(t => '- ' + t.id + ': ' + t.name).join('\n'));
        break;

      case 'resume_complete':
        addLog(`✅ 任务恢复完成: ${msg.stepsCompleted}/${msg.totalSteps}`, 'success');
        break;

      case 'resume_error':
        addLog(`❌ 任务恢复失败: ${msg.error}`, 'error');
        break;

      // ===== 目标驱动执行 =====
      case 'goal_created':
        addLog(`🎯 目标已创建: ${msg.goal?.id || msg.goalId}`, 'success');
        break;

      case 'goal_progress':
        if (msg.step !== undefined) {
          addLog(`🎯 目标进度: 步骤 ${msg.step} - ${msg.status || '执行中'}`, 'info');
        }
        break;

      case 'goal_complete':
        state.agentRunning = false;
        hideExecutingIndicator();
        updateStatus();
        if (msg.success) {
          addLog(`✅ 目标完成: ${msg.goalId} (${msg.attempts || 1} 次尝试)`, 'success');
        } else {
          addLog(`❌ 目标失败: ${msg.goalId} - ${msg.error || '未知错误'}`, 'error');
        }
        // 生成目标完成摘要
        const goalSummary = `**[目标执行完成]** ${msg.success ? '✓ 成功' : '✗ 失败'}\n` +
          `- 目标ID: ${msg.goalId}\n` +
          `- 尝试次数: ${msg.attempts || 1}\n` +
          (msg.gaps?.length ? `- 未满足条件: ${msg.gaps.length}\n` : '') +
          `\n`;
        sendMessageToAI(goalSummary);
        break;

      case 'goal_status_result':
        addLog(`📊 目标状态: ${msg.status?.status || '未知'} (${msg.status?.progress || 0}%)`, 'info');
        break;

      case 'goals_list':
        addLog(`📋 活跃目标: ${msg.goals?.active?.length || 0}, 已完成: ${msg.goals?.completed || 0}`, 'info');
        break;

      case 'validated_result':
        state.agentRunning = false;
        hideExecutingIndicator();
        updateStatus();
        const vr = msg.result;
        if (vr?.success && vr?.validated) {
          addLog(`✅ ${msg.tool} 执行并验证成功`, 'success');
        } else if (vr?.success && !vr?.validated) {
          addLog(`⚠️ ${msg.tool} 执行成功但验证失败`, 'warning');
        } else {
          addLog(`❌ ${msg.tool} 执行失败: ${vr?.error}`, 'error');
        }
        // 生成验证结果摘要
        const vrSummary = `**[验证执行结果]** ${msg.tool}\n` +
          `- 执行: ${vr?.success ? '✓' : '✗'}\n` +
          `- 验证: ${vr?.validated ? '✓' : '✗'}\n` +
          (vr?.result ? `\`\`\`\n${typeof vr.result === 'string' ? vr.result.slice(0, 1000) : JSON.stringify(vr.result).slice(0, 1000)}\n\`\`\`\n` : '') +
          `\n`;
        sendMessageToAI(vrSummary);
        break;

      // ===== 异步命令执行 =====
      case 'async_result':
        state.agentRunning = false;
        hideExecutingIndicator();
        updateStatus();
        if (msg.success) {
          const modeText = msg.mode === 'async' ? ' (后台)' : '';
          addLog(`✅ 命令执行成功${modeText}`, 'success');
          if (msg.processId) {
            addLog(`📋 进程ID: ${msg.processId}`, 'info');
          }
        } else {
          addLog(`❌ 命令执行失败: ${msg.error}`, 'error');
          if (msg.suggestion) {
            addLog(`💡 建议: ${msg.suggestion}`, 'info');
          }
        }
        // 生成异步结果摘要
        const asyncSummary = `**[命令执行结果]** ${msg.success ? '✓ 成功' : '✗ 失败'}${msg.mode === 'async' ? ' (后台模式)' : ''}\n` +
          (msg.processId ? `- 进程ID: ${msg.processId}\n` : '') +
          (msg.logFile ? `- 日志文件: ${msg.logFile}\n` : '') +
          (msg.warning ? `- ⚠️ ${msg.warning}\n` : '') +
          (msg.output ? `\`\`\`\n${msg.output.slice(-2000)}\n\`\`\`\n` : '') +
          (msg.error ? `- 错误: ${msg.error}\n` : '') +
          `\n`;
        sendMessageToAI(asyncSummary);
        break;

      case 'async_output':
        // 实时输出，仅记录日志
        if (msg.output) {
          addLog(`📤 ${msg.output.slice(0, 200)}`, 'info');
        }
        break;

      case 'async_status_result':
        if (msg.exists) {
          addLog(`📊 进程 ${msg.processId}: ${msg.isRunning ? '运行中' : '已停止'}`, msg.isRunning ? 'success' : 'info');
        } else {
          addLog(`⚠️ 进程不存在: ${msg.processId}`, 'warning');
        }
        break;

      case 'async_stop_result':
        if (msg.success) {
          addLog(`⏹️ 进程已停止: ${msg.processId}`, 'success');
        } else {
          addLog(`❌ 停止失败: ${msg.error}`, 'error');
        }
        break;

      case 'async_log_result':
        if (msg.success) {
          addLog(`📋 日志 (${msg.lines} 行)`, 'info');
          const logSummary = `**[进程日志]** ${msg.processId}\n` +
            `- 文件: ${msg.logFile}\n` +
            `- 总行数: ${msg.lines}\n` +
            `\`\`\`\n${msg.content?.slice(-3000) || '(空)'}\n\`\`\`\n` +
            `\n`;
          sendMessageToAI(logSummary);
        } else {
          addLog(`❌ 读取日志失败: ${msg.error}`, 'error');
        }
        break;

      // ===== 录制相关 =====
      case 'recording_started':
        addLog(`🎬 录制已开始: ${msg.recordingId}`, 'success');
        break;

      case 'recording_stopped':
        addLog(`⏹️ 录制已停止: ${msg.recordingId} (${msg.summary?.totalSteps || 0} 步)`, 'success');
        break;

      case 'recordings_list':
        if (msg.recordings?.length > 0) {
          addLog(`📼 录制列表: ${msg.recordings.length} 个`, 'info');
          msg.recordings.forEach(r => {
            addLog(`  - ${r.id}: ${r.name || '未命名'} (${r.totalSteps} 步)`, 'info');
          });
        } else {
          addLog('📼 暂无录制', 'info');
        }
        break;

      case 'recording_loaded':
        if (msg.success) {
          addLog(`📂 录制已加载: ${msg.recording?.id}`, 'success');
        } else {
          addLog(`❌ 加载录制失败: ${msg.error}`, 'error');
        }
        break;

      case 'replay_step_result':
        const replayStatus = msg.success ? '✓' : '✗';
        addLog(`▶️ 回放步骤 ${msg.stepIndex}: ${msg.tool} ${replayStatus}`, msg.success ? 'info' : 'warning');
        break;

      case 'replay_complete':
        addLog(`🏁 回放完成: ${msg.stepsCompleted || 0}/${msg.totalSteps || 0} 成功`, 'success');
        break;

      case 'replay_error':
        addLog(`❌ 回放错误: ${msg.error}`, 'error');
        break;

      case 'tool_result':
        console.log('[Agent-DEBUG] tool_result received:', msg.tool, msg.id, typeof msg.result, String(msg.result).substring(0,100));
        // 去重：用 tool + 结果内容生成 hash
        const resultHash = `result:${msg.tool}:${msg.id || ''}:${JSON.stringify(msg.result || msg.error).slice(0,100)}`;
        if (state.executedCalls.has(resultHash)) {
          log('跳过重复的 tool_result:', msg.tool);
          break;
        }
        addExecutedCall(resultHash);
        
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
        addExecutedCall(sendHash);
        setTimeout(() => {
          state.executedCalls.delete(sendHash);  // 5秒后允许再次发送
        }, 5000);
        sendMessageSafe(resultText);
        incrementRound();
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
        
        // 发送回执给发送方（只发一次）
        if (!state.crossTabBuffer) {
          state.crossTabBuffer = {};
        }
        
        const fromAgent = msg.from;
        
        // 初始化该 agent 的缓冲区
        if (!state.crossTabBuffer[fromAgent]) {
          state.crossTabBuffer[fromAgent] = {
            messages: [],
            timer: null,
            receiptSent: false
          };
        }
        
        const buffer = state.crossTabBuffer[fromAgent];
        
        // 只发送一次回执
        if (!buffer.receiptSent) {
          chrome.runtime.sendMessage({
            type: 'CROSS_TAB_SEND',
            to: fromAgent,
            message: `✅ [回执] ${agentId || '对方'} 已收到消息，正在处理...`
          });
          buffer.receiptSent = true;
        }
        
        // 累积消息
        buffer.messages.push(msg.message);
        
        // 清除之前的定时器
        if (buffer.timer) {
          clearTimeout(buffer.timer);
        }
        
        // 设置新定时器，等待 2 秒后合并发送（给足够时间让所有分段到达）
        buffer.timer = setTimeout(() => {
          const combinedMsg = buffer.messages.join('');
          const crossTabMsg = `**[来自 ${fromAgent} 的消息]**\n\n${combinedMsg}\n\n---\n请处理上述消息。完成后可以用 ΩSEND:${fromAgent}:回复内容ΩSENDEND 来回复。`;
          waitForGenerationComplete(() => enqueueMessage(crossTabMsg));
          
          // 清空缓冲区
          delete state.crossTabBuffer[fromAgent];
        }, 2000);
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



  // ============== AI 响应超时唤醒 ==============
  let lastAiMessageTime = Date.now();
  let wakeupTimer = null;
  const WAKEUP_TIMEOUT = 600000; // 60 seconds timeout
  const WAKEUP_CHECK_INTERVAL = 15000; // check every 15 seconds
  
  function updateLastAiMessageTime() {
    lastAiMessageTime = Date.now();
    startToolCallDetection();
  }
  
  function startWakeupMonitor() {
    if (wakeupTimer) clearInterval(wakeupTimer);
    
    wakeupTimer = setInterval(() => {
      // 只在 Agent 运行中（有待处理任务）时检查
      if (!state.agentRunning) {
        lastAiMessageTime = Date.now(); // 重置时间
        return;
      }
      
      const elapsed = Date.now() - lastAiMessageTime;
      if (elapsed > WAKEUP_TIMEOUT) {
        addLog(`⏰ AI 超过 ${Math.round(elapsed/1000)} 秒无响应，发送唤醒消息`, 'warning');
        sendWakeupMessage();
        lastAiMessageTime = Date.now(); // 重置，避免重复发送
      }
    }, WAKEUP_CHECK_INTERVAL);
    
    addLog('👁️ 响应超时监控已启动', 'info');
  }
  
  function sendWakeupMessage() {
    const messages = [
      '继续',
      '请继续执行',
      '继续之前的任务'
    ];
    const msg = messages[Math.floor(Math.random() * messages.length)];
    sendMessageSafe(msg);
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
      sendMessageSafe(`检查是否有分配给我的任务：\n\`\`\`\nΩ{"tool":"run_command","params":{"command":"node /Users/yay/workspace/.agent_hub/task_manager.js check ${agentId}"}}\n\`\`\``);
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
    log('初始化 Agent v34 (Genspark)');
    
    createPanel();
    
    // 加载面板增强模块
    loadPanelEnhancer();

    setInterval(scanForToolCalls, CONFIG.SCAN_INTERVAL);

    // Notification polling from watchdog
    let lastNotifyTime = null;
    setInterval(async () => {
      try {
        const resp = await fetch("http://localhost:8766/notify");
        if (resp.ok) {
          const data = await resp.json();
          if (data.message && data.timestamp !== lastNotifyTime) {
            lastNotifyTime = data.timestamp;
            sendMessageSafe("**[Watchdog]** " + data.message);
          }
        }
      } catch (e) { }
    }, 3000);
    
    // 自动检测并点击 "Regenerate response" 按钮
    setInterval(() => {
      const btn = document.querySelector('[data-v-374c52ef].button');
      if (btn && btn.textContent && btn.textContent.includes('Regenerate')) {
        console.log('[Agent] 检测到 Regenerate response 按钮，1秒后自动点击');
        setTimeout(() => {
          if (btn && document.contains(btn)) {
            btn.click();
            console.log('[Agent] 已点击 Regenerate response 按钮');
          }
        }, 1000);
      }
    }, 2000);
    
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

    addLog('🚀 Agent v34 已启动', 'success');
    addLog('💡 点击「📋 提示词」复制给AI', 'info');
    
    // 恢复之前保存的 Agent 身份
    restoreAgentId();
    
    // 启动 AI 响应超时监控
    startWakeupMonitor();
    
    // 初始化 Agent ID 显示
    setTimeout(updateAgentIdDisplay, 100);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 100);
  }

})();

// === Omega 手动执行快捷键 (Ctrl+Shift+E) ===
(function() {
  document.addEventListener('keydown', async function(e) {
    // Ctrl+Shift+E 触发
    if (e.ctrlKey && e.shiftKey && e.key === 'E') {
      e.preventDefault();
      console.log('[Omega] 快捷键触发');
      
      // 获取最后一条 AI 消息
      const msgs = document.querySelectorAll('.conversation-statement.assistant');
      const lastMsg = msgs[msgs.length - 1];
      if (!lastMsg) {
        alert('No AI message found');
        return;
      }
      
      // 提取文本
      const contentEl = lastMsg.querySelector('.markdown-viewer') || 
                        lastMsg.querySelector('.bubble .content') ||
                        lastMsg.querySelector('.bubble') || lastMsg;
      const text = contentEl.innerText || lastMsg.innerText || '';
      
      // 匹配 Omega 命令
      const match = text.match(/[ΩŒ©]\{[\s\S]*?\}[ΩŒ©]?STOP/);
      if (!match) {
        alert('No Omega command found in last message');
        return;
      }
      
      console.log('[Omega] Found command:', match[0].substring(0, 100) + '...');
      
      // 发送到本地服务器执行
      try {
        const resp = await fetch('http://localhost:7749/exec', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: match[0] })
        });
        const data = await resp.json();
        
        if (data.success) {
          // 填入输入框
          const input = document.querySelector('textarea.chat-input') || document.querySelector('textarea');
          if (input) {
            input.value = data.result;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.focus();
            console.log('[Omega] Result pasted, press Enter to send');
          } else {
            navigator.clipboard.writeText(data.result);
            alert('Result copied to clipboard!');
          }
        } else {
          alert('Execution error: ' + data.error);
        }
      } catch (err) {
        alert('Server error (is omega-server running?): ' + err.message);
      }
    }
  });
  console.log('[Omega] Hotkey Ctrl+Shift+E registered');
})();
