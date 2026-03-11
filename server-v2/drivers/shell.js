// Shell Driver — run_command, bg_run, bg_status, bg_kill
// Phase 1: 薄 wrapper，核心逻辑仍在 index.js，这里做 trace 包装
// Phase 2: 逐步把 index.js 里的 shell 逻辑迁移过来

import { spawn } from 'child_process';
import { writeFileSync } from 'fs';

let _processManager = null;
let _logger = null;
let _addToHistory = null;

export default {
  name: 'shell',
  tools: ['run_command', 'bg_run', 'bg_status', 'bg_kill'],

  async init(deps) {
    if (deps) {
      _processManager = deps.processManager;
      _logger = deps.logger;
      _addToHistory = deps.addToHistory;
    }
  },

  async handle(tool, params, trace, ws, message) {
    trace.span('shell', { action: 'start', tool, command: params.command || params.command_line });

    const id = message.id;

    if (tool === 'bg_run') {
      return this._handleBgRun(params, trace, ws, id);
    } else if (tool === 'bg_status') {
      return this._handleBgStatus(params, trace, ws, id);
    } else if (tool === 'bg_kill') {
      return this._handleBgKill(params, trace, ws, id);
    } else if (tool === 'run_command') {
      return this._handleRunCommand(params, trace, ws, id, message);
    }

    trace.error('shell', new Error('Unknown shell tool: ' + tool));
    return { success: false, error: 'Unknown tool: ' + tool };
  },

  _handleBgRun(params, trace, ws, id) {
    trace.span('shell', { action: 'bg_run_start' });
    const historyId = _addToHistory('bg_run', params, true, null, null);

    let bgCommand = params.command;
    if (params.stdinFile) {
      bgCommand = (params.command || 'bash') + ' ' + params.stdinFile;
    } else if (params.stdin) {
      const tmpScript = '/private/tmp/bg_run_' + Date.now() + '.sh';
      writeFileSync(tmpScript, params.stdin, { mode: 0o755 });
      bgCommand = (params.command || 'bash') + ' ' + tmpScript;
    }

    const result = _processManager.run(bgCommand, { cwd: params.cwd, shell: params.shell });
    trace.span('shell', { action: 'bg_run_done', slotId: result.slotId, success: result.success });

    ws.send(JSON.stringify({
      type: 'tool_result', id, historyId, tool: 'bg_run',
      success: result.success,
      result: JSON.stringify(result, null, 2),
      error: result.success ? undefined : result.error
    }));
    return result;
  },

  _handleBgStatus(params, trace, ws, id) {
    trace.span('shell', { action: 'bg_status' });
    const historyId = _addToHistory('bg_status', params, true, null, null);
    const lastN = parseInt(params.lastN || params.lastn || params.last || 0);
    const status = _processManager.status();
    let result = status;
    if (lastN > 0) {
      result = status.map(s => {
        if (s.lastOutput) {
          const lines = s.lastOutput.split('\n');
          s.lastOutput = lines.slice(-lastN).join('\n');
        }
        return s;
      });
    }
    const resultStr = JSON.stringify(result, null, 2);
    trace.span('shell', { action: 'bg_status_done', slots: result.length });

    ws.send(JSON.stringify({
      type: 'tool_result', id, historyId, tool: 'bg_status',
      success: true, result: resultStr
    }));
    return result;
  },

  _handleBgKill(params, trace, ws, id) {
    trace.span('shell', { action: 'bg_kill', slotId: params.slotId });
    const historyId = _addToHistory('bg_kill', params, true, null, null);
    const result = _processManager.kill(params.slotId || params.slot);
    trace.span('shell', { action: 'bg_kill_done', success: result.success });

    ws.send(JSON.stringify({
      type: 'tool_result', id, historyId, tool: 'bg_kill',
      success: result.success,
      result: JSON.stringify(result, null, 2)
    }));
    return result;
  },

  async _handleRunCommand(params, trace, ws, id, message) {
    trace.span('shell', { action: 'run_command_start', command: params.command });

    // 智能路由: 长命令/sleep → bg_run
    const cmd = (params.command || '').toLowerCase();
    const longPatterns = [
      /\bpip3?\s+install\b/, /\bnpm\s+install\b/, /\bnpm\s+ci\b/,
      /\byarn\s+(install|add)\b/, /\bbrew\s+install\b/, /\bcargo\s+build\b/,
      /\bgit\s+clone\b/, /\bdocker\s+(build|pull)\b/, /\bdemucs\b/,
      /\bwhisper\b/, /\bnohup\b/, /\bscp\s+-/, /\brsync\b/
    ];
    const hasSleep = /\bsleep\s+\d/.test(cmd) || (params.stdin && /\bsleep\s+\d/.test(params.stdin));
    const isLong = longPatterns.some(p => p.test(cmd));

    if ((isLong || hasSleep) && !params._noAutoRoute) {
      trace.span('shell', { action: 'auto_route_to_bg_run', reason: hasSleep ? 'sleep' : 'long_command' });
      params._noAutoRoute = true;
      return this._handleBgRun(params, trace, ws, id);
    }

    // 普通执行: spawn
    return new Promise((resolve, reject) => {
      const spawnCmd = params.command || 'bash';
      const args = [];
      const opts = {
        cwd: params.cwd || '/Users/yay/workspace',
        shell: true,
        timeout: params.timeout || 30000
      };

      const proc = spawn(spawnCmd, args, opts);
      let stdout = '';
      let stderr = '';

      if (params.stdin) proc.stdin.write(params.stdin);
      if (params.stdinFile) {
        try {
          const content = require('fs').readFileSync(params.stdinFile, 'utf8');
          proc.stdin.write(content);
        } catch (e) {
          trace.error('shell', e);
        }
      }
      proc.stdin.end();

      proc.stdout.on('data', d => { stdout += d; });
      proc.stderr.on('data', d => { stderr += d; });

      proc.on('close', code => {
        const output = (stdout + stderr).trim();
        const success = code === 0;
        const historyId = _addToHistory('run_command', params, success, output.slice(0, 200));
        trace.span('shell', { action: 'run_command_done', exitCode: code, outputLen: output.length });

        ws.send(JSON.stringify({
          type: 'tool_result', id, historyId, tool: 'run_command',
          success, result: '[#' + historyId + '] ' + code + '\n' + output
        }));
        resolve({ success, result: output, exitCode: code });
      });

      proc.on('error', e => {
        trace.error('shell', e);
        const historyId = _addToHistory('run_command', params, false, null, e.message);
        ws.send(JSON.stringify({
          type: 'tool_result', id, historyId, tool: 'run_command',
          success: false, error: e.message
        }));
        reject(e);
      });
    });
  },

  async healthCheck() {
    return { ok: true, processManager: !!_processManager };
  },

  async shutdown() {
    if (_processManager) _processManager.killAll();
  }
};