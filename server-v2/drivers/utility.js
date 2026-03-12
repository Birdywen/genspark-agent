// Utility Driver — _metrics, replay, delay_run
// 独立小工具，不走 MCP

let _metrics = null;
let _history = null;
let _processManager = null;
let _handleToolCall = null;
let _logger = null;

export default {
  name: 'utility',
  tools: ['_metrics', 'replay', 'delay_run'],

  init(deps) {
    _metrics = deps.metrics;
    _history = deps.history;
    _processManager = deps.processManager;
    _handleToolCall = deps.handleToolCall;
    _logger = deps.logger || console;
  },

  async handle(tool, params, ctx) {
    const { ws, message } = ctx;
    const id = message?.id;

    if (tool === '_metrics') {
      return this._handleMetrics(id, ws);
    } else if (tool === 'replay') {
      return this._handleReplay(id, params, ws, message);
    } else if (tool === 'delay_run') {
      return this._handleDelayRun(id, params, ws);
    }
  },

  _handleMetrics(id, ws) {
    const summary = _metrics ? _metrics.getSummary() : {};
    const top = _metrics ? _metrics.getTopTools() : [];
    ws.send(JSON.stringify({ type: 'tool_result', id, tool: '_metrics', success: true, result: JSON.stringify({ summary, top }, null, 2) }));
    return { handled: true };
  },

  async _handleReplay(id, params, ws, message) {
    const targetId = parseInt(params.id || params.historyId);
    if (!targetId) {
      ws.send(JSON.stringify({ type: 'tool_result', id, tool: 'replay', success: false, error: 'replay 需要 id 参数（历史命令 ID）' }));
      return { handled: true };
    }
    const entry = _history.getById(targetId);
    if (!entry) {
      ws.send(JSON.stringify({ type: 'tool_result', id, tool: 'replay', success: false, error: `找不到历史命令 #${targetId}` }));
      return { handled: true };
    }
    _logger.info(`[replay] 重放历史命令 #${targetId}: ${entry.tool}`);
    const replayMsg = { type: 'tool_call', id, tool: entry.tool, params: { ...entry.params } };
    if (entry.tool === 'run_process' && entry.params.command_line === 'bash' && entry.params.stdin) {
      replayMsg.tool = 'run_command';
      replayMsg.params = { command: 'bash', stdin: entry.params.stdin };
      if (entry.params.cwd) replayMsg.params.cwd = entry.params.cwd;
    }
    await _handleToolCall(ws, replayMsg, true, targetId);
    return { handled: true };
  },

  _handleDelayRun(id, params, ws) {
    const delay = parseInt(params.delay || params.seconds || 0) * 1000;
    const command = params.command;
    if (!command) {
      ws.send(JSON.stringify({ type: 'tool_result', id, tool: 'delay_run', success: false, error: 'delay_run 需要 command 参数' }));
      return { handled: true };
    }
    if (delay > 600000) {
      ws.send(JSON.stringify({ type: 'tool_result', id, tool: 'delay_run', success: false, error: '延迟不能超过 600 秒' }));
      return { handled: true };
    }
    const historyId = _history.add('delay_run', params, true, null, null);
    _logger.info(`[delay_run] ${delay/1000}s 后执行: ${command.substring(0, 100)}`);

    ws.send(JSON.stringify({
      type: 'tool_result', id, historyId, tool: 'delay_run',
      success: true,
      result: `[#${historyId}] 已安排 ${delay/1000}s 后执行，将以 bg_run 方式运行`
    }));

    setTimeout(() => {
      const result = _processManager.run(command, { cwd: params.cwd }, (completedSlot) => {
        try {
          ws.send(JSON.stringify({
            type: 'bg_complete', tool: 'delay_run',
            slotId: completedSlot.slotId, exitCode: completedSlot.exitCode,
            elapsed: completedSlot.elapsed, lastOutput: completedSlot.lastOutput,
            success: completedSlot.exitCode === 0
          }));
        } catch (e) { _logger.error('[delay_run] 完成通知失败: ' + e.message); }
      });
      _logger.info(`[delay_run] 延迟 ${delay/1000}s 到期，bg_run 启动: slot=${result.slotId || '?'}`);
      try {
        ws.send(JSON.stringify({
          type: 'tool_result', id: 'delay_run_started_' + historyId,
          tool: 'delay_run', success: true,
          result: `[delay_run #${historyId}] 延迟到期，已启动 bg_run: ${JSON.stringify(result)}`
        }));
      } catch(e) {}
    }, delay);
    return { handled: true };
  }
};
