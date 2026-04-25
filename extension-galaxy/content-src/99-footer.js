// ============== SSE 原始数据拦截 (Galaxy AI 专用) ==============
  // 从 sse-hook.js (MAIN world) 接收 Galaxy SSE delta
  // Galaxy SSE format: {type:"text",content:"..."} / {type:"reasoning"} / {type:"tool_use"} / {type:"completion"}
  
  const sseState = {
    currentText: '',
    connected: false,
    processedCommands: new Set(),
    lastDeltaTime: 0,
    messageId: null,
    enabled: true,
    executedInCurrentMessage: false
  };

  // Expose for isAIGenerating() check in DOM layer
  window.__galaxySSEState = sseState;

  function initSSEListener() {
    // Galaxy: SSE events come from sse-hook.js via CustomEvent
    // No need to inject script — sse-hook.js runs in MAIN world via manifest

    // 监听 SSE 连接建立
    document.addEventListener('__galaxy_sse_connected__', (e) => {
      sseState.connected = true;
      sseState.currentText = '';
      sseState.processedCommands.clear();
      sseState.executedInCurrentMessage = false;
      window.__galaxySSEState.streaming = true;
      log('Galaxy SSE connected:', e.detail?.url);
    });

    // 监听文本 delta
    document.addEventListener('__galaxy_sse_delta__', (e) => {
      if (!sseState.enabled) return;
      const detail = e.detail;
      if (!detail) return;
      
      if (detail.type === 'text') {
        sseState.currentText += detail.content || '';
        sseState.lastDeltaTime = Date.now();
        
        // 实时检测完整的 ΩCODE 命令
        tryParseSSECommands();
      }
      // reasoning type: 不拼接到 currentText（只是思考过程）
    });

    // 监听工具调用（Galaxy 原生工具，非我们的 ΩCODE）
    document.addEventListener('__galaxy_sse_tool__', (e) => {
      const detail = e.detail;
      log('Galaxy tool event:', detail?.type, detail?.toolName);
    });

    // 监听完成
    document.addEventListener('__galaxy_sse_complete__', (e) => {
      sseState.connected = false;
      window.__galaxySSEState.streaming = false;
      if (sseState.currentText) {
        tryParseSSECommands();
      }
      log('Galaxy SSE complete, text length:', sseState.currentText.length);
    });

    // 监听关闭
    document.addEventListener('__galaxy_sse_closed__', (e) => {
      sseState.connected = false;
      window.__galaxySSEState.streaming = false;
      if (sseState.currentText) {
        tryParseSSECommands();
      }
      log('Galaxy SSE closed, text length:', sseState.currentText.length);
    });

    log('Galaxy SSE listener initialized');
  }

  // === SSE 参数完整性检查 ===
  function sseParamsLookCorrupted(call) {
    var p = call.params;
    var paramLen = JSON.stringify(p).length;
    var sseAllowLarge = (call.name === 'write_file' || call.name === 'edit_file' || call.name === 'vfs_write' || call.name === 'vfs_local_write' || call.name === 'vfs_save' || call.name === 'vfs_append' || call.name === 'run_process' || call.name === 'run_command');
    if (paramLen > 100 && !sseAllowLarge) {
      log("SSE pre-check: params > 100 chars (" + paramLen + "), defer to DOM for: " + call.name);
      return true;
    }
    if ((call.name === 'eval_js' || call.name === 'async_task') && p.code) {
      try { new Function(p.code); } catch (e) {
        if (e instanceof SyntaxError) return true;
      }
    }
    if (call.name === 'write_file' && !p.content && !p.contentFile) return true;
    if (call.name === 'edit_file' && (!p.edits || !Array.isArray(p.edits) || p.edits.length === 0)) return true;
    if (p.path && typeof p.path === 'string' && !p.path.startsWith('/')) return true;
    return false;
  }

  function tryParseSSECommands() {
    const text = sseState.currentText;
    if (!text) return;

    // Detect ΩCODE blocks
    var prefix = "\u03A9CODE";
    var endTag = "\u03A9CODEEND";
    
    var startIdx = text.indexOf(prefix);
    if (startIdx === -1) return;
    
    var endIdx = text.indexOf(endTag, startIdx);
    if (endIdx === -1) return; // still streaming
    
    var blockStart = text.indexOf('\n', startIdx);
    if (blockStart === -1 || blockStart >= endIdx) return;
    
    var content = text.substring(blockStart + 1, endIdx).trim();
    if (!content) return;
    
    // Dedup
    var sig = 'sse:omega:' + content.substring(0, 200);
    if (sseState.processedCommands.has(sig)) return;
    sseState.processedCommands.add(sig);
    
    log('SSE ΩCODE detected (' + content.length + ' chars)');
    
    try {
      var parsed = JSON.parse(content);
      
      if (parsed.tool && parsed.params) {
        // Single tool call
        var call = { name: parsed.tool, params: parsed.params };
        if (!sseParamsLookCorrupted(call)) {
          sseState.executedInCurrentMessage = true;
          var callSig = 'sse:single:' + JSON.stringify({tool: call.name, params: call.params}).substring(0, 100);
          sseState.processedCommands.add(callSig);
          addExecutedCall(callSig);
          executeToolCall(call.name, call.params);
        }
      } else if (parsed.steps && Array.isArray(parsed.steps)) {
        // Batch tool calls
        sseState.executedInCurrentMessage = true;
        var batchSig = 'sse:batch:' + JSON.stringify(parsed).substring(0, 100);
        sseState.processedCommands.add(batchSig);
        addExecutedCall(batchSig);
        executeBatchCalls(parsed.steps);
      }
    } catch (e) {
      log('SSE ΩCODE parse error:', e.message);
    }
  }

  function isSSEProcessed(toolName, params) {
    const sig1 = 'sse:single:' + JSON.stringify({tool: toolName, params}).substring(0, 100);
    const sig2 = 'sse:batch:' + JSON.stringify(params).substring(0, 100);
    return sseState.processedCommands.has(sig1) || sseState.processedCommands.has(sig2);
  }

  // Tab 保活心跳
  setInterval(function() {
    document.title = document.title;
  }, 30000);

  function init() {
    log('初始化 Galaxy Agent v1.0');

    initSSEListener();
    createPanel();
    loadPanelEnhancer();
    _restoreAsyncTasks();

    const loadTime = Date.now();
    const loadMessageCount = document.querySelectorAll('div.group\\/message').length;
    window.__agentLoadState = { loadTime, loadMessageCount };
    setInterval(scanForToolCalls, CONFIG.SCAN_INTERVAL);
    
    setTimeout(() => {
      chrome.runtime.sendMessage({ type: 'GET_WS_STATUS' }, resp => {
        if (chrome.runtime.lastError) {
          log('获取状态失败:', chrome.runtime.lastError);
          return;
        }
        if (resp) {
          state.wsConnected = resp.connected;
          if (resp.tools) {
            state.availableTools = resp.tools;
            updateToolsDisplay();
          }
          if (resp.skillsPrompt) { state.skillsPrompt = resp.skillsPrompt; }
          updateStatus();
        }
      });
    }, 500);

    addLog('🚀 Galaxy Agent v1.0 已启动', 'success');
    addLog('💡 点击「📋 提示词」复制给AI', 'info');
    
    startWakeupMonitor();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 100);
  }

})();
