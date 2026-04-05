// content.js — Giz.AI Agent Bridge Content Script
// Built from content-src/ modules. DO NOT EDIT directly — run build.sh
(function() {
  'use strict';

  if (window.__GIZ_AGENT_LOADED__) { console.log('[GizAgent] Already loaded, skipping'); return; }
  window.__GIZ_AGENT_LOADED__ = true;

  const DISABLED_KEY = 'giz_agent_disabled_' + location.pathname;
  const isDisabled = localStorage.getItem(DISABLED_KEY) === 'true';

  setTimeout(() => {
    const btn = document.createElement('div');
    btn.id = 'giz-agent-toggle';
    btn.innerHTML = isDisabled ? '🔴' : '🟢';
    btn.title = isDisabled ? 'GizAgent: OFF (click to enable)' : 'GizAgent: ON (click to disable)';
    btn.style.cssText = 'position:fixed;bottom:70px;right:12px;z-index:99999;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:16px;background:#1a1a2e;border:1px solid #333;box-shadow:0 2px 8px rgba(0,0,0,0.3);opacity:0.7;transition:opacity 0.2s;';
    btn.onmouseenter = () => btn.style.opacity = '1';
    btn.onmouseleave = () => btn.style.opacity = '0.7';
    btn.onclick = () => {
      const cur = localStorage.getItem(DISABLED_KEY) === 'true';
      localStorage.setItem(DISABLED_KEY, cur ? 'false' : 'true');
      btn.innerHTML = cur ? '🟢' : '🔴';
      if (!cur) {
        const n = document.createElement('div');
        n.textContent = 'Agent disabled. Refresh to take effect.';
        n.style.cssText = 'position:fixed;bottom:110px;right:12px;z-index:99999;background:#333;color:#fff;padding:8px 12px;border-radius:8px;font-size:12px;';
        document.body.appendChild(n); setTimeout(() => n.remove(), 3000);
      }
    };
    document.body.appendChild(btn);
  }, 1500);

  if (isDisabled) { console.log('[GizAgent] Disabled on this page'); return; }

  const CONFIG = {
    SCAN_INTERVAL: 300, TIMEOUT_MS: 600000, MAX_RESULT_LENGTH: 50000, MAX_LOGS: 50, DEBUG: false,
    SELECTORS: {
      INPUT: 'textarea.q-field__native[placeholder*="Message"], div[contenteditable="true"], textarea[placeholder*="Message"]',
      SEND_BTN: 'button.q-btn[title="Send"], button[aria-label*="Send"]',
      AI_MESSAGE: '.assistant-message, [class*="assistant-message"]',
      STOP_BTN: 'button[title*="Stop"], button[aria-label*="Stop"], button[class*="stop"]'
    }
  };

  const state = {
    wsConnected: false, agentRunning: false, availableTools: [],
    executedCalls: new Set(), // Fresh each page load — dedup is per-message now
    pendingCalls: new Map(), lastMessageText: '', lastStableTime: 0,
    generatingFalseCount: 0, messageQueue: [], isProcessingQueue: false,
    roundCount: parseInt(localStorage.getItem('giz_agent_round_count') || '0'),
    totalCalls: 0, sessionStart: Date.now(),
    wsState: { currentSubscribeId: null, currentText: '', executedInCurrentMessage: false, lastMessageTime: 0, processedCommands: new Set() }
  };

  function addExecutedCall(hash) {
    state.executedCalls.add(hash);
    localStorage.setItem('giz_agent_executed_calls', JSON.stringify(Array.from(state.executedCalls).slice(-500)));
  }
  function log(...args) { if (CONFIG.DEBUG) console.log('[GizAgent]', ...args); }
  // ============== 工具函数 ==============

  function isAIGenerating() {
    for (const sel of CONFIG.SELECTORS.STOP_BTN.split(',')) {
      try { const btn = document.querySelector(sel.trim()); if (btn && btn.offsetParent !== null) return true; } catch(e) {}
    }
    const msgs = document.querySelectorAll(CONFIG.SELECTORS.AI_MESSAGE);
    if (msgs.length > 0) {
      const last = msgs[msgs.length - 1];
      const cl = last.className.toLowerCase();
      if (cl.includes('loading') || cl.includes('streaming') || cl.includes('typing') || cl.includes('generating')) return true;
      if (last.querySelector('[class*="loading"], [class*="typing"], [class*="streaming"]')) return true;
    }
    if (state.wsState && Date.now() - state.wsState.lastMessageTime < 800) return true;
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

  function safeJsonParse(str) {
    // Level 1: raw parse
    try { return JSON.parse(str); } catch(e) {}
    // Level 2: fix smart quotes + trailing commas
    try {
      const fixed = str.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'").replace(/,\s*([}\]])/g, '$1');
      return JSON.parse(fixed);
    } catch(e2) {}
    // Level 3: regex add quotes to unquoted keys (last resort, can break string values)
    try {
      const aggressive = str.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'").replace(/,\s*([}\]])/g, '$1').replace(/(\{|,)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
      return JSON.parse(aggressive);
    } catch(e3) { return null; }
  }

  function truncateResult(result) {
    if (typeof result !== 'string') result = JSON.stringify(result);
    if (result.length > CONFIG.MAX_RESULT_LENGTH) return result.substring(0, CONFIG.MAX_RESULT_LENGTH) + '\n...[truncated]';
    return result;
  }
  // ============== UI 面板 ==============

  function createInfoPanel() {
    if (document.getElementById('giz-agent-panel')) return;
    const panel = document.createElement('div');
    panel.id = 'giz-agent-panel';
    panel.innerHTML = `
      <div id="giz-panel-header">
        <span id="giz-panel-title">⚡ Giz Agent Bridge</span>
        <div style="display:flex;gap:6px;align-items:center">
          <span id="giz-agent-round" style="font-size:10px;color:#888">Round: 0</span>
          <button id="giz-panel-clear" title="Clear logs" style="background:transparent;border:none;color:#888;cursor:pointer;font-size:12px;padding:0 4px;">🗑</button>
          <button id="giz-panel-minimize">_</button>
        </div>
      </div>
      <div id="giz-panel-body">
        <div id="giz-status-bar">
          <span id="giz-server-status">Server: ❌</span>
          <span id="giz-ws-hook-status">WS-Hook: ❌</span>
          <span id="giz-agent-status">Agent: ⏸</span>
        </div>
        <div id="giz-stats-bar">
          <span id="giz-call-count">Calls: 0</span>
          <span id="giz-pending-count">Pending: 0</span>
          <span id="giz-tools-count">Tools: 0</span>
        </div>
        <div id="giz-executing" style="display:none;padding:4px 8px;background:#1a2a1a;border-radius:4px;margin-bottom:6px;font-size:11px;color:#4ade80">
          ⚡ Executing: <span id="giz-exec-tool"></span> <span id="giz-exec-time" style="color:#888">0s</span>
        </div>
        <div id="giz-log-container"></div>
      </div>`;
    document.body.appendChild(panel);

    // minimize
    const minBtn = document.getElementById('giz-panel-minimize');
    const body = document.getElementById('giz-panel-body');
    minBtn.onclick = () => { body.classList.toggle('collapsed'); minBtn.textContent = body.classList.contains('collapsed') ? '□' : '_'; };

    // clear logs
    document.getElementById('giz-panel-clear').onclick = () => {
      const c = document.getElementById('giz-log-container'); if (c) c.innerHTML = '';
    };

    // drag
    let ox, oy, dragging = false;
    const hdr = document.getElementById('giz-panel-header');
    hdr.addEventListener('mousedown', e => { dragging = true; ox = e.clientX - panel.offsetLeft; oy = e.clientY - panel.offsetTop; });
    document.addEventListener('mousemove', e => { if (!dragging) return; panel.style.left = (e.clientX-ox)+'px'; panel.style.top = (e.clientY-oy)+'px'; panel.style.right='auto'; panel.style.bottom='auto'; });
    document.addEventListener('mouseup', () => { dragging = false; });
  }

  function addLog(message, type = 'info') {
    const container = document.getElementById('giz-log-container');
    if (!container) return;
    const entry = document.createElement('div');
    entry.className = 'giz-log-entry ' + type;
    entry.innerHTML = '<div class="giz-log-time">' + new Date().toLocaleTimeString() + '</div><div class="giz-log-msg">' + message + '</div>';
    container.insertBefore(entry, container.firstChild);
    while (container.children.length > CONFIG.MAX_LOGS) container.removeChild(container.lastChild);
  }

  function updateStatus() {
    const el = id => document.getElementById(id);
    if (el('giz-server-status')) el('giz-server-status').textContent = 'Server: ' + (state.wsConnected ? '✅' : '❌');
    if (el('giz-ws-hook-status')) el('giz-ws-hook-status').textContent = 'WS-Hook: ' + (window.__GIZ_WS_HOOK_ACTIVE__ ? '✅' : '❌');
    if (el('giz-agent-status')) el('giz-agent-status').textContent = 'Agent: ' + (state.agentRunning ? '🔄' : '⏸');
    if (el('giz-call-count')) el('giz-call-count').textContent = 'Calls: ' + state.totalCalls;
    if (el('giz-pending-count')) el('giz-pending-count').textContent = 'Pending: ' + state.pendingCalls.size;
    if (el('giz-tools-count')) el('giz-tools-count').textContent = 'Tools: ' + state.availableTools.length;
    if (el('giz-agent-round')) el('giz-agent-round').textContent = 'Round: ' + state.roundCount;
  }

  let execTimer = null;
  function showExecutingIndicator(toolName) {
    const el = document.getElementById('giz-executing');
    const tn = document.getElementById('giz-exec-tool');
    const tt = document.getElementById('giz-exec-time');
    if (el) el.style.display = 'block';
    if (tn) tn.textContent = toolName || '...';
    const start = Date.now();
    if (execTimer) clearInterval(execTimer);
    execTimer = setInterval(() => { if (tt) tt.textContent = ((Date.now()-start)/1000).toFixed(1)+'s'; }, 100);
  }
  function hideExecutingIndicator() {
    const el = document.getElementById('giz-executing');
    if (el) el.style.display = 'none';
    if (execTimer) { clearInterval(execTimer); execTimer = null; }
  }
  // ============== DOM 操作 (Giz.AI 专用) ==============

  function getAIMessages() {
    return Array.from(document.querySelectorAll(CONFIG.SELECTORS.AI_MESSAGE));
  }

  function getLatestAIMessage() {
    // 优先用 WS stream 缓冲的完整文本
    if (state.wsState.currentText && state.wsState.currentText.length > 0) {
      return { text: state.wsState.currentText, index: -1, element: null, fromWS: true };
    }
    const messages = getAIMessages();
    if (messages.length === 0) return { text: '', index: -1, element: null };
    const last = messages[messages.length - 1];
    return { text: last.innerText || last.textContent || '', index: messages.length - 1, element: last };
  }

  function getInputBox() {
    for (const sel of CONFIG.SELECTORS.INPUT.split(',')) {
      try {
        const el = document.querySelector(sel.trim());
        if (el && el.offsetParent !== null) return el;
      } catch(e) {}
    }
    return null;
  }

  function sendMessage(text) {
    const input = getInputBox();
    if (!input) { addLog('❌ 找不到输入框', 'error'); return false; }
    input.focus();
    if (input.tagName === 'TEXTAREA') {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      if (nativeSetter) nativeSetter.call(input, text);
      else input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      input.innerHTML = '';
      const p = document.createElement('p');
      p.textContent = text;
      input.appendChild(p);
      input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
    }
    // 尝试点击发送按钮
    for (const sel of CONFIG.SELECTORS.SEND_BTN.split(',')) {
      try {
        const btn = document.querySelector(sel.trim());
        if (btn && !btn.disabled && btn.offsetParent !== null) { btn.click(); addLog('📤 发送消息', 'info'); return true; }
      } catch(e) {}
    }
    // 回退：Enter 键
    ['keydown','keypress','keyup'].forEach(type => {
      input.dispatchEvent(new KeyboardEvent(type, { key:'Enter', code:'Enter', keyCode:13, which:13, bubbles:true, cancelable:true }));
    });
    addLog('📤 Enter 发送', 'info');
    return true;
  }

  function sendMessageSafe(text) {
    if (isAIGenerating()) {
      waitForGenerationComplete(() => { setTimeout(() => sendMessage(text), 300); });
    } else {
      sendMessage(text);
    }
  }

  function enqueueMessage(msg) {
    state.messageQueue.push(msg);
    processMessageQueue();
  }

  function processMessageQueue() {
    if (state.isProcessingQueue || state.messageQueue.length === 0) return;
    state.isProcessingQueue = true;
    const msg = state.messageQueue.shift();
    sendMessage(msg);
    setTimeout(() => { state.isProcessingQueue = false; processMessageQueue(); }, 3000);
  }
  // ============== 工具调用解析 ==============

  function isExampleToolCall(text, matchStart) {
    const beforeText = text.substring(Math.max(0, matchStart - 100), matchStart).toLowerCase();
    const exampleIndicators = ['示例：','示例:','例如：','例如:','example:','e.g.:','格式如下','格式为','比如','such as','like this'];
    for (const ind of exampleIndicators) { if (beforeText.includes(ind)) return true; }
    const textBeforeMatch = text.substring(0, matchStart);
    const lastBacktick = textBeforeMatch.lastIndexOf('`');
    if (lastBacktick !== -1) {
      const between = textBeforeMatch.substring(lastBacktick + 1);
      if (!between.includes('`')) {
        const tripleBacktickBefore = textBeforeMatch.lastIndexOf('```');
        if (tripleBacktickBefore === -1 || tripleBacktickBefore < lastBacktick - 2) return true;
      }
    }
    return false;
  }

  function extractBalancedJson(text, marker, fromEnd = false) {
    const idx = fromEnd ? text.lastIndexOf(marker) : text.indexOf(marker);
    if (idx === -1) return null;
    const jsonStart = text.indexOf('{', idx + marker.length);
    if (jsonStart === -1) return null;
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
    if (!text) return [];

    const ocPrefix = String.fromCharCode(0x03A9) + 'CODE';     // ΩCODE (5 chars)
    const ocEndTag = String.fromCharCode(0x03A9) + 'CODEEND';  // ΩCODEEND (8 chars)

    // ===== Step 1: Strip markdown fenced code blocks to avoid false matches =====
    let cleanText = text;
    const fenceRegex = /```[\s\S]*?```/g;
    let fenceMatch;
    while ((fenceMatch = fenceRegex.exec(text)) !== null) {
      const block = text.substring(fenceMatch.index, fenceMatch.index + fenceMatch[0].length);
      if (block.includes(ocPrefix)) {
        // Replace with same-length spaces to preserve positions
        const replacement = ' '.repeat(fenceMatch[0].length);
        cleanText = cleanText.substring(0, fenceMatch.index) + replacement + cleanText.substring(fenceMatch.index + fenceMatch[0].length);
      }
    }

    // ===== Step 2: Find real ΩCODE blocks =====
    let searchFrom = 0;
    while (searchFrom < cleanText.length) {
      let codeStart = cleanText.indexOf(ocPrefix, searchFrom);
      if (codeStart === -1) break;

      // Skip if this is actually ΩCODEEND (contains ΩCODE as substring)
      if (cleanText.substring(codeStart, codeStart + 8) === ocEndTag) {
        searchFrom = codeStart + 8;
        continue;
      }

      // Skip if inside markdown code block (odd number of ``` before)
      const textBefore = cleanText.substring(0, codeStart);
      const fenceCount = (textBefore.match(/```/g) || []).length;
      if (fenceCount % 2 === 1) {
        searchFrom = codeStart + 5;
        continue;
      }

      // Skip example context
      const beforeOC = text.substring(Math.max(0, codeStart - 100), codeStart);
      if (/Example:|e\.g\.|示例|格式/.test(beforeOC)) {
        searchFrom = codeStart + 5;
        continue;
      }

      // Find matching ΩCODEEND
      let codeEnd = -1;
      let endSearch = codeStart + 5;
      while (endSearch < cleanText.length) {
        const idx = cleanText.indexOf(ocEndTag, endSearch);
        if (idx === -1) break;
        const charBefore = idx > 0 ? cleanText[idx - 1] : '\n';
        if (charBefore === "'" || charBefore === '"' || charBefore === '\\') {
          endSearch = idx + 8;
          continue;
        }
        codeEnd = idx;
        break;
      }
      if (codeEnd === -1) break; // Incomplete block, wait for more

      searchFrom = codeEnd + 8;

      // Extract and parse the block body from ORIGINAL text
      const hdrEnd = text.indexOf('\n', codeStart);
      let ocBody = (hdrEnd !== -1 && hdrEnd < codeEnd)
        ? text.substring(hdrEnd + 1, codeEnd).trim()
        : text.substring(codeStart + 5, codeEnd).trim();
      ocBody = ocBody.replace(/^`+[\w]*\n?/, '').replace(/\n?`+$/, '').trim();

      const ocObj = safeJsonParse(ocBody);
      if (ocObj && (ocObj.tool || ocObj.steps)) {
        if (ocObj.steps && Array.isArray(ocObj.steps)) {
          log('parseToolCalls: BATCH steps=' + ocObj.steps.length);
          return [{ name: '__BATCH__', params: ocObj, raw: text.substring(codeStart, codeEnd + 8), start: codeStart, end: codeEnd + 8, isBatch: true }];
        } else {
          log('parseToolCalls: SINGLE tool=' + ocObj.tool);
          return [{ name: ocObj.tool, params: ocObj.params || {}, raw: text.substring(codeStart, codeEnd + 8), start: codeStart, end: codeEnd + 8 }];
        }
      } else {
        log('parseToolCalls: ΩCODE found but JSON parse failed, body[0:120]:', ocBody.substring(0, 120));
      }
    }

    // ===== Fallback: ```tool code blocks =====
    const toolRe = /```tool\s*\n([\s\S]*?)\n```/g;
    let m;
    const toolCalls = [];
    while ((m = toolRe.exec(text)) !== null) {
      try {
        const json = m[1].trim().replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'");
        const p = safeJsonParse(json);
        if (p && p.tool) toolCalls.push({ name: p.tool, params: p.params || {}, raw: m[0], start: m.index, end: m.index + m[0].length });
      } catch(e) {}
    }
    if (toolCalls.length > 0) return toolCalls;

    return [];
  }
  // ============== 工具执行 ==============

  function executeToolCall(tool, hash) {
    if (!tool || !tool.name) return;
    state.agentRunning = true;
    state.totalCalls++;
    updateStatus();
    showExecutingIndicator(tool.name);
    addLog('⚡ 执行: ' + tool.name, 'tool');
    log('executeToolCall:', tool.name, tool.params);

    chrome.runtime.sendMessage({
      type: 'SEND_TO_SERVER',
      payload: { type: 'tool_call', tool: tool.name, params: tool.params, callId: hash }
    }, resp => {
      if (chrome.runtime.lastError || !resp?.success) {
        const err = chrome.runtime.lastError?.message || resp?.error || 'unknown';
        addLog('❌ 发送失败: ' + err, 'error');
        hideExecutingIndicator();
        state.agentRunning = false;
        updateStatus();
        // 回退：把结果直接发回给 AI
        const errResult = JSON.stringify({ error: err, tool: tool.name });
        sendResultToAI(tool.name, errResult, hash);
      }
    });
  }

  function executeBatchCall(batchObj, hash) {
    state.agentRunning = true;
    state.totalCalls++;
    updateStatus();
    showExecutingIndicator('batch[' + batchObj.steps.length + ']');
    addLog('⚡ 批量执行: ' + batchObj.steps.length + ' 步', 'tool');

    chrome.runtime.sendMessage({
      type: 'SEND_TO_SERVER',
      payload: { type: 'batch_call', steps: batchObj.steps, callId: hash }
    }, resp => {
      if (chrome.runtime.lastError || !resp?.success) {
        const err = chrome.runtime.lastError?.message || resp?.error || 'unknown';
        addLog('❌ 批量发送失败: ' + err, 'error');
        hideExecutingIndicator();
        state.agentRunning = false;
        updateStatus();
      }
    });
  }

  function sendResultToAI(toolName, result, callId) {
    hideExecutingIndicator();
    state.agentRunning = false;
    state.pendingCalls.delete(callId);
    updateStatus();

    const truncated = truncateResult(result);
    state.roundCount++;
    localStorage.setItem('giz_agent_round_count', state.roundCount);
    updateStatus();

    // 重置 WS 状态，准备接收下一条消息
    state.wsState.executedInCurrentMessage = false;
    state.wsState.currentText = '';
    state.wsState.currentSubscribeId = null;

    const resultMsg = '[执行结果] ' + toolName + ':\n' + truncated;
    addLog('✅ 结果发送: ' + truncated.substring(0, 80) + (truncated.length > 80 ? '...' : ''), 'success');
    enqueueMessage(resultMsg);
  }

  function handleToolResult(data) {
    log('handleToolResult:', data);
    const callId = data.callId || data.call_id;
    const toolName = data.tool || data.name || 'unknown';
    const result = data.result !== undefined ? data.result : (data.output || data.error || JSON.stringify(data));

    addLog('📥 结果: ' + toolName + ' (' + String(result).substring(0, 60) + ')', 'success');
    sendResultToAI(toolName, result, callId);
  }
  // ============== 扫描工具调用 ==============

  function scanForToolCalls() {
    if (localStorage.getItem('giz_agent_disabled_' + location.pathname) === 'true') return;
    if (state.agentRunning) return;
    if (isAIGenerating()) { state.generatingFalseCount = 0; return; }

    state.generatingFalseCount++;
    if (state.generatingFalseCount < 3) return;

    const { text, index } = getLatestAIMessage();
    if (!text) return;

    // 刷新保护：页面加载 5 秒内跳过
    if (window.__gizAgentLoadState) {
      const elapsed = Date.now() - window.__gizAgentLoadState.loadTime;
      if (elapsed < 3000) return;
      if (elapsed < 5000 && !window.__gizAgentLoadState.marked) {
        window.__gizAgentLoadState.marked = true;
        const existingCalls = parseToolCalls(text);
        for (const tool of existingCalls) {
          addExecutedCall(index + ':' + tool.name + ':' + JSON.stringify(tool.params));
        }
        log('刷新保护：标记', existingCalls.length, '个已有工具调用');
        return;
      }
    }

    if (state.lastMessageText !== text) {
      state.lastMessageText = text;
      state.lastStableTime = Date.now();
      state.generatingFalseCount = 0;
      return;
    }

    // 文本稳定 1000ms
    if (Date.now() - state.lastStableTime < 1000) return;

    // 二次确认
    const { text: textNow } = getLatestAIMessage();
    if (textNow !== text) {
      state.lastMessageText = textNow;
      state.lastStableTime = Date.now();
      state.generatingFalseCount = 0;
      return;
    }

    const calls = parseToolCalls(text);
    if (calls.length === 0) return;

    for (const call of calls) {
      const hash = (index >= 0 ? index : 'ws') + ':' + call.name + ':' + JSON.stringify(call.params).substring(0, 100);
      if (state.executedCalls.has(hash)) { log('跳过已执行:', hash.substring(0, 60)); continue; }
      addExecutedCall(hash);
      addLog('🔍 发现工具调用: ' + call.name, 'tool');

      if (call.isBatch || call.name === '__BATCH__') {
        executeBatchCall(call.params, hash);
      } else {
        state.pendingCalls.set(hash, call);
        updateStatus();
        executeToolCall(call, hash);
      }
      break; // 每次只执行一个，等结果回来再继续
    }
  }

  setInterval(scanForToolCalls, CONFIG.SCAN_INTERVAL);
  // ============== 通信：WS Hook 事件 + Background 消息 ==============

  // 监听 ws-hook.js 发来的 WS 流事件
  document.addEventListener('__giz_ws_connected__', () => {
    addLog('🔌 Giz WebSocket 已连接', 'success');
    updateStatus();
  });

  document.addEventListener('__giz_ws_ready__', () => {
    addLog('✅ Notifications namespace 就绪', 'success');
  });

  document.addEventListener('__giz_ws_closed__', () => {
    addLog('🔌 Giz WebSocket 断开', 'error');
    state.wsState.currentText = '';
    state.wsState.executedInCurrentMessage = false;
    updateStatus();
  });

  // 接收 AI 流式消息
  document.addEventListener('__giz_message__', (e) => {
    const { subscribeId, output, status } = e.detail;
    const ws = state.wsState;

    ws.lastMessageTime = Date.now();

    // 新的 subscribeId = 新消息
    if (subscribeId && subscribeId !== ws.currentSubscribeId) {
      ws.currentSubscribeId = subscribeId;
      ws.currentText = '';
      ws.executedInCurrentMessage = false;
      ws.processedCommands.clear();
      log('新消息 subscribeId:', subscribeId);
    }

    if (output) ws.currentText = output; // Giz 每次发全量 output

    // 消息完成时尝试解析
    if (status === 'completed' || status === 'done' || status === 'finished') {
      addLog('💬 AI 消息完成 (' + (ws.currentText.length) + ' chars)', 'info');
      if (ws.executedInCurrentMessage) { log('WS: 已执行，跳过'); return; }

      const text = ws.currentText;
      if (!text) return;

      const calls = parseToolCalls(text);
      if (calls.length === 0) return;

      const call = calls[0];
      const hash = 'ws:' + subscribeId + ':' + call.name;
      if (state.executedCalls.has(hash)) return;

      addExecutedCall(hash);
      ws.executedInCurrentMessage = true;
      addLog('⚡ WS 触发: ' + call.name, 'tool');

      if (call.isBatch || call.name === '__BATCH__') {
        executeBatchCall(call.params, hash);
      } else {
        state.pendingCalls.set(hash, call);
        updateStatus();
        executeToolCall(call, hash);
      }
    }
  });

  // 监听 background 消息
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'WS_STATUS') {
      state.wsConnected = message.connected;
      updateStatus();
      addLog(message.connected ? '🔌 Agent Server 已连接' : '🔌 Agent Server 断开', message.connected ? 'success' : 'error');
    }
    if (message.type === 'TOOL_RESULT') handleToolResult(message.payload);
    if (message.type === 'tools_updated') {
      state.availableTools = message.tools || [];
      updateStatus();
      addLog('🔧 工具列表更新: ' + state.availableTools.length + ' 个', 'info');
    }
    if (message.type === 'batch_step_result') {
      addLog('📦 批量步骤完成: ' + (message.stepIndex + 1) + '/' + message.total, 'info');
    }
    if (message.type === 'batch_complete') {
      addLog('✅ 批量执行完成', 'success');
      handleToolResult({ tool: 'batch', result: message.results || [], callId: message.callId });
    }
    sendResponse({ received: true });
    return true;
  });
  // ============== 初始化 ==============

  window.__gizAgentLoadState = { loadTime: Date.now(), marked: false };

  // 超时唤醒监控
  let lastAiMessageTime = Date.now();
  const WAKEUP_TIMEOUT = 120000; // 2分钟无响应则唤醒
  const WAKEUP_CHECK_INTERVAL = 20000;

  setInterval(() => {
    if (!state.agentRunning) { lastAiMessageTime = Date.now(); return; }
    const elapsed = Date.now() - lastAiMessageTime;
    if (elapsed > WAKEUP_TIMEOUT) {
      addLog('⏰ AI 超过 ' + Math.round(elapsed/1000) + 's 无响应，发送唤醒', 'warning');
      sendMessageSafe('继续');
      lastAiMessageTime = Date.now();
    }
  }, WAKEUP_CHECK_INTERVAL);

  // 更新最后 AI 消息时间
  document.addEventListener('__giz_message__', () => { lastAiMessageTime = Date.now(); });

  // 请求工具列表
  function requestTools() {
    chrome.runtime.sendMessage({ type: 'SEND_TO_SERVER', payload: { type: 'get_tools' } }, resp => {
      if (resp?.success) addLog('🔧 已请求工具列表', 'info');
    });
  }

  function init() {
    const setup = () => {
      setTimeout(() => {
        createInfoPanel();
        updateStatus();
        addLog('🚀 Giz Agent Bridge 已启动 v2.0', 'success');
        addLog('📡 等待 WebSocket 连接...', 'info');
        // 检查 background 连接状态
        chrome.runtime.sendMessage({ type: 'GET_STATUS' }, resp => {
          if (resp?.connected) {
            state.wsConnected = true;
            updateStatus();
            addLog('✅ Agent Server 已连接', 'success');
            requestTools();
          }
        });
      }, 1000);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
    else setup();
  }

  init();
})(); // end IIFE
