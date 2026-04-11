// content.js v3 — Vear.com Agent Bridge (DOM-injection mode)
// 回到 DOM 注入：输入框填文本 → 点发送按钮 → 从 DOM 读取 AI 回复
(function() {
  'use strict';
  if (window.__VEAR_AGENT_LOADED__) return;
  window.__VEAR_AGENT_LOADED__ = true;

  // === postMessage Bridge (MAIN world -> ISOLATED world) ===
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || !e.data.type) return;
    const t = e.data.type;
    if (t.startsWith('__vear_')) {
      // Convert postMessage to CustomEvent on document (same world)
      document.dispatchEvent(new CustomEvent(t, { detail: e.data }));
    }
  });



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
      btn.title = cur ? 'VearAgent: ON' : 'VearAgent: OFF';
    };
    document.body.appendChild(btn);
  }, 1500);

  if (isDisabled) return;

  // === DOM Selectors for Vear ===
  const SEL = {
    // Input field: contenteditable div or textarea
    INPUT: [
      'textarea.queryContent',
      'textarea[placeholder="Ask anything..."]',
      'div.chatq-holder[contenteditable="true"]',
      'textarea.search-input',
      'textarea[placeholder]'
    ],
    // Send button
    SEND: [
      'button.sendQBtn',
      '.enter-icon-wrapper',
      'button[type="submit"]',
      '.send-button',
      'button.send'
    ],
    // AI response containers (last assistant message)
    RESPONSE: [
      '.conversation-statement.assistant:last-child',
      '.chat-message.assistant:last-child',
      '[class*="assistant"]:last-child',
      '.message-bubble.ai:last-child'
    ],
    // Response content inside the bubble
    CONTENT: [
      '.markdown-viewer',
      '.bubble .content',
      '.bubble',
      '.message-content',
      '[class*="markdown"]'
    ],
    // Generating/streaming indicators
    GENERATING: [
      '.generating',
      '.loading-response',
      '[class*="generating"]',
      '[class*="streaming"]',
      '.loading',
      '.typing',
      '.cursor',
      '.blink',
      '[class*="loading"]',
      '[class*="typing"]'
    ],
    // Stop button
    STOP: [
      'button[aria-label*="stop" i]',
      'button.stop-button',
      '.stop-generating'
    ]
  };

  const state = {
    wsConnected: false,
    roundCount: parseInt(localStorage.getItem('vear_agent_round_count') || '0'),
    lastCid: null,
    processedCids: new Set(),
    extensionValid: true,
    sending: false,
    lastSentText: '',
    lastResponseText: ''
  };

  // === DOM Helpers ===
  function $(selectors) {
    const sels = Array.isArray(selectors) ? selectors : [selectors];
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function isGenerating() {
    for (const sel of SEL.GENERATING) {
      if (document.querySelector(sel)) return true;
    }
    // Also check if stop button is visible
    const stopBtn = $(SEL.STOP);
    if (stopBtn && stopBtn.offsetParent !== null) return true;
    return false;
  }

  function getLastResponse() {
    const msg = $(SEL.RESPONSE);
    if (!msg) return '';
    const content = null;
    for (const sel of SEL.CONTENT) {
      const el = msg.querySelector(sel);
      if (el) return el.textContent || '';
    }
    return msg.textContent || '';
  }

  // === Core: Type text into input and click send ===
  function typeAndSend(text) {
    return new Promise((resolve, reject) => {
      const input = $(SEL.INPUT);
      if (!input) {
        reject(new Error('Input element not found'));
        return;
      }

      console.log('[VearAgent] typeAndSend: filling input (' + text.length + ' chars)');

      // Fill input depending on type
      if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
        // Native input/textarea
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
          || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (nativeSetter) {
          nativeSetter.call(input, text);
        } else {
          input.value = text;
        }
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        // contenteditable div
        input.focus();
        input.textContent = '';
        input.textContent = text;
        input.dispatchEvent(new InputEvent('input', {
          bubbles: true, cancelable: true, inputType: 'insertText', data: text
        }));
      }

      // Small delay then click send
      setTimeout(() => {
        const sendBtn = $(SEL.SEND);
        if (sendBtn) {
          sendBtn.click();
          console.log('[VearAgent] Clicked send button');
          resolve(true);
        } else {
          // Try Enter key as fallback
          console.log('[VearAgent] No send button, trying Enter key');
          input.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
          }));
          input.dispatchEvent(new KeyboardEvent('keypress', {
            key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
          }));
          input.dispatchEvent(new KeyboardEvent('keyup', {
            key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
          }));
          resolve(true);
        }
      }, 150);
    });
  }

  // === Wait for AI to finish generating ===
  function waitForResponse(previousText, timeout = 120000) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      let stableText = '';
      let stableCount = 0;
      const STABLE_NEEDED = 3; // need 3 consecutive stable reads

      const check = setInterval(() => {
        if (Date.now() - startTime > timeout) {
          clearInterval(check);
          resolve({ text: getLastResponse(), timedOut: true });
          return;
        }

        const current = getLastResponse();

        // Still generating
        if (isGenerating()) {
          stableCount = 0;
          stableText = current;
          return;
        }

        // Check stability
        if (current && current !== previousText && current.length > 10) {
          if (current === stableText) {
            stableCount++;
            if (stableCount >= STABLE_NEEDED) {
              clearInterval(check);
              resolve({ text: current, timedOut: false });
            }
          } else {
            stableText = current;
            stableCount = 1;
          }
        }
      }, 500);
    });
  }

  // === Chrome API Safety Wrapper ===
  function safeChromeMessage(msg) {
    try {
      if (chrome.runtime && chrome.runtime.id) {
        chrome.runtime.sendMessage(msg);
        return true;
      }
    } catch(e) {
      if (e.message.includes('Extension context invalidated')) {
        state.extensionValid = false;
      }
    }
    return false;
  }

  // === Fallback WS to server-v2 ===
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
  panelEl.style.cssText = 'position:fixed;bottom:110px;right:12px;z-index:99999;background:#1a1a2e;color:#a0a0b0;padding:6px 10px;border-radius:6px;font-size:11px;font-family:monospace;border:1px solid #333;max-width:200px;display:flex;align-items:center;gap:6px;';
  document.body.appendChild(panelEl);
  const statusSpan = document.createElement('span');
  panelEl.appendChild(statusSpan);

  const retryBtn = document.createElement('button');
  retryBtn.textContent = '⟳';
  retryBtn.title = 'Retry last ΩCODE';
  retryBtn.style.cssText = 'background:#2d2d44;color:#facc15;border:1px solid #555;border-radius:4px;cursor:pointer;font-size:13px;padding:1px 5px;line-height:1;';
  retryBtn.onclick = () => {
    retryBtn.textContent = '⏳';
    safeChromeMessage({ type: 'RETRY_LAST' });
    setTimeout(() => { retryBtn.textContent = '⟳'; }, 3000);
  };
  panelEl.appendChild(retryBtn);

  function updateStatus() {
    const ws = state.wsConnected ? '🟢' : '🔴';
    const ctx = state.extensionValid ? '' : ' ⚠️ext';
    statusSpan.textContent = ws + ' R' + state.roundCount + ctx;
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

  // === Handle tool result: inject into DOM ===
  async function handleToolResult(data) {
    hideExec();
    const text = data.text || data.result || JSON.stringify(data);
    console.log('[VearAgent] handleToolResult: injecting via DOM (' + text.length + ' chars)');

    state.roundCount++;
    localStorage.setItem('vear_agent_round_count', state.roundCount);
    updateStatus();

    // Record previous response to detect new one
    const prevResponse = getLastResponse();

    try {
      state.sending = true;
      await typeAndSend(text);
      state.lastSentText = text;

      // Wait for AI response
      showExec('等待AI回复...');
      const { text: responseText, timedOut } = await waitForResponse(prevResponse);
      hideExec();

      if (timedOut) {
        console.warn('[VearAgent] AI response timed out');
      }

      state.lastResponseText = responseText;
      console.log('[VearAgent] AI response received (' + responseText.length + ' chars)');

      // Send AI response back to server for processing
      const payload = { type: 'ai_text', text: responseText, source: 'vear' };
      const sent = safeChromeMessage({ type: 'SEND_TO_SERVER', payload });
      if (!sent) {
        const ws = getFallbackWs();
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify(payload));
        }
      }
    } catch(e) {
      console.error('[VearAgent] typeAndSend failed:', e);
    } finally {
      state.sending = false;
    }
  }

  // === Listen for WS hook events: AI completed message ===
  document.addEventListener('__vear_ws_done__', (e) => {
    const { text, cid } = e.detail || {};
    if (!text || text.length < 5) return;

    const key = cid + ':' + text.length;
    if (state.processedCids.has(key)) return;
    state.processedCids.add(key);
    setTimeout(() => state.processedCids.delete(key), 30000);

    // Don't process AI text if we're currently sending a tool result
    if (state.sending) {
      console.log('[VearAgent] Ignoring AI text while sending');
      return;
    }

    state.lastCid = cid;
    console.log('[VearAgent] AI done (from WS hook), sending to server (' + text.length + ' chars)');

    const payload = { type: 'ai_text', text, source: 'vear', cid };
    const sent = safeChromeMessage({ type: 'SEND_TO_SERVER', payload });
    if (!sent) {
      const ws = getFallbackWs();
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify(payload));
      }
    }
  });

  document.addEventListener('__vear_ws_connected__', () => { state.wsConnected = true; updateStatus(); });
  document.addEventListener('__vear_ws_error__', () => { state.processedCids.clear(); });
  document.addEventListener('__vear_ws_closed__', () => { state.wsConnected = false; updateStatus(); });

  // === Background Messages ===
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
  } catch(e) {}

  console.log('[VearAgent v3] DOM-injection mode loaded. Round:', state.roundCount);
})();
