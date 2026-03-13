  // ============== 执行指示器 ==============

  function showExecutingIndicator(toolName) {
    const el = document.getElementById("agent-executing");
    if (!el) return;
    state.execStartTime = Date.now();
    el.querySelector(".exec-tool").textContent = toolName;
    el.querySelector(".exec-time").textContent = "0.0s";
    el.classList.add("active");
    if (state.execTimer) clearInterval(state.execTimer);
    state.execTimer = setInterval(() => {
      const elapsed = ((Date.now() - state.execStartTime) / 1000).toFixed(1);
      const timeEl = document.querySelector("#agent-executing .exec-time");
      if (timeEl) timeEl.textContent = elapsed + "s";
    }, 100);
  }

  function hideExecutingIndicator() {
    const el = document.getElementById("agent-executing");
    if (el) el.classList.remove("active");
    if (state.execTimer) { clearInterval(state.execTimer); state.execTimer = null; }
  
  }

  // ============== 工具调用检测 ==============
  let expectingToolCall = false;
  let toolCallWarningTimer = null;

  function startToolCallDetection() {
    // SSE 已执行当前消息的工具调用，跳过 DOM 检测避免重复
    if (sseState.executedInCurrentMessage && (Date.now() - sseState.lastDeltaTime < 30000)) {
      log('跳过 DOM 检测（SSE 已执行）');
      return;
    }
    if (toolCallWarningTimer) clearTimeout(toolCallWarningTimer);
    expectingToolCall = true;
    toolCallWarningTimer = setTimeout(() => {
      if (expectingToolCall) {
        // 静默失败，不显示任何提示
        expectingToolCall = false;
      }
    }, 2000);
  }

  function clearToolCallDetection() {
    if (toolCallWarningTimer) {
      clearTimeout(toolCallWarningTimer);
      toolCallWarningTimer = null;
    }
    expectingToolCall = false;
  }

  // ============== 工具执行 ==============

  function executeRetry(historyId) {
    clearToolCallDetection();
    const callId = `retry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    
    state.agentRunning = true;
    showExecutingIndicator(`retry #${historyId}`);
    updateStatus();
    
    chrome.runtime.sendMessage({
      type: 'SEND_TO_SERVER',
      payload: { 
        type: 'retry', 
        historyId: historyId,
        id: callId 
      }
    });
    
    addLog(`🔄 重试 #${historyId}...`, 'tool');
    
    // 超时处理
    setTimeout(() => {
      if (state.agentRunning) {
        state.agentRunning = false;
        hideExecutingIndicator();
        updateStatus();
        addLog(`⏱️ 重试 #${historyId} 超时`, 'error');
        
        const timeoutResult = `**[重试结果]** \`#${historyId}\` ✗ 超时\n\n请稍后再试，或检查服务器状态。`;
        sendMessageSafe(timeoutResult);
      }
    }, CONFIG.TIMEOUT_MS);
  }

  // 执行批量工具调用
  function executeBatchCall(batch, callHash) {
    clearToolCallDetection();

    // === 内容级去重: 防止 SSE + DOM 双通道重复执行 ===
    const contentKey = `exec:__BATCH__:${JSON.stringify(batch).substring(0, 200)}`;
    if (hasDedupKey(contentKey)) {
      log('跳过重复 BATCH 执行（内容级去重）');
      addExecutedCall(callHash);
      return;
    }
    addDedupKey(contentKey, 30000);
    const batchId = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    
    state.agentRunning = true;
    addExecutedCall(callHash);
    
    if (!batch || !batch.steps || !Array.isArray(batch.steps)) {
      addLog('\u274c \u6279\u91cf\u4efb\u52a1\u53c2\u6570\u65e0\u6548: steps \u4e0d\u5b58\u5728', 'error');
      hideExecutingIndicator();
      return;
    }
    state.batchResults = [];  // 重置批量结果
    state.currentBatchId = batchId;
    state.currentBatchTotal = batch.steps.length;
    showExecutingIndicator(`批量 (${batch.steps.length} 步)`);
    updateStatus();
    
    // 显示进度条
    if (window.PanelEnhancer) {
      window.PanelEnhancer.showBatchProgress(batchId, batch.steps.length);
    }
    
    addLog(`📦 开始批量执行: ${batch.steps.length} 个步骤`, 'tool');
    
    chrome.runtime.sendMessage({
      type: 'SEND_TO_SERVER',
      payload: {
        type: 'tool_batch',
        id: batchId,
        steps: batch.steps,
        options: batch.options || { stopOnError: true }
      }
    }, (response) => {
      if (chrome.runtime.lastError) {
        addLog(`❌ 批量发送失败: ${chrome.runtime.lastError.message}`, 'error');
        state.agentRunning = false;
        hideExecutingIndicator();
        updateStatus();
        if (window.PanelEnhancer) window.PanelEnhancer.hideProgress();
      } else if (response?.success) {
        addLog(`📤 批量任务已提交: ${batchId}`, 'info');
      } else {
        addLog('❌ 批量任务提交失败', 'error');
        state.agentRunning = false;
        hideExecutingIndicator();
        updateStatus();
        if (window.PanelEnhancer) window.PanelEnhancer.hideProgress();
      }
    });
  }


  // === async_task 持久化与执行引擎 ===
    // CSP 安全的条件评估器（不使用 eval / new Function）
    // 支持: "result.key === value", "result.a.b == value", "result.key", "!result.key"
    // 多条件: "result.a === true && result.b", "result.a || result.b"
    function _evalConditionSafe(result, condStr) {
      // 解析单个比较表达式
      function evalSingle(expr) {
        expr = expr.trim();
        // 否定: !result.key
        if (expr.startsWith('!')) {
          return !evalSingle(expr.slice(1));
        }
        // 比较: left === right 或 left == right 或 left !== right 或 left != right
        const cmpMatch = expr.match(/^(.+?)\s*(===|!==|==|!=|>=|<=|>|<)\s*(.+)$/);
        if (cmpMatch) {
          const left = resolveValue(cmpMatch[1].trim(), result);
          const op = cmpMatch[2];
          const right = resolveValue(cmpMatch[3].trim(), result);
          switch(op) {
            case '===': return left === right;
            case '!==': return left !== right;
            case '==': return left == right;
            case '!=': return left != right;
            case '>': return left > right;
            case '<': return left < right;
            case '>=': return left >= right;
            case '<=': return left <= right;
          }
        }
        // 真值检查: result.key
        return !!resolveValue(expr, result);
      }

      // 解析值：支持 result.a.b.c 路径、字面量 true/false/null/数字/字符串
      function resolveValue(token, ctx) {
        token = token.trim();
        if (token === 'true') return true;
        if (token === 'false') return false;
        if (token === 'null') return null;
        if (token === 'undefined') return undefined;
        if (/^-?\d+(\.\d+)?$/.test(token)) return Number(token);
        if ((token.startsWith("'") && token.endsWith("'")) || (token.startsWith('"') && token.endsWith('"'))) return token.slice(1, -1);
        // result.a.b.c 路径
        const path = token.replace(/^result\.?/, '').split('.');
        let val = ctx;
        for (const p of path) {
          if (p === '' || val == null) break;
          val = val[p];
        }
        return val;
      }

      // 处理 && 和 || 组合（简单左到右，&& 优先于 ||）
      // 先按 || 拆，再按 && 拆
      const orParts = condStr.split('||').map(s => s.trim());
      for (const orPart of orParts) {
        const andParts = orPart.split('&&').map(s => s.trim());
        const allTrue = andParts.every(p => evalSingle(p));
        if (allTrue) return true;
      }
      return false;
    }

    function _saveAsyncTask(taskDef) {
      try {
        const tasks = JSON.parse(localStorage.getItem('__async_tasks') || '[]');
        tasks.push(taskDef);
        localStorage.setItem('__async_tasks', JSON.stringify(tasks));
      } catch(e) { addLog('⚠️ async_task 保存失败: ' + e.message, 'error'); }
    }

    function _removeAsyncTask(taskId) {
      try {
        let tasks = JSON.parse(localStorage.getItem('__async_tasks') || '[]');
        tasks = tasks.filter(t => t.id !== taskId);
        localStorage.setItem('__async_tasks', JSON.stringify(tasks));
      } catch(e) {}
    }

    function _runAsyncTask(task) {
      const { id, code, condition, interval, timeout, tabId, label, startTime } = task;
      let pollCount = 0;
      addLog(`🔄 async_task 运行中 [${label}] (ID: ${id})`, 'info');

      const doPoll = () => {
        if (Date.now() - startTime > timeout) {
          addLog(`⏰ async_task [${label}] 超时`, 'error');
          _removeAsyncTask(id);
          sendMessageSafe(`**[async_task]** ⏰ 任务超时: ${label} (已轮询 ${pollCount} 次, ${Math.round((Date.now()-startTime)/1000)}s)`);
          return;
        }

        pollCount++;
        const callId = 'at_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

        const resultHandler = (msg) => {
          if (msg.type === 'EVAL_JS_RESULT' && msg.callId === callId) {
            chrome.runtime.onMessage.removeListener(resultHandler);
            clearTimeout(evalTO);

            if (!msg.success) {
              addLog(`⚠️ async_task [${label}] 执行错误: ${msg.error}`, 'error');
              setTimeout(doPoll, interval);
              return;
            }

            let result = msg.result;
            addLog(`🔍 async_task [${label}] raw type=${typeof msg.result}, val=${String(msg.result).substring(0,120)}`, 'info');
            try { result = JSON.parse(result); } catch(e) {}
            addLog(`🔍 async_task [${label}] parsed type=${typeof result}, keys=${typeof result === 'object' && result ? Object.keys(result).join(',') : 'N/A'}`, 'info');

            let conditionMet = false;
            try {
              // CSP 禁止 new Function，改用安全的条件解析器
              // 支持格式: "key === value", "key == value", "key", "!key"
              // 嵌套: "a.b.c === value"
              conditionMet = _evalConditionSafe(result, condition);
            } catch(e) {
              addLog(`⚠️ async_task 条件检查错误: ${e.message}`, 'error');
            }

            if (conditionMet) {
              addLog(`✅ async_task [${label}] 完成! (${pollCount} 次, ${Math.round((Date.now()-startTime)/1000)}s)`, 'success');
              _removeAsyncTask(id);
              const resultStr = typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result);
              sendMessageSafe(`**[async_task]** ✅ 任务完成: ${label}\n轮询次数: ${pollCount} | 耗时: ${Math.round((Date.now()-startTime)/1000)}s\n\n**结果:**\n\`\`\`\n${resultStr.substring(0, 3000)}\n\`\`\``);
            } else {
              const preview = typeof result === 'object' ? JSON.stringify(result) : String(result);
              addLog(`🔄 async_task [${label}] #${pollCount}: ${preview.substring(0, 80)}`, 'info');
              setTimeout(doPoll, interval);
            }
          }
        };
        chrome.runtime.onMessage.addListener(resultHandler);

        const evalTO = setTimeout(() => {
          chrome.runtime.onMessage.removeListener(resultHandler);
          addLog(`⚠️ async_task [${label}] eval 超时，重试`, 'error');
          setTimeout(doPoll, interval);
        }, 15000);

        chrome.runtime.sendMessage({ type: 'EVAL_JS', code: code, callId: callId, targetTabId: tabId });
      };

      setTimeout(doPoll, 3000); // 首次 3 秒后开始
    }

    function _restoreAsyncTasks() {
      try {
        const tasks = JSON.parse(localStorage.getItem('__async_tasks') || '[]');
        if (tasks.length === 0) return;
        addLog(`🔄 恢复 ${tasks.length} 个异步任务`, 'info');
        tasks.forEach(task => {
          if (Date.now() - task.startTime > task.timeout) {
            addLog(`⏰ 任务已过期，跳过: ${task.label}`, 'info');
            _removeAsyncTask(task.id);
          } else {
            addLog(`🔄 恢复任务: ${task.label} (剩余 ${Math.round((task.timeout - (Date.now() - task.startTime))/1000)}s)`, 'info');
            _runAsyncTask(task);
          }
        });
      } catch(e) { addLog('⚠️ 异步任务恢复失败: ' + e.message, 'error'); }
    }
  // === END async_task 引擎 ===

  function executeToolCall(tool, callHash) {
    clearToolCallDetection();
    
    // === 内容级去重: 防止 SSE + DOM 双通道重复执行 ===
    const contentKey = `exec:${tool.name}:${JSON.stringify(tool.params).substring(0, 200)}`;
    if (hasDedupKey(contentKey)) {
      log('跳过重复执行（内容级去重）:', tool.name);
      addExecutedCall(callHash);
      return;
    }
    addDedupKey(contentKey, 10000);
    
    // === 本地拦截: list_tabs 查询所有标签页 ===
    if (tool.name === 'list_tabs') {
      addExecutedCall(callHash);
      showExecutingIndicator('list_tabs');
      state.agentRunning = true;
      updateStatus();
      addLog('🔧 list_tabs: 查询所有标签页', 'tool');
      
      const callId = 'list_tabs_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      
      const resultHandler = (msg) => {
        if (msg.type === 'LIST_TABS_RESULT' && msg.callId === callId) {
          chrome.runtime.onMessage.removeListener(resultHandler);
          clearTimeout(listTimeout);
          state.agentRunning = false;
          hideExecutingIndicator();
          updateStatus();
          const resultText = formatToolResult({ tool: 'list_tabs', success: msg.success, result: msg.result, error: msg.error });
          sendMessageSafe(resultText);
          addLog('✅ list_tabs 完成', 'success');
        }
      };
      chrome.runtime.onMessage.addListener(resultHandler);
      
      const listTimeout = setTimeout(() => {
        chrome.runtime.onMessage.removeListener(resultHandler);
        state.agentRunning = false;
        hideExecutingIndicator();
        updateStatus();
        const resultText = formatToolResult({ tool: 'list_tabs', success: false, error: '查询超时' });
        sendMessageSafe(resultText);
      }, 5000);
      
      chrome.runtime.sendMessage({ type: 'LIST_TABS', callId: callId });
      return;
    }
    
    // === 本地拦截: eval_js 直接在页面执行 ===
    if (tool.name === 'eval_js') {
      addExecutedCall(callHash);
      showExecutingIndicator('eval_js');
      state.agentRunning = true;
      updateStatus();
      
      const code = tool.params.code || '';
      const useMainWorld = tool.params.mainWorld === true;
      addLog(`🔧 eval_js: ${code.substring(0, 80)}${code.length > 80 ? '...' : ''}`, 'tool');
      
      try {
        // 通过 background script 的 chrome.scripting.executeScript 执行（绕过 CSP）
        const callId = 'eval_js_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        
        // 监听 background 返回的结果
        const resultHandler = (msg) => {
          if (msg.type === 'EVAL_JS_RESULT' && msg.callId === callId) {
            chrome.runtime.onMessage.removeListener(resultHandler);
            clearTimeout(evalTimeout);
            
            state.agentRunning = false;
            hideExecutingIndicator();
            updateStatus();
            const resultText = formatToolResult({
              tool: 'eval_js',
              success: msg.success,
              result: msg.success ? msg.result : undefined,
              error: msg.success ? undefined : msg.error
            });
            sendMessageSafe(resultText);
            addLog(msg.success ? '✅ eval_js 完成' : '❌ eval_js 失败: ' + msg.error, msg.success ? 'success' : 'error');
          }
        };
        chrome.runtime.onMessage.addListener(resultHandler);
        
        // 超时处理
        const evalTimeout = setTimeout(() => {
          chrome.runtime.onMessage.removeListener(resultHandler);
          state.agentRunning = false;
          hideExecutingIndicator();
          updateStatus();
          const resultText = formatToolResult({ tool: 'eval_js', success: false, error: '执行超时 (60秒)' });
          sendMessageSafe(resultText);
          addLog('❌ eval_js 超时', 'error');
        }, 60000);
        
        // 发送给 background 执行（支持跨 tab）
        const targetTabId = tool.params.tabId || null;
        chrome.runtime.sendMessage({ type: 'EVAL_JS', code: code, callId: callId, targetTabId: targetTabId }, (resp) => {
          if (chrome.runtime.lastError) {
            chrome.runtime.onMessage.removeListener(resultHandler);
            clearTimeout(evalTimeout);
            state.agentRunning = false;
            hideExecutingIndicator();
            updateStatus();
            const resultText = formatToolResult({ tool: 'eval_js', success: false, error: chrome.runtime.lastError.message });
            sendMessageSafe(resultText);
            addLog('❌ eval_js 发送失败: ' + chrome.runtime.lastError.message, 'error');
          }
        });
      } catch (e) {
        state.agentRunning = false;
        hideExecutingIndicator();
        updateStatus();
        const resultText = formatToolResult({ tool: 'eval_js', success: false, error: e.message });
        sendMessageSafe(resultText);
        addLog(`❌ eval_js 异常: ${e.message}`, 'error');
      }
      return;
    }
    // === END eval_js 拦截 ===

    // === 本地拦截: async_task 异步任务监控器（支持持久化恢复） ===
    if (tool.name === 'async_task') {
      addExecutedCall(callHash);
      const taskDef = {
        id: 'async_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        code: tool.params.code || '',
        condition: tool.params.condition || 'true',
        interval: tool.params.interval || 15000,
        timeout: tool.params.timeout || 600000,
        tabId: tool.params.tabId || null,
        label: tool.params.label || 'async_task',
        startTime: Date.now()
      };
      
      addLog(`🔄 async_task [${taskDef.label}]: interval=${taskDef.interval/1000}s, timeout=${taskDef.timeout/1000}s, tab=${taskDef.tabId || 'current'}`, 'tool');
      
      // 不阻塞 AI — 立即返回确认
      state.agentRunning = false;
      updateStatus();
      sendMessageSafe(`**[async_task]** ✅ 任务已启动: ${taskDef.label} (ID: ${taskDef.id})\n轮询间隔: ${taskDef.interval/1000}s | 超时: ${taskDef.timeout/1000}s\n后台监控中，完成后自动通知...`);
      
      // 持久化存储，扩展刷新后可恢复
      _saveAsyncTask(taskDef);
      _runAsyncTask(taskDef);
      return;
    }
    // === END async_task 拦截 ===

    // === 本地拦截: js_flow 浏览器 JS 微型工作流 ===
    if (tool.name === 'js_flow') {
      addExecutedCall(callHash);
      showExecutingIndicator('js_flow');
      state.agentRunning = true;
      updateStatus();

      const steps = tool.params.steps || [];
      const targetTabId = tool.params.tabId ? Number(tool.params.tabId) : undefined;
      const totalTimeout = tool.params.timeout || 60000;
      const flowId = 'js_flow_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

      addLog(`🔄 js_flow: ${steps.length} 步骤, tab=${targetTabId || 'current'}, timeout=${totalTimeout}ms`, 'tool');

      const flowStartTime = Date.now();
      const results = [];
      let aborted = false;

      const runStep = (stepIndex) => {
        if (aborted) return;
        if (stepIndex >= steps.length) {
          // 全部完成
          state.agentRunning = false;
          hideExecutingIndicator();
          updateStatus();
          const resultText = formatToolResult({ tool: 'js_flow', success: true, result: JSON.stringify(results, null, 2) });
          sendMessageSafe(resultText);
          addLog(`✅ js_flow 完成: ${results.length} 步`, 'success');
          return;
        }

        if (Date.now() - flowStartTime > totalTimeout) {
          aborted = true;
          state.agentRunning = false;
          hideExecutingIndicator();
          updateStatus();
          const resultText = formatToolResult({ tool: 'js_flow', success: false, error: `总超时 ${totalTimeout}ms, 完成 ${stepIndex}/${steps.length} 步`, result: JSON.stringify(results, null, 2) });
          sendMessageSafe(resultText);
          addLog(`❌ js_flow 总超时`, 'error');
          return;
        }

        const step = steps[stepIndex];
        const stepDelay = step.delay || 0;
        const stepLabel = step.label || `step${stepIndex}`;

        const stepTargetTab = step.tabId ? `tab=${step.tabId}` : '';
        addLog(`▶ js_flow [${stepIndex + 1}/${steps.length}] ${stepLabel}${stepTargetTab ? ' (' + stepTargetTab + ')' : ''}${stepDelay ? ' (delay ' + stepDelay + 'ms)' : ''}`, 'info');

        const executeCode = () => {
          // waitFor: 等待选择器出现或 JS 条件为真
          if (step.waitFor) {
            const waitTimeout = step.waitTimeout || 15000;
            const waitCode = step.waitFor.startsWith('!')
              || step.waitFor.includes('(') || step.waitFor.includes('.')
              || step.waitFor.includes('=') || step.waitFor.includes('>')
              ? step.waitFor  // JS 表达式
              : `!!document.querySelector('${step.waitFor.replace(/'/g, "\\'")}')`; // CSS 选择器

            const waitCallId = flowId + '_wait_' + stepIndex;
            const waitStart = Date.now();

            const pollWait = () => {
              if (aborted) return;
              if (Date.now() - waitStart > waitTimeout) {
                results.push({ step: stepLabel, success: false, error: `waitFor 超时: ${step.waitFor}` });
                if (step.optional) { runStep(stepIndex + 1); }
                else {
                  aborted = true;
                  state.agentRunning = false;
                  hideExecutingIndicator();
                  updateStatus();
                  const resultText = formatToolResult({ tool: 'js_flow', success: false, error: `步骤 ${stepLabel} waitFor 超时`, result: JSON.stringify(results, null, 2) });
                  sendMessageSafe(resultText);
                  addLog(`❌ js_flow waitFor 超时: ${step.waitFor}`, 'error');
                }
                return;
              }

              const stepTabId = step.tabId ? Number(step.tabId) : targetTabId;
              chrome.runtime.sendMessage({ type: 'EVAL_JS', code: `return (function(){ try { return !!(${waitCode}); } catch(e) { return false; } })()`, callId: waitCallId + '_' + Date.now(), targetTabId: stepTabId });

              // 简化: 用 onMessage 监听结果
              const onWaitResult = (msg) => {
                if (msg.type !== 'EVAL_JS_RESULT') return;
                chrome.runtime.onMessage.removeListener(onWaitResult);
                if (msg.result === 'true' || msg.result === true) {
                  doExec();
                } else {
                  setTimeout(pollWait, 500);
                }
              };
              chrome.runtime.onMessage.addListener(onWaitResult);
            };
            pollWait();
          } else {
            doExec();
          }
        };

        const doExec = () => {
          if (!step.code) {
            // 纯延迟/等待步骤，没有代码
            results.push({ step: stepLabel, success: true, result: '(no code)' });
            runStep(stepIndex + 1);
            return;
          }

          // 注入 ctx (前几步的结果)
          const ctxJson = JSON.stringify(results).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
          const wrappedCode = `return (async function(){ const ctx = JSON.parse('${ctxJson}'); ${step.code} })()`;

          const execCallId = flowId + '_exec_' + stepIndex;
          const onExecResult = (msg) => {
            if (msg.type !== 'EVAL_JS_RESULT' || !msg.callId || !msg.callId.startsWith(flowId + '_exec_' + stepIndex)) return;
            chrome.runtime.onMessage.removeListener(onExecResult);
            clearTimeout(execTimeout);
            results.push({ step: stepLabel, success: msg.success, result: msg.result || msg.error });
            addLog(`${msg.success ? '✓' : '✗'} ${stepLabel}: ${(msg.result || msg.error || '').substring(0, 100)}`, msg.success ? 'info' : 'error');
            if (!msg.success && !step.optional) {
              if (step.continueOnError) {
                runStep(stepIndex + 1);
              } else {
                aborted = true;
                state.agentRunning = false;
                hideExecutingIndicator();
                updateStatus();
                const resultText = formatToolResult({ tool: 'js_flow', success: false, error: `步骤 ${stepLabel} 失败: ${msg.error}`, result: JSON.stringify(results, null, 2) });
                sendMessageSafe(resultText);
                addLog(`❌ js_flow 在 ${stepLabel} 失败`, 'error');
              }
            } else {
              runStep(stepIndex + 1);
            }
          };

          chrome.runtime.onMessage.addListener(onExecResult);
          const execTimeout = setTimeout(() => {
            chrome.runtime.onMessage.removeListener(onExecResult);
            results.push({ step: stepLabel, success: false, error: '执行超时 (15s)' });
            if (step.optional || step.continueOnError) { runStep(stepIndex + 1); }
            else {
              aborted = true;
              state.agentRunning = false;
              hideExecutingIndicator();
              updateStatus();
              const resultText = formatToolResult({ tool: 'js_flow', success: false, error: `步骤 ${stepLabel} 执行超时`, result: JSON.stringify(results, null, 2) });
              sendMessageSafe(resultText);
            }
          }, 15000);

          const actualCallId = execCallId + '_' + Date.now();
          const stepTabId = step.tabId ? Number(step.tabId) : targetTabId;
          chrome.runtime.sendMessage({ type: 'EVAL_JS', code: wrappedCode, callId: actualCallId, targetTabId: stepTabId }, (resp) => {
            if (chrome.runtime.lastError) {
              chrome.runtime.onMessage.removeListener(onExecResult);
              clearTimeout(execTimeout);
              results.push({ step: stepLabel, success: false, error: chrome.runtime.lastError.message });
              if (step.optional || step.continueOnError) { runStep(stepIndex + 1); }
              else {
                aborted = true;
                state.agentRunning = false;
                hideExecutingIndicator();
                updateStatus();
                const resultText = formatToolResult({ tool: 'js_flow', success: false, error: chrome.runtime.lastError.message, result: JSON.stringify(results, null, 2) });
                sendMessageSafe(resultText);
              }
            }
          });
        };

        if (stepDelay > 0) {
          setTimeout(executeCode, stepDelay);
        } else {
          executeCode();
        }
      };

      try {
        runStep(0);
      } catch (e) {
        state.agentRunning = false;
        hideExecutingIndicator();
        updateStatus();
        const resultText = formatToolResult({ tool: 'js_flow', success: false, error: e.message });
        sendMessageSafe(resultText);
        addLog(`❌ js_flow 异常: ${e.message}`, 'error');
      }
      return;
    }
    // === END js_flow 拦截 ===

    // === 本地拦截: tutorial_record 教程录制引擎 ===
    if (tool.name === 'tutorial_record') {
      addExecutedCall(callHash);
      showExecutingIndicator('tutorial_record');
      state.agentRunning = true;
      updateStatus();

      const steps = tool.params.steps || [];
      const targetTabId = tool.params.tabId || null;
      const projectDir = tool.params.outputDir || '/private/tmp/tutorial_' + Date.now();

      addLog(`🎬 tutorial_record: ${steps.length} 步, tab=${targetTabId || 'auto'}`, 'tool');

      const callId = 'tutorial_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

      // 监听结果
      const handler = (msg) => {
        if (msg.type === 'TUTORIAL_RECORD_RESULT' && msg.callId === callId) {
          chrome.runtime.onMessage.removeListener(handler);
          clearTimeout(timeoutTimer);

          if (msg.success && msg.screenshots && msg.screenshots.length > 0) {
            // 把截图通过 server 保存到本地
            const savePromises = msg.screenshots.map((s, idx) => {
              return new Promise((resolve) => {
                // 发给 server 保存 base64 图片
                const savePath = projectDir + '/step_' + s.step + '.png';
                // 通过 WebSocket 发送保存请求
                chrome.runtime.sendMessage({
                  type: 'SEND_TO_SERVER',
                  data: {
                    type: 'save_base64_file',
                    path: savePath,
                    data: s.dataUrl.replace(/^data:image\/png;base64,/, ''),
                    encoding: 'base64'
                  }
                }, () => resolve(savePath));
              });
            });

            Promise.all(savePromises).then((paths) => {
              const summary = {
                tool: 'tutorial_record',
                success: true,
                result: JSON.stringify({
                  totalSteps: steps.length,
                  screenshotCount: msg.screenshotCount,
                  savedPaths: paths,
                  results: msg.results
                }, null, 2)
              };
              const resultText = formatToolResult(summary);
              sendResultToAI(resultText);
              addLog(`✅ tutorial_record 完成: ${msg.screenshotCount} 截图已保存`, 'success');
              state.agentRunning = false;
              updateStatus();
            });
          } else {
            // 没有截图但可能有结果
            const summary = {
              tool: 'tutorial_record',
              success: msg.success,
              result: JSON.stringify(msg.results || [], null, 2),
              error: msg.error
            };
            const resultText = formatToolResult(summary);
            sendResultToAI(resultText);
            addLog(msg.success ? '✅ tutorial_record 完成' : '❌ tutorial_record 失败', msg.success ? 'success' : 'error');
            state.agentRunning = false;
            updateStatus();
          }
        }
      };
      chrome.runtime.onMessage.addListener(handler);

      // 超时保护 (每步最多15秒，加30秒缓冲)
      const totalTimeout = steps.length * 15000 + 30000;
      const timeoutTimer = setTimeout(() => {
        chrome.runtime.onMessage.removeListener(handler);
        const resultText = formatToolResult({ tool: 'tutorial_record', success: false, error: `超时 (${Math.round(totalTimeout/1000)}秒)` });
        sendResultToAI(resultText);
        addLog('❌ tutorial_record 超时', 'error');
        state.agentRunning = false;
        updateStatus();
      }, totalTimeout);

      // 发送到 background.js 执行
      try {
        chrome.runtime.sendMessage({
          type: 'TUTORIAL_RECORD',
          callId,
          steps,
          tabId: targetTabId,
          outputDir: projectDir
        }, (response) => {
          if (chrome.runtime.lastError) {
            chrome.runtime.onMessage.removeListener(handler);
            clearTimeout(timeoutTimer);
            const resultText = formatToolResult({ tool: 'tutorial_record', success: false, error: chrome.runtime.lastError.message });
            sendResultToAI(resultText);
            state.agentRunning = false;
            updateStatus();
          }
        });
      } catch(e) {
        chrome.runtime.onMessage.removeListener(handler);
        clearTimeout(timeoutTimer);
        const resultText = formatToolResult({ tool: 'tutorial_record', success: false, error: e.message });
        sendResultToAI(resultText);
        state.agentRunning = false;
        updateStatus();
      }
      return;
    }
    // === END tutorial_record 拦截 ===

    const callId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    
    state.pendingCalls.set(callId, {
      tool: tool.name,
      params: tool.params,
      timestamp: Date.now(),
      hash: callHash
    });
    
    state.agentRunning = true;
    addExecutedCall(callHash);
    showExecutingIndicator(tool.name);
    updateStatus();
    
    // 保存到本地缓存（发送失败时可用 retryLast 重试）
    state.lastToolCall = { tool: tool.name, params: tool.params, timestamp: Date.now() };
    
    // 检测消息大小（超过 500KB 可能有问题）
    const payloadSize = JSON.stringify(tool.params).length;
    if (payloadSize > 500000) {
      addLog(`⚠️ 内容过大 (${Math.round(payloadSize/1024)}KB)，可能发送失败`, 'error');
      addLog('💡 建议: 用 run_command + echo/cat 写入，或拆分内容', 'info');
    }
    
    // ── Payload Upload:段内容通过 HTTP 上传避免 WebSocket 损坏 ──
    const PAYLOAD_UPLOAD_URL = 'http://localhost:8766/upload-payload';
    const PAYLOAD_THRESHOLD = 50; // 超过 50 字符的内容走 HTTP 上传（降低阈值，防止 SSE 损坏短内容）
    const PAYLOAD_FIELDS = ['content', 'stdin', 'code'];
    const FILE_FIELD_MAP = { content: 'contentFile', stdin: 'stdinFile', code: 'codeFile' };

    async function uploadPayloads(params) {
      const uploaded = {};
      for (const field of PAYLOAD_FIELDS) {
        if (params[field] && typeof params[field] === 'string' && params[field].length > PAYLOAD_THRESHOLD) {
          try {
            const result = await new Promise((resolve, reject) => {
              chrome.runtime.sendMessage(
                { type: 'UPLOAD_PAYLOAD', body: params[field] },
                (resp) => {
                  if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                  } else {
                    resolve(resp);
                  }
                }
              );
            });
            if (result && result.success && result.path) {
              uploaded[field] = result.path;
              log('[PayloadUpload] ' + field + ' -> ' + result.path + ' (' + result.size + ' bytes)');
            }
          } catch(e) {
            log('[PayloadUpload] failed ' + field + ': ' + e.message + ', fallback to WS');
          }
        }
      }
      return uploaded;
    }

    // 异步上传大内容，然后发送 tool_call
    (async () => {
      try {
        const uploadedFields = await uploadPayloads(tool.params);
        const finalParams = Object.assign({}, tool.params);
        for (const [field, filePath] of Object.entries(uploadedFields)) {
          delete finalParams[field];
          finalParams[FILE_FIELD_MAP[field]] = filePath;
        }
        if (Object.keys(uploadedFields).length > 0) {
          addLog('📦 大内容已通过 HTTP 安全上传 (' + Object.keys(uploadedFields).join(', ') + ')', 'info');
        }

        chrome.runtime.sendMessage({
          type: 'SEND_TO_SERVER',
          payload: { 
            type: 'tool_call', 
            tool: tool.name, 
            params: finalParams, 
            id: callId 
          }
        }, (response) => {
        if (chrome.runtime.lastError) {
          addLog(`❌ 发送失败: ${chrome.runtime.lastError.message}`, 'error');
          state.pendingCalls.delete(callId);
          state.agentRunning = false;
          hideExecutingIndicator();
          updateStatus();
        } else if (!response?.success) {
          addLog('❌ 服务器未连接', 'error');
        }
      });
    } catch (e) {
      addLog('\u274c 消息发送异常: ' + e.message, 'error');
      state.agentRunning = false;
      hideExecutingIndicator();
      updateStatus();
    }
    })();
    
    addLog(`🔧 ${tool.name}(${Object.keys(tool.params).join(',')})`, 'tool');
    
    setTimeout(() => {
      if (state.pendingCalls.has(callId)) {
        state.pendingCalls.delete(callId);
        state.agentRunning = false;
        hideExecutingIndicator();
        updateStatus();
        hideExecutingIndicator();
        addLog(`⏱️ ${tool.name} 超时`, "error");
        
        const timeoutResult = formatToolResult({
          tool: tool.name,
          success: false,
          error: `执行超时 (${CONFIG.TIMEOUT_MS / 1000}秒)`
        });
        sendMessageSafe(timeoutResult);
      }
    }, CONFIG.TIMEOUT_MS);
  }

