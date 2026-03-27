// content.js v1.0.53 - REC增强 - ΩCODE统一通道 - 添加 Agent 心跳机制，确保跨 Tab 通信可靠
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
    TIMEOUT_MS: 600000,
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

