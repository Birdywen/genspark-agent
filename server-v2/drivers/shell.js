// Shell Driver — run_command/run_process (智能路由到 bg_run)
// Phase 1: 薄 wrapper，核心逻辑仍在 index.js，这里做 trace 包装
// Phase 2: 逐步把 index.js 里的 shell 逻辑迁移过来

import { spawn } from 'child_process';
import { writeFileSync, readFileSync } from 'fs';
import dbApi from '../core/db.js';
import artifactStore from '../core/artifact-store.js';

let _processManager = null;
let _logger = null;
let _addToHistory = null;

function parseDuration(value, fallback = 30000, legacySmallSeconds = false) {
  if (value === undefined || value === null || value === '') return fallback;
  let number;
  let unit = '';
  if (typeof value === 'number') number = value;
  else if (typeof value === 'string') {
    const match = value.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/);
    if (!match) throw new Error('Invalid timeout: ' + value);
    number = Number(match[1]);
    unit = match[2] || '';
  } else throw new Error('Invalid timeout type: ' + typeof value);
  if (!Number.isFinite(number) || number < 0) throw new Error('Invalid timeout: ' + value);
  const factors = { ms: 1, s: 1000, m: 60000, h: 3600000 };
  if (unit) return Math.round(number * factors[unit]);
  if (legacySmallSeconds && number > 0 && number < 1000) return Math.round(number * 1000);
  return Math.round(number);
}

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
  tools: ['run_process', 'run_command', 'shell'],

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
    // timeout_ms 始终按毫秒；timeout 支持显式单位并兼容旧式小整数秒。
    trace.span('shell', { action: 'start', tool, command: params.command });

    // BATCH 模式下 message/ws 可能不存在
    const id = message ? message.id : null;

    let r;
    if (tool === 'run_command' || tool === 'run_process' || tool === 'shell') {
      r = await this._handleRunCommand(params, trace, ws, id, message);
    }

    if (r) { r.handled = true; return r; }

    trace.error('shell', new Error('Unknown shell tool: ' + tool));
    return { success: false, error: 'Unknown tool: ' + tool };
  },

  async _handleRunCommand(params, trace, ws, id, message) {
    trace.span('shell', { action: 'run_command_start', command: params.command });

    // 路由策略 (2026-04-26 反转): 默认前台执行,只有显式 bg:true 才走后台
    // 旧版隐式路由 pip/npm/git clone 等长命令到 bg_run 是 footgun,
    // 导致 stdout 被吞、看不到错误、调试困难。已删除。
    // 长命令请显式: { command:..., bg:true } 或调高 timeout。
    if (params.bg === true && !params._noAutoRoute) {
      trace.span('shell', { action: 'explicit_route_to_bg_run' });
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
      const timeoutMs = params.timeout_ms !== undefined
        ? parseDuration(params.timeout_ms, 30000, false)
        : parseDuration(params.timeout, 30000, true);
      const opts = {
        cwd: params.cwd || '/Users/yay/workspace',
        shell: true,
        detached: process.platform !== 'win32',
        env: params.env ? { ...process.env, ...params.env } : process.env
      };

      const proc = spawn(spawnCmd, args, opts);
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let forceKillTimer = null;
      const killTree = signal => {
        try {
          if (opts.detached && proc.pid) process.kill(-proc.pid, signal);
          else proc.kill(signal);
        } catch (e) {
          try { proc.kill(signal); } catch (_) { /* already exited */ }
        }
      };
      const timeoutTimer = timeoutMs > 0 ? setTimeout(() => {
        timedOut = true;
        killTree('SIGTERM');
        forceKillTimer = setTimeout(() => {
          if (proc.exitCode === null && proc.signalCode === null) killTree('SIGKILL');
        }, 1000);
        forceKillTimer.unref();
      }, timeoutMs) : null;

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

      proc.on('close', (code, signal) => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (forceKillTimer) clearTimeout(forceKillTimer);
        const fullOutput = (stdout + stderr).trim();
        const formatted = artifactStore.formatOutput(stdout, stderr, params.output || params.outputPolicy || {});
        const output = formatted.display;
        // exit code 1 for grep/diff/head/tail = no match, not error
        const cmd0 = (params.command_line || params.command || '').trim().split(/[|;&]/).pop().trim().split(/\s+/)[0].replace(/^.*\//, '');
        const softFail1 = ['grep','egrep','fgrep','diff','head','tail','find','ls'].includes(cmd0);
        const success = !timedOut && (code === 0 || (code === 1 && softFail1));
        const errMsg = success ? null : (timedOut ? `TIMEOUT after ${timeoutMs}ms` : (stderr.trim() || fullOutput || ('exit code ' + code))).slice(0, 500);
        const historyId = _addToHistory('run_process', params, success, output, errMsg);
        if (formatted.artifact) {
          try { dbApi.raw.prepare('UPDATE commands SET content=? WHERE id=?').run(JSON.stringify({ artifact: formatted.artifact, outputPolicy: formatted.policy }), historyId); } catch (_) {}
        }
        trace.span('shell', { action: 'run_command_done', exitCode: code, signal, timedOut, timeoutMs, outputLen: fullOutput.length, displayedLen: output.length, truncated: formatted.truncated });

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
        const response = {
          success, result: output, historyId,
          stdout: formatted.truncated ? artifactStore.previewText(stdout.trim(), formatted.policy) : stdout.trim(),
          stderr: formatted.truncated ? artifactStore.previewText(stderr.trim(), formatted.policy) : stderr.trim(),
          exitCode: code, signal, timedOut, timeoutMs,
          truncated: formatted.truncated,
          outputMode: formatted.policy.mode,
          outputStats: formatted.stats,
          fullOutputRef: formatted.fullOutputRef,
          artifact: formatted.artifact || undefined,
          error: success ? undefined : (timedOut ? `TIMEOUT after ${timeoutMs}ms` : fullOutput || 'exit code ' + code)
        };
        Object.defineProperties(response, {
          _fullOutput: { value: fullOutput, enumerable: false },
          _fullStdout: { value: stdout.trim(), enumerable: false },
          _fullStderr: { value: stderr.trim(), enumerable: false }
        });
        resolve(response);
      });

      proc.on('error', e => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (forceKillTimer) clearTimeout(forceKillTimer);
        trace.error('shell', e);
        const historyId = _addToHistory('run_process', params, false, null, e.message);
        e.historyId = historyId;
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