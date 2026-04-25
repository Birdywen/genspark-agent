// ============== DOM 操作 (Galaxy AI 专用) ==============
// Galaxy 用 data-role="user" / data-role="assistant" 区分消息
// data-testid="message-user" / data-testid="message-assistant"

  function getAIMessages() {
    return [...document.querySelectorAll('div.group\\/message[data-role="assistant"]')];
  }

  function getUserMessages() {
    return [...document.querySelectorAll('div.group\\/message[data-role="user"]')];
  }

  function getLatestAIMessage() {
    const messages = getAIMessages();
    if (messages.length === 0) return { text: '', index: -1, element: null };
    const lastMsg = messages[messages.length - 1];
    
    // Galaxy: content is in markdown prose area
    const contentEl = lastMsg.querySelector('.prose') ||
                      lastMsg.querySelector('[class*="message-content"]') ||
                      lastMsg;
    
    return {
      text: contentEl?.innerText || lastMsg.innerText || '',
      index: messages.length - 1,
      element: lastMsg
    };
  }

  function getInputBox() {
    return document.querySelector('textarea[placeholder="Send a message..."]') ||
           document.querySelector('textarea');
  }

  function sendMessage(text) {
    const input = getInputBox();
    if (!input) {
      log('sendMessage: textarea not found');
      return false;
    }
    
    // Set value via native setter to trigger React state update
    const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    nativeSet.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    
    // Wait a tick then submit
    setTimeout(() => {
      // Try form submit button
      const form = input.closest('form');
      const submitBtn = form?.querySelector('button[type="submit"]');
      if (submitBtn && !submitBtn.disabled) {
        submitBtn.click();
        log('sendMessage: clicked submit button');
      } else {
        // Fallback: Enter key
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
        log('sendMessage: dispatched Enter key');
      }
    }, 100);
    return true;
  }

  function isAIGenerating() {
    // Check Galaxy SSE state first
    if (window.__galaxySSEState && window.__galaxySSEState.streaming) return true;
    
    // Check for stop button
    const stopBtn = document.querySelector('button[aria-label*="stop" i], button[class*="stop"], [data-testid="stop-button"]');
    if (stopBtn && stopBtn.offsetParent !== null) return true;
    
    // Check for streaming/loading indicators
    const indicators = document.querySelectorAll('.generating, [class*="streaming"], [class*="generating"], .loading-response');
    for (const el of indicators) {
      if (el.offsetParent !== null) return true;
    }
    return false;
  }

  function waitForGenerationComplete(callback, maxWait = 60000) {
    const start = Date.now();
    const check = () => {
      if (!isAIGenerating()) {
        setTimeout(() => callback(true), 300);
      } else if (Date.now() - start > maxWait) {
        callback(false);
      } else {
        setTimeout(check, 500);
      }
    };
    setTimeout(check, 1000);
  }
