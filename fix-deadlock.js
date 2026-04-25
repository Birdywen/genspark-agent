#!/usr/bin/env node
// fix-deadlock.js — 修复 content.js 中 handleToolResult 等待AI回复的死锁问题

const fs = require('fs');
const path = require('path');

const contentFile = path.join(__dirname, 'extension-vear/content.js');

console.log('📖 Reading:', contentFile);
let code = fs.readFileSync(contentFile, 'utf-8');

// === 改动 1: 修改 handleToolResult 函数 ===
const oldHandleToolResult = `  // === Handle tool result: inject into DOM ===
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
  }`;

const newHandleToolResult = `  // === Handle tool result: inject into DOM ===
  async function handleToolResult(data) {
    hideExec();
    const text = data.text || data.result || JSON.stringify(data);
    console.log('[VearAgent] handleToolResult: injecting via DOM (' + text.length + ' chars)');

    state.roundCount++;
    localStorage.setItem('vear_agent_round_count', state.roundCount);
    updateStatus();

    // Create a promise that WS hook can resolve (fast path)
    let wsResolve = null;
    const wsPromise = new Promise((resolve) => { wsResolve = resolve; });
    state._wsResponseResolve = wsResolve;

    // Record previous response to detect new one
    const prevResponse = getLastResponse();

    try {
      state.sending = true;
      await typeAndSend(text);
      state.lastSentText = text;

      // Wait for AI response: WS hook (fast) vs DOM polling (fallback) — race!
      showExec('等待AI回复...');
      const domPromise = waitForResponse(prevResponse);
      const result = await Promise.race([
        wsPromise.then(t => ({ text: t, timedOut: false, source: 'ws' })),
        domPromise.then(r => ({ ...r, source: 'dom' }))
      ]);
      hideExec();
      state._wsResponseResolve = null;

      if (result.timedOut) {
        console.warn('[VearAgent] AI response timed out');
      }

      const responseText = result.text;
      state.lastResponseText = responseText;
      console.log('[VearAgent] AI response received via ' + result.source + ' (' + responseText.length + ' chars)');

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
      state._wsResponseResolve = null;
    } finally {
      state.sending = false;
    }
  }`;

// === 改动 2: 修改 __vear_ws_done__ 监听器中的 state.sending 拦截 ===
const oldSendingCheck = `    // Don't process AI text if we're currently sending a tool result
    if (state.sending) {
      console.log('[VearAgent] Ignoring AI text while sending');
      return;
    }`;

const newSendingCheck = `    // If sending tool result, resolve the waiting promise (WS fast path)
    if (state.sending) {
      console.log('[VearAgent] AI response captured via WS while sending');
      if (state._wsResponseResolve) {
        state._wsResponseResolve(text);
        state._wsResponseResolve = null;
      }
      return;
    }`;

// === Apply patches ===
let changes = 0;

if (code.includes(oldHandleToolResult)) {
  code = code.replace(oldHandleToolResult, newHandleToolResult);
  console.log('✅ 改动1: handleToolResult — 添加 WS Promise race 机制');
  changes++;
} else {
  console.log('⚠️  改动1: handleToolResult 未匹配到，可能已修改过');
}

if (code.includes(oldSendingCheck)) {
  code = code.replace(oldSendingCheck, newSendingCheck);
  console.log('✅ 改动2: __vear_ws_done__ — WS hook 不再死拦，改为 resolve promise');
  changes++;
} else {
  console.log('⚠️  改动2: sending check 未匹配到，可能已修改过');
}

if (changes > 0) {
  // Backup
  const backupFile = contentFile + '.bak';
  fs.copyFileSync(contentFile, backupFile);
  console.log('💾 Backup saved:', backupFile);

  // Write
  fs.writeFileSync(contentFile, code, 'utf-8');
  console.log('\n🎉 Done! ' + changes + ' patches applied to content.js');
  console.log('🔄 请刷新浏览器扩展和页面来生效');
} else {
  console.log('\n❌ No changes applied');
}
