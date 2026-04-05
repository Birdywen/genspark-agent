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
