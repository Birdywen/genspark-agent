// ============== DOM 操作 (ChatGPT 专用) ==============

function getAIMessages() {
 return Array.from(document.querySelectorAll('article[data-testid^="conversation-turn-"]'));
}

function getLatestAIMessage() {
 const messages = getAIMessages();
 if (messages.length === 0) return { text: '', index: -1, element: null };
 const lastMsg = messages[messages.length - 1];
 const contentEl = lastMsg.querySelector('[data-message-author-role="assistant"] .markdown.prose') || 
 lastMsg.querySelector('[data-message-author-role="assistant"] .markdown') ||
 lastMsg.querySelector('[data-message-author-role="assistant"]');
 return {
 text: contentEl?.innerText || lastMsg.innerText || '',
 index: messages.length - 1,
 element: lastMsg
 };
}

function isGenerating() {
 const turns = document.querySelectorAll('article[data-testid^="conversation-turn-"]');
 if (turns.length === 0) return false;
 const lastTurn = turns[turns.length - 1];
 return lastTurn.querySelector('.result-streaming, [class*="streaming"]') !== null;
}

function isAssistantTurn(el) {
 return el.querySelector('[data-message-author-role="assistant"]') !== null;
}

function getInputBox() {
 const selectors = [
 'div[data-placeholder="Ask anything"]',
 'div[contenteditable="true"][data-placeholder]',
 'div.ProseMirror[contenteditable="true"]',
 'textarea#prompt-textarea',
 'div[contenteditable="true"]',
 'textarea'
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
 if (input.classList.contains('ProseMirror') || input.contentEditable === 'true') {
 input.innerHTML = '';
 const p = document.createElement('p');
 p.textContent = text;
 input.appendChild(p);
 input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: text, inputType: 'insertText' }));
 } else {
 const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
 input.value = '';
 if (nativeSetter) nativeSetter.call(input, text);
 else input.value = text;
 input.dispatchEvent(new Event('input', { bubbles: true }));
 }
 const btnSelectors = [
 'button[data-testid="send-button"]',
 'button[aria-label*="Send"]',
 'button[aria-label*="发送"]',
 'button[type="submit"]'
 ];
 let sent = false;
 for (const sel of btnSelectors) {
 const btn = document.querySelector(sel);
 if (btn && !btn.disabled && btn.offsetParent !== null) {
 btn.click();
 addLog('📤 点击发送按钮', 'info');
 sent = true;
 break;
 }
 }
 if (!sent) {
 ['keydown', 'keypress', 'keyup'].forEach(type => {
 input.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
 });
 addLog('📤 Enter 发送', 'info');
 }
 return true;
}

function enqueueMessage(msg) {
 state.messageQueue.push(msg);
 addLog(`📥 消息入队 (队列长度: ${state.messageQueue.length})`, 'info');
 processMessageQueue();
}

function processMessageQueue() {
 if (state.isProcessingQueue || state.messageQueue.length === 0) return;
 state.isProcessingQueue = true;
 const msg = state.messageQueue.shift();
 addLog(`📤 处理队列消息 (剩余: ${state.messageQueue.length})`, 'info');
 sendMessage(msg);
 setTimeout(() => { state.isProcessingQueue = false; processMessageQueue(); }, 3000);
}
