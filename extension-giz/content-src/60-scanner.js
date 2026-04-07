  // ============== 扫描工具调用 ==============

  function scanForToolCalls() {
    if (localStorage.getItem('giz_agent_disabled_' + location.pathname) === 'true') return;
    if (state.agentRunning) return;
    // Skip if WS channel already handled this message
    if (state.wsState && state.wsState.executedInCurrentMessage) return;
    if (isAIGenerating()) { state.generatingFalseCount = 0; return; }

    state.generatingFalseCount++;
    if (state.generatingFalseCount < 3) return;

    const { text, index } = getLatestAIMessage();
    if (!text) return;

    // 刷新保护：页面加载 5 秒内跳过
    if (window.__gizAgentLoadState) {
      const elapsed = Date.now() - window.__gizAgentLoadState.loadTime;
      if (elapsed < 3000) return;
      if (elapsed < 5000 && !window.__gizAgentLoadState.marked) {
        window.__gizAgentLoadState.marked = true;
        const existingCalls = parseToolCalls(text);
        for (const tool of existingCalls) {
          addExecutedCall(index + ':' + tool.name + ':' + JSON.stringify(tool.params));
        }
        log('刷新保护：标记', existingCalls.length, '个已有工具调用');
        return;
      }
    }

    if (state.lastMessageText !== text) {
      state.lastMessageText = text;
      state.lastStableTime = Date.now();
      state.generatingFalseCount = 0;
      return;
    }

    // 文本稳定 1000ms
    if (Date.now() - state.lastStableTime < 1000) return;

    // 二次确认
    const { text: textNow } = getLatestAIMessage();
    if (textNow !== text) {
      state.lastMessageText = textNow;
      state.lastStableTime = Date.now();
      state.generatingFalseCount = 0;
      return;
    }

    const calls = parseToolCalls(text);
    if (calls.length === 0) return;

    for (const call of calls) {
      const hash = (index >= 0 ? index : 'ws') + ':' + call.name + ':' + JSON.stringify(call.params).substring(0, 100);
      if (state.executedCalls.has(hash)) { log('跳过已执行:', hash.substring(0, 60)); continue; }
      addExecutedCall(hash);
      addLog('🔍 发现工具调用: ' + call.name, 'tool');

      if (call.isBatch || call.name === '__BATCH__') {
        executeBatchCall(call.params, hash);
      } else {
        state.pendingCalls.set(hash, call);
        updateStatus();
        executeToolCall(call, hash);
      }
      break; // 每次只执行一个，等结果回来再继续
    }
  }

  setInterval(scanForToolCalls, CONFIG.SCAN_INTERVAL);
