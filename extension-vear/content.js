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
    processedCids: new Set()
  };

  // === Status Panel ===
  const panelEl = document.createElement('div');
  panelEl.id = 'vear-agent-panel';
  panelEl.style.cssText = 'position:fixed;bottom:110px;right:12px;z-index:99999;background:#1a1a2e;color:#a0a0b0;padding:6px 10px;border-radius:6px;font-size:11px;font-family:monospace;border:1px solid #333;max-width:200px;';
  document.body.appendChild(panelEl);

  function updateStatus() {
    const ws = state.wsConnected ? '🟢' : '🔴';
    panelEl.textContent = ws + ' R' + state.roundCount;
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

  // === Send Message to Chat ===
  function sendMessage(text) {
    if (!text) return;
    const input = document.querySelector(CONFIG.SEL.INPUT);
    if (!input) { console.error('[VearAgent] No input found'); return; }

    console.log('[VearAgent] sendMessage: input tag=' + input.tagName + ' class=' + input.className?.substring(0, 40));

    // Clear and set content
    if (input.matches('div[contenteditable]')) {
      // contenteditable div - use clipboard paste for long text reliability
      input.focus();
      input.innerHTML = '';
      
      // Method: Clipboard paste (handles long text without truncation)
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      const pasteEvent = new ClipboardEvent('paste', {
        clipboardData: dt,
        bubbles: true,
        cancelable: true
      });
      const handled = !input.dispatchEvent(pasteEvent);
      
      if (!handled || !input.textContent) {
        // Fallback: direct textContent + input event
        console.log('[VearAgent] paste not handled, using textContent fallback');
        input.textContent = text;
      }
      
      // Dispatch input event for framework reactivity
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      // textarea fallback
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      nativeSetter.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // Click send button after short delay
    setTimeout(() => {
      const sendBtn = document.querySelector(CONFIG.SEL.SEND_BTN);
      console.log('[VearAgent] sendBtn:', sendBtn?.tagName, sendBtn?.className?.substring(0, 40), 'disabled:', sendBtn?.disabled);
      if (sendBtn && !sendBtn.disabled) {
        sendBtn.click();
        console.log('[VearAgent] Send button clicked');
      } else if (sendBtn && sendBtn.disabled) {
        // Button disabled, wait and retry
        console.log('[VearAgent] Send button disabled, retrying...');
        setTimeout(() => {
          if (!sendBtn.disabled) sendBtn.click();
          else {
            // Force Enter key
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
            input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
            input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
            console.log('[VearAgent] Enter key dispatched');
          }
        }, 500);
      } else {
        // No button found, try Enter
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        console.log('[VearAgent] No send button, Enter dispatched');
      }
    }, 300);
  }

  function sendMessageSafe(text) {
    const check = () => {
      const stopBtn = document.querySelector('button[aria-label*="stop" i], button.stop-button, .stop-generating');
      if (stopBtn) { setTimeout(check, 500); return; }
      setTimeout(() => sendMessage(text), 800);
    };
    check();
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

    const key = (cid || '') + ':' + text.length;
    if (state.processedCids.has(key)) return;
    state.processedCids.add(key);
    setTimeout(() => state.processedCids.delete(key), 30000);

    state.lastCid = cid;
    console.log('[VearAgent] AI done, sending to server (' + text.length + ' chars)');

    chrome.runtime.sendMessage({
      type: 'SEND_TO_SERVER',
      payload: { type: 'ai_text', text: text, source: 'vear', cid: cid }
    });
  });

  document.addEventListener('__vear_ws_error__', () => { state.processedCids.clear(); });
  document.addEventListener('__vear_ws_closed__', () => { state.wsConnected = false; updateStatus(); });

  // === Background Messages: 收server结果 → 注入 ===
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'WS_STATUS') {
      state.wsConnected = msg.connected;
      updateStatus();
    }
    if (msg.type === 'inject_status') {
      showExec(msg.detail || 'working...');
    }
    if (msg.type === 'inject_result') {
      hideExec();
      state.roundCount++;
      localStorage.setItem('vear_agent_round_count', state.roundCount);
      updateStatus();
      console.log('[VearAgent] Injecting result (' + (msg.text || '').length + ' chars)');
      sendMessageSafe(msg.text || '(empty result)');
    }
  });

  console.log('[VearAgent] v2 loaded — server-side processing mode');
})();
