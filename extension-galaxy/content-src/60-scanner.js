  // ============== 扫描工具调用 ==============

  function scanForToolCalls() {
    // Real-time disable check (no refresh needed)
    const dKey = 'agent_disabled_' + location.href.split('?')[1];
    if (localStorage.getItem(dKey) === 'true') return;
    // SSE 已成功执行当前消息中的工具调用，跳过 DOM 扫描避免重复
    // 但仅在 SSE 最近有活动时才跳过（避免 SSE 断开后 DOM 也不工作）
    if (sseState.executedInCurrentMessage && (Date.now() - sseState.lastDeltaTime < 30000)) return;
    // console.log("[Agent] scanning...");
    if (state.agentRunning) return;
    
    // 如果 AI 正在生成中，重置确认计数器并跳过
    if (isAIGenerating()) {
      state.generatingFalseCount = 0;
      log('AI 正在生成中，跳过扫描');
      return;
    }
    
    // 要求连续 3 次 (约600ms) isAIGenerating()=false 才确认输出结束
    state.generatingFalseCount++;
    if (state.generatingFalseCount < 3) {
      return;
    }
    
    const { text, index } = getLatestAIMessage();
    
    if (index < 0 || !text) return;
    
    // 刷新保护：页面加载后 3 秒内，跳过加载时已存在的消息
    if (window.__agentLoadState) {
      const elapsed = Date.now() - window.__agentLoadState.loadTime;
      if (elapsed < 3000) return; // 冷却期内不扫描
      if (elapsed < 5000 && !window.__agentLoadState.marked) {
        // 5秒内首次扫描：把当前消息里所有工具调用标记为已执行
        window.__agentLoadState.marked = true;
        state.lastMessageText = text;
        state.lastStableTime = Date.now();
        const existingCalls = parseToolCalls(text);
        for (const tool of existingCalls) {
          const hash = index + ':' + tool.name + ':' + JSON.stringify(tool.params);
          addExecutedCall(hash);
        }
        if (text.includes('@DONE') || text.includes('[[DONE]]')) {
          addExecutedCall('done:' + index);
        }
        log('刷新保护：标记 ' + existingCalls.length + ' 个已有工具调用，跳过执行');
        return;
      }
    }
    
    // 检测到新消息，重置所有计时器
    if (state.lastMessageText !== text) {
      state.lastMessageText = text;
      state.lastStableTime = Date.now();
      state.generatingFalseCount = 0;
      startToolCallDetection();
      return;
    }
    
    // Removed: result check (conflicts with code containing these chars)
    
    const toolStartCount = (text.match(/\[\[TOOL:/g) || []).length;
    const toolEndCount = (text.match(/\[\[\/TOOL\]\]/g) || []).length;
    
    if (toolStartCount > toolEndCount) {
      log('等待工具调用输出完成...');
      return;
    }
    
    // 文本稳定窗口: 1000ms 无变化
    if (Date.now() - state.lastStableTime < 1000) {
      return;
    }
    
    // 最终快照确认: 再取一次文本，确保真的没变
    const { text: textNow } = getLatestAIMessage();
    if (textNow !== text) {
      state.lastMessageText = textNow;
      state.lastStableTime = Date.now();
      state.generatingFalseCount = 0;
      return;
    }
    
    // 检查重试命令 @RETRY:#ID
    const retryMatch = text.match(/@RETRY:\s*#?(\d+)/);


    if (retryMatch) {
      const retryId = parseInt(retryMatch[1]);
      const retryHash = `${index}:retry:${retryId}`;
      if (!state.executedCalls.has(retryHash)) {
        addExecutedCall(retryHash);
        addLog(`🔄 重试命令 #${retryId}`, 'tool');
        executeRetry(retryId);
        return;
      }
    }
    
    // 检查录制命令 @REC:action:name
    const recMatch = text.match(/@REC:(start|stop|list|play)(?::([^:\s]+))?(?::([\{\[][^\s]*))?/);
    if (recMatch) {
      const recHash = `${index}:rec:${recMatch[0]}`;
      if (!state.executedCalls.has(recHash)) {
        addExecutedCall(recHash);
        const action = recMatch[1];
        const name = recMatch[2] || '';
        
        switch (action) {
          case 'start':
            if (name) {
              addLog(`🎬 开始录制: ${name}`, 'tool');
              chrome.runtime.sendMessage({ type: 'SEND_TO_SERVER', payload: { type: 'start_recording', name: name, description: '' } });
              state.currentRecordingId = name;
            } else {
              addLog('❌ 请指定录制名称: @REC:start:名称', 'error');
            }
            break;
          case 'stop':
            addLog('⏹️ 停止录制', 'tool');
            chrome.runtime.sendMessage({ type: 'SEND_TO_SERVER', payload: { type: 'stop_recording', recordingId: state.currentRecordingId || name } });
            state.currentRecordingId = null;
            break;
          case 'list':
            addLog('📼 获取录制列表...', 'tool');
            chrome.runtime.sendMessage({ type: 'SEND_TO_SERVER', payload: { type: 'list_recordings' } });
            break;
          case 'play':
            if (name) {
              console.log('[REC DEBUG] recMatch:', recMatch);
              const extraParam = recMatch[3];
              console.log('[REC DEBUG] extraParam:', extraParam);
              let playMsg = { type: 'replay_recording', recordingId: name };
              let paramInfo = '';
              
              if (extraParam) {
                try {
                  const parsed = JSON.parse(extraParam);
                  if (Array.isArray(parsed)) {
                    // 循环模式: @REC:play:名称:["a","b","c"]
                    playMsg.foreach = parsed;
                    paramInfo = ` (循环 ${parsed.length} 次)`;
                  } else if (typeof parsed === 'object') {
                    // 参数模式: @REC:play:名称:{"server":"oracle"}
                    playMsg.variables = parsed;
                    paramInfo = ` (参数: ${Object.keys(parsed).join(', ')})`;
                  }
                } catch (e) {
                  addLog(`⚠️ 参数解析失败: ${e.message}`, 'warning');
                }
              }
              
              addLog(`▶️ 回放录制: ${name}${paramInfo}`, 'tool');
              chrome.runtime.sendMessage({ type: 'SEND_TO_SERVER', payload: playMsg });
            } else {
              addLog('❌ 请指定录制名称: @REC:play:名称', 'error');
            }
            break;
        }
        return;
      }
    }
    
    
    const toolCalls = parseToolCalls(text);
    
    for (const tool of toolCalls) {
      const callHash = `${index}:${tool.name}:${JSON.stringify(tool.params)}`;
      
      if (state.executedCalls.has(callHash)) {
        continue;
      }
      
      // 通用去重：检查 SSE 通道注册的 dedup key
      // 第三重兜底：如果 SSE 本轮未执行任何命令，不信任 dedup key
      const dedupKey = `dedup:${tool.name}:${JSON.stringify(tool.params)}`;
      if (hasDedupKey(dedupKey) && sseState.executedInCurrentMessage) {
        log('跳过 DOM 扫描（dedup key 已存在）:', tool.name);
        addExecutedCall(callHash);
        continue;
      }
      
      // SSE 去重：如果已被 SSE 通道处理过，跳过 DOM 扫描的执行
      // 第三重兜底：如果 SSE 本轮未执行任何命令，不信任 SSE 处理标记
      if (sseState.enabled && isSSEProcessed(tool.name, tool.params) && sseState.executedInCurrentMessage) {
        log('跳过 DOM 扫描（已被 SSE 处理）:', tool.name);
        addExecutedCall(callHash);  // 标记为已执行，防止反复检查
        continue;
      }
      
      log('检测到工具调用:', tool.name, tool.params);
      
      // 判断是否为批量调用
      if (tool.isBatch && tool.name === '__BATCH__') {
        executeBatchCall(tool.params, callHash);
      } else if (tool.isPlan && tool.name === '__PLAN__') {
        addExecutedCall(callHash);
        chrome.runtime.sendMessage({
          type: 'SEND_TO_SERVER',
          payload: { type: 'task_plan', params: tool.params, id: Date.now() }
        }, (resp) => {
          if (resp && resp.success) addLog('📋 任务规划请求已发送', 'info');
          else addLog('❌ 任务规划请求失败', 'error');
        });
        return;
      } else if (tool.isFlow && tool.name === '__FLOW__') {
        addExecutedCall(callHash);
        chrome.runtime.sendMessage({
          type: 'SEND_TO_SERVER',
          payload: { type: 'workflow_execute', params: tool.params, id: Date.now() }
        }, (resp) => {
          if (resp && resp.success) addLog('🔄 工作流请求已发送', 'info');
          else addLog('❌ 工作流请求失败', 'error');
        });
        return;
      } else if (tool.isResume && tool.name === '__RESUME__') {
        addExecutedCall(callHash);
        chrome.runtime.sendMessage({
          type: 'SEND_TO_SERVER',
          payload: { type: 'task_resume', params: tool.params, id: Date.now() }
        }, (resp) => {
          if (resp && resp.success) addLog('▶️ 断点续传请求已发送', 'info');
          else addLog('❌ 断点续传请求失败', 'error');
        });
        return;
      } else {
        executeToolCall(tool, callHash);
      }
      return;
    }
    
    if (text.includes('@DONE') || text.includes('[[DONE]]')) {
      const doneHash = `done:${index}`;
      if (!state.executedCalls.has(doneHash)) {
        addExecutedCall(doneHash);
        state.agentRunning = false;
        hideExecutingIndicator();
        state.pendingCalls.clear();
        updateStatus();
        addLog('✅ 任务完成', 'success');
      }
    }
  }

  // ============== 结果格式化 ==============

  function incrementRound() {
    state.roundCount++;
    localStorage.setItem('agent_round_count', state.roundCount.toString());
    // 每 30 轮发出预警
    if (state.roundCount > 0 && state.roundCount % 30 === 0) {
      addLog('⚠️ 已达 ' + state.roundCount + ' 轮，考虑开新对话', 'warn');
    }
    addLog('📊 轮次: ' + state.roundCount, 'info');
    updateRoundDisplay();
  }

  function resetRound() {
    state.roundCount = 0;
    localStorage.setItem('agent_round_count', '0');
    addLog('🔄 轮次已重置', 'info');
    updateRoundDisplay();
  }

  function updateRoundDisplay() {
    const el = document.getElementById('agent-round');
    if (el) {
      el.textContent = 'R:' + state.roundCount;
      el.style.color = state.roundCount >= 30 ? '#f59e0b' : state.roundCount >= 20 ? '#eab308' : '#9ca3af';
    }
  }

  
  // ============== 智能提示系统 ==============
  const SmartTips = {
    toolTips: {
      'take_screenshot': '截图已保存，可用 read_media_file 查看',
      'take_snapshot': '快照包含 uid，用于 click/fill 等操作',
      'click': '点击后可能需要 wait_for 等待页面变化',
      'fill': '填写后通常需要 click 提交按钮',
      'navigate_page': '导航后用 take_snapshot 获取页面内容',
      'new_page': '新页面已创建，用 take_snapshot 查看内容',
      'write_file': '文件已写入，大文件建议用 run_command',
      'edit_file': '文件已修改，可用 read_file 验证',
      'register_project_tool': '项目已注册，可用 get_symbols/find_text 分析',
      'get_symbols': '符号列表可用于 find_usage 查引用',
    },
    errorTips: {
      'timeout': '超时了，可拆分任务或后台执行: nohup cmd &',
      'not found': '路径不存在，先用 list_directory 确认',
      'permission denied': '权限不足，检查是否在允许目录内',
      'enoent': '文件/目录不存在，检查路径拼写',
      'eacces': '访问被拒绝，检查文件权限',
      'no such file': '文件不存在，用 list_directory 查看目录',
      'command not found': '命令不存在，检查是否已安装',
      'not allowed': '路径不在允许目录内，检查 list_allowed_directories',
      'syntax error': '语法错误，检查代码格式',
    },
    generalTips: [
      'ΩCODE 统一通道: 单步{tool:...} 多步{steps:[...]}',
      '长内容用 run_command + heredoc 写入',
      '项目记忆: memory_manager_v2.js projects',
    ],
    getTip(toolName, success, content, error) {
      const text = ((content || '') + ' ' + (error || '')).toLowerCase();
      if (!success) {
        for (const [key, tip] of Object.entries(this.errorTips)) {
          if (text.includes(key)) return tip;
        }
        return '';
      }
      if (this.toolTips[toolName]) {
        return this.toolTips[toolName];
      }
      return '';
    }
  };

  function formatToolResult(msg) {
    let content;
    
    if (msg.success) {
      if (typeof msg.result === 'string') {
        content = msg.result;
      } else if (msg.result?.stdout !== undefined) {
        content = msg.result.stdout || '(空输出)';
        if (msg.result.stderr) {
          content += '\n[stderr]: ' + msg.result.stderr;
        }
      } else {
        content = JSON.stringify(msg.result, null, 2);
      }
    } else {
      content = `错误: ${msg.error || msg.result?.stderr || '未知错误'}`;
      // 添加错误类型和修复建议
      if (msg.errorType) {
        content += `\n[错误类型]: ${msg.errorType}`;
      }
      if (msg.recoverable) {
        content += `\n[可恢复]: 是`;
      }
    }
    
    // 智能截断：根据工具类型设定不同上限
    const toolLimits = {
      'read_file': 20000,
      'read_multiple_files': 20000,
      'directory_tree': 5000,
      'run_command': 10000,
      'browser_snapshot': 3000,
      'find_text': 8000,
      'find_usage': 8000,
      'get_symbols': 8000,
      'analyze_project': 8000
    };
    const maxLen = toolLimits[msg.tool] || 15000;
    
    if (content.length > maxLen) {
      // 保留头尾，中间截断
      const headLen = Math.floor(maxLen * 0.7);
      const tailLen = Math.floor(maxLen * 0.2);
      content = content.slice(0, headLen) + `\n\n...(截断了 ${content.length - headLen - tailLen} 字符)...\n\n` + content.slice(-tailLen);
    }
    
    const status = msg.success ? '✓ 成功' : '✗ 失败';
    
    // 优先使用服务器返回的建议，否则使用本地 SmartTips
    const tip = msg.suggestion || SmartTips.getTip(msg.tool, msg.success, content, msg.error);
    
    // 上下文计数：统计当前对话消息数，附加到结果末尾
    let contextInfo = '';
    try {
      // 读取服务端真实数据（auto-compress daemon 通过 DOM dataset 桥接）
      const _ds = document.documentElement.dataset;
      const serverChars = parseInt(_ds.serverMsgChars) || 0;
      const serverCount = parseInt(_ds.serverMsgCount) || 0;
      const hasServerData = serverChars > 0;
      const totalMsgs = serverCount > 0 ? serverCount : document.querySelectorAll('div.group\/message').length;
      let totalChars = 0;
      if (hasServerData) {
        totalChars = serverChars;
      } else {
        document.querySelectorAll('div.group\/message').forEach(function(m) { totalChars += m.textContent.length; });
      }
      
      // 加上注入prompt长度（AI实际看到的总量）
      const injectedSize = window.__injectedPromptSize || 0;
      const effectiveChars = totalChars + injectedSize;
      const effectiveK = Math.round(effectiveChars / 1000);
      const source = hasServerData ? '服务端' : '本地';
      
      // 主要靠字符数判断，消息数辅助
      if (effectiveChars > 350000 || totalMsgs > 300) {
        contextInfo = `\n⚠️ [对话: ${totalMsgs}条/${effectiveK}K${source}(含注入${Math.round(injectedSize/1000)}K) — 已超过压缩阈值，执行 compress-chat 压缩]`;
      } else if (effectiveChars > 300000 || totalMsgs > 250) {
        contextInfo = `\n⚠️ [对话: ${totalMsgs}条/${effectiveK}K${source}(含注入${Math.round(injectedSize/1000)}K) — 接近压缩阈值]`;
      } else {
        contextInfo = `\n[对话状态: ${totalMsgs}条/${effectiveK}K${source}]`;
      }
    } catch(e) {}
    
    return `**[执行结果]** \`${msg.tool}\` ${status}:
\`\`\`
${content}
\`\`\`
${tip}${contextInfo}
`;
  }

