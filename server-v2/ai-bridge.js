// ai-bridge.js — 通用 AI 文本 → 工具执行桥
import { EventEmitter } from 'events';

const OMEGA = '\u03A9';
const OC_START = OMEGA + 'CODE';
const OC_END = OMEGA + 'CODEEND';

// brace_diag.js — ΩCODE JSON 花括号失衡诊断 (独立测试版)
// 输入: 出错的 body 字符串 + V8 错误位置
// 输出: 人类可读诊断, 指出多了/少了花括号、位置、上下文

function diagBraces(body, v8msg) {
  // 1. 提取 V8 报错位置
  let errPos = -1;
  const m = v8msg.match(/position (\d+)/);
  if (m) errPos = parseInt(m[1], 10);

  // 2. 扫描花括号配对, 记录每个 } 的匹配 { 位置
  const stack = [];      // 存 { 的位置
  const pairs = [];      // [{open, close}]
  const extraCloses = []; // 多余的 } 位置
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '{') stack.push(i);
    else if (c === '}') {
      if (stack.length === 0) extraCloses.push(i);
      else pairs.push({ open: stack.pop(), close: i });
    }
  }
  const unclosed = stack.slice(); // 没闭合的 {

  // 3. 上下文片段
  const ctx = (pos, radius=30) => {
    const s = Math.max(0, pos - radius);
    const e = Math.min(body.length, pos + radius);
    return body.substring(s, e).replace(/\s+/g, ' ').trim();
  };

  // 4. 判断类型
  let kind = 'unknown';
  let detail = '';
  if (extraCloses.length > 0 && unclosed.length === 0) {
    kind = 'extra_close';
    const p = extraCloses[0];
    detail = `多了一个 } 在位置 ${p} (V8 报错 ${errPos}). 上下文: ...${ctx(p)}...`;
  } else if (unclosed.length > 0 && extraCloses.length === 0) {
    kind = 'unclosed';
    const p = unclosed[0];
    detail = `有一个 { 没闭合, 开始于位置 ${p}. 上下文: ...${ctx(p)}...`;
  } else if (extraCloses.length > 0 && unclosed.length > 0) {
    kind = 'mixed';
    detail = `同时有 ${extraCloses.length} 个多余 } 和 ${unclosed.length} 个未闭合 {. 多余 } 最早在位置 ${extraCloses[0]}.`;
  } else {
    kind = 'balanced_but_other';
    detail = `花括号数量平衡 (${pairs.length} 对), 错误可能是引号/逗号/其他. V8 位置 ${errPos}, 上下文: ...${ctx(errPos>=0?errPos:0)}...`;
  }

  return {
    kind,
    detail,
    stats: { openCount: pairs.length + unclosed.length, closeCount: pairs.length + extraCloses.length, pairs: pairs.length, extraCloses: extraCloses.length, unclosed: unclosed.length }
  };
}

function parseOmegaCode(text) {
  let startIdx = -1;
  let searchFrom = 0;
  while (searchFrom < text.length) {
    const idx = text.indexOf(OC_START, searchFrom);
    if (idx === -1) break;
    // 放宽: ΩCODE 前允许行首/换行/空白; ΩCODE 后允许 { / \n / 空格 / 制表符
    const before = idx === 0 ? '\n' : text[idx - 1];
    if (before === '\n' || before === ' ' || before === '\t' || before === '\r') {
      const after = text[idx + OC_START.length];
      if (after === '\n' || after === '{' || after === ' ' || after === '\t' || after === '\r' || after === undefined) { startIdx = idx; break; }
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
    const diag = diagBraces(body, e.message);
    return { error: 'JSON parse: ' + e.message + ' | 花括号诊断: ' + diag.detail, preview: body.substring(0, 200), diag };
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
          logger.warning('[AiBridge] taskEngine missing, fallback to legacy loop (no saveAs/when/template)');
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
    if (!text) {
      logger.warning(`[AiBridge][${source||'?'}] ai_text 收到空 text, cid=${cid}`);
      return;
    }

    const hash = text.length + ':' + text.slice(-80);
    if (processed.has(hash)) {
      logger.warning(`[AiBridge][${source||'?'}] dedup 命中, 跳过 cid=${cid} hash=${hash.slice(0,40)}...`);
      return;
    }
    processed.add(hash);
    setTimeout(() => processed.delete(hash), 30000);

    logger.info(`[AiBridge][${source||'?'}] ai_text 进入解析, cid=${cid} len=${text.length}`);

    const parsed = parseOmegaCode(text);
    if (!parsed) {
      logger.warning(`[AiBridge][${source||'?'}] 文本中未找到 ΩCODE, 跳过 cid=${cid}`);
      return;
    }
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
