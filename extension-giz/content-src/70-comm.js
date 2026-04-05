  // ============== 通信：WS Hook 事件 + Background 消息 ==============

  // 监听 ws-hook.js 发来的 WS 流事件
  document.addEventListener('__giz_ws_connected__', () => {
    state.wsHookActive = true;
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

    if (output) ws.currentText += output; // Giz sends delta chunks, accumulate

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
