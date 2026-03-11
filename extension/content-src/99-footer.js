  // ============== SSE 原始数据拦截 ==============
  // 从 sse-hook.js (MAIN world) 接收未经 DOM 渲染的原始 SSE delta
  // 拼接后直接解析 Ω 命令，避免 DOM 渲染导致的转义问题
  
  const sseState = {
    currentText: '',          // 当前 SSE stream 拼接的完整文本
    connected: false,
    processedCommands: new Set(),  // 已从 SSE 处理过的命令签名
    lastDeltaTime: 0,
    messageId: null,
    enabled: true,             // SSE 通道开关
    executedInCurrentMessage: false  // 当前消息中 SSE 是否已执行过工具
  };

  function initSSEListener() {
    // 监听 SSE 连接建立
    document.addEventListener('__sse_connected__', (e) => {
      sseState.connected = true;
      sseState.currentText = '';
      sseState.messageId = null;
      sseState.processedCommands.clear();
      sseState.executedInCurrentMessage = false;
      log('SSE connected:', e.detail?.transport);
    });

    // 监听每个 SSE delta
    document.addEventListener('__sse_data__', (e) => {
      if (!sseState.enabled) return;
      const raw = e.detail?.data;
      if (!raw) return;

      try {
        const parsed = JSON.parse(raw);
        
        // 只处理 content delta
        if (parsed.type === 'message_field_delta' && parsed.field_name === 'content' && parsed.delta) {
          sseState.currentText += parsed.delta;
          sseState.lastDeltaTime = Date.now();
          sseState.messageId = parsed.message_id || sseState.messageId;
          
          // 实时检测完整的 Ω 命令
          tryParseSSECommands();
        }
      } catch (err) {
        // 非 JSON 数据，忽略
      }
    });

    // 监听 SSE 连接关闭
    document.addEventListener('__sse_closed__', (e) => {
      sseState.connected = false;
      // executedInCurrentMessage 不在 SSE 关闭时重置
      // 只在新消息的 SSE 连接建立时重置，避免长时间执行的命令被 DOM 重复执行
      // 最后一次扫描，确保不遗漏
      if (sseState.currentText) {
        tryParseSSECommands();
      }
      log('SSE closed, total text length:', sseState.currentText.length);
    });

    log('SSE listener initialized');
  }

  // === SSE 通用参数完整性预检查 ===
  // 检测 SSE 传输损坏的参数，返回 true 表示应 defer to DOM
  function sseParamsLookCorrupted(call) {
    var p = call.params;
    // SSE long-content guard: params > 500 chars likely corrupted, defer to DOM
    var paramLen = JSON.stringify(p).length;
    // write_file / edit_file: 允许 SSE 直接处理大内容，避免 DOM 渲染截断
    var sseAllowLarge = (call.name === 'write_file' || call.name === 'edit_file' || call.name === 'vfs_write');
    if (paramLen > 100 && !sseAllowLarge) {
      log("SSE pre-check: params > 100 chars (" + paramLen + "), defer to DOM for: " + call.name);
      return true;
    }
    if (sseAllowLarge && paramLen > 100) {
      log("SSE allow-large: " + call.name + " (" + paramLen + " chars) - SSE 直传避免 DOM 截断");
    }
    // eval_js / async_task: JS 语法检查
    if ((call.name === 'eval_js' || call.name === 'async_task') && p.code) {
      try { new Function(p.code); } catch (e) {
        if (e instanceof SyntaxError) {
          log('SSE pre-check: ' + call.name + ' code SyntaxError: ' + e.message + ', defer to DOM');
          return true;
        }
      }
    }
    // run_command: command 不应含引号或换行
    if (call.name === 'run_command' && p.command && /["'\n]/.test(p.command)) {
      log('SSE pre-check: run_command command corrupted, defer to DOM');
      return true;
    }
    // run_command: stdin 引号不配对
    if (call.name === 'run_command' && p.stdin) {
      var sq = (p.stdin.match(/'/g) || []).length;
      var dq = (p.stdin.match(/"/g) || []).length;
      if (sq % 2 !== 0 || dq % 2 !== 0) {
        log('SSE pre-check: run_command stdin unmatched quotes, defer to DOM');
        return true;
      }
    }
    // write_file: content 不应为空
    if (call.name === 'write_file' && !p.content && !p.contentFile) {
      log('SSE pre-check: write_file empty content, defer to DOM');
      return true;
    }
    // edit_file: edits 必须是非空数组
    if (call.name === 'edit_file') {
      if (!p.edits || !Array.isArray(p.edits) || p.edits.length === 0) {
        log('SSE pre-check: edit_file edits missing/empty, defer to DOM');
        return true;
      }
    }
    // 路径完整性: path 应以 / 开头
    if (p.path && typeof p.path === 'string' && !p.path.startsWith('/')) {
      log('SSE pre-check: path not starting with /, defer to DOM');
      return true;
    }
    // run_command stdin heredoc 未闭合检测
    if (call.name === 'run_command' && p.stdin) {
      var hereMatch = p.stdin.match(/<<\s*'?(\w+)'?\s*\n/);
      if (hereMatch && p.stdin.indexOf('\n' + hereMatch[1]) === -1) {
        log('SSE pre-check: run_command stdin heredoc unclosed (' + hereMatch[1] + '), defer to DOM');
        return true;
      }
    }
    // js_flow: steps 必须是非空数组
    if (call.name === 'js_flow') {
      if (!p.steps || !Array.isArray(p.steps) || p.steps.length === 0) {
        log('SSE pre-check: js_flow steps missing/empty, defer to DOM');
        return true;
      }
    }
    // bg_run: command 引号配对检测
    if (call.name === 'bg_run' && p.command) {
      var bsq = (p.command.match(/'/g) || []).length;
      var bdq = (p.command.match(/"/g) || []).length;
      if (bsq % 2 !== 0 || bdq % 2 !== 0) {
        log('SSE pre-check: bg_run command unmatched quotes, defer to DOM');
        return true;
      }
      // bg_run: 括号配对检测
      var opens = (p.command.match(/\(/g) || []).length;
      var closes = (p.command.match(/\)/g) || []).length;
      if (opens !== closes) {
        log("SSE pre-check: bg_run unmatched parens (" + opens + " vs " + closes + "), defer to DOM");
        return true;
      }
    }
    return false;
  }

  function tryParseSSECommands() {
    const text = sseState.currentText;
    if (!text) return;

    window.__OMEGA_WRITE_VERSION = 2;
    // -- OMEGA WRITE: zero-escape data transport channel --
    // Supports: \u03A9CODE, \u03A9DATA, with optional :slot=ID modifier
    // Format: \u03A9CODE[:slot=conversationId]\n...content...\n\u03A9CODEEND
    //         \u03A9DATA[:slot=conversationId]\n...content...\n\u03A9DATAEND
    var omegaWritePatterns = [
      { prefix: "\u03A9CODE", endTag: "\u03A9CODEEND", label: "OMEGACODE" },
      { prefix: "\u03A9DATA", endTag: "\u03A9DATAEND", label: "OMEGADATA" }
    ];
    for (var owi = 0; owi < omegaWritePatterns.length; owi++) {
      var owp = omegaWritePatterns[owi];
      // Find start marker: prefix must be at line start (preceded by \n or text start)
      // and followed immediately by \n or :slot= (not arbitrary text like "ΩDATA 回复")
      var owStartIdx = -1;
      var owSearchFrom = 0;
      while (owSearchFrom < text.length) {
        var candidateIdx = text.indexOf(owp.prefix, owSearchFrom);
        if (candidateIdx === -1) break;
        // Check: must be at start of line (pos 0 or preceded by \n)
        if (candidateIdx > 0 && text[candidateIdx - 1] !== "\n") {
          owSearchFrom = candidateIdx + owp.prefix.length;
          continue;
        }
        // Check: after prefix must be \n (bare marker) or : (for :slot=)
        var afterPrefix = text[candidateIdx + owp.prefix.length];
        if (afterPrefix === "\n" || afterPrefix === ":") {
          owStartIdx = candidateIdx;
          break;
        }
        owSearchFrom = candidateIdx + owp.prefix.length;
      }
      if (owStartIdx === -1) continue;
      var owEndMarker = "\n" + owp.endTag;
      var owEndIdx = text.indexOf(owEndMarker, owStartIdx);
      if (owEndIdx === -1 || owEndIdx <= owStartIdx) continue;
      var owSig = "sse:omegawrite:" + owp.label + ":" + owStartIdx;
      if (sseState.processedCommands.has(owSig)) continue;
      // Parse the header line (from prefix to first newline)
      var owHeaderEnd = text.indexOf("\n", owStartIdx);
      if (owHeaderEnd === -1 || owHeaderEnd > owEndIdx) continue;
      var owHeader = text.substring(owStartIdx, owHeaderEnd);
      var owContent = text.substring(owHeaderEnd + 1, owEndIdx);
      // Parse modifiers from header: :slot=UUID, :name=xxx, :append
      var owSlotId = null;
      var owSlotName = null;
      var owAppend = false;
      var slotMatch = owHeader.match(/:slot=([a-f0-9-]{36})/i);
      if (slotMatch) owSlotId = slotMatch[1];
      var nameMatch = owHeader.match(/:name=([a-zA-Z0-9_.\-]+)/);
      if (nameMatch) owSlotName = nameMatch[1];
      if (owHeader.indexOf(':append') !== -1) owAppend = true;
      sseState.processedCommands.add(owSig);
      var modStr = (owSlotId ? ' slot:' + owSlotId.substring(0,8) : '') + (owSlotName ? ' name:' + owSlotName : '') + (owAppend ? ' APPEND' : '');
      addLog("\u26A1 " + owp.label + " captured " + owContent.length + " chars" + modStr, "tool");
      log("SSE " + owp.label + " captured:", owContent.length, "chars," + modStr);
      // Resolve target: :name= uses VFS, :slot= uses raw ID, default uses code storage
      if (owSlotName && typeof window.vfs === 'object') {
        // VFS name-based write (with optional append)
        (function(vfsName, content, label, append) {
          var op = append ? window.vfs.append(vfsName, content) : window.vfs.write(vfsName, content);
          op.then(function(result) {
            if (result && result.error) {
              addLog("\u274C " + label + " VFS " + vfsName + ": " + result.error, "error");
            } else {
              addLog("\u2705 " + label + " " + (append ? "appended" : "stored") + " " + (result.length || content.length) + " chars to vfs:" + vfsName, "success");
            }
          }).catch(function(e) {
            addLog("\u274C " + label + " VFS write failed: " + e.message, "error");
          });
        })(owSlotName, owContent, owp.label, owAppend);
      } else if (owSlotId) {
        // Direct slot ID write (with optional append)
        (function(slotId, content, label, append) {
          var writePromise;
          if (append) {
            writePromise = window.readSlot(slotId).then(function(existing) {
              return window.writeSlot(slotId, (existing || '') + content);
            });
          } else {
            writePromise = window.writeSlot(slotId, content);
          }
          writePromise.then(function(len) {
            addLog("\u2705 " + label + " " + (append ? "appended" : "stored") + " " + len + " chars to slot " + slotId.substring(0,8), "success");
            log(label + (append ? " appended:" : " stored:"), len, "chars to slot", slotId);
          }).catch(function(e) {
            addLog("\u274C " + label + " write failed: " + e.message, "error");
          });
        })(owSlotId, owContent, owp.label, owAppend);
      } else if (typeof window.writeCodeStorage === "function") {
        window.writeCodeStorage(owContent).then(function(len) {
          addLog("\u2705 " + owp.label + " stored " + len + " chars", "success");
          log(owp.label + " stored:", len, "chars");
        });
      } else {
        window.__OMEGA_CODE = owContent;
        addLog("\u26A0 " + owp.label + " saved to window.__OMEGA_CODE (storage unavailable)", "warning");
      }
    }

    // 最优先：检测 ΩHERE heredoc 格式（支持自定义结束标记，不再硬编码检查 ΩEND）
    if (text.indexOf('\u03A9HERE') !== -1) {
      const hereCalls = parseHeredocFormat(text);
      for (const call of hereCalls) {
        const sig = 'sse:here:' + call.name + ':' + call.start;
        if (!sseState.processedCommands.has(sig)) {
          sseState.processedCommands.add(sig);
          addLog('\u26A1 SSE \u89E3\u6790 \u03A9HERE ' + call.name, 'tool');
          log('SSE parsed HEREDOC:', call.name, JSON.stringify(call.params));
          // === SSE 通用参数完整性预检查 (defer to DOM if corrupted) ===
          if (sseParamsLookCorrupted(call)) {
            continue;
          }
          const callHash = 'sse:' + sseState.messageId + ':' + call.name + ':' + call.start;
          addExecutedCall(callHash);
          // 注册 dedup key 防止 DOM 通道重复执行
          addDedupKey('dedup:' + call.name + ':' + JSON.stringify(call.params).substring(0, 200));
          sseState.executedInCurrentMessage = true;
          executeToolCall(call, callHash);
        }
      }
    }

    // 检测 ΩHEREBATCH 格式（HEREDOC 批量执行）
    var hereBatchSSEMarker = String.fromCharCode(0x03A9) + 'HEREBATCH';
    var hereBatchEndSSEMarker = String.fromCharCode(0x03A9) + 'HEREBATCHEND';
    if (text.indexOf(hereBatchSSEMarker) !== -1 && text.indexOf(hereBatchEndSSEMarker) !== -1) {
      var hereBatchSSE = parseHereBatchFormat(text);
      if (hereBatchSSE) {
        var hereBatchSig = 'sse:herebatch:' + hereBatchSSE.start;
        if (!sseState.processedCommands.has(hereBatchSig)) {
          sseState.processedCommands.add(hereBatchSig);
          addLog('\u26A1 SSE \u89E3\u6790 \u03A9HEREBATCH (' + hereBatchSSE.steps.length + ' steps)', 'tool');
          log('SSE parsed HEREBATCH:', hereBatchSSE.steps.length, 'steps');
          var hereBatchHash = 'sse:' + sseState.messageId + ':herebatch:' + hereBatchSSE.start;
          addExecutedCall(hereBatchHash);
          addDedupKey('dedup:__BATCH__:' + JSON.stringify(hereBatchSSE.steps).substring(0, 200));
          sseState.executedInCurrentMessage = true;
          executeBatchCall({ steps: hereBatchSSE.steps }, hereBatchHash);
        }
      }
    }


    // 检测 ΩBATCH...ΩEND (正则快速匹配 + fallback 括号平衡法)
    let batchMatch = text.match(/ΩBATCH(\{[\s\S]*?\})ΩEND/);
    let batchJson = batchMatch ? batchMatch[1] : null;
    if (batchMatch) {
      try {
        JSON.parse(batchJson);
      } catch (e) {
        // 正则截断，用括号平衡法重新提取
        const batchIdx = text.indexOf('ΩBATCH{');
        if (batchIdx !== -1) {
          const extracted = extractJsonFromText(text, batchIdx + 6);
          if (extracted) {
            const after = text.substring(extracted.end, extracted.end + 10);
            if (after.trim().startsWith('ΩEND')) {
              batchJson = extracted.json;
              log('SSE BATCH fallback bracket parse OK');
            }
          }
        }
      }
    }
    if (batchJson) {
      try {
        const batch = JSON.parse(batchJson);
        const sig = 'sse:batch:' + JSON.stringify(batch).substring(0, 100);
        if (!sseState.processedCommands.has(sig)) {
          sseState.processedCommands.add(sig);
          if (batch.steps && Array.isArray(batch.steps)) {
            addLog('⚡ SSE 直接解析 ΩBATCH', 'tool');
            log('SSE parsed BATCH (raw, no DOM):', batch);
            const callHash = `sse:${sseState.messageId}:__BATCH__:${JSON.stringify(batch)}`;
            addExecutedCall(callHash);
            sseState.executedInCurrentMessage = true;
            executeBatchCall(batch, callHash);
          }
        }
      } catch (e) {
        log('SSE BATCH parse error:', e.message);
      }
    }

    // 检测 Ω{...}ΩSTOP (可能有多个)
    // 策略：直接用括号平衡法提取完整 JSON + safeJsonParse 解析
    let searchPos = 0;
    while (true) {
      const omegaIdx = text.indexOf('Ω{', searchPos);
      if (omegaIdx === -1) break;
      // === SSE example keyword detection ===
      const sseNearBefore = text.substring(Math.max(0, omegaIdx - 30), omegaIdx);
      const sseIsExample = /Example:|e\.g\./.test(sseNearBefore);
      if (sseIsExample) {
        const skipExtracted = extractJsonFromText(text, omegaIdx + 1);
        if (skipExtracted) {
          try {
            const skipParsed = safeJsonParse(skipExtracted.json);
            if (skipParsed && skipParsed.tool) {
              addDedupKey(`dedup:${skipParsed.tool}:${JSON.stringify(skipParsed.params)}`);
              addDedupKey(`exec:${skipParsed.tool}:${JSON.stringify(skipParsed.params).substring(0, 200)}`);
              log('SSE SKIP (example keyword):', skipParsed.tool);
            }
          } catch(e) {}
        }
        searchPos = omegaIdx + 2; continue;
      }
      const extracted = extractJsonFromText(text, omegaIdx + 1);
      if (!extracted) { searchPos = omegaIdx + 1; continue; }
      const after = text.substring(extracted.end, extracted.end + 10);
      if (!after.trim().startsWith('ΩSTOP')) { searchPos = extracted.end; continue; }
      let parsed = null;
      try {
        parsed = safeJsonParse(extracted.json);
      } catch (e) {
        log('SSE single parse error:', e.message);
        searchPos = extracted.end;
        continue;
      }
      searchPos = extracted.end;
      if (!parsed) continue;
      // 如果是 partial parse（JSON.parse 失败后的 fallback），跳过 SSE 执行
      // partial parse 使用正则提取字段，参数可能不准确（如 command+ 被拼接）
      // 让 DOM 通道用完整文本重新解析
      if (parsed._partialParse) {
        log('SSE skip partial parse result:', parsed.tool, '(unreliable params)');
        continue;
      }
      const normalizedSig = 'sse:single:' + JSON.stringify({tool: parsed.tool, params: parsed.params}).substring(0, 100);
      if (sseState.processedCommands.has(normalizedSig)) continue;
      sseState.processedCommands.add(normalizedSig);
      if (parsed.tool) {
        // === SSE 通用参数完整性预检查 ===
        if (sseParamsLookCorrupted({ name: parsed.tool, params: parsed.params || {} })) {
          continue;
        }
        addLog(`⚡ SSE 直接解析 Ω ${parsed.tool}`, 'tool');
        log('SSE parsed tool call (raw, no DOM):', parsed.tool, parsed.params);
        const callHash = `sse:${sseState.messageId}:${parsed.tool}:${JSON.stringify(parsed.params)}`;
        addExecutedCall(callHash);
        addDedupKey(`dedup:${parsed.tool}:${JSON.stringify(parsed.params)}`);
        sseState.executedInCurrentMessage = true;
        executeToolCall({ name: parsed.tool, params: parsed.params || {} }, callHash);
      }
    }

    // 检测 ΩPLAN / ΩFLOW / ΩRESUME
    const planMatch = text.match(/ΩPLAN(\{[\s\S]*?\})/);
    if (planMatch) {
      const sig = 'sse:plan:' + planMatch[1].substring(0, 100);
      if (!sseState.processedCommands.has(sig)) {
        sseState.processedCommands.add(sig);
        try {
          const plan = JSON.parse(planMatch[1]);
          addLog('⚡ SSE 直接解析 ΩPLAN', 'tool');
          const callHash = `sse:${sseState.messageId}:__PLAN__:${JSON.stringify(plan)}`;
          addExecutedCall(callHash);
          chrome.runtime.sendMessage({
            type: 'SEND_TO_SERVER',
            payload: { type: 'task_plan', params: plan, id: Date.now() }
          });
        } catch (e) {}
      }
    }
  }

  // 检查一个命令是否已被 SSE 通道处理过（供 scanForToolCalls 判断）
  function isSSEProcessed(toolName, params) {
    const sig1 = 'sse:single:' + JSON.stringify({tool: toolName, params}).substring(0, 100);
    const sig2 = 'sse:batch:' + JSON.stringify(params).substring(0, 100);
    // 也检查 callHash 格式（SSE 通道会同时 addExecutedCall）
    return sseState.processedCommands.has(sig1) || sseState.processedCommands.has(sig2);
  }

  // Tab 保活心跳 - 防止 Chrome 休眠
  setInterval(function() {
    document.title = document.title;
  }, 30000);

  function init() {
    log('初始化 Agent v34 (Genspark)');

    // 启动 SSE 原始数据监听（优先通道）
    initSSEListener();
    
    createPanel();
    
    // 加载面板增强模块
    loadPanelEnhancer();
    // VideoGenerator 已通过 manifest content_scripts 自动加载

    // 恢复扩展刷新前未完成的异步任务
    _restoreAsyncTasks();

    setInterval(scanForToolCalls, CONFIG.SCAN_INTERVAL);

    // Notification polling - 已移除，改用 WebSocket 实时通道
    // 旧的 fetch http://localhost:8766/notify 会触发 CORS 错误
    // 如需 watchdog 通知，应通过 background.js 中转
    
    // 自动检测并点击 "Regenerate response" 按钮
    setInterval(() => {
      const btn = document.querySelector('[data-v-374c52ef].button');
      if (btn && btn.textContent && btn.textContent.includes('Regenerate')) {
        console.log('[Agent] 检测到 Regenerate response 按钮，1秒后自动点击');
        setTimeout(() => {
          if (btn && document.contains(btn)) {
            btn.click();
            console.log('[Agent] 已点击 Regenerate response 按钮');
          }
        }, 1000);
      }
    }, 2000);
    
    // 监听用户消息，检测 Agent ID（只检测用户自己发的消息，不检测系统注入的消息）
    let lastCheckedUserMsgCount = 0;
    setInterval(() => {
      const userMessages = document.querySelectorAll('.conversation-statement.user');
      if (userMessages.length > lastCheckedUserMsgCount) {
        const lastUserMsg = userMessages[userMessages.length - 1];
        const text = lastUserMsg.innerText || '';
        // 排除跨 Tab 消息的内容
        if (!text.includes('[来自') && !text.includes('[跨Tab通信]')) {
          detectAgentId(text);

        }
        lastCheckedUserMsgCount = userMessages.length;
      }
    }, 1000);

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
          if (resp.skills) { state.availableSkills = resp.skills; }
          if (resp.skillsPrompt) { state.skillsPrompt = resp.skillsPrompt; } try { document.dispatchEvent(new CustomEvent('__agent_skills_update__', { detail: { skillsPrompt: state.skillsPrompt } })); } catch(e) {}
          updateStatus();
        }
      });
    }, 500);

    addLog('🚀 Agent v34 已启动', 'success');
    addLog('💡 点击「📋 提示词」复制给AI', 'info');
    
    // 恢复之前保存的 Agent 身份
    restoreAgentId();
    
    // 启动 AI 响应超时监控
    startWakeupMonitor();
    
    // 初始化 Agent ID 显示
    setTimeout(updateAgentIdDisplay, 100);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 100);
  }

})();

// === Omega 手动执行快捷键 (Ctrl+Shift+E) ===
(function() {
  document.addEventListener('keydown', async function(e) {
    // Ctrl+Shift+E 触发
    if (e.ctrlKey && e.shiftKey && e.key === 'E') {
      e.preventDefault();
      console.log('[Omega] 快捷键触发');
      
      // 获取最后一条 AI 消息
      const msgs = document.querySelectorAll('.conversation-statement.assistant');
      const lastMsg = msgs[msgs.length - 1];
      if (!lastMsg) {
        alert('No AI message found');
        return;
      }
      
      // 提取文本
      const contentEl = lastMsg.querySelector('.markdown-viewer') || 
                        lastMsg.querySelector('.bubble .content') ||
                        lastMsg.querySelector('.bubble') || lastMsg;
      const text = contentEl.innerText || lastMsg.innerText || '';
      
      // 匹配 Omega 命令
      const match = text.match(/[ΩŒ©]\{[\s\S]*?\}[ΩŒ©]?STOP/);
      if (!match) {
        alert('No Omega command found in last message');
        return;
      }
      
      console.log('[Omega] Found command:', match[0].substring(0, 100) + '...');
      
      // 发送到本地服务器执行
      try {
        const resp = await fetch('http://localhost:7749/exec', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: match[0] })
        });
        const data = await resp.json();
        
        if (data.success) {
          // 填入输入框
          const input = document.querySelector('textarea.chat-input') || document.querySelector('textarea');
          if (input) {
            input.value = data.result;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.focus();
            console.log('[Omega] Result pasted, press Enter to send');
          } else {
            navigator.clipboard.writeText(data.result);
            alert('Result copied to clipboard!');
          }
        } else {
          alert('Execution error: ' + data.error);
        }
      } catch (err) {
        alert('Server error (is omega-server running?): ' + err.message);
      }
    }
  });
  console.log('[Omega] Hotkey Ctrl+Shift+E registered');
})();
