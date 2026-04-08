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
      const p = (r.result || r.error || '').substring(0, 300);
      text += `**[步骤${i}]** \`${r.tool}\` ${r.success ? '✓' : '✗'}\n\`\`\`\n${p}\n\`\`\`\n\n`;
    });
    return text.trim();
  }
  const s = msg.success ? '✓ 成功' : '✗ 失败';
  const c = (msg.success ? (msg.result || '') : (msg.error || '')).substring(0, 500);
  return `**[执行结果]** \`${msg.tool}\` ${s}:\n\`\`\`\n${c}\n\`\`\``;
}

function createAiBridge({ handleToolCall, taskEngine, logger }) {
  const processed = new Set();
  const bus = new EventEmitter();

  // callTool: 用 proxyWs 拦截 handleToolCall 的 ws.send 输出
  // 对浏览器工具，proxyWs 透传 browserWs 相关调用，只拦截 tool_result
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

      // proxyWs: 拦截 tool_result，其他消息透传给真实 ws
      const proxyWs = {
        send: (data) => {
          try {
            const resp = JSON.parse(data);
            if (resp.type === 'tool_result' && resp.id === callId) {
              setImmediate(() => bus.emit(callId, resp));
              return; // 不转发给真实 ws，避免 background 重复处理
            }
          } catch(e) {}
          // 非 tool_result 消息透传（如 browser_tool_call 等）
          if (realWs && realWs.readyState === 1) {
            realWs.send(data);
          }
        },
        readyState: 1,
        // 代理 on/removeListener 给真实 ws（浏览器工具需要监听 browser_tool_result）
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

  return async function onAiText(ws, msg) {
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
    logger.info(`[AiBridge][${source}] ΩCODE: ${cmd.tool || 'batch(' + cmd.steps?.length + ')'}`);
    ws.send(JSON.stringify({ type: 'inject_status', cid, status: 'executing', detail: cmd.tool || 'batch' }));

    try {
      if (cmd.steps && Array.isArray(cmd.steps)) {
        const results = [];
        for (const step of cmd.steps) {
          const result = await callTool(ws, step.tool, step.params);
          results.push(result);
          ws.send(JSON.stringify({
            type: 'inject_status', cid,
            status: 'step_done',
            step: results.length - 1,
            total: cmd.steps.length,
            tool: step.tool,
            success: result.success
          }));
        }
        ws.send(JSON.stringify({ type: 'inject_result', cid, text: formatResult({ batchResults: results }) }));
      } else {
        const result = await callTool(ws, cmd.tool, cmd.params);
        ws.send(JSON.stringify({ type: 'inject_result', cid, text: formatResult(result) }));
      }
    } catch (e) {
      logger.error(`[AiBridge][${source}] Error:`, e.message);
      ws.send(JSON.stringify({ type: 'inject_result', cid, text: `**[执行错误]** ${e.message}` }));
    }
  };
}

export { createAiBridge, parseOmegaCode, formatResult };
