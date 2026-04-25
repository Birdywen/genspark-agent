// ai-bridge.js — 通用 AI 文本 → 工具执行桥
import { EventEmitter } from 'events';

const OMEGA = '\u03A9';
const OC_START = OMEGA + 'CODE';
const OC_END = OMEGA + 'CODEEND';

function parseOmegaCode(text) {
  let startIdx = -1;
  let searchFrom = 0;
  while (searchFrom < text.length) {
    const idx = text.indexOf(OC_START, searchFrom);
    if (idx === -1) break;
    if (idx === 0 || text[idx - 1] === '\n') {
      const after = text[idx + OC_START.length];
      if (after === '\n' || after === '{') { startIdx = idx; break; }
    }
    searchFrom = idx + OC_START.length;
  }
  if (startIdx === -1) return null;
  const endIdx = text.indexOf(OC_END, startIdx);
  if (endIdx === -1) return null;
  const headerEnd = text.indexOf('\n', startIdx);
  let body = (headerEnd !== -1 && headerEnd < endIdx)
    ? text.substring(headerEnd + 1, endIdx).trim()
    : text.substring(startIdx + OC_START.length, endIdx).trim();
  body = body.replace(/^`+[\w]*\n?/, '').replace(/\n?`+$/, '').trim();
  try {
    const obj = JSON.parse(body);
    if (obj.tool || obj.steps) return { parsed: obj, startIdx, endIdx: endIdx + OC_END.length };
  } catch (e) {
    return { error: 'JSON parse: ' + e.message, preview: body.substring(0, 200) };
  }
  return null;
}

function formatResult(msg) {
  if (msg.batchResults) {
    const total = msg.batchResults.length;
    const ok = msg.batchResults.filter(r => r.success).length;
    let text = `**[批量执行完成]** ${ok === total ? '✓' : '⚠️'} 成功 (${ok}/${total})\n\n`;
    msg.batchResults.forEach((r, i) => {
      const p = ((v => typeof v === 'string' ? v : JSON.stringify(v, null, 2))(r.result ?? r.error ?? '')).substring(0, 50000);
      text += `**[步骤${i}]** \`${r.tool}\` ${r.success ? '✓' : '✗'}\n\`\`\`\n${p}\n\`\`\`\n\n`;
    });
    return text.trim();
  }
  const s = msg.success ? '✓ 成功' : '✗ 失败';
  const c = ((v => typeof v === 'string' ? v : JSON.stringify(v, null, 2))(msg.success ? (msg.result ?? '') : (msg.error ?? ''))).substring(0, 50000);
  return `**[执行结果]** \`${msg.tool}\` ${s}:\n\`\`\`\n${c}\n\`\`\``;
}

function createAiBridge({ handleToolCall, taskEngine, logger }) {
  const processed = new Set();
  const bus = new EventEmitter();

  // === Last ΩCODE storage for retry ===
  global.__LAST_OMEGA__ = null;

  function callTool(realWs, tool, params) {
    return new Promise((resolve) => {
      const callId = `ai-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
      let resolved = false;
      const timer = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        bus.removeAllListeners(callId);
        resolve({ success: false, error: 'timeout (60s)', tool });
      }, 60000);

      bus.once(callId, (resp) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        resolve(resp);
      });

      const proxyWs = {
        send: (data) => {
          try {
            const resp = JSON.parse(data);
            if (resp.type === 'tool_result' && resp.id === callId) {
              setImmediate(() => bus.emit(callId, resp));
              return;
            }
          } catch(e) {}
          if (realWs && realWs.readyState === 1) {
            realWs.send(data);
          }
        },
        readyState: 1,
        on: realWs.on ? realWs.on.bind(realWs) : () => {},
        removeListener: realWs.removeListener ? realWs.removeListener.bind(realWs) : () => {},
        once: realWs.once ? realWs.once.bind(realWs) : () => {}
      };

      handleToolCall(proxyWs, { type: 'tool_call', tool, params: params || {}, id: callId })
        .catch((e) => {
          if (resolved) return;
          resolved = true;
          clearTimeout(timer);
          bus.removeAllListeners(callId);
          resolve({ success: false, error: e.message, tool });
        });
    });
  }

  // === Execute a parsed ΩCODE command ===
  // v4 (2026-04-25): batch 走 taskEngine.executeBatch — 启用 saveAs/when/模板/forEach/retry/onError
  async function executeCmd(ws, cmd, cid, source) {
    logger.info(`[AiBridge][${source}] ΩCODE: ${cmd.tool || 'batch(' + cmd.steps?.length + ')'}`); 
    ws.send(JSON.stringify({ type: 'inject_status', cid, status: 'executing', detail: cmd.tool || 'batch' }));

    try {
      if (cmd.steps && Array.isArray(cmd.steps)) {
        if (!taskEngine) {
          // 降级到旧循环（无控制流）
          logger.warn('[AiBridge] taskEngine missing, fallback to legacy loop (no saveAs/when/template)');
          const results = [];
          for (const step of cmd.steps) {
            const result = await callTool(ws, step.tool, step.params);
            results.push(result);
            ws.send(JSON.stringify({ type:'inject_status', cid, status:'step_done', step:results.length-1, total:cmd.steps.length, tool:step.tool, success:result.success }));
          }
          const text = formatResult({ batchResults: results });
          ws.send(JSON.stringify({ type:'inject_result', cid, text }));
          return text;
        }

        const batchId = `omega_${cid || Date.now()}_${Math.random().toString(36).slice(2,8)}`;
        const total = cmd.steps.length;
        const onStepComplete = (r) => {
          ws.send(JSON.stringify({
            type: 'inject_status', cid,
            status: r.skipped ? 'step_skipped' : 'step_done',
            step: r.stepIndex,
            total,
            tool: r.tool || r.type,
            success: r.success !== false,
            skipped: !!r.skipped,
            reason: r.reason || undefined
          }));
        };

        const batchResult = await taskEngine.executeBatch(
          batchId,
          cmd.steps,
          { stopOnError: cmd.stopOnError !== false, retry: cmd.retry, onError: cmd.onError, maxConcurrency: cmd.maxConcurrency },
          onStepComplete
        );

        // 标准化为 formatResult 期望的形状
        const batchResults = (batchResult.results || []).map(r => ({
          success: r.success !== false && !r.skipped,
          skipped: !!r.skipped,
          tool: r.tool || r.type,
          result: r.result !== undefined ? r.result : (r.output || ''),
          error: r.error || (r.skipped ? `skipped: ${r.reason||r.when||'condition'}` : ''),
          raw: r
        }));
        const text = formatResult({ batchResults, summary: { ok: batchResult.stepsCompleted, fail: batchResult.stepsFailed, skip: batchResult.stepsSkipped, total: batchResult.totalSteps } });
        ws.send(JSON.stringify({ type: 'inject_result', cid, text }));
        return text;
      } else {
        const result = await callTool(ws, cmd.tool, cmd.params);
        const text = formatResult(result);
        ws.send(JSON.stringify({ type: 'inject_result', cid, text }));
        return text;
      }
    } catch (e) {
      logger.error(`[AiBridge][${source}] Error:`, e.message);
      const text = `**[执行错误]** ${e.message}`;
      ws.send(JSON.stringify({ type: 'inject_result', cid, text }));
      return text;
    }
  }

  // === Main handler for ai_text ===
  async function onAiText(ws, msg) {
    const { text, source, cid } = msg;
    if (!text) return;

    const hash = text.length + ':' + text.slice(-80);
    if (processed.has(hash)) return;
    processed.add(hash);
    setTimeout(() => processed.delete(hash), 30000);

    const parsed = parseOmegaCode(text);
    if (!parsed) return;
    if (parsed.error) {
      logger.error(`[AiBridge][${source}] ${parsed.error}`);
      ws.send(JSON.stringify({ type: 'inject_result', cid, text: `**[ΩCODE 解析错误]** ${parsed.error}` }));
      return;
    }

    const cmd = parsed.parsed;

    // Store for retry
    global.__LAST_OMEGA__ = {
      cmd,
      source: source || 'unknown',
      cid,
      rawText: text,
      timestamp: Date.now()
    };

    await executeCmd(ws, cmd, cid, source || 'ai');
  }

  // === Retry last ΩCODE ===
  async function retryLast(ws, msg) {
    const last = global.__LAST_OMEGA__;
    if (!last) {
      ws.send(JSON.stringify({ type: 'inject_result', cid: msg.cid, text: '**[Retry]** 没有可重试的 ΩCODE' }));
      return;
    }
    const age = Date.now() - last.timestamp;
    logger.info(`[AiBridge] Retrying last ΩCODE (${last.cmd.tool || 'batch'}, age: ${Math.round(age/1000)}s)`);
    await executeCmd(ws, last.cmd, msg.cid || last.cid, 'retry');
  }

  onAiText.retryLast = retryLast;
  return onAiText;
}

export { createAiBridge, parseOmegaCode, formatResult };
