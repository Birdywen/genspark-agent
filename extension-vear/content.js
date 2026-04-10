// content.js v2 — Vear.com Agent Bridge (server-side processing)
// 浏览器只做 I/O：截获AI文本 → 发server → 注入结果
(function() {
  'use strict';
  if (window.__VEAR_AGENT_LOADED__) return;
  window.__VEAR_AGENT_LOADED__ = true;

  const DISABLED_KEY = 'vear_agent_disabled_' + location.pathname;
  const isDisabled = localStorage.getItem(DISABLED_KEY) === 'true';

  // === Toggle Button ===
  setTimeout(() => {
    const btn = document.createElement('div');
    btn.id = 'vear-agent-toggle';
    btn.innerHTML = isDisabled ? '🔴' : '🟢';
    btn.title = isDisabled ? 'VearAgent: OFF' : 'VearAgent: ON';
    btn.style.cssText = 'position:fixed;bottom:70px;right:12px;z-index:99999;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:16px;background:#1a1a2e;border:1px solid #333;box-shadow:0 2px 8px rgba(0,0,0,0.3);opacity:0.7;';
    btn.onclick = () => {
      const cur = localStorage.getItem(DISABLED_KEY) === 'true';
      localStorage.setItem(DISABLED_KEY, cur ? 'false' : 'true');
      btn.innerHTML = cur ? '🟢' : '🔴';
    };
    document.body.appendChild(btn);
  }, 1500);

  if (isDisabled) return;

  const CONFIG = {
    SEL: {
      INPUT: 'div.chatq-holder[contenteditable], textarea.search-input, textarea',
      SEND_BTN: 'button.sendQBtn, .enter-icon-wrapper, button[type="submit"]'
    }
  };

  const state = {
    wsConnected: false,
    roundCount: parseInt(localStorage.getItem('vear_agent_round_count') || '0'),
    lastCid: null,
    processedCids: new Set(),
    extensionValid: true
  };

  // === Chrome API Safety Wrapper ===
  function safeChromeMessage(msg) {
    try {
      if (chrome.runtime && chrome.runtime.id) {
        chrome.runtime.sendMessage(msg);
        return true;
      }
    } catch(e) {
      if (e.message.includes('Extension context invalidated')) {
        console.warn('[VearAgent] Extension context lost, using fallback channel');
        state.extensionValid = false;
      } else {
        console.error('[VearAgent] chrome.runtime.sendMessage error:', e.message);
      }
    }
    return false;
  }

  // === Fallback: Direct WS to server-v2 (bypass extension) ===
  let fallbackWs = null;
  function getFallbackWs() {
    if (fallbackWs && fallbackWs.readyState === 1) return fallbackWs;
    try {
      fallbackWs = new WebSocket('ws://localhost:8765');
      fallbackWs.onopen = () => console.log('[VearAgent] Fallback WS connected');
      fallbackWs.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data);
          if (data.type === 'tool_result' || data.type === 'inject_result') {
            console.log('[VearAgent] Fallback WS got result, tool:', data.tool, 'len:', (data.result||'').length);
            handleToolResult(data);
          }
        } catch(e) {}
      };
      fallbackWs.onerror = () => { fallbackWs = null; };
      fallbackWs.onclose = () => { fallbackWs = null; };
      return fallbackWs;
    } catch(e) { return null; }
  }

  // === Status Panel ===
  const panelEl = document.createElement('div');
  panelEl.id = 'vear-agent-panel';
  panelEl.style.cssText = 'position:fixed;bottom:110px;right:12px;z-index:99999;background:#1a1a2e;color:#a0a0b0;padding:6px 10px;border-radius:6px;font-size:11px;font-family:monospace;border:1px solid #333;max-width:200px;';
  document.body.appendChild(panelEl);

  function updateStatus() {
    const ws = state.wsConnected ? '🟢' : '🔴';
    const ctx = state.extensionValid ? '' : ' ⚡fb';
    panelEl.textContent = ws + ' R' + state.roundCount + ctx;
  }
  updateStatus();

  // === Executing Indicator ===
  function showExec(label) {
    let ind = document.getElementById('vear-exec');
    if (!ind) {
      ind = document.createElement('div');
      ind.id = 'vear-exec';
      ind.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;background:#2d2d44;color:#facc15;padding:8px 16px;border-radius:8px;font-size:13px;font-family:monospace;';
      document.body.appendChild(ind);
    }
    ind.textContent = '执行中 ' + label;
    ind.style.display = 'block';
  }
  function hideExec() {
    const i = document.getElementById('vear-exec');
    if (i) i.style.display = 'none';
  }

  // === Send Message to Vear Chat via WS bridge ===
  function sendMessage(text) {
    if (!text) return;
    console.log('[VearAgent] sendMessage via WS bridge (' + text.length + ' chars)');

    // Inject a visual bubble in chat so user can see the tool result
    try {
      const chatArea = document.querySelector('.chat-messages, .conversation-content, [class*="message-list"], [class*="chat-content"]');
      if (chatArea) {
        const bubble = document.createElement('div');
        bubble.style.cssText = 'margin:8px 16px;padding:10px 14px;background:#e8f4e8;border-radius:12px;border:1px solid #c3e6c3;font-size:13px;max-height:200px;overflow-y:auto;white-space:pre-wrap;word-break:break-word;opacity:0.85;';
        bubble.textContent = text.length > 500 ? text.substring(0, 500) + '... (' + text.length + ' chars total)' : text;
        chatArea.appendChild(bubble);
        chatArea.scrollTop = chatArea.scrollHeight;
      }
    } catch(e) { console.log('[VearAgent] UI inject failed:', e.message); }

    document.dispatchEvent(new CustomEvent('__vear_ws_send__', { detail: { text: text } }));
  }

  function sendMessageSafe(text) {
    const check = () => {
      const stopBtn = document.querySelector('button[aria-label*="stop" i], button.stop-button, .stop-generating');
      if (stopBtn) { setTimeout(check, 500); return; }
      setTimeout(() => sendMessage(text), 800);
    };
    check();
  }

  // === Handle Tool Result (shared by chrome listener + fallback WS) ===
  function handleToolResult(msg) {
    hideExec();
    state.roundCount++;
    localStorage.setItem('vear_agent_round_count', state.roundCount);
    updateStatus();
    const resultText = msg.text || (msg.success
      ? ('**[执行结果]** `' + (msg.tool||'') + '` ✓ 成功:\n```\n' + (msg.result||'') + '\n```')
      : ('**[执行结果]** `' + (msg.tool||'') + '` ✗ 失败:\n```\n' + (msg.error||'') + '\n```'));
    console.log('[VearAgent] Injecting result (' + resultText.length + ' chars)');
    sendMessageSafe(resultText);
  }

  // === WS Hook Events: 截获AI文本 → 发server ===
  document.addEventListener('__vear_ws_connected__', () => {
    state.wsConnected = true;
    updateStatus();
  });

  document.addEventListener('__vear_ws_done__', (e) => {
    const text = e.detail?.text || '';
    const cid = e.detail?.cid || null;
    if (!text) return;

    // Skip if this is a response to our bridge message
    if (state.bridgePending) {
      state.bridgePending = false;
      console.log('[VearAgent] Bridge response received, forwarding to server normally');
    }

    const key = (cid || '') + ':' + text.length;
    if (state.processedCids.has(key)) return;
    state.processedCids.add(key);
    setTimeout(() => state.processedCids.delete(key), 30000);

    state.lastCid = cid;
    console.log('[VearAgent] AI done, sending to server (' + text.length + ' chars)');

    // Try chrome API first, fallback to direct WS
    const sent = safeChromeMessage({
      type: 'SEND_TO_SERVER',
      payload: { type: 'ai_text', text: text, source: 'vear', cid: cid }
    });

    if (!sent) {
      // Extension dead — send via fallback WS and listen for result
      console.log('[VearAgent] Using fallback WS to send ai_text');
      const ws = getFallbackWs();
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'ai_text', text: text, source: 'vear', cid: cid }));
      } else {
        // WS not ready yet, wait and retry
        setTimeout(() => {
          const ws2 = getFallbackWs();
          if (ws2 && ws2.readyState === 1) {
            ws2.send(JSON.stringify({ type: 'ai_text', text: text, source: 'vear', cid: cid }));
          } else {
            console.error('[VearAgent] Both chrome and fallback WS failed');
          }
        }, 1000);
      }
    }
  });

  document.addEventListener('__vear_ws_error__', () => { state.processedCids.clear(); });
  document.addEventListener('__vear_ws_closed__', () => { state.wsConnected = false; updateStatus(); });

  // === Background Messages: 收server结果 → 注入 ===
  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg.type === 'WS_STATUS') {
        state.wsConnected = msg.connected;
        updateStatus();
      }
      if (msg.type === 'inject_status') {
        showExec(msg.detail || 'working...');
      }
      if (msg.type === 'inject_result' || msg.type === 'tool_result') {
        handleToolResult(msg);
      }
    });
  } catch(e) {
    console.warn('[VearAgent] chrome.runtime.onMessage failed, using fallback only:', e.message);
    state.extensionValid = false;
    getFallbackWs();
  }

  // === Proactive: if extension context dies mid-session, auto-connect fallback ===
  setInterval(() => {
    if (!state.extensionValid && !fallbackWs) {
      getFallbackWs();
    }
    // Periodic check if extension is still alive
    try {
      if (chrome.runtime && chrome.runtime.id) {
        state.extensionValid = true;
      }
    } catch(e) {
      if (state.extensionValid) {
        console.warn('[VearAgent] Extension context died, switching to fallback');
        state.extensionValid = false;
        getFallbackWs();
        updateStatus();
      }
    }
  }, 5000);

  console.log('[VearAgent] v2 loaded — server-side processing mode');
})();
