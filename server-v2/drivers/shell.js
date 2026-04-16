// Shell Driver — run_command/run_process (智能路由到 bg_run)
// Phase 1: 薄 wrapper，核心逻辑仍在 index.js，这里做 trace 包装
// Phase 2: 逐步把 index.js 里的 shell 逻辑迁移过来

import { spawn } from 'child_process';
import { writeFileSync, readFileSync } from 'fs';
import dbApi from '../core/db.js';

let _processManager = null;
let _logger = null;
let _addToHistory = null;

function _getRecentSuccess(tool, limit, failedParams) {
  try {
    var keywords = [];
    var ps = typeof failedParams === 'string' ? failedParams : JSON.stringify(failedParams || {});
    var paths = ps.match(/\/[\w\-\.\/]+/g);
    if (paths) paths.forEach(function(p) { var base = p.split('/').pop(); if (base && base.length > 2) keywords.push(base); });
    var cmds = ps.match(/(?:grep|sed|awk|find|ls|cat|head|tail|wc|diff|md5|curl|node|python3?)\b/g);
    if (cmds) cmds.forEach(function(c) { if (keywords.indexOf(c) === -1) keywords.push(c); });
    var rows = [];
    if (keywords.length > 0) {
      var where = keywords.map(function(k) { return "params LIKE '%" + k.replace(/'/g,"''") + "%'"; }).join(' OR ');
      rows = dbApi.query("SELECT id, timestamp, substr(params,1,200) as p, substr(result_preview,1,150) as r FROM commands WHERE tool='" + tool + "' AND success=1 AND (" + where + ") ORDER BY id DESC LIMIT " + (limit || 3));
    }
    if (rows.length > 0) return '\n\n[历史成功记录 - ' + tool + ' (关键词: ' + keywords.join(',') + ')]\n' + rows.map(function(r) { return '#' + r.id + ' ' + r.timestamp + ' | params: ' + r.p + ' | result: ' + (r.r || ''); }).join('\n');
  } catch(e) { /* ignore */ }
  return '';
}

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

    // BATCH 模式下 message/ws 可能不存在
    const id = message ? message.id : null;

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
    const isLong = longPatterns.some(p => p.test(cmd));

    if (isLong && !params._noAutoRoute && !params.no_bg) {
      trace.span('shell', { action: 'auto_route_to_bg_run', reason: 'long_command' });
      params._noAutoRoute = true;
      const bgDriver = (await import('./bg.js')).default;
      return bgDriver.handle('bg_run', params, { trace, ws, message });
    }

    // 自动修复: node /private/tmp/xxx.js -> cp到cwd (require需要node_modules)
    const cmdLine = params.command_line || params.command || '';
    const tmpNodeMatch = cmdLine.match(/\bnode\s+(\/private\/tmp\/[\w._-]+\.(?:js|cjs|mjs))/);
    if (tmpNodeMatch && cmdLine.includes('cd ')) {
      const tmpPath = tmpNodeMatch[1];
      const fileName = tmpPath.split('/').pop();
      const cwdMatch = cmdLine.match(/cd\s+([^&;|]+)/);
      if (cwdMatch) {
        const targetDir = cwdMatch[1].trim().replace(/~/g, '/Users/yay');
        const targetPath = targetDir + '/' + fileName;
        try {
          const fs = require('fs');
          fs.copyFileSync(tmpPath, targetPath);
          params.command_line = cmdLine.replace(tmpPath, targetPath) + ' ; rm -f ' + targetPath;
          if (params.command) params.command = params.command_line;
          trace.span('shell', { action: 'auto_cp_tmp_script', from: tmpPath, to: targetPath });
        } catch(e) { /* ignore */ }
      }
    }

    // 普通执行: spawn
    return new Promise((resolve, reject) => {
      const spawnCmd = params.command || 'bash';
      // 兼容: content.js 解析器把 freeLines 放到 params.code，转为 stdin
      if (params.code && !params.stdin) { params.stdin = params.code; }
      const args = [];
      // timeout 单位修正: <1000 视为秒，自动转毫秒
      let timeoutMs = params.timeout || 30000;
      if (timeoutMs > 0 && timeoutMs < 1000) timeoutMs = timeoutMs * 1000;
      const opts = {
        cwd: params.cwd || '/Users/yay/workspace',
        shell: true,
        timeout: timeoutMs
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
        // exit code 1 for grep/diff/head/tail = no match, not error
        const cmd0 = (params.command_line || params.command || '').trim().split(/[|;&]/).pop().trim().split(/\s+/)[0].replace(/^.*\//, '');
        const softFail1 = ['grep','egrep','fgrep','diff','head','tail','find','ls'].includes(cmd0);
        const success = code === 0 || (code === 1 && softFail1) || (code === null && output.length > 0);  // null=timeout-killed but output received
        const historyId = _addToHistory('run_process', params, success, output.slice(0, 200));
        trace.span('shell', { action: 'run_command_done', exitCode: code, outputLen: output.length });

        if (ws && id) {
          const historyHint = !success ? _getRecentSuccess('run_process', 3, params) : '';
          const resultMsg = '[#' + historyId + '] ' + code + '\n' + output + historyHint;
          if (success) {
            ws.send(JSON.stringify({
              type: 'tool_result', id, historyId, tool: 'run_process',
              success: true, result: resultMsg
            }));
          } else {
            ws.send(JSON.stringify({
              type: 'tool_result', id, historyId, tool: 'run_process',
              success: false, error: resultMsg, result: resultMsg
            }));
          }
        }
        resolve({ success, result: output, exitCode: code, error: success ? undefined : output || 'exit code ' + code });
      });

      proc.on('error', e => {
        trace.error('shell', e);
        const historyId = _addToHistory('run_process', params, false, null, e.message);
        if (ws && id) {
          ws.send(JSON.stringify({
            type: 'tool_result', id, historyId, tool: 'run_process',
            success: false, error: e.message + _getRecentSuccess('run_process', 3, params)
          }));
        }
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