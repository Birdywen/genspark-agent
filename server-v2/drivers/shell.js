// Shell Driver — run_command/run_process (智能路由到 bg_run)
// Phase 1: 薄 wrapper，核心逻辑仍在 index.js，这里做 trace 包装
// Phase 2: 逐步把 index.js 里的 shell 逻辑迁移过来

import { spawn } from 'child_process';
import { writeFileSync, readFileSync } from 'fs';

let _processManager = null;
let _logger = null;
let _addToHistory = null;

export default {
  name: 'shell',
  tools: ['run_process'],

  async init(deps) {
    if (deps) {
      _processManager = deps.processManager;
      _logger = deps.logger;
      _addToHistory = deps.addToHistory;
    }
  },

  async handle(tool, params, context) {
    const { trace, ws, message } = context;
    // 兼容 alias 转换: run_command{command,stdin} → run_process{command_line,mode,stdin}
    if (params.command_line && !params.command) params.command = params.command_line;
    if (params.timeout_ms && !params.timeout) params.timeout = params.timeout_ms;
    trace.span('shell', { action: 'start', tool, command: params.command });

    const id = message.id;

    let r;
    if (tool === 'run_command' || tool === 'run_process') {
      r = await this._handleRunCommand(params, trace, ws, id, message);
    }

    if (r) return { handled: true, ...r };

    trace.error('shell', new Error('Unknown shell tool: ' + tool));
    return { success: false, error: 'Unknown tool: ' + tool };
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
      const bgDriver = (await import('./bg.js')).default;
      return bgDriver.handle('bg_run', params, { trace, ws, message });
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
          const content = readFileSync(params.stdinFile, 'utf8');
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
        const historyId = _addToHistory('run_process', params, success, output.slice(0, 200));
        trace.span('shell', { action: 'run_command_done', exitCode: code, outputLen: output.length });

        ws.send(JSON.stringify({
          type: 'tool_result', id, historyId, tool: 'run_process',
          success, result: '[#' + historyId + '] ' + code + '\n' + output
        }));
        resolve({ success, result: output, exitCode: code });
      });

      proc.on('error', e => {
        trace.error('shell', e);
        const historyId = _addToHistory('run_process', params, false, null, e.message);
        ws.send(JSON.stringify({
          type: 'tool_result', id, historyId, tool: 'run_process',
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