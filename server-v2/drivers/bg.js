// BG Driver - 后台进程管理
// Tools: bg_run, bg_status, bg_kill

import { writeFileSync } from 'fs';
import http from 'http';

let _processManager = null;
let _logger = null;
let _history = null;

async function init(deps) {
  _processManager = deps.processManager;
  _logger = deps.logger;
  _history = deps.history;
  _logger.info('[BG Driver] initialized');
}

async function handle(tool, params, context) {
  const { ws } = context;
  let result;

  if (tool === 'bg_run') {
    _logger.info('[bg_run] params keys: ' + JSON.stringify(Object.keys(params)));
    let bgCommand = params.command;
    if (params.stdinFile) {
      bgCommand = (params.command || 'bash') + ' ' + params.stdinFile;
      _logger.info('[bg_run] using stdinFile: ' + params.stdinFile);
    } else if (params.stdin) {
      const tmpScript = '/private/tmp/bg_run_' + Date.now() + '.sh';
      writeFileSync(tmpScript, params.stdin, { mode: 0o755 });
      bgCommand = (params.command || 'bash') + ' ' + tmpScript;
      _logger.info('[bg_run] stdin -> tmpScript: ' + tmpScript);
    }
    result = _processManager.run(bgCommand, { cwd: params.cwd, shell: params.shell }, (completedSlot) => {
      try {
        ws.send(JSON.stringify({
          type: 'bg_complete',
          tool: 'bg_run',
          slotId: completedSlot.slotId,
          exitCode: completedSlot.exitCode,
          elapsed: completedSlot.elapsed,
          lastOutput: completedSlot.lastOutput,
          success: completedSlot.exitCode === 0
        }));
        _logger.info("[bg_complete] slot=" + completedSlot.slotId);
        // 推送到手机
        try {
          const pStatus = completedSlot.exitCode === 0 ? "✅" : "❌";
          const pMsg = pStatus + " bg_run slot " + completedSlot.slotId + " 完成 (" + (completedSlot.elapsed ? Math.round(completedSlot.elapsed/1000) : "?") + "s) exit=" + completedSlot.exitCode;
          const pData = JSON.stringify({text: pMsg});
          const pReq = http.request({hostname:"localhost",port:8769,path:"/reply",method:"POST",headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(pData)}}, () => {});
          pReq.write(pData);
          pReq.end();
        } catch(pe) { _logger.error("[bg_complete] 推送异常: " + pe.message); }
      } catch (e) {
        _logger.error('[bg_complete] 通知发送失败: ' + e.message);
      }
    });
  } else if (tool === 'bg_status') {
    result = _processManager.status(params.slotId, { lastN: params.lastN });
  } else {
    result = _processManager.kill(params.slotId);
  }

  // handled 模式: driver 自己 ws.send
  const historyId = _history.add(tool, params, result.success, JSON.stringify(result).slice(0, 500), result.success ? null : result.error);
  ws.send(JSON.stringify({
    type: 'tool_result',
    id: context.message.id,
    historyId,
    tool,
    success: result.success,
    result: JSON.stringify(result, null, 2),
    error: result.success ? undefined : result.error
  }));
  return { handled: true };
}

export default {
  name: 'bg',
  tools: ['bg_run', 'bg_status', 'bg_kill'],
  init,
  handle
};
