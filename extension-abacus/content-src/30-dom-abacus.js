// ============== DOM 操作 (Abacus AI 专用) ==============

function getAIMessages() {
  // Abacus AI 消息选择器 - 需要根据实际DOM调整
  return Array.from(document.querySelectorAll('[class*="message"], [class*="Message"], [class*="chat"], [class*="Chat"]'));
}

function getLatestAIMessage() {
  const messages = getAIMessages();
  if (messages.length === 0) return { text: '', index: -1, element: null };
  const lastMsg = messages[messages.length - 1];
  
  // 尝试找到消息内容区域
  const contentEl = lastMsg.querySelector('[class*="content"], [class*="Content"], .markdown, .prose') || 
                    lastMsg.querySelector('div') ||
                    lastMsg;
  
  return { 
    text: contentEl?.innerText || lastMsg.innerText || '', 
    index: messages.length - 1,
    element: lastMsg
  };
}

function isGenerating() {
  // 检查是否有正在生成的指示器
  const indicators = document.querySelectorAll('[class*="loading"], [class*="generating"], [class*="streaming"], .typing, .cursor, .blink');
  if (indicators.length > 0) return true;
  
  // 检查最后一条消息是否包含生成中标记
  const lastMsg = getLatestAIMessage();
  if (lastMsg.element) {
    const hasLoading = lastMsg.element.querySelectorAll('.loading, .typing, .cursor, .blink, [class*="loading"], [class*="typing"]').length > 0;
    if (hasLoading) return true;
  }
  
  // 全局检查
  const globalInd = document.querySelectorAll('.generating, .loading-response, [class*="generating"], [class*="streaming"]');
  return globalInd.length > 0;
}

function getInputBox() {
  const selectors = [
    'textarea',
    'input[type="text"]',
    'div[contenteditable="true"]',
    '[class*="input"], [class*="Input"], [class*="prompt"], [class*="Prompt"]',
    '[placeholder*="message" i], [placeholder*="ask" i], [placeholder*="输入"], [placeholder*="发送"]'
  ];
  
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.offsetParent !== null) return el;
  }
  return null;
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
      'button[type="submit"]',
      'button[aria-label*="send" i]',
      'button[aria-label*="发送"]',
      '[class*="send"], [class*="Send"], [class*="submit"], [class*="Submit"]',
      'button:has(svg)', // 包含图标的按钮
      'button'
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
    
    return true;
  };

  // 第一次尝试发送
  setTimeout(() => {
    const sent = trySend(1);
    if (!sent) {
      setTimeout(() => {
        const currentInput = getInputBox();
        if (currentInput && currentInput.value && currentInput.value.length > 10) {
          addLog('🔄 重试发送...', 'info');
          trySend(2);
        }
      }, 800);
    }
  }, 800);
  
  return true;
}

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
  sendMessage(msg);
  
  setTimeout(() => {
    state.isProcessingQueue = false;
    processMessageQueue();
  }, 3000);
}
