  // ============== 消息监听 ==============

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    log('收到消息:', msg.type, msg);

    switch (msg.type) {
      case 'WS_STATUS':
        const wasConnected = state.wsConnected;
        state.wsConnected = msg.connected;
        updateStatus();
        addLog(msg.connected ? '✓ 服务器已连接' : '✗ 服务器断开', msg.connected ? 'success' : 'error');
        // 静默处理重连（合盖/开盖导致的断开不通知 AI，避免干扰对话）
        if (!msg.connected && wasConnected) {
          addLog('⚠️ 服务器断开（可能是合盖休眠），等待自动重连...', 'warning');
        } else if (msg.connected && !wasConnected) {
          // 重连成功：重置所有执行状态，防止卡在"执行中"
          if (state.agentRunning) {
            addLog('🔄 重连后重置执行状态', 'info');
          }
          state.agentRunning = false;
          state.pendingCalls.clear();
          hideExecutingIndicator();
          addLog('✅ 服务器已静默重连', 'success');
        }
        break;

      case 'connected':
        state.wsConnected = true;
        if (msg.tools) {
          state.availableTools = msg.tools;
          updateToolsDisplay();
        }
        updateStatus();
        addLog('✓ 连接成功', 'success');
        if (msg.skills) { state.availableSkills = msg.skills; }
        if (msg.skillsPrompt) { state.skillsPrompt = msg.skillsPrompt; } try { document.dispatchEvent(new CustomEvent('__agent_skills_update__', { detail: { skillsPrompt: state.skillsPrompt } })); } catch(e) {}
        break;

      case 'update_tools':
        if (msg.tools && msg.tools.length > 0) {
          state.availableTools = msg.tools;
          updateToolsDisplay();
          addLog(`📦 加载了 ${msg.tools.length} 个工具`, 'info');
        }
        if (msg.skills) { state.availableSkills = msg.skills; }
        if (msg.skillsPrompt) { state.skillsPrompt = msg.skillsPrompt; } try { document.dispatchEvent(new CustomEvent('__agent_skills_update__', { detail: { skillsPrompt: state.skillsPrompt } })); } catch(e) {}
        break;

      case 'tools_updated':
        // 服务端热刷新后推送的工具更新
        if (msg.tools && msg.tools.length > 0) {
          const oldCount = state.availableTools.length;
          state.availableTools = msg.tools;
          updateToolsDisplay();
          addLog(`🔄 工具已刷新: ${oldCount} → ${msg.tools.length}`, 'success');
        }
        break;

      case 'reload_tools_result':
        // reload_tools 请求的结果
        if (msg.success) {
          addLog(`✅ 工具刷新成功: ${msg.toolCount} 个工具`, 'success');
        } else {
          addLog(`❌ 工具刷新失败: ${msg.error}`, 'error');
        }
        break;

      // ===== 批量任务消息 =====
      case 'batch_step_result':
        state.totalCalls++;  // 统计调用次数
        if (msg.success) {
          addLog(`📦 步骤${msg.stepIndex}: ${msg.tool} ✓`, 'success');
          state.batchResults.push({
            stepIndex: msg.stepIndex,
            tool: msg.tool,
            success: true,
            result: msg.result
          });
          // 更新进度条
          if (window.PanelEnhancer) {
            window.PanelEnhancer.updateStepStatus(msg.stepIndex, 'success', msg.tool);
            window.PanelEnhancer.updateProgress(state.batchResults.length, state.currentBatchTotal);
          }
        } else if (msg.skipped) {
          addLog(`📦 步骤${msg.stepIndex}: 跳过 (${msg.reason})`, 'info');
          if (window.PanelEnhancer) {
            window.PanelEnhancer.updateStepStatus(msg.stepIndex, 'skipped', msg.tool);
          }
        } else {
          addLog(`📦 步骤${msg.stepIndex}: ${msg.tool} ✗ ${msg.error}`, 'error');
          state.batchResults.push({
            stepIndex: msg.stepIndex,
            tool: msg.tool,
            success: false,
            error: msg.error
          });
          // 更新进度条（错误状态）
          if (window.PanelEnhancer) {
            window.PanelEnhancer.updateStepStatus(msg.stepIndex, 'error', msg.tool);
            window.PanelEnhancer.updateProgress(state.batchResults.length, state.currentBatchTotal, true);
          }
        }
        break;

      case 'batch_complete':
        state.agentRunning = false;
        hideExecutingIndicator();
        updateStatus();
        // 隐藏进度条
        if (window.PanelEnhancer) {
          window.PanelEnhancer.hideProgress();
          // 显示 Toast 通知
          if (msg.success) {
            window.PanelEnhancer.showToast(`批量任务完成: ${msg.stepsCompleted}/${msg.totalSteps}`, 'success');
          } else {
            window.PanelEnhancer.showToast(`批量任务部分失败: ${msg.stepsFailed} 个错误`, 'error');
          }
        }
        if (msg.success) {
          addLog(`✅ 批量任务完成: ${msg.stepsCompleted}/${msg.totalSteps} 成功`, 'success');
        } else {
          addLog(`⚠️ 批量任务部分失败: ${msg.stepsCompleted}/${msg.totalSteps} 成功, ${msg.stepsFailed} 失败`, 'error');
        }
        // 生成包含详细结果的汇总
        let detailedResults = '';
        if (state.batchResults && state.batchResults.length > 0) {
          detailedResults = state.batchResults.map((r, i) => {
            if (r.success) {
              let content = r.result || '';
              if (content.length > 2000) content = content.slice(0, 2000) + '...(截断)';
              return `**[步骤${r.stepIndex}]** \`${r.tool}\` ✓\n\`\`\`\n${content}\n\`\`\``;
            } else {
              return `**[步骤${r.stepIndex}]** \`${r.tool}\` ✗ ${r.error}`;
            }
          }).join('\n\n');
          state.batchResults = []; // 清空
        }
        const batchSummary = `**[批量执行完成]** ${msg.success ? '✓ 成功' : '✗ 部分失败'} (${msg.stepsCompleted}/${msg.totalSteps})\n\n` +
          detailedResults +
          `\n\n`;
        sendMessageSafe(batchSummary);
        break;

      case 'batch_error':
        state.agentRunning = false;
        hideExecutingIndicator();
        updateStatus();
        addLog(`❌ 批量任务错误: ${msg.error}`, 'error');
        sendMessageSafe(`**[批量执行错误]** ${msg.error}`);
        break;

      // ===== 浏览器工具反向调用（来自 ΩBATCH 中的 js_flow/eval_js/list_tabs）=====
      case 'browser_tool_call': {
        const { callId, tool: bTool, params: bParams } = msg;
        addLog(`🔄 BATCH→浏览器: ${bTool} (${callId})`, 'tool');

        const sendBrowserResult = (success, result, error) => {
          chrome.runtime.sendMessage({
            type: 'SEND_TO_SERVER',
            payload: { type: 'browser_tool_result', callId, success, result, error }
          });
          addLog(`${success ? '✅' : '❌'} BATCH←浏览器: ${bTool}`, success ? 'success' : 'error');
        };

        if (bTool === 'list_tabs') {
          const ltCallId = 'bt_lt_' + Date.now();
          const ltHandler = (m) => {
            if (m.type === 'LIST_TABS_RESULT' && m.callId === ltCallId) {
              chrome.runtime.onMessage.removeListener(ltHandler);
              sendBrowserResult(m.success, m.result, m.error);
            }
          };
          chrome.runtime.onMessage.addListener(ltHandler);
          chrome.runtime.sendMessage({ type: 'LIST_TABS', callId: ltCallId });
        } else if (bTool === 'eval_js') {
          const ejCallId = 'bt_ej_' + Date.now();
          const ejHandler = (m) => {
            if (m.type === 'EVAL_JS_RESULT' && m.callId === ejCallId) {
              chrome.runtime.onMessage.removeListener(ejHandler);
              sendBrowserResult(m.success, m.result, m.error);
            }
          };
          chrome.runtime.onMessage.addListener(ejHandler);
          chrome.runtime.sendMessage({ type: 'EVAL_JS', code: bParams.code || '', callId: ejCallId, targetTabId: bParams.tabId || null, allFrames: bParams.allFrames || false });
        } else if (bTool === 'screenshot') {
          const scCallId = 'bt_sc_' + Date.now();
          const scHandler = (m) => {
            if (m.type === 'CAPTURE_TAB_RESULT' && m.callId === scCallId) {
              chrome.runtime.onMessage.removeListener(scHandler);
              if (m.success && m.dataUrl) {
                sendBrowserResult(true, m.dataUrl);
              } else {
                sendBrowserResult(false, null, m.error || 'screenshot failed');
              }
            }
          };
          chrome.runtime.onMessage.addListener(scHandler);
          chrome.runtime.sendMessage({ type: 'CAPTURE_TAB', callId: scCallId, tabId: bParams.tabId ? Number(bParams.tabId) : null });
        } else if (bTool === 'js_flow') {
          // js_flow 比较特殊：复用现有的 executeToolCall 逻辑太复杂
          // 直接内联一个简化版：逐步执行，收集结果
          const steps = bParams.steps || [];
          const flowTabId = bParams.tabId ? Number(bParams.tabId) : undefined;
          const results = [];
          let flowAborted = false;

          const runFlowStep = (si) => {
            if (flowAborted) return;
            if (si >= steps.length) {
              sendBrowserResult(true, JSON.stringify(results, null, 2));
              return;
            }
            const s = steps[si];
            const sLabel = s.label || `step${si}`;
            const sTabId = s.tabId ? Number(s.tabId) : flowTabId;
            const sDelay = s.delay || 0;

            const doStep = () => {
              if (!s.code) {
                results.push({ step: sLabel, success: true, result: '(no code)' });
                runFlowStep(si + 1);
                return;
              }
              const ctxJson = JSON.stringify(results).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
              const wrapped = `return (async function(){ const ctx = JSON.parse('${ctxJson}'); ${s.code} })()`;
              const sCallId = 'bt_fl_' + si + '_' + Date.now();
              const sHandler = (m) => {
                if (m.type !== 'EVAL_JS_RESULT' || m.callId !== sCallId) return;
                chrome.runtime.onMessage.removeListener(sHandler);
                results.push({ step: sLabel, success: m.success, result: m.result || m.error });
                if (!m.success && !s.optional && !s.continueOnError) {
                  flowAborted = true;
                  sendBrowserResult(false, JSON.stringify(results, null, 2), `步骤 ${sLabel} 失败: ${m.error}`);
                } else {
                  runFlowStep(si + 1);
                }
              };
              chrome.runtime.onMessage.addListener(sHandler);
              chrome.runtime.sendMessage({ type: 'EVAL_JS', code: wrapped, callId: sCallId, targetTabId: sTabId });
            };

            if (sDelay > 0) setTimeout(doStep, sDelay);
            else doStep();
          };
          runFlowStep(0);
        } else {
          sendBrowserResult(false, null, `未知浏览器工具: ${bTool}`);
        }
        break;
      }

      // ===== 第三阶段: 任务规划 =====
      case 'plan_result':
        addLog('📋 收到任务规划结果', 'success');
        state.agentRunning = false;
        hideExecutingIndicator();
        updateStatus();
        sendMessageSafe('**[任务规划完成]**\n\n' + (msg.visualization || '') + '\n\n' + JSON.stringify(msg.plan, null, 2).slice(0, 2000));
        break;

      case 'plan_error':
        addLog('❌ 任务规划失败: ' + msg.error, 'error');
        state.agentRunning = false;
        hideExecutingIndicator();
        updateStatus();
        sendMessageSafe('**[任务规划失败]** ' + msg.error);
        break;

      case 'workflow_step':
        addLog('🔄 工作流步骤 ' + msg.stepIndex, msg.success ? 'info' : 'error');
        break;

      case 'workflow_complete':
        addLog('✅ 工作流完成', 'success');
        state.agentRunning = false;
        hideExecutingIndicator();
        updateStatus();
        sendMessageSafe('**[工作流完成]** ' + msg.workflowId + ' 成功: ' + msg.stepsCompleted + '/' + msg.totalSteps);
        break;

      case 'workflow_error':
        addLog('❌ 工作流失败: ' + msg.error, 'error');
        state.agentRunning = false;
        hideExecutingIndicator();
        updateStatus();
        sendMessageSafe('**[工作流失败]** ' + msg.error);
        break;

      case 'resume_complete':
        addLog('✅ 断点续传完成', 'success');
        state.agentRunning = false;
        hideExecutingIndicator();
        updateStatus();
        break;

      case 'resume_started':
        addLog('▶️ 断点续传开始', 'info');
        break;

      case 'resume_step':
        addLog('▶️ 恢复步骤 ' + msg.stepIndex, msg.success ? 'info' : 'error');
        break;

      case 'checkpoint_result':
        addLog('💾 检查点操作完成', 'success');
        state.agentRunning = false;
        hideExecutingIndicator();
        updateStatus();
        sendMessageSafe('**[检查点结果]** ' + JSON.stringify(msg, null, 2).slice(0, 1000));
        break;

      case 'checkpoint_error':
        addLog('❌ 检查点失败: ' + msg.error, 'error');
        break;

      case 'templates_list':
        addLog('📋 模板列表', 'success');
        sendMessageSafe('**[工作流模板]**\n' + msg.templates.map(t => '- ' + t.id + ': ' + t.name).join('\n'));
        break;

      case 'resume_complete':
        addLog(`✅ 任务恢复完成: ${msg.stepsCompleted}/${msg.totalSteps}`, 'success');
        break;

      case 'resume_error':
        addLog(`❌ 任务恢复失败: ${msg.error}`, 'error');
        break;

      // ===== 目标驱动执行 =====
      case 'goal_created':
        addLog(`🎯 目标已创建: ${msg.goal?.id || msg.goalId}`, 'success');
        break;

      case 'goal_progress':
        if (msg.step !== undefined) {
          addLog(`🎯 目标进度: 步骤 ${msg.step} - ${msg.status || '执行中'}`, 'info');
        }
        break;

      case 'goal_complete':
        state.agentRunning = false;
        hideExecutingIndicator();
        updateStatus();
        if (msg.success) {
          addLog(`✅ 目标完成: ${msg.goalId} (${msg.attempts || 1} 次尝试)`, 'success');
        } else {
          addLog(`❌ 目标失败: ${msg.goalId} - ${msg.error || '未知错误'}`, 'error');
        }
        // 生成目标完成摘要
        const goalSummary = `**[目标执行完成]** ${msg.success ? '✓ 成功' : '✗ 失败'}\n` +
          `- 目标ID: ${msg.goalId}\n` +
          `- 尝试次数: ${msg.attempts || 1}\n` +
          (msg.gaps?.length ? `- 未满足条件: ${msg.gaps.length}\n` : '') +
          `\n`;
        sendMessageToAI(goalSummary);
        break;

      case 'goal_status_result':
        addLog(`📊 目标状态: ${msg.status?.status || '未知'} (${msg.status?.progress || 0}%)`, 'info');
        break;

      case 'goals_list':
        addLog(`📋 活跃目标: ${msg.goals?.active?.length || 0}, 已完成: ${msg.goals?.completed || 0}`, 'info');
        break;

      case 'validated_result':
        state.agentRunning = false;
        hideExecutingIndicator();
        updateStatus();
        const vr = msg.result;
        if (vr?.success && vr?.validated) {
          addLog(`✅ ${msg.tool} 执行并验证成功`, 'success');
        } else if (vr?.success && !vr?.validated) {
          addLog(`⚠️ ${msg.tool} 执行成功但验证失败`, 'warning');
        } else {
          addLog(`❌ ${msg.tool} 执行失败: ${vr?.error}`, 'error');
        }
        // 生成验证结果摘要
        const vrSummary = `**[验证执行结果]** ${msg.tool}\n` +
          `- 执行: ${vr?.success ? '✓' : '✗'}\n` +
          `- 验证: ${vr?.validated ? '✓' : '✗'}\n` +
          (vr?.result ? `\`\`\`\n${typeof vr.result === 'string' ? vr.result.slice(0, 1000) : JSON.stringify(vr.result).slice(0, 1000)}\n\`\`\`\n` : '') +
          `\n`;
        sendMessageToAI(vrSummary);
        break;

      // ===== 异步命令执行 =====
      case 'async_result':
        state.agentRunning = false;
        hideExecutingIndicator();
        updateStatus();
        if (msg.success) {
          const modeText = msg.mode === 'async' ? ' (后台)' : '';
          addLog(`✅ 命令执行成功${modeText}`, 'success');
          if (msg.processId) {
            addLog(`📋 进程ID: ${msg.processId}`, 'info');
          }
        } else {
          addLog(`❌ 命令执行失败: ${msg.error}`, 'error');
          if (msg.suggestion) {
            addLog(`💡 建议: ${msg.suggestion}`, 'info');
          }
        }
        // 生成异步结果摘要
        const asyncSummary = `**[命令执行结果]** ${msg.success ? '✓ 成功' : '✗ 失败'}${msg.mode === 'async' ? ' (后台模式)' : ''}\n` +
          (msg.processId ? `- 进程ID: ${msg.processId}\n` : '') +
          (msg.logFile ? `- 日志文件: ${msg.logFile}\n` : '') +
          (msg.warning ? `- ⚠️ ${msg.warning}\n` : '') +
          (msg.output ? `\`\`\`\n${msg.output.slice(-2000)}\n\`\`\`\n` : '') +
          (msg.error ? `- 错误: ${msg.error}\n` : '') +
          `\n`;
        sendMessageToAI(asyncSummary);
        break;

      case 'async_output':
        // 实时输出，仅记录日志
        if (msg.output) {
          addLog(`📤 ${msg.output.slice(0, 200)}`, 'info');
        }
        break;

      case 'async_status_result':
        if (msg.exists) {
          addLog(`📊 进程 ${msg.processId}: ${msg.isRunning ? '运行中' : '已停止'}`, msg.isRunning ? 'success' : 'info');
        } else {
          addLog(`⚠️ 进程不存在: ${msg.processId}`, 'warning');
        }
        break;

      case 'async_stop_result':
        if (msg.success) {
          addLog(`⏹️ 进程已停止: ${msg.processId}`, 'success');
        } else {
          addLog(`❌ 停止失败: ${msg.error}`, 'error');
        }
        break;

      case 'async_log_result':
        if (msg.success) {
          addLog(`📋 日志 (${msg.lines} 行)`, 'info');
          const logSummary = `**[进程日志]** ${msg.processId}\n` +
            `- 文件: ${msg.logFile}\n` +
            `- 总行数: ${msg.lines}\n` +
            `\`\`\`\n${msg.content?.slice(-3000) || '(空)'}\n\`\`\`\n` +
            `\n`;
          sendMessageToAI(logSummary);
        } else {
          addLog(`❌ 读取日志失败: ${msg.error}`, 'error');
        }
        break;

      // ===== 录制相关 =====
      case 'recording_started':
        addLog(`🎬 录制已开始: ${msg.recordingId}`, 'success');
        break;

      case 'recording_stopped':
        addLog(`⏹️ 录制已停止: ${msg.recordingId} (${msg.summary?.totalSteps || 0} 步)`, 'success');
        break;

      case 'recordings_list':
        if (msg.recordings?.length > 0) {
          addLog(`📼 录制列表: ${msg.recordings.length} 个`, 'info');
          msg.recordings.forEach(r => {
            addLog(`  - ${r.id}: ${r.name || '未命名'} (${r.totalSteps} 步)`, 'info');
          });
        } else {
          addLog('📼 暂无录制', 'info');
        }
        break;

      case 'recording_loaded':
        if (msg.success) {
          addLog(`📂 录制已加载: ${msg.recording?.id}`, 'success');
        } else {
          addLog(`❌ 加载录制失败: ${msg.error}`, 'error');
        }
        break;

      case 'replay_step_result':
        const replayStatus = msg.success ? '✓' : '✗';
        addLog(`▶️ 回放步骤 ${msg.stepIndex}: ${msg.tool} ${replayStatus}`, msg.success ? 'info' : 'warning');
        break;

      case 'replay_complete':
        addLog(`🏁 回放完成: ${msg.stepsCompleted || 0}/${msg.totalSteps || 0} 成功`, 'success');
        break;

      case 'replay_error':
        addLog(`❌ 回放错误: ${msg.error}`, 'error');
        break;

      case 'tool_result':
        // 终端命令的结果不注入聊天框，由终端自己处理
        if (msg.id && msg.id.startsWith('term_')) {
          log('终端结果，跳过聊天框注入:', msg.id);
          break;
        }
        // 存档检查命令不注入聊天框，但 digest 结果需要注入
        if (msg.id && msg.id.startsWith('save_check_')) {
          log('存档检查结果，跳过聊天框注入:', msg.id);
          break;
        }
        if (msg.id && msg.id.startsWith('save_') && msg.success && msg.result) {
          log('存档完成，注入 digest 结果到聊天框');
          const digestText = '💾 **项目上下文已更新：**\n\n' + msg.result;
          sendMessageSafe(digestText);
          break;
        }
        // 去重：用 tool + 结果内容生成 hash
        const resultHash = `result:${msg.tool}:${msg.id || ''}:${JSON.stringify(msg.result || msg.error).slice(0,100)}`;
        if (state.executedCalls.has(resultHash)) {
          log('跳过重复的 tool_result:', msg.tool);
          break;
        }
        addExecutedCall(resultHash);
        
        // 用 msg.id 精确匹配，而不是用 tool 名称
        if (msg.id && state.pendingCalls.has(msg.id)) {
          state.pendingCalls.delete(msg.id);
        } else {
          // 回退：按 tool 名称匹配（兼容旧版本）
          for (const [id, call] of state.pendingCalls) {
            if (call.tool === msg.tool) {
              state.pendingCalls.delete(id);
              break;
            }
          }
        }
        
        addLog(`📥 ${msg.tool}: ${msg.success ? '成功' : '失败'}`, msg.success ? 'result' : 'error');
        
        state.agentRunning = false;
        // executedInCurrentMessage 不在此处重置，由 SSE 连接建立/关闭时重置
        // 避免 batch 执行中间或结果返回后 DOM 扫描重复执行
        hideExecutingIndicator();
        updateStatus();
        
        const resultText = formatToolResult(msg);
        // 发送去重：同样内容 5 秒内不重复发送
        const sendHash = `send:${resultText.slice(0, 100)}`;
        if (state.executedCalls.has(sendHash)) {
          log('跳过重复发送');
          break;
        }
        addExecutedCall(sendHash);
        setTimeout(() => {
          state.executedCalls.delete(sendHash);  // 5秒后允许再次发送
        }, 5000);
        sendMessageSafe(resultText);
        incrementRound();
        break;

      case 'error':
        addLog(`❌ ${msg.message || '未知错误'}`, 'error');
        state.agentRunning = false;
        hideExecutingIndicator();
        updateStatus();
        break;
      
      // 跨 Tab 消息
      case 'CROSS_TAB_MESSAGE':
        // 检查是否是回执消息（不注入聊天框，只显示日志）
        if (msg.message && msg.message.startsWith('✅ [回执]')) {
          addLog(`📬 ${msg.message}`, 'success');
          break;
        }
        
        addLog(`📩 收到来自 ${msg.from} 的消息`, 'success');
        
        // 发送回执给发送方（只发一次）
        if (!state.crossTabBuffer) {
          state.crossTabBuffer = {};
        }
        
        const fromAgent = msg.from;
        
        // 初始化该 agent 的缓冲区
        if (!state.crossTabBuffer[fromAgent]) {
          state.crossTabBuffer[fromAgent] = {
            messages: [],
            timer: null,
            receiptSent: false
          };
        }
        
        const buffer = state.crossTabBuffer[fromAgent];
        
        // 只发送一次回执
        if (!buffer.receiptSent) {
          chrome.runtime.sendMessage({
            type: 'CROSS_TAB_SEND',
            to: fromAgent,
            message: `✅ [回执] ${agentId || '对方'} 已收到消息，正在处理...`
          });
          buffer.receiptSent = true;
        }
        
        // 累积消息
        buffer.messages.push(msg.message);
        
        // 清除之前的定时器
        if (buffer.timer) {
          clearTimeout(buffer.timer);
        }
        
        // 设置定时器合并发送（phone-bridge 消息不需要等太久）
        const delay = fromAgent === 'phone-bridge' ? 200 : 2000;
        buffer.timer = setTimeout(() => {
          const combinedMsg = buffer.messages.join('');
          const crossTabMsg = `**[来自 ${fromAgent} 的消息]**\n\n${combinedMsg}\n\n---\n请处理上述消息。完成后可以用 ΩSEND:${fromAgent}:回复内容ΩSENDEND 来回复。`;
          waitForGenerationComplete(() => enqueueMessage(crossTabMsg));
          
          // 清空缓冲区
          delete state.crossTabBuffer[fromAgent];
        }, delay);
        break;
    }

    sendResponse({ ok: true });
    return true;
  });

