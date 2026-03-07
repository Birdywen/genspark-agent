// content.js v1.0.53 - REC增强 - Ω标记格式 - 添加 Agent 心跳机制，确保跨 Tab 通信可靠
(function() { console.log('=== GENSPARK AGENT v35 LOADED ===');
  'use strict';

  // 防止脚本重复加载
  if (window.__GENSPARK_AGENT_LOADED__) {
    console.log('[Agent] 已加载，跳过重复初始化');
    return;
  }
  window.__GENSPARK_AGENT_LOADED__ = true;

  // Per-tab disable: check localStorage
  const DISABLED_KEY = 'agent_disabled_' + location.href.split('?')[1];
  const isDisabled = localStorage.getItem(DISABLED_KEY) === 'true';
  
  // Create floating toggle button
  setTimeout(() => {
    const btn = document.createElement('div');
    btn.id = 'agent-toggle-btn';
    btn.innerHTML = isDisabled ? '🔴' : '🟢';
    btn.title = isDisabled ? 'Agent: OFF (click to enable)' : 'Agent: ON (click to disable)';
    btn.style.cssText = 'position:fixed;bottom:70px;right:12px;z-index:99999;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:16px;background:#1a1a2e;border:1px solid #333;box-shadow:0 2px 8px rgba(0,0,0,0.3);opacity:0.7;transition:opacity 0.2s;';
    // 修复 Genspark 页面中文排版：去掉 justify 两端对齐
    const fixStyle = document.createElement('style');
    fixStyle.id = 'agent-fix-justify';
    fixStyle.textContent = `
      * { text-align: left !important; text-justify: none !important; }
      p, li, div, span, td, th, pre, code, blockquote,
      .markdown-viewer, .markdown-viewer *, .bubble, .bubble *,
      .conversation-statement, .conversation-statement *,
      [class*="message"], [class*="content"], [class*="chat"] {
        text-align: left !important;
        text-justify: none !important;
        word-spacing: normal !important;
      }
    `;
    document.head.appendChild(fixStyle);
    btn.onmouseenter = () => btn.style.opacity = '1';
    btn.onmouseleave = () => btn.style.opacity = '0.7';
    btn.onclick = () => {
      const current = localStorage.getItem(DISABLED_KEY) === 'true';
      localStorage.setItem(DISABLED_KEY, current ? 'false' : 'true');
      btn.innerHTML = current ? '🟢' : '🔴';
      btn.title = current ? 'Agent: ON (click to disable)' : 'Agent: OFF (click to enable)';
      if (!current) {
        // Just disabled - show notice
        const notice = document.createElement('div');
        notice.textContent = 'Agent disabled on this page. Refresh to take effect.';
        notice.style.cssText = 'position:fixed;bottom:110px;right:12px;z-index:99999;background:#333;color:#fff;padding:8px 12px;border-radius:8px;font-size:12px;';
        document.body.appendChild(notice);
        setTimeout(() => notice.remove(), 3000);
      }
    };
    document.body.appendChild(btn);
  }, 2000);

  if (isDisabled) {
    console.log('[Agent] Disabled on this page via toggle');
    return;
  }

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

  // ── SSE→DOM 短生命周期去重（不持久化，自动过期）──
  const _dedupKeys = new Map(); // key → expireTimestamp
  function addDedupKey(key, ttlMs) {
    if (ttlMs === undefined) ttlMs = 15000;
    _dedupKeys.set(key, Date.now() + ttlMs);
  }
  function hasDedupKey(key) {
    const expire = _dedupKeys.get(key);
    if (!expire) return false;
    if (Date.now() > expire) { _dedupKeys.delete(key); return false; }
    return true;
  }
  // 定期清理过期 key
  setInterval(function() {
    var now = Date.now();
    _dedupKeys.forEach(function(exp, k) { if (now > exp) _dedupKeys.delete(k); });
  }, 30000);

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

  // VideoGenerator 通过 manifest.json content_scripts 在 content.js 之前加载，无需手动加载


  
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
        // 最后尝试：提取工具名和所有参数
        const toolMatch = fixed.match(/"tool"\s*:\s*"(\w[\w:-]*)"/);
        if (toolMatch) {
          const params = {};
          // 提取 JSON 字符串值的辅助函数（处理转义引号）
          function extractJsonStringValue(str, key) {
            const keyPattern = new RegExp('"' + key + '"\\s*:\\s*"');
            const m = keyPattern.exec(str);
            if (!m) return null;
            let start = m.index + m[0].length;
            let esc = false;
            for (let i = start; i < str.length; i++) {
              if (esc) { esc = false; continue; }
              if (str[i] === '\\') { esc = true; continue; }
              if (str[i] === '"') return str.substring(start, i);
            }
            return null;
          }
          // 提取所有常用字符串字段
          const fields = ['path', 'command', 'stdin', 'url', 'directory', 'pattern', 'content',
                          'code', 'condition', 'label', 'slotId', 'lastN', 'tabId', 'query'];
          for (const f of fields) {
            const v = extractJsonStringValue(fixed, f);
            if (v !== null) params[f] = v;
          }
          // 提取数值字段
          const numFields = ['interval', 'timeout', 'tabId'];
          for (const f of numFields) {
            const nm = fixed.match(new RegExp('"' + f + '"\\s*:\\s*(\\d+)'));
            if (nm) params[f] = parseInt(nm[1]);
          }
          // 提取 edits 数组（edit_file）
          const editsIdx = fixed.indexOf('"edits"');
          if (editsIdx !== -1) {
            const arrStart = fixed.indexOf('[', editsIdx);
            if (arrStart !== -1) {
              let depth = 0, inStr = false, esc2 = false;
              for (let i = arrStart; i < fixed.length; i++) {
                const ch = fixed[i];
                if (esc2) { esc2 = false; continue; }
                if (ch === '\\') { esc2 = true; continue; }
                if (ch === '"') { inStr = !inStr; continue; }
                if (inStr) continue;
                if (ch === '[') depth++;
                if (ch === ']') { depth--; if (depth === 0) { try { params.edits = JSON.parse(fixed.substring(arrStart, i + 1)); } catch(ee) {} break; } }
              }
            }
          }
          console.warn('[Agent] Partial parse for tool:', toolMatch[1], 'fields:', Object.keys(params).join(','));
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
- **文件系统** (14个): read_file, write_file, edit_file, list_directory, read_multiple_files, read_media_file 等
  - **read_media_file(path)** — 读取图片/媒体文件并直接展示。支持 PNG/JPG/GIF/Web等格式。读取图片时必须用此工具，不要用 OCR 或 base64 命令替代
- **浏览器自动化** (26个): browser_navigate, browser_snapshot, browser_click, browser_type 等  
- **命令执行** (4个): run_command, bg_run, bg_status, bg_kill
- **页面脚本** (4个): 直接操控浏览器标签页，绕过 CSP/Cloudflare
  - **list_tabs** — 查询所有打开的标签页，返回 id/title/url/active/windowId。无需参数
  - **eval_js(code, [tabId])** — 在 MAIN world 执行 JS，可访问页面全局变量/DOM/cookie。用 return 返回结果。支持 async/Promise
  - **js_flow(steps, [tabId], [timeout])** — 浏览器 JS 微型工作流，多步骤顺序执行，支持 delay 延迟、waitFor 等待条件、ctx 上下文传递。每步可设 label/optional/continueOnError/tabId
  - **async_task(code, condition, [tabId], [interval], [timeout], [label])** \u2014 \u540e\u53f0\u5f02\u6b65\u76d1\u63a7\u5668\uff0c\u8f6e\u8be2\u76f4\u5230\u6761\u4ef6\u6ee1\u8db3\u540e\u901a\u77e5\u3002code \u5fc5\u987b\u7528 .then() \u4e0d\u80fd\u7528 await\n  - 跨 tab 操作流程: 先 list_tabs 获取目标 tabId → 再 eval_js/js_flow/async_task 指定 tabId 操作目标页面
  - **操作网页前**: 先查 page_elements 表获取已知选择器 (SELECT selector,text_content FROM page_elements WHERE site='站点名')，没有记录才扫描
- **代码分析** (26个): register_project_tool, find_text, get_symbols, find_usage 等`;

    const prompt = `## 核心行为准则（最高优先级）

1. **等待确认再继续** — 发出工具调用后，必须等待执行结果返回，确认成功或失败后才能继续。绝不假设或编造执行结果。
2. **代码块包裹所有工具调用** — 工具调用必须放在 markdown 围栏代码块内（用三个反引号包裹），文字说明和代码块之间必须留一个空行。
3. **一次只发一条命令，放在回复最后** — 除 ΩBATCH 外，每条回复只包含一个工具调用，且必须放在所有说明文字之后。
4. **多个独立操作用 ΩBATCH 批量执行** — 减少往返轮次。
5. **任务完成输出 @DONE** — 仅在用户交代的完整任务（含多步骤）全部完成时输出。简单问答、单步操作不需要。
6. **统一使用 ΩHERE 格式** — 所有工具调用默认用 ΩHERE 格式，确保零转义、零损坏。

---

## 身份

你连接了 **genspark-agent** 本地代理系统 (v1.0.52+)，可执行文件操作、命令、浏览器自动化等。
工具调用会被本地代理拦截并执行，不要质疑可用性，直接使用。不确定时先用简单命令测试（如 echo hello）。

### 远程手机桥接 (Team Chat Bridge)

- 消息以 **[来自 phone-bridge 的消息]** 开头 → 来自手机端，回复用: sos say "回复内容"
- Bridge 管理: sos bridge / sos bridge-stop / sos bridge-status
- 回复手机端要简洁，适合手机阅读

### 新对话 Checklist

1. 执行 \`echo hello\` 验证连通性，**等待结果确认**后再继续
2. 涉及已知项目（genspark-agent / ezmusicstore / oracle-cloud）→ 先恢复上下文
3. 多项任务或复杂开发 → 创建 /Users/yay/workspace/TODO.md

---

## 工具调用格式

### ΩHERE Heredoc 格式（默认）

ΩHERE 工具名 @参数=值 @大内容参数<<分隔符
任意内容（零转义，原样传递）
分隔符
ΩEND

**run_command 示例:**
ΩHERE run_command
@command=bash
@stdin<<SCRIPT
echo "hello $USER"
SCRIPT
ΩEND

edit_file 用 @edits @oldText<<OLD ... OLD @newText<<NEW ... NEW 分隔。oldText 必须与文件完全一致，匹配失败改用 write_file 重写。

规则: 数值自动转换，true/false 转布尔值。分隔符可为任意标识符（EOF/SCRIPT/CODE）。
自定义结束标记: 内容含 ΩEND 时，用 ΩHERE 工具名 自定义结束词。

### 批量执行 (ΩBATCH)

ΩBATCH{"steps":[ {"tool":"工具1","params":{...},"saveAs":"变量名"}, {"tool":"工具2","params":{...},"when":{"var":"变量名","success":true}} ],"stopOnError":false}ΩEND

when 条件: success / contains / regex（用 var 不是 variable）

| 场景 | 格式 |
|------|------|
| 纯 bash 多步操作 | 单个 ΩHERE bash 脚本 |
| 跨工具 + 简单参数 | ΩBATCH |
| 适合批量 | 查询、API 调用、环境检查 |
| 不适合批量 | write_file 长内容(>50行)、edit_file 复杂修改 |

### 高级调度与标记

- ΩPLAN{"goal":"..."} — 智能规划 | ΩFLOW{"template":"..."} — 工作流 | ΩRESUME{"taskId":"..."} — 断点续传
- base64 模式: content/stdin/code 以 \`base64:\` 开头自动解码
- 重试: @RETRY:#ID | 协作: ΩSEND:目标agent:消息ΩSENDEND

---

## 实战指南

### 命令执行

- **禁止把命令放在 command 参数里**: 必须用 \`{"command":"bash","stdin":"echo hello"}\`
- 超长脚本（50行以上）先 write_file 写到 /private/tmp/ 再 bash 执行
- ffmpeg 复杂命令一律写成 .sh 脚本文件再 bash 执行

### 代码修改

- 1-20 行小修改 → edit_file | 20+ 行或结构性修改 → write_file | 不确定 → 先 read_file
- 修改后验证语法: JS 用 \`node -c\`，Python 用 \`python3 -m py_compile\`
- **修改服务器核心文件前必须备份**（\`cp xxx xxx.bak\`），验证通过后再重启

### 工具选择优先级（必须遵守）

| 场景 | 正确工具 | 禁止 |
|------|----------|------|
| 读取图片/媒体 | **read_media_file** | read_file、base64 命令 |
| 抓取网络图片 | **imageFetch** | curl/wget |
| 代码搜索 | **find_text** (tree-sitter) | grep/rg |
| 查找符号/引用 | **get_symbols / find_usage** | grep |
| 查库/框架文档 | **context7: query-docs** | web_search |
| Git/GitHub | **github** 工具集 | run_command+git (简单 add/commit/push 除外) |
| 跨会话记忆 | **memory** 工具集 | 无 |
| SSH 远程执行 | **ssh-oracle:exec / ssh-cpanel:exec** | run_command+ssh |
| SSH 远程文件 | **ssh-oracle:read_file / write_file / edit_file** | ssh exec+cat/sed/转义 |
| 截图 | **take_screenshot** | 无 |
| 网络请求调试 | **list_network_requests** | 无 |

### 长时间命令（防 timeout）

系统自动识别长时间命令并路由到 bg_run 后台执行。收到 bg_run (auto) 时用 bg_status 查进度。
bg_run（后台启动）/ bg_status（查状态，lastN 控制输出行数）/ bg_kill（终止）。最多 5 并发槽位。

### 错误处理

- 不编造结果，错误后先分析原因，同一方式最多重试 2 次，2 次失败换方式或报告用户
- 工具未找到→检查拼写 | 权限拒绝→检查路径 | 文件不存在→list_directory 确认
- **eval_js 超时不代表请求未发出** — 超时后先检查操作是否已成功，绝不直接重试
- 服务器排查: ps aux | grep node → lsof -i :8766 → curl localhost:8766/status → 查 server-v2/logs/

---

## 环境

### 可用工具

\${toolSummary}

### 系统

- macOS arm64 (Apple Silicon)
- 可用: pandoc, ffmpeg, ImageMagick, jq, sqlite3, git, python3, node/npm, rg, fd, curl, wget
- 允许目录: /Users/yay/workspace, /Users/yay/Documents, /tmp
- **注意**: macOS 桌面/下载等目录有沙盒限制，引导用户放到 workspace 或 Documents
- **注意**: /tmp 路径要用 /private/tmp（macOS 的 /tmp 是符号链接但工具校验不认）

### 远程与运维

- SSH 禁止 run_command+ssh，使用 ssh-oracle:exec / ssh-cpanel:exec
- SSH 远程文件操作优先用 read_file/write_file/edit_file（SFTP 直传，零转义问题）
- edit_file 用 @oldText<< @newText<< heredoc 格式，内容原样传输不经 shell
- 服务器重启: curl http://localhost:8766/restart 或 touch /tmp/genspark-restart-trigger
- 查看所有工具: node /Users/yay/workspace/genspark-agent/server-v2/list-tools.js

---

## 基础设施 (Infrastructure)

新对话开始时，执行以下命令读取配置状态（脱敏，不暴露密钥）：


bash /Users/yay/workspace/genspark-agent/env_check.sh


### 快速参考

**服务器：**
- Oracle ARM (猛兽): 150.136.51.61 — 4核 24GB, SSH: \`ssh -i ~/.ssh/oracle-cloud.key ubuntu@150.136.51.61\`
- Oracle AMD (轻量): 157.151.227.157 — 2核 1GB, SSH: \`ssh -i ~/.ssh/oracle-cloud.key ubuntu@157.151.227.157\`
- Sandbox (高性能): https://3000-isjad10r8glpogdbe5r7n-02b9cc79.sandbox.novita.ai — 4核 8GB, POST /api/exec
- Sandbox (标准): https://3000-i3tin0xbrjov9c7se6vov-8f57ffe2.sandbox.novita.ai

**AI API：**
- 1min.ai: ~31.5M credits, 支持 GPT-4.1/Claude Opus 4/o3 等, key 在 .env
- Genspark: ~8500 credits, 通过 ask_proxy 调用

**SOS 工具箱（本地 CLI）：**
- \`sos ask "问题"\` — AI 问答 | \`sos se "命令"\` — Sandbox 执行 | \`sos sp 文件\` — 推文件到 Sandbox
- \`sos sl/sr/ss/su\` — 列目录/读文件/状态/URL | \`sos say "消息"\` — 手机推送

**部署：**
- Cloudflare Workers: wrangler deploy (从 sandbox)
- Dashboard: https://agent-dashboard.woshipeiwenhao.workers.dev

**保活：** ARM 上 PM2 运行 sandbox-keepalive，每3分钟 ping，失败3次 ntfy 告警

### 上下文恢复

涉及以下项目时先恢复上下文：genspark-agent / ezmusicstore / oracle-cloud


Ω{"tool":"run_command","params":{"command":"node /Users/yay/workspace/.agent_memory/context_loader.js 项目名"}}ΩSTOP

---

⚠️ **每次回复前自检：工具调用是否在代码块内？是否在回复最后？格式是否为 ΩHERE？**
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

  // HEREDOC 格式解析器
  function parseHeredocFormat(text) {
    var calls = [];
    var OMEGA = String.fromCharCode(0x03A9);
    var MARKER = OMEGA + "HERE";
    var END_STR = OMEGA + "END";
    var NL = String.fromCharCode(10);
    var searchFrom = 0;
    while (true) {
      var si = text.indexOf(MARKER, searchFrom);
      if (si === -1) break;
      // 先找 header 行获取工具名和可选的自定义结束标记
      var he = text.indexOf(NL, si);
      if (he === -1) break;
      var hdr = text.substring(si + MARKER.length, he).trim();
      var hdrParts = hdr.split(/\s+/);
      if (!hdrParts[0] || !hdrParts[0].match(/^[a-zA-Z_][a-zA-Z0-9_:-]*$/)) { searchFrom = si + 1; continue; }
      var toolName = hdrParts[0];
      var customEnd = hdrParts.length > 1 ? hdrParts[1] : null;
      // 用自定义结束标记或默认 omega END
      var actualEnd = customEnd || END_STR;
      var endNL = text.indexOf(NL + actualEnd, he);
      var ei = (endNL !== -1) ? endNL : text.indexOf(actualEnd, he);
      if (ei === -1) { searchFrom = he; break; }
      var bStart = Math.max(0, si - 50);
      var before = text.substring(bStart, si).toLowerCase();
      var skip = before.indexOf("example") !== -1;
      if (skip) { searchFrom = ei + actualEnd.length + 1; continue; }
      var body = text.substring(he + 1, ei);
      var params = {};
      var blines = body.split(NL);
      var idx = 0;
      while (idx < blines.length) {
        var line = blines[idx];
        var hdm = line.match(/^@(\w+)<<(\S+)\s*$/);
        if (hdm) {
          var hkey = hdm[1], delim = hdm[2], buf = [];
          idx++;
          while (idx < blines.length && blines[idx] !== delim) {
            buf.push(blines[idx]); idx++;
          }
          params[hkey] = buf.join(NL);
          idx++;
          continue;
        }
        var spm = line.match(/^@(\w+)=(.*)$/);
        if (spm) {
          var skey = spm[1], sval = spm[2];
          if (/^\d+$/.test(sval)) sval = parseInt(sval);
          else if (sval === "true") sval = true;
          else if (sval === "false") sval = false;
          params[skey] = sval;
          idx++;
          continue;
        }
        if (line.trim() === "@edits" || line.indexOf("@oldText<<") === 0) {
          if (!params.edits) params.edits = [];
          if (line.trim() === "@edits") { idx++; } // skip @edits marker line
          while (idx < blines.length) {
            var eline = blines[idx];
            if (eline.indexOf("@oldText<<") === 0) {
              var odm = eline.match(/^@oldText<<(\S+)/);
              if (!odm) break;
              var odelim = odm[1], obuf = [];
              idx++;
              while (idx < blines.length && blines[idx] !== odelim) {
                obuf.push(blines[idx]); idx++;
              }
              idx++;
              if (idx < blines.length && blines[idx].indexOf("@newText<<") === 0) {
                var ndm = blines[idx].match(/^@newText<<(\S+)/);
                if (!ndm) break;
                var ndelim = ndm[1], nbuf = [];
                idx++;
                while (idx < blines.length && blines[idx] !== ndelim) {
                  nbuf.push(blines[idx]); idx++;
                }
                idx++;
                params.edits.push({ oldText: obuf.join(NL), newText: nbuf.join(NL) });
              }
            } else { break; }
          }
          continue;
        }
        idx++;
      }
      var noParamTools = ['list_tabs', 'health_check', 'reload_tools'];
      if (Object.keys(params).length > 0 || noParamTools.indexOf(toolName) !== -1) {
        calls.push({
          name: toolName,
          params: params,
          start: si,
          end: ei + END_STR.length + 1,
          isHeredoc: true
        });
      }
      searchFrom = ei + actualEnd.length + 1;
    }
    return calls;
  }

  // HEREBATCH 格式解析器 - 多个 HEREDOC 工具调用的批量执行
  function parseHereBatchFormat(text) {
    var MARKER_START = 'ΩHEREBATCH';
    var MARKER_END = 'ΩHEREBATCHEND';
    var HERE = 'ΩHERE';
    var NL = String.fromCharCode(10);
    
    var si = text.indexOf(MARKER_START);
    if (si === -1) return null;
    var ei = text.indexOf(MARKER_END, si);
    if (ei === -1) return null;
    
    // Skip examples
    var before = text.substring(Math.max(0, si - 30), si).toLowerCase();
    if (before.indexOf('example') !== -1) return null;
    
    var body = text.substring(si + MARKER_START.length, ei).trim();
    
    // Split into individual HERE blocks
    var blocks = [];
    var searchPos = 0;
    while (true) {
      var hereIdx = body.indexOf(HERE, searchPos);
      if (hereIdx === -1) break;
      // Find the end of this HERE block (next HERE or end of body)
      var nextHere = body.indexOf(HERE, hereIdx + HERE.length + 1);
      var blockEnd = nextHere !== -1 ? nextHere : body.length;
      blocks.push(body.substring(hereIdx, blockEnd).trim());
      searchPos = hereIdx + HERE.length + 1;
    }
    
    if (blocks.length === 0) return null;
    
    var steps = [];
    for (var b = 0; b < blocks.length; b++) {
      var block = blocks[b];
      // Parse each block as a mini heredoc
      var headerEnd = block.indexOf(NL);
      if (headerEnd === -1) continue;
      var header = block.substring(HERE.length, headerEnd).trim();
      var hdrParts = header.split(/\s+/);
      if (!hdrParts[0] || !hdrParts[0].match(/^[a-zA-Z_][a-zA-Z0-9_:-]*$/)) continue;
      var toolName = hdrParts[0];
      
      var blockBody = block.substring(headerEnd + 1);
      var lines = blockBody.split(NL);
      var params = {};
      var saveAs = undefined;
      var when = undefined;
      var idx = 0;
      
      while (idx < lines.length) {
        var line = lines[idx];
        // Extract saveAs
        var saveMatch = line.match(/^@saveAs=(\S+)/);
        if (saveMatch) { saveAs = saveMatch[1]; idx++; continue; }
        // Extract when
        var whenMatch = line.match(/^@when=(.*)/);
        if (whenMatch) { when = whenMatch[1]; idx++; continue; }
        // Heredoc param
        var hdm = line.match(/^@(\w+)<<(\S+)\s*$/);
        if (hdm) {
          var hkey = hdm[1], delim = hdm[2], buf = [];
          idx++;
          while (idx < lines.length && lines[idx] !== delim) {
            buf.push(lines[idx]); idx++;
          }
          params[hkey] = buf.join(NL);
          idx++; continue;
        }
        // Simple param
        var spm = line.match(/^@(\w+)=(.*)/);
        if (spm) {
          var skey = spm[1], sval = spm[2];
          if (/^\d+$/.test(sval)) sval = parseInt(sval);
          else if (sval === 'true') sval = true;
          else if (sval === 'false') sval = false;
          params[skey] = sval;
          idx++; continue;
        }
        idx++;
      }
      
      var step = { tool: toolName, params: params };
      if (saveAs) step.saveAs = saveAs;
      if (when) step.when = when;
      steps.push(step);
    }
    
    if (steps.length === 0) return null;
    return { steps: steps, start: si };
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
    // 最优先：检查 ΩHERE heredoc 格式（零转义，解决 SSE 传输损坏问题）
    const hereIdx = text.indexOf('\u03A9HERE');
    if (hereIdx !== -1) {
      const hereCalls = parseHeredocFormat(text);
      if (hereCalls.length > 0) {
        return hereCalls;
      }
    }

    // 最优先：检查 ΩHEREBATCH 格式（HEREDOC 批量执行）
    var hereBatchMarker = String.fromCharCode(0x03A9) + 'HEREBATCH';
    if (text.indexOf(hereBatchMarker) !== -1) {
      var hereBatch = parseHereBatchFormat(text);
      if (hereBatch && !state.executedCalls.has('herebatch:' + hereBatch.start)) {
        return [{ name: '__BATCH__', params: hereBatch.steps, isBatch: true, start: hereBatch.start }];
      }
    }

    // 优先检查 ΩBATCH 批量格式（支持 ΩBATCH{...}ΩEND 或 ΩBATCH{...} 格式）
    const batchStartIdx = text.indexOf('ΩBATCH');
    if (batchStartIdx !== -1 && !state.executedCalls.has('batch:' + batchStartIdx)) {
      // 跳过示例中的 ΩBATCH
      const beforeBatch = text.substring(Math.max(0, batchStartIdx - 100), batchStartIdx);
      const isExample = /Example:/.test(beforeBatch);
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
    // SSE 已执行当前消息的工具调用，跳过 DOM 检测避免重复
    if (sseState.executedInCurrentMessage && (Date.now() - sseState.lastDeltaTime < 30000)) {
      log('跳过 DOM 检测（SSE 已执行）');
      return;
    }
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

    // === 内容级去重: 防止 SSE + DOM 双通道重复执行 ===
    const contentKey = `exec:__BATCH__:${JSON.stringify(batch).substring(0, 200)}`;
    if (hasDedupKey(contentKey)) {
      log('跳过重复 BATCH 执行（内容级去重）');
      addExecutedCall(callHash);
      return;
    }
    addDedupKey(contentKey, 30000);
    const batchId = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    
    state.agentRunning = true;
    addExecutedCall(callHash);
    
    if (!batch || !batch.steps || !Array.isArray(batch.steps)) {
      addLog('\u274c \u6279\u91cf\u4efb\u52a1\u53c2\u6570\u65e0\u6548: steps \u4e0d\u5b58\u5728', 'error');
      hideExecutingIndicator();
      return;
    }
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


  // === async_task 持久化与执行引擎 ===
    // CSP 安全的条件评估器（不使用 eval / new Function）
    // 支持: "result.key === value", "result.a.b == value", "result.key", "!result.key"
    // 多条件: "result.a === true && result.b", "result.a || result.b"
    function _evalConditionSafe(result, condStr) {
      // 解析单个比较表达式
      function evalSingle(expr) {
        expr = expr.trim();
        // 否定: !result.key
        if (expr.startsWith('!')) {
          return !evalSingle(expr.slice(1));
        }
        // 比较: left === right 或 left == right 或 left !== right 或 left != right
        const cmpMatch = expr.match(/^(.+?)\s*(===|!==|==|!=|>=|<=|>|<)\s*(.+)$/);
        if (cmpMatch) {
          const left = resolveValue(cmpMatch[1].trim(), result);
          const op = cmpMatch[2];
          const right = resolveValue(cmpMatch[3].trim(), result);
          switch(op) {
            case '===': return left === right;
            case '!==': return left !== right;
            case '==': return left == right;
            case '!=': return left != right;
            case '>': return left > right;
            case '<': return left < right;
            case '>=': return left >= right;
            case '<=': return left <= right;
          }
        }
        // 真值检查: result.key
        return !!resolveValue(expr, result);
      }

      // 解析值：支持 result.a.b.c 路径、字面量 true/false/null/数字/字符串
      function resolveValue(token, ctx) {
        token = token.trim();
        if (token === 'true') return true;
        if (token === 'false') return false;
        if (token === 'null') return null;
        if (token === 'undefined') return undefined;
        if (/^-?\d+(\.\d+)?$/.test(token)) return Number(token);
        if ((token.startsWith("'") && token.endsWith("'")) || (token.startsWith('"') && token.endsWith('"'))) return token.slice(1, -1);
        // result.a.b.c 路径
        const path = token.replace(/^result\.?/, '').split('.');
        let val = ctx;
        for (const p of path) {
          if (p === '' || val == null) break;
          val = val[p];
        }
        return val;
      }

      // 处理 && 和 || 组合（简单左到右，&& 优先于 ||）
      // 先按 || 拆，再按 && 拆
      const orParts = condStr.split('||').map(s => s.trim());
      for (const orPart of orParts) {
        const andParts = orPart.split('&&').map(s => s.trim());
        const allTrue = andParts.every(p => evalSingle(p));
        if (allTrue) return true;
      }
      return false;
    }

    function _saveAsyncTask(taskDef) {
      try {
        const tasks = JSON.parse(localStorage.getItem('__async_tasks') || '[]');
        tasks.push(taskDef);
        localStorage.setItem('__async_tasks', JSON.stringify(tasks));
      } catch(e) { addLog('⚠️ async_task 保存失败: ' + e.message, 'error'); }
    }

    function _removeAsyncTask(taskId) {
      try {
        let tasks = JSON.parse(localStorage.getItem('__async_tasks') || '[]');
        tasks = tasks.filter(t => t.id !== taskId);
        localStorage.setItem('__async_tasks', JSON.stringify(tasks));
      } catch(e) {}
    }

    function _runAsyncTask(task) {
      const { id, code, condition, interval, timeout, tabId, label, startTime } = task;
      let pollCount = 0;
      addLog(`🔄 async_task 运行中 [${label}] (ID: ${id})`, 'info');

      const doPoll = () => {
        if (Date.now() - startTime > timeout) {
          addLog(`⏰ async_task [${label}] 超时`, 'error');
          _removeAsyncTask(id);
          sendMessageSafe(`**[async_task]** ⏰ 任务超时: ${label} (已轮询 ${pollCount} 次, ${Math.round((Date.now()-startTime)/1000)}s)`);
          return;
        }

        pollCount++;
        const callId = 'at_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

        const resultHandler = (msg) => {
          if (msg.type === 'EVAL_JS_RESULT' && msg.callId === callId) {
            chrome.runtime.onMessage.removeListener(resultHandler);
            clearTimeout(evalTO);

            if (!msg.success) {
              addLog(`⚠️ async_task [${label}] 执行错误: ${msg.error}`, 'error');
              setTimeout(doPoll, interval);
              return;
            }

            let result = msg.result;
            addLog(`🔍 async_task [${label}] raw type=${typeof msg.result}, val=${String(msg.result).substring(0,120)}`, 'info');
            try { result = JSON.parse(result); } catch(e) {}
            addLog(`🔍 async_task [${label}] parsed type=${typeof result}, keys=${typeof result === 'object' && result ? Object.keys(result).join(',') : 'N/A'}`, 'info');

            let conditionMet = false;
            try {
              // CSP 禁止 new Function，改用安全的条件解析器
              // 支持格式: "key === value", "key == value", "key", "!key"
              // 嵌套: "a.b.c === value"
              conditionMet = _evalConditionSafe(result, condition);
            } catch(e) {
              addLog(`⚠️ async_task 条件检查错误: ${e.message}`, 'error');
            }

            if (conditionMet) {
              addLog(`✅ async_task [${label}] 完成! (${pollCount} 次, ${Math.round((Date.now()-startTime)/1000)}s)`, 'success');
              _removeAsyncTask(id);
              const resultStr = typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result);
              sendMessageSafe(`**[async_task]** ✅ 任务完成: ${label}\n轮询次数: ${pollCount} | 耗时: ${Math.round((Date.now()-startTime)/1000)}s\n\n**结果:**\n\`\`\`\n${resultStr.substring(0, 3000)}\n\`\`\``);
            } else {
              const preview = typeof result === 'object' ? JSON.stringify(result) : String(result);
              addLog(`🔄 async_task [${label}] #${pollCount}: ${preview.substring(0, 80)}`, 'info');
              setTimeout(doPoll, interval);
            }
          }
        };
        chrome.runtime.onMessage.addListener(resultHandler);

        const evalTO = setTimeout(() => {
          chrome.runtime.onMessage.removeListener(resultHandler);
          addLog(`⚠️ async_task [${label}] eval 超时，重试`, 'error');
          setTimeout(doPoll, interval);
        }, 15000);

        chrome.runtime.sendMessage({ type: 'EVAL_JS', code: code, callId: callId, targetTabId: tabId });
      };

      setTimeout(doPoll, 3000); // 首次 3 秒后开始
    }

    function _restoreAsyncTasks() {
      try {
        const tasks = JSON.parse(localStorage.getItem('__async_tasks') || '[]');
        if (tasks.length === 0) return;
        addLog(`🔄 恢复 ${tasks.length} 个异步任务`, 'info');
        tasks.forEach(task => {
          if (Date.now() - task.startTime > task.timeout) {
            addLog(`⏰ 任务已过期，跳过: ${task.label}`, 'info');
            _removeAsyncTask(task.id);
          } else {
            addLog(`🔄 恢复任务: ${task.label} (剩余 ${Math.round((task.timeout - (Date.now() - task.startTime))/1000)}s)`, 'info');
            _runAsyncTask(task);
          }
        });
      } catch(e) { addLog('⚠️ 异步任务恢复失败: ' + e.message, 'error'); }
    }
  // === END async_task 引擎 ===

  function executeToolCall(tool, callHash) {
    clearToolCallDetection();
    
    // === 内容级去重: 防止 SSE + DOM 双通道重复执行 ===
    const contentKey = `exec:${tool.name}:${JSON.stringify(tool.params).substring(0, 200)}`;
    if (hasDedupKey(contentKey)) {
      log('跳过重复执行（内容级去重）:', tool.name);
      addExecutedCall(callHash);
      return;
    }
    addDedupKey(contentKey, 10000);
    
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

    // === 本地拦截: async_task 异步任务监控器（支持持久化恢复） ===
    if (tool.name === 'async_task') {
      addExecutedCall(callHash);
      const taskDef = {
        id: 'async_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        code: tool.params.code || '',
        condition: tool.params.condition || 'true',
        interval: tool.params.interval || 15000,
        timeout: tool.params.timeout || 600000,
        tabId: tool.params.tabId || null,
        label: tool.params.label || 'async_task',
        startTime: Date.now()
      };
      
      addLog(`🔄 async_task [${taskDef.label}]: interval=${taskDef.interval/1000}s, timeout=${taskDef.timeout/1000}s, tab=${taskDef.tabId || 'current'}`, 'tool');
      
      // 不阻塞 AI — 立即返回确认
      state.agentRunning = false;
      updateStatus();
      sendMessageSafe(`**[async_task]** ✅ 任务已启动: ${taskDef.label} (ID: ${taskDef.id})\n轮询间隔: ${taskDef.interval/1000}s | 超时: ${taskDef.timeout/1000}s\n后台监控中，完成后自动通知...`);
      
      // 持久化存储，扩展刷新后可恢复
      _saveAsyncTask(taskDef);
      _runAsyncTask(taskDef);
      return;
    }
    // === END async_task 拦截 ===

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

    // === 本地拦截: tutorial_record 教程录制引擎 ===
    if (tool.name === 'tutorial_record') {
      addExecutedCall(callHash);
      showExecutingIndicator('tutorial_record');
      state.agentRunning = true;
      updateStatus();

      const steps = tool.params.steps || [];
      const targetTabId = tool.params.tabId || null;
      const projectDir = tool.params.outputDir || '/private/tmp/tutorial_' + Date.now();

      addLog(`🎬 tutorial_record: ${steps.length} 步, tab=${targetTabId || 'auto'}`, 'tool');

      const callId = 'tutorial_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

      // 监听结果
      const handler = (msg) => {
        if (msg.type === 'TUTORIAL_RECORD_RESULT' && msg.callId === callId) {
          chrome.runtime.onMessage.removeListener(handler);
          clearTimeout(timeoutTimer);

          if (msg.success && msg.screenshots && msg.screenshots.length > 0) {
            // 把截图通过 server 保存到本地
            const savePromises = msg.screenshots.map((s, idx) => {
              return new Promise((resolve) => {
                // 发给 server 保存 base64 图片
                const savePath = projectDir + '/step_' + s.step + '.png';
                // 通过 WebSocket 发送保存请求
                chrome.runtime.sendMessage({
                  type: 'SEND_TO_SERVER',
                  data: {
                    type: 'save_base64_file',
                    path: savePath,
                    data: s.dataUrl.replace(/^data:image\/png;base64,/, ''),
                    encoding: 'base64'
                  }
                }, () => resolve(savePath));
              });
            });

            Promise.all(savePromises).then((paths) => {
              const summary = {
                tool: 'tutorial_record',
                success: true,
                result: JSON.stringify({
                  totalSteps: steps.length,
                  screenshotCount: msg.screenshotCount,
                  savedPaths: paths,
                  results: msg.results
                }, null, 2)
              };
              const resultText = formatToolResult(summary);
              sendResultToAI(resultText);
              addLog(`✅ tutorial_record 完成: ${msg.screenshotCount} 截图已保存`, 'success');
              state.agentRunning = false;
              updateStatus();
            });
          } else {
            // 没有截图但可能有结果
            const summary = {
              tool: 'tutorial_record',
              success: msg.success,
              result: JSON.stringify(msg.results || [], null, 2),
              error: msg.error
            };
            const resultText = formatToolResult(summary);
            sendResultToAI(resultText);
            addLog(msg.success ? '✅ tutorial_record 完成' : '❌ tutorial_record 失败', msg.success ? 'success' : 'error');
            state.agentRunning = false;
            updateStatus();
          }
        }
      };
      chrome.runtime.onMessage.addListener(handler);

      // 超时保护 (每步最多15秒，加30秒缓冲)
      const totalTimeout = steps.length * 15000 + 30000;
      const timeoutTimer = setTimeout(() => {
        chrome.runtime.onMessage.removeListener(handler);
        const resultText = formatToolResult({ tool: 'tutorial_record', success: false, error: `超时 (${Math.round(totalTimeout/1000)}秒)` });
        sendResultToAI(resultText);
        addLog('❌ tutorial_record 超时', 'error');
        state.agentRunning = false;
        updateStatus();
      }, totalTimeout);

      // 发送到 background.js 执行
      try {
        chrome.runtime.sendMessage({
          type: 'TUTORIAL_RECORD',
          callId,
          steps,
          tabId: targetTabId,
          outputDir: projectDir
        }, (response) => {
          if (chrome.runtime.lastError) {
            chrome.runtime.onMessage.removeListener(handler);
            clearTimeout(timeoutTimer);
            const resultText = formatToolResult({ tool: 'tutorial_record', success: false, error: chrome.runtime.lastError.message });
            sendResultToAI(resultText);
            state.agentRunning = false;
            updateStatus();
          }
        });
      } catch(e) {
        chrome.runtime.onMessage.removeListener(handler);
        clearTimeout(timeoutTimer);
        const resultText = formatToolResult({ tool: 'tutorial_record', success: false, error: e.message });
        sendResultToAI(resultText);
        state.agentRunning = false;
        updateStatus();
      }
      return;
    }
    // === END tutorial_record 拦截 ===

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
    
    // ── Payload Upload:段内容通过 HTTP 上传避免 WebSocket 损坏 ──
    const PAYLOAD_UPLOAD_URL = 'http://localhost:8766/upload-payload';
    const PAYLOAD_THRESHOLD = 50; // 超过 50 字符的内容走 HTTP 上传（降低阈值，防止 SSE 损坏短内容）
    const PAYLOAD_FIELDS = ['content', 'stdin', 'code'];
    const FILE_FIELD_MAP = { content: 'contentFile', stdin: 'stdinFile', code: 'codeFile' };

    async function uploadPayloads(params) {
      const uploaded = {};
      for (const field of PAYLOAD_FIELDS) {
        if (params[field] && typeof params[field] === 'string' && params[field].length > PAYLOAD_THRESHOLD) {
          try {
            const result = await new Promise((resolve, reject) => {
              chrome.runtime.sendMessage(
                { type: 'UPLOAD_PAYLOAD', body: params[field] },
                (resp) => {
                  if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                  } else {
                    resolve(resp);
                  }
                }
              );
            });
            if (result && result.success && result.path) {
              uploaded[field] = result.path;
              log('[PayloadUpload] ' + field + ' -> ' + result.path + ' (' + result.size + ' bytes)');
            }
          } catch(e) {
            log('[PayloadUpload] failed ' + field + ': ' + e.message + ', fallback to WS');
          }
        }
      }
      return uploaded;
    }

    // 异步上传大内容，然后发送 tool_call
    (async () => {
      try {
        const uploadedFields = await uploadPayloads(tool.params);
        const finalParams = Object.assign({}, tool.params);
        for (const [field, filePath] of Object.entries(uploadedFields)) {
          delete finalParams[field];
          finalParams[FILE_FIELD_MAP[field]] = filePath;
        }
        if (Object.keys(uploadedFields).length > 0) {
          addLog('📦 大内容已通过 HTTP 安全上传 (' + Object.keys(uploadedFields).join(', ') + ')', 'info');
        }

        chrome.runtime.sendMessage({
          type: 'SEND_TO_SERVER',
          payload: { 
            type: 'tool_call', 
            tool: tool.name, 
            params: finalParams, 
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
      addLog('\u274c 消息发送异常: ' + e.message, 'error');
      state.agentRunning = false;
      hideExecutingIndicator();
      updateStatus();
    }
    })();
    
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
    // SSE 已成功执行当前消息中的工具调用，跳过 DOM 扫描避免重复
    // 但仅在 SSE 最近有活动时才跳过（避免 SSE 断开后 DOM 也不工作）
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
    const sendMatch = text.match(/ΩSEND:([\w_-]+):([\s\S]+?)ΩSENDEND/);
    const isExampleSend = sendMatch && isExampleToolCall(text, sendMatch.index);
    const timeSinceStable = Date.now() - state.lastStableTime;
    if (sendMatch && !isExampleSend && timeSinceStable >= 3000) {
      const sendHash = `${index}:send:${sendMatch[1]}:${sendMatch[2].slice(0,50)}`;
      if (!state.executedCalls.has(sendHash)) {
        addExecutedCall(sendHash);
        const toAgent = sendMatch[1];
        const message = sendMatch[2].trim();
        addLog(`📨 发送给 ${toAgent}...`, 'tool');
        if (toAgent === 'phone-bridge') {
          // phone-bridge 是外部进程，通过 Agent 服务器中转
          chrome.runtime.sendMessage({
            type: 'SEND_TO_SERVER',
            payload: { type: 'phone_reply', text: message }
          }, (resp) => {
            if (chrome.runtime.lastError) {
              addLog('❌ 手机发送失败: ' + chrome.runtime.lastError.message, 'error');
            } else {
              addLog('📱 已发送到手机', 'success');
            }
          });
        } else {
          sendToAgent(toAgent, message);
        }
        return;
      }
    }
    
    const toolCalls = parseToolCalls(text);
    
    for (const tool of toolCalls) {
      const callHash = `${index}:${tool.name}:${JSON.stringify(tool.params)}`;
      
      if (state.executedCalls.has(callHash)) {
        continue;
      }
      
      // 通用去重：检查 SSE 通道注册的 dedup key
      // 第三重兜底：如果 SSE 本轮未执行任何命令，不信任 dedup key
      const dedupKey = `dedup:${tool.name}:${JSON.stringify(tool.params)}`;
      if (hasDedupKey(dedupKey) && sseState.executedInCurrentMessage) {
        log('跳过 DOM 扫描（dedup key 已存在）:', tool.name);
        addExecutedCall(callHash);
        continue;
      }
      
      // SSE 去重：如果已被 SSE 通道处理过，跳过 DOM 扫描的执行
      // 第三重兜底：如果 SSE 本轮未执行任何命令，不信任 SSE 处理标记
      if (sseState.enabled && isSSEProcessed(tool.name, tool.params) && sseState.executedInCurrentMessage) {
        log('跳过 DOM 扫描（已被 SSE 处理）:', tool.name);
        addExecutedCall(callHash);  // 标记为已执行，防止反复检查
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
    
    // 上下文计数：统计当前对话消息数，附加到结果末尾
    let contextInfo = '';
    try {
      const allMsgs = document.querySelectorAll('.conversation-statement');
      const totalMsgs = allMsgs.length;
      let totalChars = 0;
      allMsgs.forEach(function(m) { totalChars += m.textContent.length; });
      const charsK = Math.round(totalChars / 1000);
      
      // 主要靠字符数判断，消息数辅助
      if (totalChars > 700000 || totalMsgs > 300) {
        contextInfo = `\n⚠️ [对话: ${totalMsgs}条/${charsK}K字符 — 已超过压缩阈值，建议执行上下文压缩]`;
      } else if (totalChars > 500000 || totalMsgs > 200) {
        contextInfo = `\n⚠️ [对话: ${totalMsgs}条/${charsK}K字符 — 接近压缩阈值]`;
      } else {
        contextInfo = `\n[对话状态: ${totalMsgs}条/${charsK}K字符]`;
      }
    } catch(e) {}
    
    return `**[执行结果]** \`${msg.tool}\` ${status}:
\`\`\`
${content}
\`\`\`
${tip}${contextInfo}
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
        <button id="agent-switch-server" title="切换本地/云端">💻 本地</button>
        <button id="agent-reload-ext" title="重载扩展">♻️</button>
        <button id="agent-list" title="查看在线Agent">👥</button>
        <button id="agent-save" title="存档：保存当前进度到项目记忆">💾 存档</button>
        <button id="agent-compress" title="上下文压缩：用预设总结替换当前对话">🗜️ 压缩</button>
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
      #agent-compress { background: #92400e !important; }
      #agent-compress:hover { background: #b45309 !important; }
      #agent-compress.ready { background: #dc2626 !important; animation: pulse-compress 1.5s infinite; }
      #agent-compress.warning { background: #ea580c !important; animation: pulse-warning 3s infinite; }
      @keyframes pulse-compress { 0%,100%{opacity:1} 50%{opacity:0.6} }
      @keyframes pulse-warning { 0%,100%{opacity:1} 50%{opacity:0.7} }
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

    // ── 压缩总结编辑模态框 ──
    function showCompressModal(summaryText) {
      // 移除已有的模态框
      const existing = document.getElementById('compress-modal-overlay');
      if (existing) existing.remove();
      
      const overlay = document.createElement('div');
      overlay.id = 'compress-modal-overlay';
      overlay.innerHTML = `
        <div id="compress-modal">
          <div id="compress-modal-header">
            <span>📝 压缩总结编辑器</span>
            <span id="compress-modal-chars"></span>
          </div>
          <textarea id="compress-modal-editor"></textarea>
          <div id="compress-modal-actions">
            <button id="compress-modal-cancel">取消</button>
            <button id="compress-modal-confirm">✅ 确认压缩</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      
      const editor = document.getElementById('compress-modal-editor');
      const charsSpan = document.getElementById('compress-modal-chars');
      editor.value = summaryText;
      charsSpan.textContent = summaryText.length + ' 字符';
      
      editor.addEventListener('input', () => {
        charsSpan.textContent = editor.value.length + ' 字符';
      });
      
      document.getElementById('compress-modal-cancel').onclick = () => {
        overlay.remove();
        addLog('❌ 取消压缩', 'error');
      };
      
      document.getElementById('compress-modal-confirm').onclick = () => {
        const edited = editor.value.trim();
        if (edited.length < 50) {
          alert('总结太短，至少需要 50 字符');
          return;
        }
        overlay.remove();
        window.__COMPRESS_SUMMARY = edited;
        document.getElementById('agent-compress').click();
      };
      
      // ESC 关闭
      overlay.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          overlay.remove();
          addLog('❌ 取消压缩', 'error');
        }
      });
      
      // 添加样式
      if (!document.getElementById('compress-modal-style')) {
        const style = document.createElement('style');
        style.id = 'compress-modal-style';
        style.textContent = `
          #compress-modal-overlay {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.7);
            z-index: 2147483647;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          #compress-modal {
            width: 80vw;
            max-width: 900px;
            height: 80vh;
            background: #1a1a2e;
            border: 1px solid #0f3460;
            border-radius: 12px;
            display: flex;
            flex-direction: column;
            box-shadow: 0 20px 60px rgba(0,0,0,0.5);
          }
          #compress-modal-header {
            padding: 16px 20px;
            border-bottom: 1px solid #0f3460;
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 16px;
            font-weight: 600;
            color: #e4e4e7;
          }
          #compress-modal-chars {
            font-size: 13px;
            color: #a1a1aa;
            font-weight: normal;
          }
          #compress-modal-editor {
            flex: 1;
            margin: 12px 20px;
            padding: 16px;
            background: #0d1117;
            border: 1px solid #30363d;
            border-radius: 8px;
            color: #c9d1d9;
            font-family: 'SF Mono', 'Fira Code', monospace;
            font-size: 13px;
            line-height: 1.6;
            resize: none;
            outline: none;
          }
          #compress-modal-editor:focus {
            border-color: #58a6ff;
          }
          #compress-modal-actions {
            padding: 12px 20px 16px;
            display: flex;
            justify-content: flex-end;
            gap: 12px;
          }
          #compress-modal-cancel {
            padding: 8px 20px;
            background: #333;
            color: #e4e4e7;
            border: 1px solid #555;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
          }
          #compress-modal-cancel:hover { background: #444; }
          #compress-modal-confirm {
            padding: 8px 24px;
            background: #dc2626;
            color: white;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
          }
          #compress-modal-confirm:hover { background: #ef4444; }
        `;
        document.head.appendChild(style);
      }
      
      editor.focus();
    }

    // ── 跨压缩记忆存储 ──
    const CONTEXT_STORAGE_ID = '59cdb9cb-b175-4cdd-af44-e8927d7b006a';

    async function writeContextStorage(text) {
      try {
        const r = await fetch('/api/project/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ id: CONTEXT_STORAGE_ID, name: text, request_not_update_permission: true })
        });
        const d = await r.json();
        return d.data && d.data.name ? d.data.name.length : 0;
      } catch(e) { console.error('writeContextStorage failed:', e); return 0; }
    }

    async function readContextStorage() {
      try {
        const r = await fetch('/api/project/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ id: CONTEXT_STORAGE_ID, request_not_update_permission: true })
        });
        const d = await r.json();
        return d.data ? (d.data.name || '') : '';
      } catch(e) { console.error('readContextStorage failed:', e); return ''; }
    }

    // autoCompress: eval_js 可调用，全自动压缩（跳过模态框和 confirm）
    window.autoCompress = async function(customSummary) {
      const btn = document.getElementById('agent-compress');
      if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
      
      let summary = customSummary;
      
      if (!summary) {
        // 自动提取对话内容，调用 AI 生成摘要
        addLog('🤖 autoCompress: 提取对话内容...', 'info');
        
        const msgs = document.querySelectorAll('.conversation-statement');
        const lines = [];
        let totalLen = 0;
        for (const msg of msgs) {
          if (totalLen > 80000) { lines.push('...(省略)'); break; }
          const isUser = msg.classList.contains('user');
          const el = msg.querySelector('.markdown-viewer') || msg.querySelector('.bubble .content') || msg.querySelector('.bubble');
          let text = (el ? el.innerText : msg.innerText) || '';
          text = text.replace(/\[执行结果\][\s\S]{300,}/g, m => m.substring(0, 300) + '...(截断)');
          if (text.length > 2000) text = text.substring(0, 2000) + '...(截断)';
          lines.push((isUser ? '【用户】' : '【AI】') + text);
          totalLen += text.length;
        }
        const conversationText = lines.join('\n\n');
        const projectId = new URLSearchParams(location.search).get('id');
        
        if (!projectId) {
          if (btn) { btn.disabled = false; btn.textContent = '🗜️ 压缩'; }
          return 'failed: no projectId';
        }
        
        const summarizePrompt = `你是一个上下文压缩专家。请根据以下对话内容生成一份结构化的压缩总结。

要求：
1. 第一行必须是: [上下文压缩总结 - ${new Date().toISOString().split('T')[0]}]
2. 包含: ## 项目/任务、## 环境、## 已完成、## 关键发现、## TODO、## 关键信息
3. 保留硬信息：路径、端口、IP，敏感值用 [REDACTED]
4. 总长度 2K-5K 字符
5. 最后必须包含以下段落（原样保留）：

## 临时上下文存储
AI 可通过 eval_js 在 genspark.ai 标签页中读写临时上下文（需先 list_tabs 找到 genspark.ai 的 tabId）：
- 存储对话 ID: 59cdb9cb-b175-4cdd-af44-e8927d7b006a
- 写入: eval_js 单行执行 return fetch('/api/project/update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'59cdb9cb-b175-4cdd-af44-e8927d7b006a',name:'要存的内容',request_not_update_permission:true})}).then(function(r){return r.json()}).then(function(d){return 'saved:'+d.data.name.length})
- 读取: eval_js 单行执行 return fetch('/api/project/update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'59cdb9cb-b175-4cdd-af44-e8927d7b006a',request_not_update_permission:true})}).then(function(r){return r.json()}).then(function(d){return d.data.name})

=== 对话内容 ===
${conversationText}

请直接输出压缩总结。`;
        
        addLog('📡 autoCompress: 调用 AI 生成摘要...', 'info');
        try {
          const r = await fetch('/api/agent/ask_proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              ai_chat_model: 'claude-opus-4-6',
              ai_chat_enable_search: false,
              ai_chat_disable_personalization: true,
              use_moa_proxy: false, moa_models: [],
              writingContent: null, type: 'ai_chat',
              project_id: projectId,
              messages: [{ id: crypto.randomUUID(), role: 'user', content: summarizePrompt }],
              user_s_input: '生成压缩总结',
              is_private: true, push_token
            })
          });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const reader = r.body.getReader();
          const decoder = new TextDecoder();
          summary = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value, { stream: true });
            for (const line of text.split('\n')) {
              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.substring(6));
                  if (data.type === 'message_field_delta' && data.field_name === 'content') summary += data.delta;
                } catch(e) {}
              }
            }
          }
          if (!summary || summary.length < 100) {
            if (btn) { btn.disabled = false; btn.textContent = '🗜️ 压缩'; }
            return 'failed: summary too short (' + (summary||'').length + ')';
          }
          addLog('✅ autoCompress: 摘要 ' + summary.length + ' 字符', 'success');
        } catch(e) {
          if (btn) { btn.disabled = false; btn.textContent = '🗜️ 压缩'; }
          return 'failed: ' + e.message;
        }
      }
      
      // 备份到跨会话存储
      addLog('💾 autoCompress: 备份到存储...', 'info');
      const savedLen = await writeContextStorage(summary);
      addLog('💾 autoCompress: 已备份 ' + savedLen + ' 字符', 'success');
      // 压缩（重写 messages）
      const projectId2 = new URLSearchParams(location.search).get('id');
      const firstUserBubble = document.querySelector('.conversation-statement.user .bubble');
      if (!firstUserBubble || !projectId2) {
        if (btn) { btn.disabled = false; btn.textContent = '🗜️ 压缩'; }
        return 'failed: missing projectId or first message';
      }
      const firstMsg = firstUserBubble.innerText;
      
      addLog('🗜️ autoCompress: 执行压缩...', 'info');
      try {
        const r = await fetch('/api/agent/ask_proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            ai_chat_model: 'claude-opus-4-6',
            ai_chat_enable_search: false,
            ai_chat_disable_personalization: true,
            use_moa_proxy: false, moa_models: [],
            writingContent: null, type: 'ai_chat',
            project_id: projectId2,
            messages: [
              { id: projectId2, role: 'user', content: firstMsg },
              { id: crypto.randomUUID(), role: 'assistant', content: '**[执行结果]** `run_process` ✓ 成功:\n```\nhello\n```' },
              { id: crypto.randomUUID(), role: 'user', content: summary }
            ],
            user_s_input: summary.substring(0, 200),
            is_private: true, push_token: ''
          })
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        // 读完流
        const reader = r.body.getReader();
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
        addLog('✅ autoCompress: 压缩完成，2秒后刷新', 'success');
        setTimeout(() => location.reload(), 2000);
        return 'ok: compressed ' + summary.length + ' chars, backed up ' + savedLen + ' chars';
      } catch(e) {
        if (btn) { btn.disabled = false; btn.textContent = '🗜️ 压缩'; }
        return 'failed: compress ' + e.message;
      }
    };

    // 暴露给 eval_js 调用（content script world）
    window.writeContextStorage = writeContextStorage;
    window.readContextStorage = readContextStorage;

    // NOTE: writeContextStorage/readContextStorage/autoCompress 已通过 sse-hook.js 注入 MAIN world

    document.getElementById('agent-compress').onclick = () => {
      let summary = window.__COMPRESS_SUMMARY || localStorage.getItem('__COMPRESS_SUMMARY');
      
      // 主动路线：没有预设总结时，AI 自动生成压缩总结
      if (!summary) {
        addLog('🔄 正在提取对话内容并生成压缩总结...', 'info');
        const btn = document.getElementById('agent-compress');
        btn.disabled = true;
        btn.textContent = '⏳';
        
        // Step 1: 从 DOM 提取对话内容
        // 敏感信息脱敏函数（浏览器端精简版）
        function redactSecretsForCompress(text) {
          if (!text) return text;
          let r = text;
          // 1. sk- 开头的 API key (Kimi, DeepSeek, OpenAI 等)
          r = r.replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, '[REDACTED_API_KEY]');
          // 2. Bearer token
          r = r.replace(/Bearer\s+[A-Za-z0-9_\-\.]{20,}/g, 'Bearer [REDACTED_TOKEN]');
          // 3. 长 hex 串 (41+ chars, 跳过 40 位 git hash)
          r = r.replace(/\b[0-9a-f]{41,}\b/g, '[REDACTED_HEX_KEY]');
          // 4. 环境变量中的敏感值
          r = r.replace(/((?:API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY|ACCESS_KEY|CREDENTIAL)\s*[=:]\s*)[^\s\n'"]{8,}/gi, '$1[REDACTED]');
          // 5. JSON 中的敏感字段
          r = r.replace(/"(password|secret|token|apiKey|api_key|private_key)"\s*:\s*"[^"]{4,}"/gi, '"$1": "[REDACTED]"');
          // 6. URL 中内嵌的认证
          r = r.replace(/:\/\/([^:@\s]+):([^@\s]{4,})@/g, '://$1:[REDACTED]@');
          // 7. SSH private key block
          r = r.replace(/-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/g, '[REDACTED_SSH_KEY]');
          // 8. .env 格式的敏感行
          r = r.replace(/^(.*(?:KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL).*?=).{8,}$/gm, '$1[REDACTED]');
          return r;
        }

        function extractFullConversation() {
          const msgs = document.querySelectorAll('.conversation-statement');
          const lines = [];
          let totalLen = 0;
          const maxLen = 80000; // 限制总长度，留空间给 prompt
          for (const msg of msgs) {
            if (totalLen > maxLen) { lines.push('...(后续对话省略)'); break; }
            const isUser = msg.classList.contains('user');
            const contentEl = msg.querySelector('.markdown-viewer') || msg.querySelector('.bubble .content') || msg.querySelector('.bubble');
            let text = (contentEl ? contentEl.innerText : msg.innerText) || '';
            // 截断工具执行结果
            text = text.replace(/\[执行结果\][\s\S]{300,}/g, (m) => m.substring(0, 300) + '...(截断)');
            text = text.replace(/```[\s\S]{500,}?```/g, (m) => m.substring(0, 500) + '\n...(截断)\n```');
            if (text.length > 2000) text = text.substring(0, 2000) + '...(截断)';
            const role = isUser ? '用户' : 'AI';
            const line = `【${role}】${text}`;
            lines.push(line);
            totalLen += line.length;
          }
          return lines.join('\n\n');
        }
        
        const conversationText = redactSecretsForCompress(extractFullConversation());
        const projectId = new URLSearchParams(location.search).get('id');
        
        if (!projectId) {
          addLog('❌ 无法获取 project ID', 'error');
          btn.disabled = false;
          btn.textContent = '🗜️ 压缩';
          return;
        }
        
        // Step 2: 同时跑 history_compressor
        chrome.runtime.sendMessage({
          type: 'SEND_TO_SERVER',
          payload: {
            type: 'tool_call',
            id: 'compress_hist_' + Date.now(),
            tool: 'run_command',
            params: { command: 'bash', stdin: 'COMPRESSOR=""; HISTORY=""; for p in /Users/yay/workspace/.agent_memory/history_compressor.js /home/ubuntu/genspark-agent/scripts/history_compressor.cjs; do [ -f "$p" ] && COMPRESSOR="$p" && break; done; for p in /Users/yay/workspace/genspark-agent/server-v2/command-history.json /home/ubuntu/genspark-agent/server-v2/command-history.json; do [ -f "$p" ] && HISTORY="$p" && break; done; [ -n "$COMPRESSOR" ] && [ -n "$HISTORY" ] && node "$COMPRESSOR" context "$HISTORY" --since 24 || echo "(无命令历史)"' }
          }
        }, (histResp) => {
          const historyInfo = (histResp && histResp.result) ? String(histResp.result) : '(无命令历史)';
          
          addLog('📡 调用 AI 生成压缩总结...', 'info');
          
          // Step 3: 发 ask_proxy 让 AI 生成压缩总结
          const summarizePrompt = `你是一个上下文压缩专家。请根据以下对话内容和命令历史，生成一份结构化的压缩总结。

要求：
1. 第一行必须是: [上下文压缩总结 - ${new Date().toISOString().split('T')[0]}]
2. 包含以下章节: ## 项目/任务、## 环境、## 已完成、## 关键发现、## TODO、## 关键信息
3. 保留硬信息：project ID、文件路径、端口号、IP地址，但 API key/token/密码等敏感值必须用 [REDACTED] 占位符替代，只保留变量名不保留实际值
4. 简洁但完整，总长度控制在 2K-5K 字符
5. TODO 要从对话中提取用户提到的待办事项
6. 关键发现要包含踩坑经验和重要技术决策
7. 最后必须包含以下段落（原样保留，不要修改）：

## 临时上下文存储
AI 可通过 eval_js 在 genspark.ai 标签页中读写临时上下文（需先 list_tabs 找到 genspark.ai 的 tabId）：
- 存储对话 ID: 59cdb9cb-b175-4cdd-af44-e8927d7b006a
- 写入: eval_js 单行执行 return fetch('/api/project/update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'59cdb9cb-b175-4cdd-af44-e8927d7b006a',name:'要存的内容',request_not_update_permission:true})}).then(function(r){return r.json()}).then(function(d){return 'saved:'+d.data.name.length})
- 读取: eval_js 单行执行 return fetch('/api/project/update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'59cdb9cb-b175-4cdd-af44-e8927d7b006a',request_not_update_permission:true})}).then(function(r){return r.json()}).then(function(d){return d.data.name})

=== 命令历史摘要 ===
${historyInfo}

=== 对话内容 ===
${conversationText}

请直接输出压缩总结，不要加任何前缀说明。`;
          
          const summarizeBody = {
            ai_chat_model: 'claude-opus-4-6',
            ai_chat_enable_search: false,
            ai_chat_disable_personalization: true,
            use_moa_proxy: false,
            moa_models: [],
            writingContent: null,
            type: 'ai_chat',
            project_id: projectId,
            messages: [
              { id: crypto.randomUUID(), role: 'user', content: summarizePrompt }
            ],
            user_s_input: '生成压缩总结',
            is_private: true,
            push_token: ''
          };
          
          fetch('/api/agent/ask_proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(summarizeBody)
          }).then(r => {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const reader = r.body.getReader();
            const decoder = new TextDecoder();
            let aiSummary = '';
            function readStream() {
              return reader.read().then(result => {
                if (result.done) {
                  btn.disabled = false;
                  btn.textContent = '🗜️ 压缩';
                  
                  if (!aiSummary || aiSummary.length < 100) {
                    addLog('❌ AI 生成的总结太短或为空', 'error');
                    return;
                  }
                  
                  addLog('✅ AI 总结已生成 (' + aiSummary.length + ' 字符)', 'success');
                  
                  // Step 35: 自动备份摘要到跨会话存储
                  const cleanSummary = redactSecretsForCompress(aiSummary.trim());
                  writeContextStorage(cleanSummary).then(len => {
                    addLog('💾 已备份 ' + len + ' 字符到跨会话存储', 'success');
                  });
                  
                  // Step 4: 全屏模态框让用户查看和编辑总结
                  showCompressModal(cleanSummary);
                   return;
                }
                const text = decoder.decode(result.value, { stream: true });
                const lines = text.split('\n');
                for (const line of lines) {
                  if (line.startsWith('data: ')) {
                    try {
                      const data = JSON.parse(line.substring(6));
                      if (data.type === 'message_field_delta' && data.field_name === 'content') {
                        aiSummary += data.delta;
                      }
                    } catch(e) {}
                  }
                }
                return readStream();
              });
            }
            return readStream();
          }).catch(err => {
            addLog('❌ AI 总结生成失败: ' + err.message, 'error');
            btn.disabled = false;
            btn.textContent = '🗜️ 压缩';
          });
        });
        return;
      }

      const projectId = new URLSearchParams(location.search).get('id');
      if (!projectId) {
        addLog('❌ 无法获取 project ID', 'error');
        return;
      }

      // 获取第一条用户消息（保持标题）
      const firstUserBubble = document.querySelector('.conversation-statement.user .bubble');
      if (!firstUserBubble) {
        addLog('❌ 找不到第一条用户消息', 'error');
        return;
      }
      const firstMsg = firstUserBubble.innerText;

      if (!confirm('确认执行上下文压缩？\n\n总结长度: ' + summary.length + ' 字符\nProject: ' + projectId + '\n\n压缩后页面会自动刷新。')) {
        return;
      }

      addLog('🗜️ 开始压缩...', 'info');
      
      // 备份摘要到跨会话存储
      writeContextStorage(summary).then(len => {
        addLog('💾 已备份 ' + len + ' 字符到跨会话存储', 'success');
      });
      
      const btn = document.getElementById('agent-compress');
      btn.disabled = true;
      btn.textContent = '⏳';

      const msgId = crypto.randomUUID();
      const requestBody = {
        ai_chat_model: 'claude-opus-4-6',
        ai_chat_enable_search: false,
        ai_chat_disable_personalization: true,
        use_moa_proxy: false,
        moa_models: [],
        writingContent: null,
        type: 'ai_chat',
        project_id: projectId,
        messages: [
          { id: projectId, role: 'user', content: firstMsg },
          { id: crypto.randomUUID(), role: 'assistant', content: '**[执行结果]** `run_process` ✓ 成功:\n```\nhello\n```' },
          { id: msgId, role: 'user', content: summary }
        ],
        user_s_input: summary.substring(0, 200),
        is_private: true,
        push_token: ''
      };

      addLog('📡 发送 ask_proxy 请求...', 'info');

      fetch('/api/agent/ask_proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(requestBody)
      }).then(r => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const reader = r.body.getReader();
        const decoder = new TextDecoder();
        let aiContent = '';
        function read() {
          return reader.read().then(result => {
            if (result.done) {
              addLog('✅ 压缩完成! AI 回复: ' + aiContent.substring(0, 100) + '...', 'success');
              addLog('🔄 2 秒后刷新页面...', 'info');
              setTimeout(() => location.reload(), 2000);
              return;
            }
            const text = decoder.decode(result.value, { stream: true });
            const lines = text.split('\n');
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.substring(6));
                  if (data.type === 'message_field_delta' && data.field_name === 'content') {
                    aiContent += data.delta;
                  }
                } catch(e) {}
              }
            }
            return read();
          });
        }
        return read();
      }).catch(err => {
        addLog('❌ 压缩失败: ' + err.message, 'error');
        btn.disabled = false;
        btn.textContent = '🗜️ 压缩';
      });
    };

    // 自动检测 __COMPRESS_SUMMARY，按钮变红闪烁
    setInterval(() => {
      const btn = document.getElementById('agent-compress');
      if (!btn || btn.disabled) return; // 正在执行时不干扰
      const hasSummary = !!(window.__COMPRESS_SUMMARY || localStorage.getItem('__COMPRESS_SUMMARY'));
      
      // 检测对话量
      let overThreshold = false;
      let nearThreshold = false;
      try {
        const allMsgs = document.querySelectorAll('.conversation-statement');
        const totalMsgs = allMsgs.length;
        let totalChars = 0;
        allMsgs.forEach(m => { totalChars += m.textContent.length; });
        overThreshold = totalChars > 700000 || totalMsgs > 300;
        nearThreshold = totalChars > 500000 || totalMsgs > 200;
      } catch(e) {}
      
      // 优先级: ready(总结就绪) > warning(超阈值) > 正常
      if (hasSummary) {
        btn.classList.add('ready');
        btn.classList.remove('warning');
        btn.title = '✅ 总结已就绪 — 点击执行压缩';
      } else if (overThreshold) {
        btn.classList.remove('ready');
        btn.classList.add('warning');
        btn.textContent = '🗜️ 压缩!';
        btn.title = '⚠️ 对话已超过压缩阈值 — 点击自动生成总结并压缩';
      } else if (nearThreshold) {
        btn.classList.remove('ready');
        btn.classList.add('warning');
        btn.title = '⚠️ 对话接近压缩阈值 — 建议尽快压缩';
      } else {
        btn.classList.remove('ready', 'warning');
        btn.textContent = '🗜️ 压缩';
        btn.title = '上下文压缩：用预设总结替换当前对话';
      }
    }, 5000);

    document.getElementById('agent-save').onclick = () => {
      addLog('💾 存档中...', 'info');
      const saveBtn = document.getElementById('agent-save');
      saveBtn.disabled = true;
      saveBtn.textContent = '⏳';
      
      const historyPath = '/Users/yay/workspace/genspark-agent/server-v2/command-history.json';
      
      // 提取对话内容（最近 30 条消息）
      function extractConversation() {
        const msgs = document.querySelectorAll('.conversation-statement');
        const lines = [];
        const recent = Array.from(msgs).slice(-30);
        for (const msg of recent) {
          const isUser = msg.classList.contains('user');
          const isAI = msg.classList.contains('assistant');
          const contentEl = msg.querySelector('.markdown-viewer') || msg.querySelector('.bubble .content') || msg.querySelector('.bubble');
          let text = (contentEl ? contentEl.innerText : msg.innerText) || '';
          // 截断工具结果，只保留前 200 字符
          text = text.replace(/\[执行结果\][\s\S]{200,}/g, (m) => m.substring(0, 200) + '...(截断)');
          // 截断过长消息
          if (text.length > 1000) text = text.substring(0, 1000) + '...(截断)';
          if (isUser) lines.push('## 用户\n' + text);
          else if (isAI) lines.push('## AI\n' + text);
        }
        return lines.join('\n\n');
      }
      
      const conversation = extractConversation();
      
      // 先查活跃项目
      chrome.runtime.sendMessage({
        type: 'SEND_TO_SERVER',
        payload: {
          type: 'tool_call',
          id: 'save_check_' + Date.now(),
          tool: 'run_command',
          params: { command: 'node /Users/yay/workspace/.agent_memory/memory_manager_v2.js status' }
        }
      }, (statusResp) => {
        let project = 'genspark-agent';
        if (statusResp && statusResp.result) {
          const match = String(statusResp.result).match(/当前项目:\s*(\S+)/);
          if (match && match[1] !== '(未设置)') project = match[1];
        }
        
        const convPath = '/Users/yay/workspace/.agent_memory/projects/' + project + '/conversation_summary.md';
        const convContent = '# 对话记录 - ' + project + '\n> ' + new Date().toISOString().substring(0, 16) + '\n\n' + conversation;
        
        // 步骤1: 保存对话内容
        chrome.runtime.sendMessage({
          type: 'SEND_TO_SERVER',
          payload: {
            type: 'tool_call',
            id: 'save_conv_' + Date.now(),
            tool: 'write_file',
            params: { path: convPath, content: convContent }
          }
        }, () => {
          // 步骤2: 生成 digest
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
              addLog('💾 存档成功！项目: ' + project + ' (含对话记录)', 'success');
            } else {
              addLog('❌ 存档失败: ' + (resp?.error || '未知错误'), 'error');
            }
          });
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
    document.getElementById('agent-reload-ext').onclick = () => {
      chrome.runtime.sendMessage({ type: 'RELOAD_EXTENSION' });
    };

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
      try {
        const prompt = generateSystemPrompt();
        console.log('[Agent] prompt length:', prompt.length);
        
        // 直接在 content script 中用 textarea + execCommand 复制
        const ta = document.createElement('textarea');
        ta.value = prompt;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        ta.style.top = '-9999px';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        
        if (ok) {
          addLog('📋 提示词已复制', 'success');
        } else {
          addLog('❌ execCommand 返回 false', 'error');
        }
      } catch (err) {
        console.error('[Agent] copy-prompt error:', err);
        addLog('❌ 复制失败: ' + err.message, 'error');
      }
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
        // 静默处理重连（合盖/开盖导致的断开不通知 AI，避免干扰对话）
        if (!msg.connected && wasConnected) {
          addLog('⚠️ 服务器断开（可能是合盖休眠），等待自动重连...', 'warning');
        } else if (msg.connected && !wasConnected) {
          // 重连成功：重置所有执行状态，防止卡在"执行中"
          if (state.agentRunning) {
            addLog('🔄 重连后重置执行状态', 'info');
          }
          state.agentRunning = false;
          state.pendingCalls.clear();
          hideExecutingIndicator();
          addLog('✅ 服务器已静默重连', 'success');
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

      // ===== 浏览器工具反向调用（来自 ΩBATCH 中的 js_flow/eval_js/list_tabs）=====
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
          chrome.runtime.sendMessage({ type: 'EVAL_JS', code: bParams.code || '', callId: ejCallId, targetTabId: bParams.tabId || null, allFrames: bParams.allFrames || false });
        } else if (bTool === 'screenshot') {
          const scCallId = 'bt_sc_' + Date.now();
          const scHandler = (m) => {
            if (m.type === 'CAPTURE_TAB_RESULT' && m.callId === scCallId) {
              chrome.runtime.onMessage.removeListener(scHandler);
              if (m.success && m.dataUrl) {
                sendBrowserResult(true, m.dataUrl);
              } else {
                sendBrowserResult(false, null, m.error || 'screenshot failed');
              }
            }
          };
          chrome.runtime.onMessage.addListener(scHandler);
          chrome.runtime.sendMessage({ type: 'CAPTURE_TAB', callId: scCallId, tabId: bParams.tabId ? Number(bParams.tabId) : null });
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
        // executedInCurrentMessage 不在此处重置，由 SSE 连接建立/关闭时重置
        // 避免 batch 执行中间或结果返回后 DOM 扫描重复执行
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
        
        // 设置定时器合并发送（phone-bridge 消息不需要等太久）
        const delay = fromAgent === 'phone-bridge' ? 200 : 2000;
        buffer.timer = setTimeout(() => {
          const combinedMsg = buffer.messages.join('');
          const crossTabMsg = `**[来自 ${fromAgent} 的消息]**\n\n${combinedMsg}\n\n---\n请处理上述消息。完成后可以用 ΩSEND:${fromAgent}:回复内容ΩSENDEND 来回复。`;
          waitForGenerationComplete(() => enqueueMessage(crossTabMsg));
          
          // 清空缓冲区
          delete state.crossTabBuffer[fromAgent];
        }, delay);
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

  // ============== SSE 原始数据拦截 ==============
  // 从 sse-hook.js (MAIN world) 接收未经 DOM 渲染的原始 SSE delta
  // 拼接后直接解析 Ω 命令，避免 DOM 渲染导致的转义问题
  
  const sseState = {
    currentText: '',          // 当前 SSE stream 拼接的完整文本
    connected: false,
    processedCommands: new Set(),  // 已从 SSE 处理过的命令签名
    lastDeltaTime: 0,
    messageId: null,
    enabled: true,             // SSE 通道开关
    executedInCurrentMessage: false  // 当前消息中 SSE 是否已执行过工具
  };

  function initSSEListener() {
    // 监听 SSE 连接建立
    document.addEventListener('__sse_connected__', (e) => {
      sseState.connected = true;
      sseState.currentText = '';
      sseState.messageId = null;
      sseState.processedCommands.clear();
      sseState.executedInCurrentMessage = false;
      log('SSE connected:', e.detail?.transport);
    });

    // 监听每个 SSE delta
    document.addEventListener('__sse_data__', (e) => {
      if (!sseState.enabled) return;
      const raw = e.detail?.data;
      if (!raw) return;

      try {
        const parsed = JSON.parse(raw);
        
        // 只处理 content delta
        if (parsed.type === 'message_field_delta' && parsed.field_name === 'content' && parsed.delta) {
          sseState.currentText += parsed.delta;
          sseState.lastDeltaTime = Date.now();
          sseState.messageId = parsed.message_id || sseState.messageId;
          
          // 实时检测完整的 Ω 命令
          tryParseSSECommands();
        }
      } catch (err) {
        // 非 JSON 数据，忽略
      }
    });

    // 监听 SSE 连接关闭
    document.addEventListener('__sse_closed__', (e) => {
      sseState.connected = false;
      // executedInCurrentMessage 不在 SSE 关闭时重置
      // 只在新消息的 SSE 连接建立时重置，避免长时间执行的命令被 DOM 重复执行
      // 最后一次扫描，确保不遗漏
      if (sseState.currentText) {
        tryParseSSECommands();
      }
      log('SSE closed, total text length:', sseState.currentText.length);
    });

    log('SSE listener initialized');
  }

  // === SSE 通用参数完整性预检查 ===
  // 检测 SSE 传输损坏的参数，返回 true 表示应 defer to DOM
  function sseParamsLookCorrupted(call) {
    var p = call.params;
    // SSE long-content guard: params > 500 chars likely corrupted, defer to DOM
    var paramLen = JSON.stringify(p).length;
    // write_file / edit_file: 允许 SSE 直接处理大内容，避免 DOM 渲染截断
    var sseAllowLarge = (call.name === 'write_file' || call.name === 'edit_file');
    if (paramLen > 100 && !sseAllowLarge) {
      log("SSE pre-check: params > 100 chars (" + paramLen + "), defer to DOM for: " + call.name);
      return true;
    }
    if (sseAllowLarge && paramLen > 100) {
      log("SSE allow-large: " + call.name + " (" + paramLen + " chars) - SSE 直传避免 DOM 截断");
    }
    // eval_js / async_task: JS 语法检查
    if ((call.name === 'eval_js' || call.name === 'async_task') && p.code) {
      try { new Function(p.code); } catch (e) {
        if (e instanceof SyntaxError) {
          log('SSE pre-check: ' + call.name + ' code SyntaxError: ' + e.message + ', defer to DOM');
          return true;
        }
      }
    }
    // run_command: command 不应含引号或换行
    if (call.name === 'run_command' && p.command && /["'\n]/.test(p.command)) {
      log('SSE pre-check: run_command command corrupted, defer to DOM');
      return true;
    }
    // run_command: stdin 引号不配对
    if (call.name === 'run_command' && p.stdin) {
      var sq = (p.stdin.match(/'/g) || []).length;
      var dq = (p.stdin.match(/"/g) || []).length;
      if (sq % 2 !== 0 || dq % 2 !== 0) {
        log('SSE pre-check: run_command stdin unmatched quotes, defer to DOM');
        return true;
      }
    }
    // write_file: content 不应为空
    if (call.name === 'write_file' && !p.content && !p.contentFile) {
      log('SSE pre-check: write_file empty content, defer to DOM');
      return true;
    }
    // edit_file: edits 必须是非空数组
    if (call.name === 'edit_file') {
      if (!p.edits || !Array.isArray(p.edits) || p.edits.length === 0) {
        log('SSE pre-check: edit_file edits missing/empty, defer to DOM');
        return true;
      }
    }
    // 路径完整性: path 应以 / 开头
    if (p.path && typeof p.path === 'string' && !p.path.startsWith('/')) {
      log('SSE pre-check: path not starting with /, defer to DOM');
      return true;
    }
    // run_command stdin heredoc 未闭合检测
    if (call.name === 'run_command' && p.stdin) {
      var hereMatch = p.stdin.match(/<<\s*'?(\w+)'?\s*\n/);
      if (hereMatch && p.stdin.indexOf('\n' + hereMatch[1]) === -1) {
        log('SSE pre-check: run_command stdin heredoc unclosed (' + hereMatch[1] + '), defer to DOM');
        return true;
      }
    }
    // js_flow: steps 必须是非空数组
    if (call.name === 'js_flow') {
      if (!p.steps || !Array.isArray(p.steps) || p.steps.length === 0) {
        log('SSE pre-check: js_flow steps missing/empty, defer to DOM');
        return true;
      }
    }
    // bg_run: command 引号配对检测
    if (call.name === 'bg_run' && p.command) {
      var bsq = (p.command.match(/'/g) || []).length;
      var bdq = (p.command.match(/"/g) || []).length;
      if (bsq % 2 !== 0 || bdq % 2 !== 0) {
        log('SSE pre-check: bg_run command unmatched quotes, defer to DOM');
        return true;
      }
      // bg_run: 括号配对检测
      var opens = (p.command.match(/\(/g) || []).length;
      var closes = (p.command.match(/\)/g) || []).length;
      if (opens !== closes) {
        log("SSE pre-check: bg_run unmatched parens (" + opens + " vs " + closes + "), defer to DOM");
        return true;
      }
    }
    return false;
  }

  function tryParseSSECommands() {
    const text = sseState.currentText;
    if (!text) return;

    // 最优先：检测 ΩHERE heredoc 格式（支持自定义结束标记，不再硬编码检查 ΩEND）
    if (text.indexOf('\u03A9HERE') !== -1) {
      const hereCalls = parseHeredocFormat(text);
      for (const call of hereCalls) {
        const sig = 'sse:here:' + call.name + ':' + call.start;
        if (!sseState.processedCommands.has(sig)) {
          sseState.processedCommands.add(sig);
          addLog('\u26A1 SSE \u89E3\u6790 \u03A9HERE ' + call.name, 'tool');
          log('SSE parsed HEREDOC:', call.name, JSON.stringify(call.params));
          // === SSE 通用参数完整性预检查 (defer to DOM if corrupted) ===
          if (sseParamsLookCorrupted(call)) {
            continue;
          }
          const callHash = 'sse:' + sseState.messageId + ':' + call.name + ':' + call.start;
          addExecutedCall(callHash);
          // 注册 dedup key 防止 DOM 通道重复执行
          addDedupKey('dedup:' + call.name + ':' + JSON.stringify(call.params).substring(0, 200));
          sseState.executedInCurrentMessage = true;
          executeToolCall(call, callHash);
        }
      }
    }

    // 检测 ΩHEREBATCH 格式（HEREDOC 批量执行）
    var hereBatchSSEMarker = String.fromCharCode(0x03A9) + 'HEREBATCH';
    var hereBatchEndSSEMarker = String.fromCharCode(0x03A9) + 'HEREBATCHEND';
    if (text.indexOf(hereBatchSSEMarker) !== -1 && text.indexOf(hereBatchEndSSEMarker) !== -1) {
      var hereBatchSSE = parseHereBatchFormat(text);
      if (hereBatchSSE) {
        var hereBatchSig = 'sse:herebatch:' + hereBatchSSE.start;
        if (!sseState.processedCommands.has(hereBatchSig)) {
          sseState.processedCommands.add(hereBatchSig);
          addLog('\u26A1 SSE \u89E3\u6790 \u03A9HEREBATCH (' + hereBatchSSE.steps.length + ' steps)', 'tool');
          log('SSE parsed HEREBATCH:', hereBatchSSE.steps.length, 'steps');
          var hereBatchHash = 'sse:' + sseState.messageId + ':herebatch:' + hereBatchSSE.start;
          addExecutedCall(hereBatchHash);
          addDedupKey('dedup:__BATCH__:' + JSON.stringify(hereBatchSSE.steps).substring(0, 200));
          sseState.executedInCurrentMessage = true;
          executeBatchCall({ steps: hereBatchSSE.steps }, hereBatchHash);
        }
      }
    }


    // 检测 ΩBATCH...ΩEND (正则快速匹配 + fallback 括号平衡法)
    let batchMatch = text.match(/ΩBATCH(\{[\s\S]*?\})ΩEND/);
    let batchJson = batchMatch ? batchMatch[1] : null;
    if (batchMatch) {
      try {
        JSON.parse(batchJson);
      } catch (e) {
        // 正则截断，用括号平衡法重新提取
        const batchIdx = text.indexOf('ΩBATCH{');
        if (batchIdx !== -1) {
          const extracted = extractJsonFromText(text, batchIdx + 6);
          if (extracted) {
            const after = text.substring(extracted.end, extracted.end + 10);
            if (after.trim().startsWith('ΩEND')) {
              batchJson = extracted.json;
              log('SSE BATCH fallback bracket parse OK');
            }
          }
        }
      }
    }
    if (batchJson) {
      try {
        const batch = JSON.parse(batchJson);
        const sig = 'sse:batch:' + JSON.stringify(batch).substring(0, 100);
        if (!sseState.processedCommands.has(sig)) {
          sseState.processedCommands.add(sig);
          if (batch.steps && Array.isArray(batch.steps)) {
            addLog('⚡ SSE 直接解析 ΩBATCH', 'tool');
            log('SSE parsed BATCH (raw, no DOM):', batch);
            const callHash = `sse:${sseState.messageId}:__BATCH__:${JSON.stringify(batch)}`;
            addExecutedCall(callHash);
            sseState.executedInCurrentMessage = true;
            executeBatchCall(batch, callHash);
          }
        }
      } catch (e) {
        log('SSE BATCH parse error:', e.message);
      }
    }

    // 检测 Ω{...}ΩSTOP (可能有多个)
    // 策略：直接用括号平衡法提取完整 JSON + safeJsonParse 解析
    let searchPos = 0;
    while (true) {
      const omegaIdx = text.indexOf('Ω{', searchPos);
      if (omegaIdx === -1) break;
      // === SSE example keyword detection ===
      const sseNearBefore = text.substring(Math.max(0, omegaIdx - 30), omegaIdx);
      const sseIsExample = /Example:|e\.g\./.test(sseNearBefore);
      if (sseIsExample) {
        const skipExtracted = extractJsonFromText(text, omegaIdx + 1);
        if (skipExtracted) {
          try {
            const skipParsed = safeJsonParse(skipExtracted.json);
            if (skipParsed && skipParsed.tool) {
              addDedupKey(`dedup:${skipParsed.tool}:${JSON.stringify(skipParsed.params)}`);
              addDedupKey(`exec:${skipParsed.tool}:${JSON.stringify(skipParsed.params).substring(0, 200)}`);
              log('SSE SKIP (example keyword):', skipParsed.tool);
            }
          } catch(e) {}
        }
        searchPos = omegaIdx + 2; continue;
      }
      const extracted = extractJsonFromText(text, omegaIdx + 1);
      if (!extracted) { searchPos = omegaIdx + 1; continue; }
      const after = text.substring(extracted.end, extracted.end + 10);
      if (!after.trim().startsWith('ΩSTOP')) { searchPos = extracted.end; continue; }
      let parsed = null;
      try {
        parsed = safeJsonParse(extracted.json);
      } catch (e) {
        log('SSE single parse error:', e.message);
        searchPos = extracted.end;
        continue;
      }
      searchPos = extracted.end;
      if (!parsed) continue;
      // 如果是 partial parse（JSON.parse 失败后的 fallback），跳过 SSE 执行
      // partial parse 使用正则提取字段，参数可能不准确（如 command+ 被拼接）
      // 让 DOM 通道用完整文本重新解析
      if (parsed._partialParse) {
        log('SSE skip partial parse result:', parsed.tool, '(unreliable params)');
        continue;
      }
      const normalizedSig = 'sse:single:' + JSON.stringify({tool: parsed.tool, params: parsed.params}).substring(0, 100);
      if (sseState.processedCommands.has(normalizedSig)) continue;
      sseState.processedCommands.add(normalizedSig);
      if (parsed.tool) {
        // === SSE 通用参数完整性预检查 ===
        if (sseParamsLookCorrupted({ name: parsed.tool, params: parsed.params || {} })) {
          continue;
        }
        addLog(`⚡ SSE 直接解析 Ω ${parsed.tool}`, 'tool');
        log('SSE parsed tool call (raw, no DOM):', parsed.tool, parsed.params);
        const callHash = `sse:${sseState.messageId}:${parsed.tool}:${JSON.stringify(parsed.params)}`;
        addExecutedCall(callHash);
        addDedupKey(`dedup:${parsed.tool}:${JSON.stringify(parsed.params)}`);
        sseState.executedInCurrentMessage = true;
        executeToolCall({ name: parsed.tool, params: parsed.params || {} }, callHash);
      }
    }

    // 检测 ΩPLAN / ΩFLOW / ΩRESUME
    const planMatch = text.match(/ΩPLAN(\{[\s\S]*?\})/);
    if (planMatch) {
      const sig = 'sse:plan:' + planMatch[1].substring(0, 100);
      if (!sseState.processedCommands.has(sig)) {
        sseState.processedCommands.add(sig);
        try {
          const plan = JSON.parse(planMatch[1]);
          addLog('⚡ SSE 直接解析 ΩPLAN', 'tool');
          const callHash = `sse:${sseState.messageId}:__PLAN__:${JSON.stringify(plan)}`;
          addExecutedCall(callHash);
          chrome.runtime.sendMessage({
            type: 'SEND_TO_SERVER',
            payload: { type: 'task_plan', params: plan, id: Date.now() }
          });
        } catch (e) {}
      }
    }
  }

  // 检查一个命令是否已被 SSE 通道处理过（供 scanForToolCalls 判断）
  function isSSEProcessed(toolName, params) {
    const sig1 = 'sse:single:' + JSON.stringify({tool: toolName, params}).substring(0, 100);
    const sig2 = 'sse:batch:' + JSON.stringify(params).substring(0, 100);
    // 也检查 callHash 格式（SSE 通道会同时 addExecutedCall）
    return sseState.processedCommands.has(sig1) || sseState.processedCommands.has(sig2);
  }

  // Tab 保活心跳 - 防止 Chrome 休眠
  setInterval(function() {
    document.title = document.title;
  }, 30000);

  function init() {
    log('初始化 Agent v34 (Genspark)');

    // 启动 SSE 原始数据监听（优先通道）
    initSSEListener();
    
    createPanel();
    
    // 加载面板增强模块
    loadPanelEnhancer();
    // VideoGenerator 已通过 manifest content_scripts 自动加载

    // 恢复扩展刷新前未完成的异步任务
    _restoreAsyncTasks();

    setInterval(scanForToolCalls, CONFIG.SCAN_INTERVAL);

    // Notification polling - 已移除，改用 WebSocket 实时通道
    // 旧的 fetch http://localhost:8766/notify 会触发 CORS 错误
    // 如需 watchdog 通知，应通过 background.js 中转
    
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
