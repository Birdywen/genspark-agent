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
    executedCalls: new Set(),
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
    // 统计
    totalCalls: 0,
    sessionStart: Date.now()
  };

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
    const toolCount = state.availableTools.length || 67;
    const toolSummary = `本系统提供 ${toolCount} 个工具，分为 4 大类：
- **文件系统** (14个): read_file, write_file, edit_file, list_directory, read_multiple_files 等
- **浏览器自动化** (26个): browser_navigate, browser_snapshot, browser_click, browser_type 等  
- **命令执行** (1个): run_command
- **代码分析** (26个): register_project_tool, find_text, get_symbols, find_usage 等`;

    const prompt = `## 身份

你连接了 **genspark-agent** 本地代理系统 (v1.0.52+)，可执行文件操作、命令、浏览器自动化等。

---

## 工具调用格式

所有工具调用必须用代码块包裹。

### 单个工具

\`\`\`
Ω{"tool":"工具名","params":{"参数":"值"}}
\`\`\`

示例：
\`\`\`
Ω{"tool":"read_file","params":{"path":"/path/to/file.txt"}}
\`\`\`

### 批量执行 + 变量传递 ⭐ v1.0.52+

\`\`\`
ΩBATCH{"steps":[
  {"tool":"工具1","params":{...}},
  {"tool":"工具2","params":{...}}
]}ΩEND
\`\`\`

**关键特性**：

1. **变量保存** (saveAs)：保存步骤结果
   \`\`\`json
   {"tool":"run_command","params":{"command":"date"},"saveAs":"myVar"}
   \`\`\`

2. **条件执行** (when)：根据前置结果决定是否执行
   
   语法：\`{"var":"变量名","条件":"值"}\` (注意使用 var 不是 variable)
   
   支持的条件：
   - \`success\`: 检查是否成功 \`{"var":"step1","success":true}\`
   - \`contains\`: 包含字符串 \`{"var":"step1","contains":"OK"}\`
   - \`regex\`: 正则匹配 \`{"var":"step1","regex":"v[0-9]+"}\`

3. **错误处理** (stopOnError)：
   - \`false\`: 遇错继续执行
   - \`true\` (默认): 遇错立即停止

**完整示例**：
\`\`\`
ΩBATCH{"steps":[
  {"tool":"run_command","params":{"command":"node -v"},"saveAs":"nodeVer"},
  {"tool":"run_command","params":{"command":"npm -v"},"saveAs":"npmVer"},
  {"tool":"run_command","params":{"command":"echo 'Node installed'"},
   "when":{"var":"nodeVer","success":true}}
],"stopOnError":false}ΩEND
\`\`\`

**适用场景**：读取多文件、环境检查、批量命令执行

### 智能规划 (ΩPLAN)

\`\`\`
ΩPLAN{"goal":"目标描述","context":{...}}
\`\`\`

自动分解任务、分析依赖、并行优化。内置模式：文件复制、部署、数据库备份等。

### 工作流模板 (ΩFLOW)

\`\`\`
ΩFLOW{"template":"模板名","variables":{...}}
\`\`\`

内置模板：deploy-nodejs, backup-mysql, batch-process, health-check, log-analysis, git-workflow

### 断点续传 (ΩRESUME)

\`\`\`
ΩRESUME{"taskId":"任务ID"}
\`\`\`

恢复中断的任务，从上次失败的步骤继续执行。

---

## 可用工具

${toolSummary}

---

## 核心规则

1. **代码块包裹**：所有工具调用必须在代码块中
2. **等待结果**：单个工具调用后等待结果再继续
3. **批量执行**：多个独立操作用 ΩBATCH 批量执行
4. **不编造结果**：永远不要假设或编造执行结果
5. **转义引号**：JSON 中的引号使用 \\\"
6. **完成标记**：任务完成后输出 @DONE
7. **里程碑记录**：重要工作完成后记录里程碑

---

## 新对话上下文恢复

每次新对话涉及以下项目时，先恢复上下文：
- genspark-agent (本地代理系统)
- ezmusicstore (音乐商店)
- oracle-cloud (云服务)

**执行方法**：询问项目后执行
\`\`\`
Ω{"tool":"run_command","params":{"command":"node /Users/yay/workspace/.agent_memory/memory_manager_v2.js digest 项目名"}}
\`\`\`

示例（直接写项目名，不要用尖括号）：
\`\`\`
Ω{"tool":"run_command","params":{"command":"node /Users/yay/workspace/.agent_memory/memory_manager_v2.js digest genspark-agent"}}
\`\`\`

---

## TODO 机制

**必须创建 TODO** 的情况：
1. 用户明确列出多项任务清单
2. 跨会话的长期任务（需分多次完成）
3. 复杂开发任务（新功能、重构、多文件修复）

**不需要 TODO** 的情况：
1. 探索性工作（调试、测试、学习）
2. 即时操作（查询、读文件、单次命令）
3. 对话中的自然延伸（基于上步结果的下一步）

**TODO 文件位置**：/Users/yay/workspace/TODO.md

---

## 代码修改选择

**使用 edit_file**：
- 1-20 行修改，位置明确
- 修改配置值、单个函数
- 更新 import、调整参数

**使用 write_file**：
- 20 行以上或结构性修改
- 重构代码、批量修改
- 创建新文件、模板生成

**不确定时**：先 read_file 查看，再决定

---

## 长内容处理

当内容超过 50 行或包含大量特殊字符时，使用 heredoc 方式写入文件。

---

## 错误处理

**基本原则**：
1. 永远不编造结果
2. 错误后先分析原因再重试
3. 最多重试 2 次，失败后向用户说明

**常见错误应对**：
- 工具未找到 → 检查拼写和工具列表
- 参数错误 → 查看工具文档，补充参数
- 权限拒绝 → 检查路径是否在允许目录、命令是否在白名单
- 文件不存在 → 使用 list_directory 确认路径
- 命令失败 → 检查 stderr，验证语法和依赖

---

## SSH 远程

禁止 run_command+ssh，使用专用工具：
- ssh-oracle:exec (Oracle Cloud)
- ssh-cpanel:exec (cPanel)

---

## 本地环境

- **系统**: macOS (arm64 Apple Silicon)
- **工具**: pandoc, ffmpeg, ImageMagick, jq, sqlite3, git, python3, node/npm, rg, fd
- **允许目录**: /Users/yay/workspace, /Users/yay/Documents, /tmp

通过 run_command 调用以上工具。

---

## 其他标记

- 重试：@RETRY:#ID
- 协作：@SEND:agent:msg
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
  function extractBalancedJson(text, marker) {
    const idx = text.indexOf(marker);
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
    const planData = extractBalancedJson(text, 'ΩPLAN');
    if (planData && !state.executedCalls.has('plan:' + planData.start)) {
      const beforePlan = text.substring(Math.max(0, planData.start - 100), planData.start);
      if (!beforePlan.includes('格式') && !beforePlan.includes('示例')) {
        try {
          const plan = safeJsonParse(planData.json);
          if (plan) return [{ name: '__PLAN__', params: plan, raw: 'ΩPLAN' + planData.json, start: planData.start, end: planData.end, isPlan: true }];
        } catch (e) {}
      }
    }

    // ========== ΩFLOW ==========
    const flowData = extractBalancedJson(text, 'ΩFLOW');
    if (flowData && !state.executedCalls.has('flow:' + flowData.start)) {
      const beforeFlow = text.substring(Math.max(0, flowData.start - 100), flowData.start);
      if (!beforeFlow.includes('格式') && !beforeFlow.includes('示例')) {
        try {
          const flow = safeJsonParse(flowData.json);
          if (flow) return [{ name: '__FLOW__', params: flow, raw: 'ΩFLOW' + flowData.json, start: flowData.start, end: flowData.end, isFlow: true }];
        } catch (e) {}
      }
    }

    // ========== ΩRESUME ==========
    const resumeData = extractBalancedJson(text, 'ΩRESUME');
    if (resumeData && !state.executedCalls.has('resume:' + resumeData.start)) {
      const beforeResume = text.substring(Math.max(0, resumeData.start - 100), resumeData.start);
      if (!beforeResume.includes('格式') && !beforeResume.includes('示例')) {
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
      const isExample = /格式[：:]|示例|用法|如下|Example|调用格式|工具调用/.test(beforeMarker);
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
            toolCalls.push({ name: parsed.tool, params: parsed.params || {}, raw: marker + extracted.json, start: idx, end: idx + marker.length + extracted.json.length });
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

  // ============== 工具调用检测 v2 ==============
  let expectingToolCall = false;
  let toolCallWarningTimer = null;

  function startToolCallDetection() {
    // 清除旧的定时器
    if (toolCallWarningTimer) {
      clearTimeout(toolCallWarningTimer);
    }
    
    expectingToolCall = true;
    
    // 30秒后如果还没有工具执行，提示
    toolCallWarningTimer = setTimeout(() => {
      if (expectingToolCall) {
        addLog('⚠️ 似乎没有检测到工具调用执行', 'warning');
        addLog('提示：如果发送了工具调用但未执行，可能是格式问题', 'info');
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
    clearToolCallDetection(); // 工具开始执行，清除警告
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
    clearToolCallDetection(); // 工具开始执行，清除警告
    const batchId = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    
    state.agentRunning = true;
    state.executedCalls.add(callHash);
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
    clearToolCallDetection(); // 工具开始执行，清除警告
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
    // 如果已经在执行，清除待处理标记
    if (state.agentRunning) {
      if (toolCallTimer) {
        clearTimeout(toolCallTimer);
        toolCallTimer = null;
        pendingToolCall = null;
      }
      return;
    }
    
    // 如果 AI 正在生成中，跳过扫描
    if (isAIGenerating()) {
      log('AI 正在生成中，跳过扫描');
      return;
    }
    
    const { text, index } = getLatestAIMessage();
    
    if (index < 0 || !text) return;
    
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
    // 启动工具调用检测
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
