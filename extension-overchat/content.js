// content.js v2.0.0 - Overchat Agent Bridge - SSE+DOM双通道 - ΩCODE统一通道 - Agent 心跳机制
(function() { console.log('=== OVERCHAT AGENT v2.0.0 (SSE+DOM) LOADED ===');
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
    executedCalls: new Set(), // Fresh each page load — dedup is per-message now
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

  // === VideoGenerator 已移除 (v2.0.0) ===
  function loadVideoGenerator() { /* removed */ }

  // === 原 VideoGenerator 代码已清理 ===

  
  // 改进的 JSON 解析函数 - 处理长内容和特殊字符
  function safeJsonParse(jsonStr) {
    let fixed = jsonStr
      .replace(/[""]/g, '"')
      .replace(/['']/g, "'");
    
    // Support relaxed JSON: add quotes to unquoted keys
    // e.g. {tool:"run_process"} -> {"tool":"run_process"}
    fixed = fixed.replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":');
    
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
        if (toolMatch) {
          const params = {};
          // 使用更宽松的正则来匹配可能包含转义字符的字符串
          const pathMatch = fixed.match(/"path"\s*:\s*"((?:\\.|[^"\\])*)"/);
          if (pathMatch) params.path = pathMatch[1].replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
          
          const cmdMatch = fixed.match(/"command"\s*:\s*"((?:\\.|[^"\\])*)"/);
          if (cmdMatch) params.command = cmdMatch[1].replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
          
          const cmdLineMatch = fixed.match(/"command_line"\s*:\s*"((?:\\.|[^"\\])*)"/);
          if (cmdLineMatch) params.command_line = cmdLineMatch[1].replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
          
          const modeMatch = fixed.match(/"mode"\s*:\s*"(\w+)"/);
          if (modeMatch) params.mode = modeMatch[1];
          
          // stdin 可能是多行的，尝试提取直到下一个引号结束的复杂内容
          const stdinMatch = fixed.match(/"stdin"\s*:\s*"((?:\\.|[^"\\])*)"/);
          if (stdinMatch) params.stdin = stdinMatch[1].replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
          
          const urlMatch = fixed.match(/"url"\s*:\s*"((?:\\.|[^"\\])*)"/);
          if (urlMatch) params.url = urlMatch[1].replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
          
          console.warn('[Agent] Partial parse for tool:', toolMatch[1], 'params:', Object.keys(params).join(','));
          return { tool: toolMatch[1], params, _partialParse: true };
        }
        throw e1;
      }
    }
  }

function log(...args) {
    if (CONFIG.DEBUG) console.log('[Agent]', ...args);
  }

  // ============== SSE 原始数据拦截 (Overchat fetch delta) ==============
  // 从 sse-hook.js (MAIN world) 接收未经 DOM 渲染的原始 delta
  // 格式: {type:"content_delta", text:"..."} 或 {type:"status_change", status:"..."}
  
  const sseState = {
    currentText: '',
    connected: false,
    processedCommands: new Set(),
    lastDeltaTime: 0,
    messageId: null,
    enabled: true,
    executedInCurrentMessage: false
  };

  function initSSEListener() {
    // Fetch hook is now in fetch-hook.js (MAIN world, document_idle via manifest)
    addLog('🔌 Fetch hook (via manifest)', 'info');

    // SSE 连接建立
    document.addEventListener('__sse_connected__', (e) => {
      sseState.connected = true;
      sseState.currentText = '';
      sseState.processedCommands.clear();
      sseState.executedInCurrentMessage = false;
      const prevMessageId = sseState.messageId;
      sseState.messageId = null;
      sseState._prevMessageId = prevMessageId;
      log('SSE connected:', e.detail?.transport);
      addLog('📡 SSE ' + (e.detail?.transport || 'stream') + ' connected', 'success');
    });

    // 每个 SSE delta
    document.addEventListener('__sse_data__', (e) => {
      if (!sseState.enabled) return;
      const raw = e.detail?.data;
      if (!raw) return;

      try {
        const parsed = JSON.parse(raw);
        
        // content delta
        if (parsed.type === 'content_delta' && parsed.text) {
          // 防重复：如果这段文本已经存在于末尾，则跳过
          if (!sseState.currentText.endsWith(parsed.text)) {
            sseState.currentText += parsed.text;
          } else {
            log('SSE duplicate delta skipped');
          }
          sseState.lastDeltaTime = Date.now();
          
          // 实时检测 ΩCODE 命令
          checkSSEForToolCalls();
        }
        
        // Status change
        if (parsed.type === 'status_change' && parsed.status === 'finished_successfully') {
          log('SSE message finished');
          // 最终检查一次
          setTimeout(() => checkSSEForToolCalls(), 100);
        }

        // Genspark 兼容格式 (message_field_delta)
        if (parsed.type === 'message_field_delta' && parsed.field_name === 'content' && parsed.delta) {
          const newMsgId = parsed.message_id || sseState.messageId;
          if (newMsgId && newMsgId !== sseState._prevMessageId && newMsgId !== sseState.messageId) {
            sseState.processedCommands.clear();
            sseState.executedInCurrentMessage = false;
            sseState.currentText = '';
          }
          sseState.messageId = newMsgId;
          sseState.currentText += parsed.delta;
          sseState.lastDeltaTime = Date.now();
          checkSSEForToolCalls();
        }
      } catch (e) {
        // Not JSON — ignore
      }
    });

    // 消息完成
    document.addEventListener('__sse_message_complete__', (e) => {
      log('SSE message complete event');
      // 延迟最终检查，确保所有 delta 已到
      setTimeout(() => {
        checkSSEForToolCalls();
        // 重置为下一条消息做准备
        sseState._prevMessageId = sseState.messageId;
      }, 200);
    });

    // SSE 关闭
    document.addEventListener('__sse_closed__', (e) => {
      log('SSE closed:', e.detail?.transport);
      sseState.connected = false;
    });

    log('SSE listener initialized (Overchat mode)');
    addLog('🔌 SSE 监听器已启动', 'info');
  }

  // ============================================================
  // 文本清理：处理 SSE 重复数据导致的损坏
  // ============================================================
  function cleanCorruptedText(text) {
    // 检测重复的 ΩCODE { 模式（如 ΩCODE {ΩCODE {ΩCODE {）
    // 保留最后一个 ΩCODE { 及其后面的内容
    const omegaCodePattern = /ΩCODE\s*\{/g;
    const matches = text.match(omegaCodePattern);
    if (matches && matches.length > 1) {
      // 找到最后一个 ΩCODE { 的位置
      let lastIndex = text.lastIndexOf('ΩCODE {');
      if (lastIndex === -1) {
        // 尝试不带空格的变体
        lastIndex = text.lastIndexOf('ΩCODE{');
        if (lastIndex !== -1) lastIndex += 6; // 包含 ΩCODE{
        else lastIndex = 0;
      } else {
        lastIndex += 7; // 包含 ΩCODE {
      }
      // 保留从最后一个 ΩCODE { 开始到 ΩCODEEND 的内容
      const endIndex = text.indexOf('ΩCODEEND', lastIndex);
      if (endIndex !== -1) {
        text = 'ΩCODE {' + text.substring(lastIndex, endIndex + 8);
      }
    }
    
    // 修复字段名重复（如 tooltooltool -> tool）
    // 检测重复模式：tooltool, tooltooltool, paramsparams 等
    text = text.replace(/(\w{3,})\1+/g, '$1');
    
    // 修复重复的空键值（如 "":"run_process" 应该是 "tool":"run_process"）
    text = text.replace(/"":"([^"]+)"/g, '"$1":"$1"');
    
    return text;
  }

  function checkSSEForToolCalls() {
    // Note: removed agentRunning guard — batch calls handle dedup via callHash
    const text = sseState.currentText;
    if (!text) return;

    // 检测所有完整的 ΩCODE 块（支持同一消息多个命令）
    let searchFrom = 0;
    while (searchFrom < text.length) {
      const codeStart = text.indexOf('ΩCODE', searchFrom);
      if (codeStart === -1) break;
      const codeEnd = text.indexOf('ΩCODEEND', codeStart + 5);
      if (codeEnd === -1) break; // 未完成的块，等下一个 delta
      
      const cmdSignature = 'sse:' + codeStart + ':' + text.substring(codeStart, codeStart + 50);
      searchFrom = codeEnd + 8; // 跳过 ΩCODEEND 继续搜索
      
      if (sseState.processedCommands.has(cmdSignature)) continue;
      sseState.processedCommands.add(cmdSignature);
      
      log('SSE detected ΩCODE at position', codeStart);
      // 提取这个块的文本并解析
      let blockText = text.substring(codeStart, codeEnd + 8);
      
      // 尝试解析，如果失败则清理损坏的文本
      let toolCalls = parseToolCalls(blockText);
      if (toolCalls.length === 0) {
        const cleanedText = cleanCorruptedText(blockText);
        if (cleanedText !== blockText) {
          addLog('🧹 文本损坏，尝试清理后重新解析', 'info');
          toolCalls = parseToolCalls(cleanedText);
        }
      }
      
      if (toolCalls.length > 0) {
        sseState.executedInCurrentMessage = true;
        for (const tool of toolCalls) {
          // Include message context in hash so same command in different messages can execute
          // Unified hash format: shared between SSE and DOM paths to prevent duplicate execution
          // Use round count as message context so same command in different rounds can execute
          const paramStr = JSON.stringify(tool.params).substring(0, 200);
          const roundCtx = state.roundCount || 0;
          const callHash = 'cmd:' + roundCtx + ':' + tool.name + ':' + paramStr;
          if (!state.executedCalls.has(callHash)) {
            addExecutedCall(callHash);
            if (tool.isBatch) {
              executeBatchCall(tool.params, callHash);
            } else {
              executeToolCall(tool, callHash);
            }
          }
        }
      }
    }

    // ΩCODE already handled above, no other formats needed

    // 检测 @DONE
    if (text.includes('@DONE') || text.includes('[[DONE]]')) {
      const doneSig = 'sse:done:' + sseState.messageId;
      if (!sseState.processedCommands.has(doneSig)) {
        sseState.processedCommands.add(doneSig);
        log('SSE detected @DONE');
        addLog('✅ @DONE (via SSE)', 'success');
      }
    }
  }

  // ============== AI 生成状态检测 ==============
  
  function isAIGenerating() {
    // Overchat: streaming indicator visible
    const streamingEl = document.querySelector('[class*="streaming"]');
    if (streamingEl && streamingEl.style.display !== 'none') return true;
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
- **页面脚本** (3个): 直接操控浏览器标签页，绕过 CSP/Cloudflare
  - **list_tabs** — 查询所有打开的标签页，返回 id/title/url/active/windowId。无需参数
  - **eval_js(code, [tabId])** — 在 MAIN world 执行 JS，可访问页面全局变量/DOM/cookie。用 return 返回结果。支持 async/Promise
  - **js_flow(steps, [tabId], [timeout])** — 浏览器 JS 微型工作流，多步骤顺序执行，支持 delay 延迟、waitFor 等待条件、ctx 上下文传递。每步可设 label/optional/continueOnError/tabId。适合: 输入→延迟→发送→等待回复 等多步浏览器交互。每步可设独立 tabId 实现跨 tab 工作流，ctx 自动跨页面传递
  - 跨 tab 操作流程: 先 list_tabs 获取目标 tabId → 再 eval_js/js_flow 指定 tabId 操作目标页面。js_flow 支持步骤级 tabId，一个 flow 可操作多个 tab
- **代码分析** (26个): register_project_tool, find_text, get_symbols, find_usage 等`;

    const prompt = `## 身份

你连接了 **genspark-agent** 本地代理系统 (v1.0.52+)，可执行文件操作、命令、浏览器自动化等。
你的工具调用会被本地代理拦截并执行，不要质疑工具的可用性，直接使用即可。如果不确定，先用一个简单命令测试（如 echo hello），而不是拒绝。

> ⚠️ 重要：新对话开始时，请先执行一条简单命令验证系统连通性（如 \`echo hello\`），确认工具可用后再继续。不要假设工具不存在而拒绝执行。

---

## 工具调用格式 (ΩCODE 统一通道)

### 单步执行
ΩCODE
{"tool":"run_process","params":{"command_line":"echo hello","mode":"shell"}}
ΩCODEEND

### 多步批量执行
ΩCODE
{"steps":[{"tool":"...","params":{...},"saveAs":"s1"},{"tool":"...","params":{...},"when":"s1.success"}]}
ΩCODEEND

---

## 核心规则

1. 所有工具调用用 ΩCODE...ΩCODEEND 包裹
2. 等待结果再继续，永不假设或编造结果
3. 任务完成输出 @DONE

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
Ω{"tool":"run_command","params":{"command":"node /Users/yay/workspace/.agent_memory/context_loader.js 项目名"}}ΩSTOP
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




    // ============== DOM 操作 (Overchat 专用) ==============
  
  function getAIMessages() {
    // Overchat: div.styles-module__9lbQ2G__message
    return Array.from(document.querySelectorAll('div[class*="9lbQ2G__message"]')).filter(el => {
      // Filter out action rows, only keep actual message content divs
      return !el.className.includes('ActionsRow') && el.querySelector('[class*="markdown"], .prose, [class*="content"]');
    });
  }

  function getLatestAIMessage() {
    const messages = getAIMessages();
    if (messages.length === 0) return { text: '', index: -1, element: null };
    const lastMsg = messages[messages.length - 1];
    
    const contentEl = lastMsg.querySelector('[class*="markdown"]') || 
                      lastMsg.querySelector('.prose') ||
                      lastMsg;
    
    return { 
      text: contentEl?.innerText || lastMsg.innerText || '', 
      index: messages.length - 1,
      element: lastMsg
    };
  }

  function getInputBox() {
    // Overchat: textarea 输入框
    const selectors = [
      'textarea[placeholder*="Ask"]',
      'textarea[class*="c2wH9W__input"]',
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
        'button[class*="sendButton"]',
        'button[class*="1gdDQG__sendButton"]',
        'button[aria-label*="send" i]',
        'button[aria-label*="Send"]'
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
      
      // Overchat: 优先点击发送按钮，比 Enter 更可靠
      let sent = false;
      for (const sel of btnSelectors) {
        const btn = document.querySelector(sel);
        if (btn && btn.offsetParent !== null) {
          btn.click();
          sent = true;
          addLog('📤 点击发送按钮', 'info');
          break;
        }
      }
      
      if (!sent) {
        // 按钮没找到，用 Enter
        pressEnter();
        addLog('📤 Enter 发送', 'info');
      }
      
      // 1s 后检查一次，如果还没发出去就再试一次
      setTimeout(() => {
        const inp = getInputBox();
        const remaining = inp ? (inp.value || inp.innerText || '') : '';
        if (remaining && remaining.trim().length > 5) {
          // 再试一次点击按钮
          for (const sel of btnSelectors) {
            const btn = document.querySelector(sel);
            if (btn && btn.offsetParent !== null) {
              btn.click();
              addLog('📤 重试点击发送', 'info');
              return;
            }
          }
          pressEnter();
          addLog('📤 重试 Enter', 'info');
        }
      }, 1000);
      
      return true;
    };

    // Overchat: 简化发送流程，延迟 500ms 后一次发送
    setTimeout(() => trySend(), 500);
    return true;
  }

  // Dedup: prevent sending same result text twice within 5 seconds
  const _lastSentMessages = new Map();
  function sendMessageSafe(text) {
    // Dedup check: same text within 5s = skip
    const textKey = text.substring(0, 200);
    const now = Date.now();
    if (_lastSentMessages.has(textKey) && (now - _lastSentMessages.get(textKey)) < 5000) {
      log('sendMessageSafe dedup: skipping duplicate result');
      return;
    }
    _lastSentMessages.set(textKey, now);
    // Cleanup old entries
    if (_lastSentMessages.size > 20) {
      for (const [k, t] of _lastSentMessages) { if (now - t > 10000) _lastSentMessages.delete(k); }
    }

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

    function parseToolCalls(text) {
    // ========== ΩCODE 统一通道 (最高优先级) ==========
    const ocPrefix = String.fromCharCode(0x03A9) + "CODE";
    const ocEndTag = String.fromCharCode(0x03A9) + "CODEEND";
    let ocStart = text.indexOf(ocPrefix + String.fromCharCode(10));
    if (ocStart === -1) ocStart = text.indexOf(ocPrefix + "{");
    if (ocStart === -1) ocStart = text.indexOf(ocPrefix + " {");
    if (ocStart === -1) ocStart = text.indexOf(ocPrefix + " \n");
    if (ocStart !== -1) {
      const beforeOC = text.substring(Math.max(0, ocStart - 100), ocStart);
      if (!/Example:|e\.g\.|示例|格式/.test(beforeOC)) {
        try {
          const ocEndIdx = text.indexOf(ocEndTag, ocStart);
          if (ocEndIdx !== -1) {
            const hdrEnd = text.indexOf(String.fromCharCode(10), ocStart);
            let ocBody = text.substring(ocStart + ocPrefix.length, ocEndIdx).trim();
            // Strip leading newline if present
            if (ocBody.startsWith('\n')) ocBody = ocBody.substring(1).trim();
            ocBody = ocBody.replace(/^`+[\w]*\n?/, "").replace(/\n?`+$/, "").trim();
            const ocObj = safeJsonParse(ocBody);
            if (ocObj && (ocObj.tool || ocObj.steps)) {
              if (ocObj.steps && Array.isArray(ocObj.steps)) {
                return [{ name: "__BATCH__", params: ocObj, raw: text.substring(ocStart, ocEndIdx + 8), start: ocStart, end: ocEndIdx + 8, isBatch: true }];
              } else {
                return [{ name: ocObj.tool, params: ocObj.params || {}, raw: text.substring(ocStart, ocEndIdx + 8), start: ocStart, end: ocEndIdx + 8 }];
              }
            }
          }
        } catch (e) {
          if (CONFIG.DEBUG) console.log("[Agent] ΩCODE DOM fallback skip:", e.message);
        }
      }
    }

    return [];
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
    clearToolCallDetection();
    
    // === 本地拦截: list_tabs 查询所有标签页 ===
    if (tool.name === 'list_tabs') {
      addExecutedCall(callHash);
      showExecutingIndicator('list_tabs');
      state.agentRunning = true;
      updateStatus();
      addLog('🔧 list_tabs: 查询所有标签页', 'tool');
      
      const callId = 'list_tabs_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      
      const resultHandler = (msg) => {
        if (msg.type === 'LIST_TABS_RESULT' && msg.callId === callId) {
          chrome.runtime.onMessage.removeListener(resultHandler);
          clearTimeout(listTimeout);
          state.agentRunning = false;
          hideExecutingIndicator();
          updateStatus();
          const resultText = formatToolResult({ tool: 'list_tabs', success: msg.success, result: msg.result, error: msg.error });
          sendMessageSafe(resultText);
          addLog('✅ list_tabs 完成', 'success');
        }
      };
      chrome.runtime.onMessage.addListener(resultHandler);
      
      const listTimeout = setTimeout(() => {
        chrome.runtime.onMessage.removeListener(resultHandler);
        state.agentRunning = false;
        hideExecutingIndicator();
        updateStatus();
        const resultText = formatToolResult({ tool: 'list_tabs', success: false, error: '查询超时' });
        sendMessageSafe(resultText);
      }, 5000);
      
      chrome.runtime.sendMessage({ type: 'LIST_TABS', callId: callId });
      return;
    }
    
    // === 本地拦截: eval_js 直接在页面执行 ===
    if (tool.name === 'eval_js') {
      addExecutedCall(callHash);
      showExecutingIndicator('eval_js');
      state.agentRunning = true;
      updateStatus();
      
      const code = tool.params.code || '';
      const useMainWorld = tool.params.mainWorld === true;
      addLog(`🔧 eval_js: ${code.substring(0, 80)}${code.length > 80 ? '...' : ''}`, 'tool');
      
      try {
        // 通过 background script 的 chrome.scripting.executeScript 执行（绕过 CSP）
        const callId = 'eval_js_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        
        // 监听 background 返回的结果
        const resultHandler = (msg) => {
          if (msg.type === 'EVAL_JS_RESULT' && msg.callId === callId) {
            chrome.runtime.onMessage.removeListener(resultHandler);
            clearTimeout(evalTimeout);
            
            state.agentRunning = false;
            hideExecutingIndicator();
            updateStatus();
            const resultText = formatToolResult({
              tool: 'eval_js',
              success: msg.success,
              result: msg.success ? msg.result : undefined,
              error: msg.success ? undefined : msg.error
            });
            sendMessageSafe(resultText);
            addLog(msg.success ? '✅ eval_js 完成' : '❌ eval_js 失败: ' + msg.error, msg.success ? 'success' : 'error');
          }
        };
        chrome.runtime.onMessage.addListener(resultHandler);
        
        // 超时处理
        const evalTimeout = setTimeout(() => {
          chrome.runtime.onMessage.removeListener(resultHandler);
          state.agentRunning = false;
          hideExecutingIndicator();
          updateStatus();
          const resultText = formatToolResult({ tool: 'eval_js', success: false, error: '执行超时 (10秒)' });
          sendMessageSafe(resultText);
          addLog('❌ eval_js 超时', 'error');
        }, 10000);
        
        // 发送给 background 执行（支持跨 tab）
        const targetTabId = tool.params.tabId || null;
        chrome.runtime.sendMessage({ type: 'EVAL_JS', code: code, callId: callId, targetTabId: targetTabId }, (resp) => {
          if (chrome.runtime.lastError) {
            chrome.runtime.onMessage.removeListener(resultHandler);
            clearTimeout(evalTimeout);
            state.agentRunning = false;
            hideExecutingIndicator();
            updateStatus();
            const resultText = formatToolResult({ tool: 'eval_js', success: false, error: chrome.runtime.lastError.message });
            sendMessageSafe(resultText);
            addLog('❌ eval_js 发送失败: ' + chrome.runtime.lastError.message, 'error');
          }
        });
      } catch (e) {
        state.agentRunning = false;
        hideExecutingIndicator();
        updateStatus();
        const resultText = formatToolResult({ tool: 'eval_js', success: false, error: e.message });
        sendMessageSafe(resultText);
        addLog(`❌ eval_js 异常: ${e.message}`, 'error');
      }
      return;
    }
    // === END eval_js 拦截 ===

    // === 本地拦截: js_flow 浏览器 JS 微型工作流 ===
    if (tool.name === 'js_flow') {
      addExecutedCall(callHash);
      showExecutingIndicator('js_flow');
      state.agentRunning = true;
      updateStatus();

      const steps = tool.params.steps || [];
      const targetTabId = tool.params.tabId ? Number(tool.params.tabId) : undefined;
      const totalTimeout = tool.params.timeout || 60000;
      const flowId = 'js_flow_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

      addLog(`🔄 js_flow: ${steps.length} 步骤, tab=${targetTabId || 'current'}, timeout=${totalTimeout}ms`, 'tool');

      const flowStartTime = Date.now();
      const results = [];
      let aborted = false;

      const runStep = (stepIndex) => {
        if (aborted) return;
        if (stepIndex >= steps.length) {
          // 全部完成
          state.agentRunning = false;
          hideExecutingIndicator();
          updateStatus();
          const resultText = formatToolResult({ tool: 'js_flow', success: true, result: JSON.stringify(results, null, 2) });
          sendMessageSafe(resultText);
          addLog(`✅ js_flow 完成: ${results.length} 步`, 'success');
          return;
        }

        if (Date.now() - flowStartTime > totalTimeout) {
          aborted = true;
          state.agentRunning = false;
          hideExecutingIndicator();
          updateStatus();
          const resultText = formatToolResult({ tool: 'js_flow', success: false, error: `总超时 ${totalTimeout}ms, 完成 ${stepIndex}/${steps.length} 步`, result: JSON.stringify(results, null, 2) });
          sendMessageSafe(resultText);
          addLog(`❌ js_flow 总超时`, 'error');
          return;
        }

        const step = steps[stepIndex];
        const stepDelay = step.delay || 0;
        const stepLabel = step.label || `step${stepIndex}`;

        const stepTargetTab = step.tabId ? `tab=${step.tabId}` : '';
        addLog(`▶ js_flow [${stepIndex + 1}/${steps.length}] ${stepLabel}${stepTargetTab ? ' (' + stepTargetTab + ')' : ''}${stepDelay ? ' (delay ' + stepDelay + 'ms)' : ''}`, 'info');

        const executeCode = () => {
          // waitFor: 等待选择器出现或 JS 条件为真
          if (step.waitFor) {
            const waitTimeout = step.waitTimeout || 15000;
            const waitCode = step.waitFor.startsWith('!')
              || step.waitFor.includes('(') || step.waitFor.includes('.')
              || step.waitFor.includes('=') || step.waitFor.includes('>')
              ? step.waitFor  // JS 表达式
              : `!!document.querySelector('${step.waitFor.replace(/'/g, "\\'")}')`; // CSS 选择器

            const waitCallId = flowId + '_wait_' + stepIndex;
            const waitStart = Date.now();

            const pollWait = () => {
              if (aborted) return;
              if (Date.now() - waitStart > waitTimeout) {
                results.push({ step: stepLabel, success: false, error: `waitFor 超时: ${step.waitFor}` });
                if (step.optional) { runStep(stepIndex + 1); }
                else {
                  aborted = true;
                  state.agentRunning = false;
                  hideExecutingIndicator();
                  updateStatus();
                  const resultText = formatToolResult({ tool: 'js_flow', success: false, error: `步骤 ${stepLabel} waitFor 超时`, result: JSON.stringify(results, null, 2) });
                  sendMessageSafe(resultText);
                  addLog(`❌ js_flow waitFor 超时: ${step.waitFor}`, 'error');
                }
                return;
              }

              const stepTabId = step.tabId ? Number(step.tabId) : targetTabId;
              chrome.runtime.sendMessage({ type: 'EVAL_JS', code: `return (function(){ try { return !!(${waitCode}); } catch(e) { return false; } })()`, callId: waitCallId + '_' + Date.now(), targetTabId: stepTabId });

              // 简化: 用 onMessage 监听结果
              const onWaitResult = (msg) => {
                if (msg.type !== 'EVAL_JS_RESULT') return;
                chrome.runtime.onMessage.removeListener(onWaitResult);
                if (msg.result === 'true' || msg.result === true) {
                  doExec();
                } else {
                  setTimeout(pollWait, 500);
                }
              };
              chrome.runtime.onMessage.addListener(onWaitResult);
            };
            pollWait();
          } else {
            doExec();
          }
        };

        const doExec = () => {
          if (!step.code) {
            // 纯延迟/等待步骤，没有代码
            results.push({ step: stepLabel, success: true, result: '(no code)' });
            runStep(stepIndex + 1);
            return;
          }

          // 注入 ctx (前几步的结果)
          const ctxJson = JSON.stringify(results).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
          const wrappedCode = `return (async function(){ const ctx = JSON.parse('${ctxJson}'); ${step.code} })()`;

          const execCallId = flowId + '_exec_' + stepIndex;
          const onExecResult = (msg) => {
            if (msg.type !== 'EVAL_JS_RESULT' || !msg.callId || !msg.callId.startsWith(flowId + '_exec_' + stepIndex)) return;
            chrome.runtime.onMessage.removeListener(onExecResult);
            clearTimeout(execTimeout);
            results.push({ step: stepLabel, success: msg.success, result: msg.result || msg.error });
            addLog(`${msg.success ? '✓' : '✗'} ${stepLabel}: ${(msg.result || msg.error || '').substring(0, 100)}`, msg.success ? 'info' : 'error');
            if (!msg.success && !step.optional) {
              if (step.continueOnError) {
                runStep(stepIndex + 1);
              } else {
                aborted = true;
                state.agentRunning = false;
                hideExecutingIndicator();
                updateStatus();
                const resultText = formatToolResult({ tool: 'js_flow', success: false, error: `步骤 ${stepLabel} 失败: ${msg.error}`, result: JSON.stringify(results, null, 2) });
                sendMessageSafe(resultText);
                addLog(`❌ js_flow 在 ${stepLabel} 失败`, 'error');
              }
            } else {
              runStep(stepIndex + 1);
            }
          };

          chrome.runtime.onMessage.addListener(onExecResult);
          const execTimeout = setTimeout(() => {
            chrome.runtime.onMessage.removeListener(onExecResult);
            results.push({ step: stepLabel, success: false, error: '执行超时 (15s)' });
            if (step.optional || step.continueOnError) { runStep(stepIndex + 1); }
            else {
              aborted = true;
              state.agentRunning = false;
              hideExecutingIndicator();
              updateStatus();
              const resultText = formatToolResult({ tool: 'js_flow', success: false, error: `步骤 ${stepLabel} 执行超时`, result: JSON.stringify(results, null, 2) });
              sendMessageSafe(resultText);
            }
          }, 15000);

          const actualCallId = execCallId + '_' + Date.now();
          const stepTabId = step.tabId ? Number(step.tabId) : targetTabId;
          chrome.runtime.sendMessage({ type: 'EVAL_JS', code: wrappedCode, callId: actualCallId, targetTabId: stepTabId }, (resp) => {
            if (chrome.runtime.lastError) {
              chrome.runtime.onMessage.removeListener(onExecResult);
              clearTimeout(execTimeout);
              results.push({ step: stepLabel, success: false, error: chrome.runtime.lastError.message });
              if (step.optional || step.continueOnError) { runStep(stepIndex + 1); }
              else {
                aborted = true;
                state.agentRunning = false;
                hideExecutingIndicator();
                updateStatus();
                const resultText = formatToolResult({ tool: 'js_flow', success: false, error: chrome.runtime.lastError.message, result: JSON.stringify(results, null, 2) });
                sendMessageSafe(resultText);
              }
            }
          });
        };

        if (stepDelay > 0) {
          setTimeout(executeCode, stepDelay);
        } else {
          executeCode();
        }
      };

      try {
        runStep(0);
      } catch (e) {
        state.agentRunning = false;
        hideExecutingIndicator();
        updateStatus();
        const resultText = formatToolResult({ tool: 'js_flow', success: false, error: e.message });
        sendMessageSafe(resultText);
        addLog(`❌ js_flow 异常: ${e.message}`, 'error');
      }
      return;
    }
    // === END js_flow 拦截 ===

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
    // SSE 已执行当前消息的工具调用，跳过 DOM 检测避免重复
    if (sseState.executedInCurrentMessage && (Date.now() - sseState.lastDeltaTime < 30000)) return;
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
      // Unified hash format: shared between SSE and DOM paths to prevent duplicate execution
      const paramStr = JSON.stringify(tool.params).substring(0, 200);
      const roundCtx = state.roundCount || 0;
      const callHash = `cmd:${roundCtx}:${tool.name}:${paramStr}`;
      
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
      '支持批量执行: ΩCODE{"steps":[...]}ΩCODEEND',
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
        <button id="agent-terminal" title="迷你终端">⌨️ 终端</button>
        <button id="agent-reconnect" title="重连服务器">🔄</button>
        <button id="agent-reload-tools" title="刷新工具列表">🔧</button>
        <button id="agent-switch-server" title="切换本地/云端">🌐 云</button>
        <button id="agent-list" title="查看在线Agent">👥</button>
        <button id="agent-save" title="存档：保存当前进度到项目记忆">💾 存档</button>
        <button id="agent-video" title="生成视频：选题→Opus Pro→YouTube">🎬 视频</button>
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
      #agent-save { background: #065f46 !important; }
      #agent-save:hover { background: #047857 !important; }
      #agent-video { background: #dc2626 !important; }
      #agent-video:hover { background: #ef4444 !important; }
      #agent-terminal { background: #7c3aed !important; }
      #agent-terminal:hover { background: #8b5cf6 !important; }
      #mini-terminal {
        display: none;
        position: fixed;
        bottom: 80px;
        right: 20px;
        width: 480px;
        height: 320px;
        background: #0d1117;
        border: 1px solid #30363d;
        border-radius: 10px;
        z-index: 2147483647;
        box-shadow: 0 12px 40px rgba(0,0,0,0.6);
        font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
        font-size: 12px;
        color: #c9d1d9;
        flex-direction: column;
        overflow: hidden;
      }
      #mini-terminal.visible { display: flex; }
      #mini-terminal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 6px 12px;
        background: #161b22;
        border-bottom: 1px solid #30363d;
        cursor: move;
        user-select: none;
      }
      #mini-terminal-header span { font-size: 11px; color: #8b949e; }
      #mini-terminal-close {
        background: none;
        border: none;
        color: #8b949e;
        cursor: pointer;
        font-size: 14px;
        padding: 0 4px;
      }
      #mini-terminal-close:hover { color: #f85149; }
      #mini-terminal-output {
        flex: 1;
        overflow-y: auto;
        padding: 8px 12px;
        white-space: pre-wrap;
        word-break: break-all;
        font-size: 11.5px;
        line-height: 1.5;
      }
      #mini-terminal-output .term-cmd { color: #58a6ff; }
      #mini-terminal-output .term-ok { color: #7ee787; }
      #mini-terminal-output .term-err { color: #f85149; }
      #mini-terminal-output .term-dim { color: #484f58; }
      #mini-terminal-input-row {
        display: flex;
        align-items: center;
        padding: 6px 12px;
        border-top: 1px solid #30363d;
        background: #0d1117;
      }
      #mini-terminal-input-row .prompt { color: #7ee787; margin-right: 6px; font-weight: bold; }
      #mini-terminal-input {
        flex: 1;
        background: none;
        border: none;
        outline: none;
        color: #c9d1d9;
        font-family: inherit;
        font-size: 12px;
        caret-color: #58a6ff;
      }
    `;
    document.head.appendChild(style);

    document.getElementById('agent-save').onclick = () => {
      addLog('💾 存档中...', 'info');
      const saveBtn = document.getElementById('agent-save');
      saveBtn.disabled = true;
      saveBtn.textContent = '⏳';
      
      // 先获取命令历史路径
      const historyPath = '/Users/yay/workspace/genspark-agent/server-v2/command-history.json';
      
      // 先查活跃项目，再 digest
      chrome.runtime.sendMessage({
        type: 'SEND_TO_SERVER',
        payload: {
          type: 'tool_call',
          id: 'save_check_' + Date.now(),
          tool: 'run_command',
          params: { command: 'node /Users/yay/workspace/.agent_memory/memory_manager_v2.js status' }
        }
      }, (statusResp) => {
        // 从 status 输出中提取项目名，或使用默认值
        let project = 'genspark-agent';
        if (statusResp && statusResp.result) {
          const match = String(statusResp.result).match(/当前项目:\s*(\S+)/);
          if (match && match[1] !== '(未设置)') project = match[1];
        }
        
        chrome.runtime.sendMessage({
          type: 'SEND_TO_SERVER',
          payload: {
            type: 'tool_call',
            id: 'save_' + Date.now(),
            tool: 'run_command',
            params: { command: 'node /Users/yay/workspace/.agent_memory/memory_manager_v2.js digest ' + project + ' ' + historyPath }
          }
        }, (resp) => {
          saveBtn.disabled = false;
          saveBtn.textContent = '💾 存档';
          if (resp && resp.success) {
            addLog('💾 存档成功！项目: ' + project, 'success');
          } else {
            addLog('❌ 存档失败: ' + (resp?.error || '未知错误'), 'error');
          }
        });
      });
    };

    document.getElementById('agent-video').onclick = () => {
      if (window.VideoGenerator) {
        window.VideoGenerator.showTopicDialog(addLog);
      } else {
        addLog('❌ VideoGenerator 模块未加载，请刷新页面', 'error');
      }
    };

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
    
    // === 迷你终端 ===
    const terminalHTML = `
      <div id="mini-terminal">
        <div id="mini-terminal-header">
          <span>⌨️ Mini Terminal</span>
          <button id="mini-terminal-close">✕</button>
        </div>
        <div id="mini-terminal-output"><span class="term-dim">Welcome. Type commands and press Enter.</span>\n</div>
        <div id="mini-terminal-input-row">
          <span class="prompt">❯</span>
          <input id="mini-terminal-input" type="text" placeholder="ls, git status, node -v ..." autocomplete="off" spellcheck="false" />
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', terminalHTML);

    const termEl = document.getElementById('mini-terminal');
    const termOutput = document.getElementById('mini-terminal-output');
    const termInput = document.getElementById('mini-terminal-input');
    const termHistory = [];
    let termHistoryIndex = -1;
    let termCwd = '/Users/yay/workspace';

    // 拖拽支持
    let isDragging = false, dragOffX = 0, dragOffY = 0;
    document.getElementById('mini-terminal-header').addEventListener('mousedown', (e) => {
      isDragging = true;
      dragOffX = e.clientX - termEl.getBoundingClientRect().left;
      dragOffY = e.clientY - termEl.getBoundingClientRect().top;
    });
    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      termEl.style.left = (e.clientX - dragOffX) + 'px';
      termEl.style.top = (e.clientY - dragOffY) + 'px';
      termEl.style.right = 'auto';
      termEl.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', () => { isDragging = false; });

    document.getElementById('agent-terminal').onclick = () => {
      termEl.classList.toggle('visible');
      if (termEl.classList.contains('visible')) termInput.focus();
    };

    document.getElementById('mini-terminal-close').onclick = () => {
      termEl.classList.remove('visible');
    };

    function termAppend(html) {
      termOutput.innerHTML += html;
      termOutput.scrollTop = termOutput.scrollHeight;
    }

    // 终端结果监听器
    const termPendingCalls = new Map(); // callId -> true 或 { type: 'cd_check' }
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'tool_result' && msg.id && termPendingCalls.has(msg.id)) {
        const callInfo = termPendingCalls.get(msg.id);
        termPendingCalls.delete(msg.id);
        termInput.disabled = false;
        termInput.focus();

        // cd 验证结果
        if (callInfo && callInfo.type === 'cd_check') {
          if (msg.success) {
            const realPath = String(msg.result || '').replace(/^\[#\d+\]\s*/, '').trim();
            if (realPath) termCwd = realPath;
            termAppend(`<span class="term-dim">${termCwd}</span>\n`);
            document.querySelector('#mini-terminal-input-row .prompt').textContent = termCwd.split('/').pop() + ' ❯';
          } else {
            termCwd = '/Users/yay/workspace';
            termAppend(`<span class="term-err">cd: no such directory</span>\n`);
          }
          return;
        }

        if (msg.success) {
          // 去掉 [#xxx] 前缀
          const text = String(msg.result || '').replace(/^\[#\d+\]\s*/, '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          termAppend(`<span class="term-ok">${text}</span>\n`);
        } else {
          const err = String(msg.error || 'Unknown error').replace(/</g, '&lt;');
          termAppend(`<span class="term-err">${err}</span>\n`);
        }
      }
    });

    function termExec(cmd) {
      if (!cmd.trim()) return;
      termHistory.push(cmd);
      termHistoryIndex = termHistory.length;
      termAppend(`<span class="term-cmd">❯ ${cmd}</span>\n`);
      termInput.value = '';

      // 处理 cd 命令
      const cdMatch = cmd.trim().match(/^cd\s+(.+)/);
      if (cdMatch) {
        let target = cdMatch[1].trim().replace(/["']/g, '');
        // 解析相对路径
        if (target === '..') {
          termCwd = termCwd.replace(/\/[^\/]+$/, '') || '/';
        } else if (target === '~') {
          termCwd = '/Users/yay';
        } else if (target.startsWith('/')) {
          termCwd = target;
        } else if (target === '-') {
          // 忽略 cd - 
        } else {
          termCwd = termCwd + '/' + target;
        }
        // 验证目录是否存在
        termInput.disabled = true;
        const checkId = 'term_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        termPendingCalls.set(checkId, { type: 'cd_check' });
        chrome.runtime.sendMessage({
          type: 'SEND_TO_SERVER',
          payload: { type: 'tool_call', tool: 'run_command', params: { command: `cd ${termCwd} && pwd` }, id: checkId }
        }, (resp) => {
          if (chrome.runtime.lastError || !resp || !resp.success) {
            termPendingCalls.delete(checkId);
            termCwd = termHistory.length > 1 ? termCwd : '/Users/yay/workspace';
            termInput.disabled = false;
            termInput.focus();
            termAppend(`<span class="term-err">cd: no such directory</span>\n`);
          }
        });
        setTimeout(() => {
          if (termPendingCalls.has(checkId)) {
            termPendingCalls.delete(checkId);
            termInput.disabled = false;
            termInput.focus();
          }
        }, 10000);
        return;
      }

      // 处理 clear 命令
      if (cmd.trim() === 'clear' || cmd.trim() === 'cls') {
        termOutput.innerHTML = '';
        return;
      }

      termInput.disabled = true;

      // 实际命令：加上 cwd 前缀
      const actualCmd = `cd ${termCwd} && ${cmd}`;

      const callId = 'term_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      termPendingCalls.set(callId, true);

      // 超时保护
      setTimeout(() => {
        if (termPendingCalls.has(callId)) {
          termPendingCalls.delete(callId);
          termInput.disabled = false;
          termInput.focus();
          termAppend(`<span class="term-err">Timeout (30s)</span>\n`);
        }
      }, 30000);

      chrome.runtime.sendMessage({
        type: 'SEND_TO_SERVER',
        payload: {
          type: 'tool_call',
          tool: 'run_command',
          params: { command: actualCmd },
          id: callId
        }
      }, (resp) => {
        if (chrome.runtime.lastError) {
          termPendingCalls.delete(callId);
          termInput.disabled = false;
          termInput.focus();
          termAppend(`<span class="term-err">Send failed: ${chrome.runtime.lastError.message}</span>\n`);
          return;
        }
        if (!resp || !resp.success) {
          termPendingCalls.delete(callId);
          termInput.disabled = false;
          termInput.focus();
          termAppend(`<span class="term-err">Server not connected</span>\n`);
        }
      });
    }

    termInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        termExec(termInput.value);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (termHistoryIndex > 0) {
          termHistoryIndex--;
          termInput.value = termHistory[termHistoryIndex];
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (termHistoryIndex < termHistory.length - 1) {
          termHistoryIndex++;
          termInput.value = termHistory[termHistoryIndex];
        } else {
          termHistoryIndex = termHistory.length;
          termInput.value = '';
        }
      } else if (e.key === 'Escape') {
        termEl.classList.remove('visible');
      }
    });
    
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

      // ===== 浏览器工具反向调用（来自 ΩCODE 中的 js_flow/eval_js/list_tabs）=====
      case 'browser_tool_call': {
        const { callId, tool: bTool, params: bParams } = msg;
        addLog(`🔄 BATCH→浏览器: ${bTool} (${callId})`, 'tool');

        const sendBrowserResult = (success, result, error) => {
          chrome.runtime.sendMessage({
            type: 'SEND_TO_SERVER',
            payload: { type: 'browser_tool_result', callId, success, result, error }
          });
          addLog(`${success ? '✅' : '❌'} BATCH←浏览器: ${bTool}`, success ? 'success' : 'error');
        };

        if (bTool === 'list_tabs') {
          const ltCallId = 'bt_lt_' + Date.now();
          const ltHandler = (m) => {
            if (m.type === 'LIST_TABS_RESULT' && m.callId === ltCallId) {
              chrome.runtime.onMessage.removeListener(ltHandler);
              sendBrowserResult(m.success, m.result, m.error);
            }
          };
          chrome.runtime.onMessage.addListener(ltHandler);
          chrome.runtime.sendMessage({ type: 'LIST_TABS', callId: ltCallId });
        } else if (bTool === 'eval_js') {
          const ejCallId = 'bt_ej_' + Date.now();
          const ejHandler = (m) => {
            if (m.type === 'EVAL_JS_RESULT' && m.callId === ejCallId) {
              chrome.runtime.onMessage.removeListener(ejHandler);
              sendBrowserResult(m.success, m.result, m.error);
            }
          };
          chrome.runtime.onMessage.addListener(ejHandler);
          chrome.runtime.sendMessage({ type: 'EVAL_JS', code: bParams.code || '', callId: ejCallId, targetTabId: bParams.tabId || null });
        } else if (bTool === 'js_flow') {
          // js_flow 比较特殊：复用现有的 executeToolCall 逻辑太复杂
          // 直接内联一个简化版：逐步执行，收集结果
          const steps = bParams.steps || [];
          const flowTabId = bParams.tabId ? Number(bParams.tabId) : undefined;
          const results = [];
          let flowAborted = false;

          const runFlowStep = (si) => {
            if (flowAborted) return;
            if (si >= steps.length) {
              sendBrowserResult(true, JSON.stringify(results, null, 2));
              return;
            }
            const s = steps[si];
            const sLabel = s.label || `step${si}`;
            const sTabId = s.tabId ? Number(s.tabId) : flowTabId;
            const sDelay = s.delay || 0;

            const doStep = () => {
              if (!s.code) {
                results.push({ step: sLabel, success: true, result: '(no code)' });
                runFlowStep(si + 1);
                return;
              }
              const ctxJson = JSON.stringify(results).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
              const wrapped = `return (async function(){ const ctx = JSON.parse('${ctxJson}'); ${s.code} })()`;
              const sCallId = 'bt_fl_' + si + '_' + Date.now();
              const sHandler = (m) => {
                if (m.type !== 'EVAL_JS_RESULT' || m.callId !== sCallId) return;
                chrome.runtime.onMessage.removeListener(sHandler);
                results.push({ step: sLabel, success: m.success, result: m.result || m.error });
                if (!m.success && !s.optional && !s.continueOnError) {
                  flowAborted = true;
                  sendBrowserResult(false, JSON.stringify(results, null, 2), `步骤 ${sLabel} 失败: ${m.error}`);
                } else {
                  runFlowStep(si + 1);
                }
              };
              chrome.runtime.onMessage.addListener(sHandler);
              chrome.runtime.sendMessage({ type: 'EVAL_JS', code: wrapped, callId: sCallId, targetTabId: sTabId });
            };

            if (sDelay > 0) setTimeout(doStep, sDelay);
            else doStep();
          };
          runFlowStep(0);
        } else {
          sendBrowserResult(false, null, `未知浏览器工具: ${bTool}`);
        }
        break;
      }

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
        // 终端命令的结果不注入聊天框，由终端自己处理
        if (msg.id && msg.id.startsWith('term_')) {
          log('终端结果，跳过聊天框注入:', msg.id);
          break;
        }
        // 存档检查命令不注入聊天框，但 digest 结果需要注入
        if (msg.id && msg.id.startsWith('save_check_')) {
          log('存档检查结果，跳过聊天框注入:', msg.id);
          break;
        }
        if (msg.id && msg.id.startsWith('save_') && msg.success && msg.result) {
          log('存档完成，注入 digest 结果到聊天框');
          const digestText = '💾 **项目上下文已更新：**\n\n' + msg.result;
          sendMessageSafe(digestText);
          break;
        }
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
    log('初始化 Agent v1.0.0 (Overchat)');
    
    createPanel();
    
    // 加载面板增强模块
    loadPanelEnhancer();
    loadVideoGenerator();

    // 初始化 SSE 监听器（优先通道）
    initSSEListener();

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
