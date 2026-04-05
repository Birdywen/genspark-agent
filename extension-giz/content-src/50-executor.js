  // ============== 工具执行 ==============

  function executeToolCall(tool, hash) {
    if (!tool || !tool.name) return;
    state.agentRunning = true;
    state.totalCalls++;
    updateStatus();
    showExecutingIndicator(tool.name);
    addLog('⚡ 执行: ' + tool.name, 'tool');
    log('executeToolCall:', tool.name, tool.params);

    chrome.runtime.sendMessage({
      type: 'SEND_TO_SERVER',
      payload: { type: 'tool_call', tool: tool.name, params: tool.params, callId: hash }
    }, resp => {
      if (chrome.runtime.lastError || !resp?.success) {
        const err = chrome.runtime.lastError?.message || resp?.error || 'unknown';
        addLog('❌ 发送失败: ' + err, 'error');
        hideExecutingIndicator();
        state.agentRunning = false;
        updateStatus();
        // 回退：把结果直接发回给 AI
        const errResult = JSON.stringify({ error: err, tool: tool.name });
        sendResultToAI(tool.name, errResult, hash);
      }
    });
  }

  function executeBatchCall(batchObj, hash) {
    state.agentRunning = true;
    state.totalCalls++;
    updateStatus();
    showExecutingIndicator('batch[' + batchObj.steps.length + ']');
    addLog('⚡ 批量执行: ' + batchObj.steps.length + ' 步', 'tool');

    chrome.runtime.sendMessage({
      type: 'SEND_TO_SERVER',
      payload: { type: 'batch_call', steps: batchObj.steps, callId: hash }
    }, resp => {
      if (chrome.runtime.lastError || !resp?.success) {
        const err = chrome.runtime.lastError?.message || resp?.error || 'unknown';
        addLog('❌ 批量发送失败: ' + err, 'error');
        hideExecutingIndicator();
        state.agentRunning = false;
        updateStatus();
      }
    });
  }

  function sendResultToAI(toolName, result, callId) {
    hideExecutingIndicator();
    state.agentRunning = false;
    state.pendingCalls.delete(callId);
    updateStatus();

    const truncated = truncateResult(result);
    state.roundCount++;
    localStorage.setItem('giz_agent_round_count', state.roundCount);
    updateStatus();

    // 重置 WS 状态，准备接收下一条消息
    state.wsState.executedInCurrentMessage = false;
    state.wsState.currentText = '';
    state.wsState.currentSubscribeId = null;

    const resultMsg = '[执行结果] ' + toolName + ':\n' + truncated;
    addLog('✅ 结果发送: ' + truncated.substring(0, 80) + (truncated.length > 80 ? '...' : ''), 'success');
    enqueueMessage(resultMsg);
  }

  function handleToolResult(data) {
    log('handleToolResult:', data);
    const callId = data.callId || data.call_id;
    const toolName = data.tool || data.name || 'unknown';
    const result = data.result !== undefined ? data.result : (data.output || data.error || JSON.stringify(data));

    addLog('📥 结果: ' + toolName + ' (' + String(result).substring(0, 60) + ')', 'success');
    sendResultToAI(toolName, result, callId);
  }
