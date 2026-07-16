// Genspark Agent Server v2 - 整合版
// MCP Hub + 安全检查 + 日志记录 + Skills 系统 + 命令重试


// Load .env into process.env (no dotenv dependency)
import { readFileSync as _readEnv } from 'fs';
import { dirname as _dirEnv, join as _joinEnv } from 'path';
import { fileURLToPath as _urlEnv } from 'url';
try {
  const _envPath = _joinEnv(_dirEnv(_urlEnv(import.meta.url)), '.env');
  _readEnv(_envPath, 'utf-8').split('\n').forEach(line => {
    line = line.trim();
    if (!line || line.startsWith('#')) return;
    const eq = line.indexOf('=');
    if (eq > 0) {
      const key = line.slice(0, eq).trim();
      const val = line.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  });
} catch(e) { /* .env not found, skip */ }

import { WebSocketServer } from 'ws';
import { spawn, exec, execSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import Logger from './logger.js';
import Safety from './safety.js';
import SkillsManager from './skills.js';
import HealthChecker from './health-checker.js';
import ErrorClassifier from './error-classifier.js';
import RetryManager from './retry-manager.js';
import TaskEngine from './task-engine.js';
import Recorder from './recorder.js';
import SelfValidator from './self-validator.js';
import GoalManager from './goal-manager.js';
import AsyncExecutor from './async-executor.js';
import AutoHealer from './auto-healer.js';
import { createAiBridge } from './ai-bridge.js';
import http from "http";
import ProcessManager from './process-manager.js';
import { existsSync } from 'fs';
import Router from "./core/router.js";
import Metrics from "./core/metrics.js";
import { resolvePayloadFiles, decodeBase64Fields, parseParams, autoScript, sshFix, resolveTimeout, parseResult, sendSuccess, sendError } from './core/pipeline.js';
import { resolve as resolveAlias } from "./core/alias.js";
import { semanticizeCandidates } from "./core/semantic-compressor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import { MCPHub, expandEnvVars } from './core/mcp-hub.js';
import { isSysTool, isBrowserTool, isBrowserNative, getSysHandler, sysToolNames, buildBrowserToolCode } from './sys-tools.js';

// 合并 MCP tools + custom tools 的完整列表
function getAllTools() {
  const customDefs = sysToolNames.map(name => ({ name, description: `[sys] ${name}` }));
  return [...(hub?.tools || []), ...customDefs];
}

const config = expandEnvVars(JSON.parse(readFileSync(path.join(__dirname, 'config.json'), 'utf-8')));

// 初始化日志和安全模块
const logger = new Logger(config.logging);
const safety = new Safety(config.safety, logger);

// 初始化 Skills 管理器
const skillsManager = new SkillsManager();
skillsManager.load();

// 初始化健康检查器
const healthChecker = new HealthChecker(logger);

// 初始化错误分类器
const errorClassifier = new ErrorClassifier();

// ==================== 跨扩展通信 ====================
// agentId -> { ws, site, lastSeen }

// ==================== 命令历史管理 ====================
import history from "./core/history.js";
import dbApi from './core/db.js';
import agents from './core/agents.js';
import { createHandlers } from './core/ws-handlers.js';
//import teamsAgent from './teams-agent.js';
// 命令历史管理已提取到 core/history.js

// ==================== Agents 注册表 ====================
function loadAgents() {
  const agentsPath = path.join(__dirname, '../.agent_hub/agents.json');
  const altPath = '/Users/yay/workspace/.agent_hub/agents.json';
  
  const filePath = existsSync(agentsPath) ? agentsPath : (existsSync(altPath) ? altPath : null);
  
  if (!filePath) {
    logger.warning('agents.json 未找到');
    return { agents: {} };
  }
  
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    logger.info(`加载了 ${Object.keys(data.agents || {}).length} 个 Agent 配置`);
    return data;
  } catch (e) {
    logger.error('读取 agents.json 失败: ' + e.message);
    return { agents: {} };
  }
}

const agentsData = loadAgents();

// 存储连接的客户端
const clients = new Set();
const browserToolPending = new Map(); // 浏览器工具的 pending Promise 管理（模块级，供 handleToolCall 访问）

// 广播消息
function broadcast(message) {
  const data = typeof message === 'string' ? message : JSON.stringify(message);
  clients.forEach(client => {
    if (client.readyState === 1) client.send(data);
  });
}

const hub = new MCPHub({ config, configPath: path.join(__dirname, 'config.json'), logger });

// 初始化重试管理器
const retryManager = new RetryManager(logger, errorClassifier);

// TaskEngine 将在 main() 中 hub.start() 后初始化
let taskEngine = null;
let autoHealer = null;
let router = null;
let metrics = null;

// 初始化录制器
const recorder = new Recorder(logger, path.join(__dirname, 'recordings'));

// 初始化后台进程管理器
const processManager = new ProcessManager();

// ==================== 工具调用处理（含历史记录）====================
// 工具别名映射 → 已迁移到 core/alias.js

function resolveMessageSessionId(message = {}) {
  return message.session_id || message.sessionId || message.conversation_id || message.conversationId || null;
}

async function handleToolCall(ws, message, isRetry = false, originalId = null) {
  const _sessionId = resolveMessageSessionId(message);
  if (history && typeof history.runWithSession === 'function') {
    return history.runWithSession(_sessionId, () => handleToolCallInner(ws, message, isRetry, originalId));
  }
  return handleToolCallInner(ws, message, isRetry, originalId);
}

async function handleToolCallInner(ws, message, isRetry = false, originalId = null) {
  let { tool, params, id } = message;

  // Store for retry (skip retry calls themselves to avoid loop)
  if (!id || !id.startsWith('retry-')) {
    global.__LAST_TOOL_CALL__ = { tool, params, timestamp: Date.now() };
  }

  // ── 自定义 Tool 拦截（不走 MCP）──
  logger.info(`[handleToolCall] tool=${tool} isSysTool=${isSysTool(tool)} isBrowserTool2=${isBrowserTool(tool)} isBrowserNative2=${isBrowserNative(tool)}`);
  if (isSysTool(tool)) {
    const _cStart = Date.now();
    try {
      if (isBrowserTool(tool)) {
        // browser-side tool（如 gen_image）通过 forwardToBrowser 执行
        const browserCode = buildBrowserToolCode(tool, params);
        forwardToBrowser(ws, clients, browserToolPending, logger, {
          msg: message, resultType: 'browser_eval_result',
          tool: 'eval_js', params: { code: browserCode }, timeout: 90000
        });
        return;
      }
      if (isBrowserNative(tool)) {
        // 浏览器原生工具 (eval_js/list_tabs/take_screenshot) - 直接转发给 background.js
        logger.info(`[BrowserNative] 转发 ${tool} to browser`);
        forwardToBrowser(ws, clients, browserToolPending, logger, {
          msg: message, resultType: 'tool_result',
          tool, params, timeout: tool === 'eval_js' ? 90000 : 30000
        });
        return;
      }
      const handler = getSysHandler(tool);
      // evalInBrowser: 发 eval_js 给浏览器，返回 Promise<string>
      const evalInBrowser = (jsCode, timeoutMs) => new Promise((resolve, reject) => {
        const callId = 'eval_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        const timer = setTimeout(() => {
          browserToolPending.delete(callId);
          reject(new Error('evalInBrowser timeout ' + (timeoutMs/1000) + 's'));
        }, timeoutMs || 10000);
        browserToolPending.set(callId, {
          resolve: (r) => { clearTimeout(timer); browserToolPending.delete(callId); resolve(r); },
          reject: (e) => { clearTimeout(timer); browserToolPending.delete(callId); reject(e); },
          timeout: timer, _tool: 'eval_js', _code: jsCode.substring(0, 500)
        });
        if (global._browserWs && global._browserWs.readyState === 1) {
          global._browserWs.send(JSON.stringify({ type: 'browser_tool_call', callId, tool: 'eval_js', params: { code: jsCode } }));
        } else {
          reject(new Error('浏览器扩展未连接'));
        }
      });
      const result = await handler(params, { evalInBrowser });
      const resultStr = typeof result.result === "string" ? result.result : JSON.stringify(result.result); const historyId = history.add(tool, params, result.success, resultStr, result.error);
      ws.send(JSON.stringify({
        type: 'tool_result', id, historyId, tool,
        success: result.success,
        result: typeof result.result === 'string' ? result.result : JSON.stringify(result.result),
        error: result.error
      }));
    } catch(e) {
      const historyId = history.add(tool, params, false, null, e.message);
      ws.send(JSON.stringify({ type: 'tool_result', id, historyId, tool, success: false, error: e.message }));
    }
    return;
  }

  // ── metrics 查询快捷入口 ──
  // ── Router Phase 2: trace 观察模式 ──
  if (typeof router !== "undefined" && router) {
    const driver = router.handlers.get(tool);
    if (driver) {
      const _routerStart = Date.now(); logger.info("[Router] trace: " + tool + " -> " + driver.name);
    }
  }
  
  // 后台进程管理器 - 直接处理，不走 MCP

  // 智能路由: 识别长时间命令自动走 bg_run
  // 防御性校验: run_command 的 command 不应包含空格（除非是路径）
  // 如果 command 看起来像 "bashecho hello"（参数被拼接），拒绝执行
  // ── 拦截 sos replay/rp 命令：mini terminal 兼容 ──
  if (tool === 'run_command' && params.command) {
    const sosMatch = params.command.match(/\bsos\s+(replay|rp)(?:\s+(\d+))?\s*$/);
    if (sosMatch) {
      const targetId = sosMatch[2] ? parseInt(sosMatch[2]) : null;
      let entry;
      if (targetId) {
        entry = history.getById(targetId);
      } else {
        // 取最后一条可重放命令
        const skipTools = new Set(['bg_status', 'bg_kill', 'replay', 'delay_run']);
        const candidates = history.getRaw().filter(h => !skipTools.has(h.tool));
        entry = candidates.length ? candidates[candidates.length - 1] : null;
      }
      if (!entry) {
        ws.send(JSON.stringify({ type: 'tool_result', id, tool: 'replay', success: false, error: targetId ? `找不到命令 #${targetId}` : '没有可重放的命令' }));
        return;
      }
      logger.info(`[sos replay] 从 mini terminal 触发重放 #${entry.id}: ${entry.tool}`);
      const replayMsg = { type: 'tool_call', id, tool: entry.tool, params: { ...entry.params } };
      if (entry.tool === 'run_process' && entry.params.command_line === 'bash' && entry.params.stdin) {
        replayMsg.tool = 'run_command';
        replayMsg.params = { command: 'bash', stdin: entry.params.stdin };
        if (entry.params.cwd) replayMsg.params.cwd = entry.params.cwd;
      }
      await handleToolCall(ws, replayMsg, true, entry.id);
      return;
    }
  }

  if (tool === 'run_command' && params.command && !params.stdin && !params.stdinFile) {
    const cmd = params.command.trim();
    // 尝试自动修复 SSE 参数损坏
    // 模式1: "bash /path/to/script.sh" 或 "python3 /path/to/script.py" → 直接执行
    const execMatch = cmd.match(/^(bash|sh|python3?|node)\s+(\/\S+)$/);
    const shellCmdMatch = cmd.match(/^cd\s+\S+.*&&/) || cmd.match(/^(ls|pwd|cat|echo|grep|find|which|whoami|date|df|du|ps|top|kill|mkdir|rm|cp|mv|chmod|chown|head|tail|wc|sort|uniq|curl|wget|tar|zip|unzip|env|export|source|lsof|pkill|pgrep)\b/);
    if (execMatch || shellCmdMatch) {
      logger.info(`[自动修复] run_command 无stdin，但命令可执行: ${cmd}`);
      params.command = cmd; // 保持原样，让 run_process 处理
    } else if (cmd.includes(' ') && !cmd.startsWith('/') && !cmd.startsWith('./')) {
      // 模式2: 真正的损坏 - "bashecho hello" 等无法修复的情况
      logger.warning(`[防御] run_command 参数异常: command="${cmd}" 无 stdin，疑似 SSE 传输损坏`);
      const historyId = history.add(tool, params, false, null, '参数损坏: command 和 stdin 被拼接');
      ws.send(JSON.stringify({
        type: 'tool_result', id, historyId, tool,
        success: false,
        error: `[#${historyId}] 参数异常: command="${cmd}" (无stdin)，疑似 SSE 传输损坏，等待重试`
      }));
      return;
    }
  }

  // 别名映射 (via core/alias.js)
  const _aliasResult = resolveAlias(tool, params);
  if (_aliasResult.aliased) {
    logger.info('工具别名: ' + tool + ' → ' + _aliasResult.tool);
    tool = _aliasResult.tool;
    params = _aliasResult.params;
  }
  
  // ── Pipeline 预处理 ──
  params = resolvePayloadFiles(params, logger);
  params = decodeBase64Fields(params, logger);
  params = parseParams(params, logger);
  // ── Router Phase 3: 灰度切流量 ──
  const ROUTER_INTERCEPT = (process.env.ROUTER_INTERCEPT || 'ssh,filesystem,vfs,browser,shell,utility,bg,memory,agent').split(',');
  let _routerHandled = false;
  if (router) {
    const driver = router.handlers.get(tool);
    if (driver && ROUTER_INTERCEPT.includes(driver.name)) {
      logger.info('[Router] INTERCEPT: ' + tool + ' -> ' + driver.name);
      // 去重：同内容 tool_call 10秒内不重复执行
      const dedupeKey = tool + ':' + JSON.stringify(params).substring(0, 500);
      const now = Date.now();
      if (!global._toolDedup) global._toolDedup = new Map();
      const lastRun = global._toolDedup.get(dedupeKey);
      if (lastRun && now - lastRun < 10000) {
        logger.info('[Router] DEDUP: skipping duplicate ' + tool + ' (within 10s)');
        // 静默返回成功，不报错，避免浏览器端显示错误
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'tool_result', id, tool, success: true, result: '[dedup] skipped' }));
        }
        return;
      }
      global._toolDedup.set(dedupeKey, now);
      // 清理旧条目
      if (global._toolDedup.size > 100) {
        for (const [k, t] of global._toolDedup) { if (now - t > 30000) global._toolDedup.delete(k); }
      }
      // 安全检查
      const safetyCheck = await safety.checkOperation(tool, params || {}, broadcast);
      if (!safetyCheck.allowed) {
        const historyId = history.add(tool, params, false, null, safetyCheck.reason);
        sendError(ws, { id, historyId, tool, error: safetyCheck.reason });
        return;
      }
      // 自动脚本化
      params = sshFix(tool, params, logger);
      params = autoScript(tool, params, logger);
      // 超时策略
      const callOptions = resolveTimeout(tool, params, message);
      try {
        const r = await router.dispatch(tool, params, ws, message, callOptions);
        if (r && r.delegate) {
          const browserTools = ['eval_js', 'take_screenshot', 'list_tabs'];
          if (browserTools.includes(tool)) {
            _routerHandled = true;
            const callId = `browser_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const timeoutMs = tool === 'eval_js' ? 90000 : 30000;
            const browserPromise = new Promise((resolve, reject) => {
              const timer = setTimeout(() => { browserToolPending.delete(callId); reject(new Error(`浏览器工具超时 (${timeoutMs/1000}s)`)); }, timeoutMs);
              browserToolPending.set(callId, {
                resolve: (result) => { clearTimeout(timer); browserToolPending.delete(callId); resolve(result); },
                reject: (err) => { clearTimeout(timer); browserToolPending.delete(callId); reject(err); },
                timeout: timer,
                _tool: tool,
                _code: (params && params.code) || ''
              });
              if (browserWs && browserWs.readyState === 1) {
                browserWs.send(JSON.stringify({ type: 'browser_tool_call', callId, tool, params }));
                logger.info(`[BrowserTool] 精准投递 ${tool} (${callId}) -> background.js`);
              } else {
                reject(new Error('浏览器扩展未连接'));
              }
              logger.info(`[Browser-Delegate] 转发 ${tool} callId=${callId} to ${sentCount}/${clients.size} clients`);
            });
            try {
              const browserResult = await browserPromise;
              const resultStr = typeof browserResult === 'string' ? browserResult : JSON.stringify(browserResult);
              const historyId = history.add(tool, params, true, resultStr.substring(0, 5000));
              ws.send(JSON.stringify({ type: 'tool_result', id: message.id, historyId, tool, success: true, result: resultStr }));
            } catch (browserErr) {
              const historyId = history.add(tool, params, false, null, browserErr.message);
              ws.send(JSON.stringify({ type: 'tool_result', id: message.id, historyId, tool, success: false, error: browserErr.message }));
            }
          } else {
            logger.info('[Router] DELEGATE: ' + tool + ' (fallthrough)');
          }
        } else if (r && r.handled) {
          _routerHandled = true;
          history.add(tool, params, true, JSON.stringify(r).slice(0, 5000));
          logger.info('[Router] HANDLED: ' + tool + ' (driver self-sent)');
          // driver 自己处理了 ws.send (如 shell)
        } else if (r && r.browserEval) {
          // VFS 等需要浏览器执行的工具
          _routerHandled = true;
          const historyId = history.add(tool, { slot: params.slot, key: params.key, contentLen: params.content?.length }, true, null, null);
          const vfsCallId = `browser_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const vfsPromise = new Promise((resolve, reject) => {
            const vfsTimeout = setTimeout(() => { browserToolPending.delete(vfsCallId); reject(new Error("浏览器操作超时 (30s)")); }, 30000);
            browserToolPending.set(vfsCallId, { resolve, reject, timeout: vfsTimeout });
            if (browserWs && browserWs.readyState === 1) {
              browserWs.send(JSON.stringify({ type: "browser_tool_call", callId: vfsCallId, tool: "eval_js", params: { code: r.browserEval } }));
            } else {
              reject(new Error('浏览器扩展未连接'));
            }
            logger.info('[browserEval] ' + tool + ' 委托浏览器: ' + vfsCallId);
          });
          try {
            const vfsResult = await vfsPromise;
            sendSuccess(ws, { id, historyId, tool, result: typeof vfsResult === "string" ? vfsResult : JSON.stringify(vfsResult) });
          } catch (vfsErr) {
            sendError(ws, { id, historyId, tool, error: vfsErr.message });
          }
        } else {
          _routerHandled = true;
          let { result, images } = parseResult(r);
          const success = !(r && r.isError);
          // take_snapshot 截断
          if (tool === 'take_snapshot' && result && result.length > 3000) {
            const lines = result.split('\n');
            const maxLines = (params && params.maxElements) || 150;
            if (lines.length > maxLines) {
              result = lines.slice(0, maxLines).join('\n') + '\n\n... (截断，共 ' + lines.length + ' 行，显示前 ' + maxLines + ' 行)';
            }
          }
          // 图片保存
          if (images && images.length > 0) {
            const { writeFileSync } = await import('fs');
            const savedPaths = [];
            for (let i = 0; i < images.length; i++) {
              const img = images[i];
              const ext = img.mimeType === 'image/jpeg' ? 'jpg' : 'png';
              const imgPath = '/private/tmp/media-' + id + '-' + i + '.' + ext;
              try { writeFileSync(imgPath, Buffer.from(img.data, 'base64')); savedPaths.push(imgPath); } catch(ie) { logger.error('[Router] 图片保存失败: ' + ie.message); }
            }
            if (savedPaths.length > 0) result = (result || '') + '\n图片已保存: ' + savedPaths.join(', ');
          }
          // 重试更新
          if (isRetry && originalId) {
            history.updateById(originalId, { success: true, resultPreview: (typeof result === 'string' ? result : JSON.stringify(result ?? '', null, 2)).substring(0, 5000), retriedAt: new Date().toISOString(), error: null });
          }
          const errorMsg = success ? null : (result || r?.error || r?.errorType || '执行失败(无详情)');
          const historyId = isRetry ? originalId : history.add(tool, params, success, (result || '').slice(0, 5000), errorMsg);
          // recorder
          for (const [recId, rec] of (recorder.activeRecordings instanceof Map ? recorder.activeRecordings : [])) {
            if (rec.status === 'recording') {
              recorder.recordStep(recId, { tool, params, result: { success, result: (result || '').slice(0, 5000) }, duration: Date.now() - (message.startTime || Date.now()) });
            }
          }
          if (success) {
            sendSuccess(ws, { id, historyId, tool, result: isRetry ? '[重试 #' + historyId + '] ' + result : result, images });
          } else {
            // 失败时自动附加同名工具最近成功记录（关键词匹配）
            let errorMsg = result;
            try {
              var keywords = [];
              var ps = typeof params === 'string' ? params : JSON.stringify(params || {});
              var paths = ps.match(/\/[\w\-\.\/]+/g);
              if (paths) paths.forEach(p => { var base = p.split('/').pop(); if (base && base.length > 2) keywords.push(base); });
              var recent = [];
              if (keywords.length > 0) {
                var where = keywords.map(k => "params LIKE '%" + k.replace(/'/g,"''") + "%'").join(' OR ');
                recent = dbApi.query("SELECT id, substr(params,1,200) as params_preview, substr(result_preview,1,150) as result_preview, timestamp FROM commands WHERE tool='" + tool + "' AND success=1 AND (" + where + ") ORDER BY id DESC LIMIT 3");
              }
              if (recent.length < 3) {
                var ids = recent.map(r => r.id);
                var exclude = ids.length > 0 ? ' AND id NOT IN (' + ids.join(',') + ')' : '';
                var more = dbApi.query("SELECT id, substr(params,1,200) as params_preview, substr(result_preview,1,150) as result_preview, timestamp FROM commands WHERE tool='" + tool + "' AND success=1" + exclude + " ORDER BY id DESC LIMIT " + (3 - recent.length));
                recent = recent.concat(more);
              }
              if (recent.length > 0) {
                errorMsg += '\n\n[历史成功记录 - ' + tool + (keywords.length ? ' (关键词: ' + keywords.join(',') + ')' : '') + ']\n' + recent.map(r => '#' + r.id + ' ' + r.timestamp + ' | params: ' + r.params_preview + ' | result: ' + (r.result_preview || '')).join('\n');
              }
            } catch(dbErr) { /* ignore db query errors */ }
            sendError(ws, { id, historyId, tool, error: errorMsg });
          }
        }
      } catch(e) {
        _routerHandled = true;
        const classified = errorClassifier.wrapError(e, tool);
        logger.error('[Router] ' + tool + ' failed [' + classified.errorType + ']: ' + e.message);

        // AutoHealer: 尝试自愈
        if (autoHealer && !isRetry) {
          try {
            const healResult = await autoHealer.tryHeal(e.message || String(e), tool, params);
            if (healResult.healed && healResult.retry) {
              const retryTool = healResult.modifiedTool || tool;
              const retryParams = healResult.modifiedParams || params;
              logger.info('[AutoHealer] 自愈: ' + healResult.message + ', 重试 ' + retryTool);
              try {
                const retryCallOptions = resolveTimeout(retryTool, retryParams, message);
                const rr = await router.dispatch(retryTool, retryParams, ws, message, retryCallOptions);
                const { result: retryResult, images: retryImages } = parseResult(rr);
                const retryHistoryId = history.add(retryTool, retryParams, true, (retryResult || '').slice(0, 5000));
                sendSuccess(ws, { id, historyId: retryHistoryId, tool: retryTool, result: '[自愈: ' + healResult.message + '] ' + retryResult, images: retryImages });
                return;
              } catch (retryErr) {
                logger.warning('[AutoHealer] 重试失败: ' + retryErr.message);
              }
            }
            if (healResult.suggestion) {
              classified.suggestion = (classified.suggestion || '') + ' [AutoHealer] ' + healResult.suggestion;
            }
          } catch (healErr) {
            logger.warning('[AutoHealer] 异常: ' + healErr.message);
          }
        }

        // 正常失败流程
        const historyId = isRetry ? originalId : history.add(tool, params, false, null, e.message);
        if (isRetry && originalId) {
          history.updateById(originalId, { retriedAt: new Date().toISOString(), error: e.message, errorType: classified.errorType });
        }
        // recorder
        for (const [recId, rec] of (recorder.activeRecordings instanceof Map ? recorder.activeRecordings : [])) {
          if (rec.status === 'recording') {
            recorder.recordStep(recId, { tool, params, result: { success: false, error: e.message, errorType: classified.errorType }, duration: Date.now() - (message.startTime || Date.now()) });
          }
        }
        // 失败时自动附加同名工具最近成功记录（关键词匹配）
        let catchErrorMsg = e.message;
        try {
          var kw = [];
          var kps = typeof params === 'string' ? params : JSON.stringify(params || {});
          var kpaths = kps.match(/\/[\w\-\.\/]+/g);
          if (kpaths) kpaths.forEach(p => { var base = p.split('/').pop(); if (base && base.length > 2) kw.push(base); });
          var recent2 = [];
          if (kw.length > 0) {
            var wh = kw.map(k => "params LIKE '%" + k.replace(/'/g,"''") + "%'").join(' OR ');
            recent2 = dbApi.query("SELECT id, substr(params,1,200) as params_preview, substr(result_preview,1,150) as result_preview, timestamp FROM commands WHERE tool='" + tool + "' AND success=1 AND (" + wh + ") ORDER BY id DESC LIMIT 3");
          }
          if (recent2.length < 3) {
            var eids = recent2.map(r => r.id);
            var excl = eids.length > 0 ? ' AND id NOT IN (' + eids.join(',') + ')' : '';
            var more2 = dbApi.query("SELECT id, substr(params,1,200) as params_preview, substr(result_preview,1,150) as result_preview, timestamp FROM commands WHERE tool='" + tool + "' AND success=1" + excl + " ORDER BY id DESC LIMIT " + (3 - recent2.length));
            recent2 = recent2.concat(more2);
          }
          if (recent2.length > 0) {
            catchErrorMsg += '\n\n[历史成功记录 - ' + tool + (kw.length ? ' (关键词: ' + kw.join(',') + ')' : '') + ']\n' + recent2.map(r => '#' + r.id + ' ' + r.timestamp + ' | params: ' + r.params_preview + ' | result: ' + (r.result_preview || '')).join('\n');
          }
        } catch(dbErr) { /* ignore */ }
        sendError(ws, { id, historyId, tool, error: catchErrorMsg, errorType: classified.errorType, recoverable: classified.recoverable, suggestion: classified.suggestion });
      }
      if (_routerHandled) return;
    }
  }


}

// ==================== 主函数 ====================

// ── 浏览器工具转发 helper ──
function forwardToBrowser(ws, clients, browserToolPending, logger, { msg, resultType, tool, params, timeout = 30000 }) {
  const callId = `browser_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const timer = setTimeout(() => {
    browserToolPending.delete(callId);
    ws.send(JSON.stringify({ type: resultType, id: msg.id, success: false, error: `超时 (${timeout/1000}s)` }));
  }, timeout);
  browserToolPending.set(callId, {
    resolve: (result) => { clearTimeout(timer); ws.send(JSON.stringify({ type: resultType, id: msg.id, success: true, result })); },
    reject: (err) => { clearTimeout(timer); ws.send(JSON.stringify({ type: resultType, id: msg.id, success: false, error: err.message || String(err) })); },
    timeout: timer,
    _tool: tool,
    _code: (params && params.code) || ''
  });
  // browserWs 在 main() 里定义，这里通过闭包访问不到，用 clients 遍历找 role=browser
  // 但 forwardToBrowser 已传入 clients，改为也传入 browserWs
  if (global._browserWs && global._browserWs.readyState === 1) {
    global._browserWs.send(JSON.stringify({ type: 'browser_tool_call', callId, tool, params }));
  } else {
    logger.error(`[Browser] background.js 未连接，无法转发 ${tool}`);
  }
  logger.info(`[Browser] 转发 ${tool} 到 background.js: ${callId}`);
}

async function main() {
  // 加载历史记录
  history.init(logger);
  agents.init(logger);
  
  await hub.start();

  // 初始化任务引擎

  // ── 工具路由器 (Phase 1 灰度) ──
  router = new Router(logger);
  metrics = new Metrics(logger);
  router.setFallback(handleToolCall);
  await router.loadDrivers({ processManager, logger, addToHistory: history.add, hub, metrics, history, handleToolCall });
  // 注入 browserTool 供 agent driver 等使用 (Promise 风格)
  router._browserTool = function(browserToolName, browserParams, timeoutMs) {
    return new Promise(function(resolve, reject) {
      const callId = 'bt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      const timer = setTimeout(function() { browserToolPending.delete(callId); reject(new Error('browserTool timeout')); }, timeoutMs || 300000);
      browserToolPending.set(callId, { resolve: function(r) { clearTimeout(timer); resolve(r); }, reject: function(e) { clearTimeout(timer); reject(e); }, timeout: timer });
      for (const c of clients) { if (c.readyState === 1) c.send(JSON.stringify({ type: 'browser_tool_call', callId, tool: browserToolName, params: browserParams })); }
      logger.info('[browserTool] forwarded ' + browserToolName + ' callId=' + callId);
    });
  };

  // 初始化任务引擎（需要在 router 之后）
  taskEngine = new TaskEngine(logger, hub, safety, errorClassifier, router);
  logger.info('[Main] TaskEngine 已初始化');

  // 初始化自验证器和目标管理器
  const selfValidator = new SelfValidator(logger, hub);
  const goalManager = new GoalManager(logger, selfValidator, taskEngine.stateManager);
  const asyncExecutor = new AsyncExecutor(logger);
  autoHealer = new AutoHealer(logger, hub);
  
  // 第三阶段模块: 智能任务规划、工作流模板、断点续传
  logger.info('[Main] SelfValidator, GoalManager, AsyncExecutor, AutoHealer 已初始化');

  // 启动时运行健康检查
  const healthStatus = await healthChecker.runAll(hub);
  if (!healthStatus.healthy) {
    logger.warning('⚠️  部分组件异常，请查看上方日志');
  }


  // HTTP API for memory table (used by sse-hook.js for forged injection)
  const httpApi = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/memory' && req.method === 'GET') {
      const slot = url.searchParams.get('slot') || '';
      const key = url.searchParams.get('key') || '';
      if (!slot || !key) {
        res.writeHead(400, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
        res.end(JSON.stringify({error:'slot and key required'}));
        return;
      }
      try {
        // execSync imported at top
        const dbPath = new URL('../server-v2/data/agent.db', import.meta.url).pathname;
        const table = url.searchParams.get('table') || 'memory';
        const safeTable = table === 'local_store' ? 'local_store' : 'memory';
        const cmd = 'sqlite3 "' + dbPath + '" "SELECT content FROM ' + safeTable + ' WHERE slot=\'' + slot.replace(/'/g,"''") + '\' AND key=\'' + key.replace(/'/g,"''") + '\'"';
        const result = execSync(cmd, {encoding:'utf8', timeout:5000}).trim();
        res.writeHead(200, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
        res.end(JSON.stringify([{content: result}]));
      } catch(e) {
        res.writeHead(500, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
        res.end(JSON.stringify({error:e.message}));
      }
    } else if (url.pathname === '/memory' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          const slot = data.slot || '';
          const key = data.key || '';
          const content = data.content || '';
          if (!slot || !key) {
            res.writeHead(400, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
            res.end(JSON.stringify({error:'slot and key required'}));
            return;
          }
          const dbPath = new URL('../server-v2/data/agent.db', import.meta.url).pathname;
          const Database = (await import('better-sqlite3')).default;
          const db = new Database(dbPath);
          db.prepare('INSERT OR REPLACE INTO memory (slot, key, content) VALUES (?, ?, ?)').run(slot, key, content);
          db.pragma("wal_checkpoint(TRUNCATE)"); db.close();
          res.writeHead(200, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
          res.end(JSON.stringify({ok:true}));
        } catch(e) {
          res.writeHead(500, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
          res.end(JSON.stringify({error:e.message}));
        }
      });
      return;
    } else if (url.pathname === '/memory' && req.method === 'OPTIONS') {
      res.writeHead(204, {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type'});
      res.end();
      return;
    } else if (url.pathname === '/compress/semanticize' && req.method === 'POST') {
      let body = '';
      let tooLarge = false;
      req.on('data', chunk => {
        if (tooLarge) return;
        body += chunk;
        if (body.length > 2_000_000) {
          tooLarge = true;
          res.writeHead(413, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
          res.end(JSON.stringify({error:'payload too large'}));
          req.destroy();
        }
      });
      req.on('end', async () => {
        if (tooLarge) return;
        let db;
        try {
          const data = JSON.parse(body || '{}');
          const candidates = Array.isArray(data.candidates) ? data.candidates.slice(0, 500) : [];
          const ids = [...new Set(candidates.flatMap(item => Array.isArray(item.commandIds) ? item.commandIds : [])
            .map(Number).filter(Number.isFinite))].slice(0, 1000);
          let rows = [];
          if (ids.length) {
            const Database = (await import('better-sqlite3')).default;
            const dbPath = new URL('../server-v2/data/agent.db', import.meta.url).pathname;
            db = new Database(dbPath, { readonly: true });
            const placeholders = ids.map(() => '?').join(',');
            rows = db.prepare(`SELECT id,tool,params,success,status,result_preview,error,content FROM commands WHERE id IN (${placeholders})`).all(...ids);
          }
          const replacements = semanticizeCandidates(candidates, rows);
          res.writeHead(200, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
          res.end(JSON.stringify({ok:true, replacements, candidates:candidates.length, commands:rows.length}));
        } catch(e) {
          res.writeHead(500, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
          res.end(JSON.stringify({error:e.message}));
        } finally {
          if (db) db.close();
        }
      });
      return;
    } else if (url.pathname === '/compress/semanticize' && req.method === 'OPTIONS') {
      res.writeHead(204, {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type'});
      res.end();
      return;
    } else if (url.pathname === '/conversation-ref' && req.method === 'POST') {
      let body = '';
      let tooLarge = false;
      req.on('data', chunk => {
        if (tooLarge) return;
        body += chunk;
        if (body.length > 2_000_000) {
          tooLarge = true;
          res.writeHead(413, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
          res.end(JSON.stringify({error:'payload too large'}));
          req.destroy();
        }
      });
      req.on('end', async () => {
        if (tooLarge) return;
        let db;
        try {
          const data = JSON.parse(body || '{}');
          const conversation_id = data.conversation_id || data.conversationId || '';
          const ref_type = data.ref_type || data.refType || '';
          if (!conversation_id || !ref_type) {
            res.writeHead(400, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
            res.end(JSON.stringify({error:'conversation_id and ref_type required'}));
            return;
          }
          const snapshot_id = data.snapshot_id || data.snapshotId || null;
          const message_id = data.message_id || data.messageId || null;
          const rawCmd = data.command_id ?? data.commandId;
          const command_id = rawCmd == null || rawCmd === '' ? null : Number(rawCmd);
          const source = data.source || 'ui';
          const meta = data.meta == null ? null : (typeof data.meta === 'string' ? data.meta : JSON.stringify(data.meta));
          const force = !!data.force;
          const HEAD_THRESHOLD = 2;
          const MSG_THRESHOLD = 3;
          const Database = (await import('better-sqlite3')).default;
          const dbPath = new URL('../server-v2/data/agent.db', import.meta.url).pathname;
          db = new Database(dbPath);
          const info = db.prepare(`INSERT INTO conversation_refs
            (conversation_id, snapshot_id, message_id, command_id, ref_type, source, meta)
            VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
              conversation_id, snapshot_id, message_id,
              Number.isFinite(command_id) ? command_id : null,
              ref_type, source, meta
            );
          let refCount = 0;
          if (snapshot_id) {
            refCount = db.prepare('SELECT COUNT(*) AS n FROM conversation_refs WHERE snapshot_id = ?').get(snapshot_id).n;
            db.prepare('UPDATE conversation_snapshots SET ref_count = ? WHERE snapshot_id = ?').run(refCount, snapshot_id);
          } else {
            refCount = db.prepare('SELECT COUNT(*) AS n FROM conversation_refs WHERE conversation_id = ?').get(conversation_id).n;
          }
          let promote = { promoted: false, refCount, need: HEAD_THRESHOLD };
          if (snapshot_id && (force || refCount >= HEAD_THRESHOLD)) {
            const now = new Date().toISOString();
            const existing = db.prepare('SELECT * FROM conversation_snapshots WHERE snapshot_id = ?').get(snapshot_id);
            db.prepare(`INSERT INTO conversation_snapshots (
              snapshot_id, conversation_id, saved_at, title, message_count, ref_count,
              promoted_at, promote_reason, content_hash, source, head_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(snapshot_id) DO UPDATE SET
              ref_count=excluded.ref_count,
              title=COALESCE(excluded.title, conversation_snapshots.title),
              message_count=COALESCE(excluded.message_count, conversation_snapshots.message_count),
              head_json=COALESCE(excluded.head_json, conversation_snapshots.head_json),
              promoted_at=COALESCE(conversation_snapshots.promoted_at, excluded.promoted_at),
              promote_reason=COALESCE(conversation_snapshots.promote_reason, excluded.promote_reason)
            `).run(
              snapshot_id, conversation_id,
              data.saved_at || data.savedAt || now,
              data.title || null,
              data.message_count == null && data.messageCount == null ? null : Number(data.message_count ?? data.messageCount),
              refCount,
              existing?.promoted_at || now,
              existing?.promote_reason || (force ? 'force_event' : 'threshold'),
              data.content_hash || data.contentHash || null,
              data.snapshot_source || 'idb',
              data.head_json ? (typeof data.head_json === 'string' ? data.head_json : JSON.stringify(data.head_json)) : null
            );
            let messagesInserted = 0;
            const messages = Array.isArray(data.messages) ? data.messages : null;
            if (messages && (force || refCount >= MSG_THRESHOLD)) {
              const upsert = db.prepare(`INSERT INTO conversation_messages (
                snapshot_id, message_id, role, content, command_ids, artifact_refs, importance
              ) VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(snapshot_id, message_id) DO UPDATE SET
                role=excluded.role, content=excluded.content,
                command_ids=excluded.command_ids, artifact_refs=excluded.artifact_refs,
                importance=excluded.importance`);
              const tx = db.transaction((rows) => {
                for (const m of rows) {
                  const ids = m.commandIds || m.command_ids || (m.meta && m.meta.commandIds) || [];
                  const refs = m.artifactRefs || m.artifact_refs || (m.meta && m.meta.artifactRefs) || [];
                  upsert.run(
                    snapshot_id,
                    String(m.id || m.message_id),
                    m.role || null,
                    m.content || null,
                    ids && ids.length ? JSON.stringify(ids) : null,
                    refs && refs.length ? JSON.stringify(refs) : null,
                    m.importance == null ? null : Number(m.importance)
                  );
                  messagesInserted++;
                }
              });
              tx(messages);
            }
            promote = { promoted: true, refCount, level: messagesInserted ? 'messages' : 'head', messagesInserted };
          }
          res.writeHead(200, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
          res.end(JSON.stringify({ ok:true, refId: info.lastInsertRowid, refCount, snapshot_id, conversation_id, promote }));
        } catch (e) {
          res.writeHead(500, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
          res.end(JSON.stringify({ error: e.message }));
        } finally {
          try { db && db.close(); } catch {}
        }
      });
      return;
    } else if (url.pathname === '/conversation-ref' && req.method === 'OPTIONS') {
      res.writeHead(204, {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type'});
      res.end();
      return;
    } else if (url.pathname === '/chat-archive' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          const convId = data.conversation_id || '';
          const msgs = Array.isArray(data.messages) ? data.messages : [];
          if (!msgs.length) {
            res.writeHead(400, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
            res.end(JSON.stringify({error:'messages array required'}));
            return;
          }
          const archivedAt = new Date().toISOString();
          const stripB64 = (s) => {
            if (typeof s !== 'string') s = JSON.stringify(s);
            return s.replace(/data:[\w.+-]+\/[\w.+-]+;base64,[A-Za-z0-9+\/=]+/g, (m) => '[image removed: ' + Math.round(m.length/1024) + 'KB]');
          };
          const dbPath = new URL('../server-v2/data/agent.db', import.meta.url).pathname;
          const Database = (await import('better-sqlite3')).default;
          const db = new Database(dbPath);
          const stmt = db.prepare('INSERT INTO chat_archive (archived_at, conversation_id, msg_index, role, content) VALUES (?, ?, ?, ?, ?)');
          const tx = db.transaction((rows) => { for (const r of rows) stmt.run(r.archived_at, r.conversation_id, r.msg_index, r.role, r.content); });
          const rows = msgs.map((m, i) => ({ archived_at: archivedAt, conversation_id: convId, msg_index: (typeof m.index === 'number' ? m.index : i), role: m.role || '', content: stripB64(m.content) }));
          tx(rows);
          db.pragma("wal_checkpoint(TRUNCATE)"); db.close();
          res.writeHead(200, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
          res.end(JSON.stringify({ok:true, archived: rows.length, archived_at: archivedAt}));
        } catch(e) {
          res.writeHead(500, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
          res.end(JSON.stringify({error:e.message}));
        }
      });
      return;
    } else if (url.pathname === '/chat-archive' && req.method === 'OPTIONS') {
      res.writeHead(204, {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type'});
      res.end();
      return;
    } else if (url.pathname === '/local/read' && req.method === 'GET') {
      const slot = url.searchParams.get('slot') || '';
      const key = url.searchParams.get('key') || '';
      if (!slot || !key) {
        res.writeHead(400, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
        res.end(JSON.stringify({error:'slot and key required'}));
        return;
      }
      try {
        const dbPath = new URL('../server-v2/data/agent.db', import.meta.url).pathname;
        const cmd = 'sqlite3 "' + dbPath + '" "SELECT content FROM local_store WHERE slot=\x27' + slot.replace(/'/g,"''") + '\x27 AND key=\x27' + key.replace(/'/g,"''") + '\x27"';
        let result = execSync(cmd, {encoding:'utf8', timeout:5000}).trim();
        if (!result) {
          const cmd2 = 'sqlite3 "' + dbPath + '" "SELECT content FROM memory WHERE slot=\x27' + slot.replace(/'/g,"''") + '\x27 AND key=\x27' + key.replace(/'/g,"''") + '\x27"';
          result = execSync(cmd2, {encoding:'utf8', timeout:5000}).trim();
        }
        res.writeHead(200, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
        res.end(JSON.stringify({content: result}));
      } catch(e) {
        res.writeHead(500, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
        res.end(JSON.stringify({error:e.message}));
      }
      return;
    } else if (url.pathname === '/snapshot-oracle' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          const convId = (data.conversation_id || 'unknown').substring(0, 8);
          const b64 = data.b64 || '';
          if (!b64) {
            res.writeHead(400, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
            res.end(JSON.stringify({error:'b64 required'}));
            return;
          }
          const now = new Date();
          const pad = (n) => String(n).padStart(2, '0');
          const ts = '' + now.getFullYear() + pad(now.getMonth()+1) + pad(now.getDate()) + '_' + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
          const fname = 'chat_' + ts + '_' + convId + '.html';
          const os = await import('os');
          const fsp = await import('fs');
          const cp = await import('child_process');
          const tmpPath = os.tmpdir() + '/' + fname + '.b64';
          fsp.writeFileSync(tmpPath, b64);
          const remotePath = '~/chat_snapshots/' + fname;
          cp.execSync('ssh oracle "base64 -d > ' + remotePath + '" < ' + tmpPath, { timeout: 60000 });
          fsp.unlinkSync(tmpPath);
          const sz = cp.execSync('ssh oracle "wc -c ' + remotePath + '"', { encoding: 'utf8', timeout: 30000 }).trim();
          res.writeHead(200, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
          res.end(JSON.stringify({ok:true, file: fname, remote: remotePath, size: sz}));
        } catch(e) {
          res.writeHead(500, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
          res.end(JSON.stringify({error:e.message}));
        }
      });
      return;
    } else if (url.pathname === '/snapshot-oracle' && req.method === 'OPTIONS') {
      res.writeHead(204, {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type'});
      res.end();
      return;
    } else if (url.pathname === '/tool' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const { tool, params } = JSON.parse(body);
          if (!tool) {
            res.writeHead(400, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
            res.end(JSON.stringify({error:'tool required'}));
            return;
          }
          const callId = 'http_' + Date.now();
          const result = await new Promise((resolve, reject) => {
            const reqTimeout = (params && params._timeout) || 30000; const timeout = setTimeout(() => reject(new Error('tool timeout ' + (reqTimeout/1000) + 's')), reqTimeout);
            const fakeWs = {
              send: (data) => {
                const msg = JSON.parse(data);
                if (msg.type === 'tool_result' || msg.result !== undefined) {
                  clearTimeout(timeout);
                  resolve(msg);
                }
              },
              readyState: 1
            };
            handleToolCall(fakeWs, { id: callId, type: 'tool_call', tool, params: params || {} });
          });
          res.writeHead(200, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
          res.end(JSON.stringify(result));
        } catch(e) {
          res.writeHead(500, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
          res.end(JSON.stringify({error: e.message}));
        }
      });
    } else if (url.pathname === '/delegate' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const { task } = JSON.parse(body);
          const taskId = 'T' + Date.now().toString(36);
          if (!task) {
            res.writeHead(400, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
            res.end(JSON.stringify({error:'task required'}));
            return;
          }
          const https = await import('https');
          const ccBody = JSON.stringify({
            receiver: '94abdf9e-04cd-40ce-883d-fdc8b445d132',
            receiverType: 'user',
            type: 'text',
            data: { text: '[task:' + taskId + '] ' + task }
          });
          const ccReq = https.default.request({
            hostname: '1670754dd7dd407a4.apiclient-us.cometchat.io',
            path: '/v3.0/messages',
            method: 'POST',
            headers: {
              'appId': '1670754dd7dd407a4',
              'onBehalfOf': '180ee88d-516d-45e1-aa63-272c7ad3186d',
              'authToken': '180ee88d-516d-45e1-aa63-272c7ad3186d_177187404381eed77145044b5996ac9c53bacd70',
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(ccBody),
            }
          }, (ccRes) => {
            let d = '';
            ccRes.on('data', c => d += c);
            ccRes.on('end', () => {
              res.writeHead(200, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
              res.end(JSON.stringify({ok:true, taskId, task, cometchat: JSON.parse(d)}));
            });
          });
          ccReq.write(ccBody);
          ccReq.end();
        } catch(e) {
          res.writeHead(500, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
          res.end(JSON.stringify({error: e.message}));
        }
      });
    } else if (url.pathname === '/tool' && req.method === 'OPTIONS') {
      res.writeHead(200, {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Content-Type'});
      res.end();
    } else if (url.pathname === '/status' || url.pathname === '/restart') {
      // Proxy to watchdog 8767
      
      const proxyReq = http.get('http://127.0.0.1:8767' + url.pathname, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, Object.assign({'Access-Control-Allow-Origin':'*'}, proxyRes.headers));
        proxyRes.pipe(res);
      });
      proxyReq.on('error', (e) => { res.writeHead(502); res.end(JSON.stringify({error:e.message})); });
    } else if (url.pathname === '/nlp/score' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const { messages } = JSON.parse(body);
          if (!messages || !Array.isArray(messages)) {
            res.writeHead(400, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
            res.end(JSON.stringify({error:'messages array required'}));
            return;
          }
          const { createRequire } = await import('module');
          const require = createRequire(import.meta.url);
          const { scoreMessages } = require('./nlp-scorer.cjs');
          const scores = await scoreMessages(messages, { token: process.env.DIFFBOT_TOKEN });
          res.writeHead(200, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
          res.end(JSON.stringify({ scores }));
        } catch(e) {
          res.writeHead(500, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
          res.end(JSON.stringify({error: e.message}));
        }
      });
    } else if (url.pathname === '/nlp/score' && req.method === 'OPTIONS') {
      res.writeHead(204, {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type'});
      res.end();
    } else if (url.pathname === '/log' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          const tool = data.tool || 'eval_js';
          const params = data.params || {};
          const success = data.success !== false;
          const resultPreview = (typeof data.result === 'string' ? data.result : JSON.stringify(data.result ?? '', null, 2)).substring(0, 5000);
          const error = data.error || null;
          const hid = history.add(tool, params, success, resultPreview, error);
          res.writeHead(200, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
          res.end(JSON.stringify({ok:true,id:hid}));
        } catch(e) {
          res.writeHead(500, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
          res.end(JSON.stringify({error:e.message}));
        }
      });
      return;
    } else if (url.pathname === '/log' && req.method === 'OPTIONS') {
      res.writeHead(204, {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type'});
      res.end();
      return;
    } else {
      res.writeHead(404);
      res.end('not found');
    }
  });
  httpApi.listen(8766, '127.0.0.1', () => {
    logger.success('HTTP API listening on 127.0.0.1:8766');
  });

  const wss = new WebSocketServer({
    port: config.server.port,
    host: config.server.host
  });

  let browserWs = null; // background.js 的专用连接
  global._browserWs = null; // forwardToBrowser 函数用的全局引用

  wss.on('connection', ws => {
    clients.add(ws);
    logger.success(`客户端已连接, 当前连接数: ${clients.size}`);

    // 设置浏览器工具回调：ΩCODE steps 中的 js_flow/eval_js/list_tabs 通过 ws 委托浏览器执行
    if (taskEngine) {
      taskEngine.setBrowserCallHandler(async (tool, params, timeoutMs) => {
        const callId = `browser_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            browserToolPending.delete(callId);
            reject(new Error(`浏览器工具 ${tool} 超时 (${Math.round((timeoutMs||params.timeout||60000)/1000)}s)`));
          }, timeoutMs || params.timeout || 60000);

          browserToolPending.set(callId, { resolve, reject, timeout });

          // 精准投递给 background.js（通过 identify 注册的 browserWs）
          const msg_payload = JSON.stringify({ type: 'browser_tool_call', callId, tool, params });
          if (browserWs && browserWs.readyState === 1) {
            browserWs.send(msg_payload);
            logger.info(`[BrowserTool] 精准投递 ${tool} (${callId}) -> background.js`);
          } else {
            logger.error(`[BrowserTool] background.js 未连接! browserWs=${!!browserWs}`);
            reject(new Error('浏览器扩展未连接'));
          }
        });
      });
    }

    ws.send(JSON.stringify({
      type: 'connected',
      message: 'Genspark Agent Server v2.1 已连接 (支持命令重试)',
      tools: getAllTools(),
      skills: skillsManager.getSkillsList(),
      skillsPrompt: skillsManager.getSystemPrompt(),
      agents: agentsData.agents || {},
      historySupport: true  // 告知客户端支持历史重试
    }));


    // 创建消息处理器
    const wsHandlers = createHandlers({ ws, logger, recorder, goalManager, selfValidator, asyncExecutor, taskEngine, history, skillsManager, agents, clients, handleToolCall, router });

    ws.on('message', async data => {
      try {
        const msg = JSON.parse(data.toString());
        
        switch (msg.type) {
          case 'identify': {
            if (msg.role === 'browser') {
              browserWs = ws;
              global._browserWs = ws;
              logger.info(`[Browser] background.js 已注册为浏览器工具执行器`);
            }
            break;
          }
          case 'tool_call': {
            const _mStart = Date.now();
            let _mOk = true;
            try {
              await handleToolCall(ws, msg);
            } catch(_mErr) { _mOk = false; throw _mErr; }
            finally {
              if (metrics && msg.tool) {
                const driverName = router ? ((router.handlers.get(msg.tool) || {}).name || 'fallback') : 'legacy';
                metrics.record(msg.tool, driverName, Date.now() - _mStart, _mOk);
              }
            }
            break;
          }
            
          case 'confirm_result':
            safety.handleConfirmation(msg.id, msg.approved);
            break;

          case 'dialogue_snapshot': {
            // 对话快照入库 — items 批量,事务原子,触发于 compress 按钮
            try {
              const Database = (await import('better-sqlite3')).default;
              const path = await import('path');
              const dbPath = path.join(__dirname, 'data', 'agent.db');
              const _db = new Database(dbPath);
              const sessionId = msg.sessionId || 'unknown';
              const items = Array.isArray(msg.items) ? msg.items : [];
              const stmt = _db.prepare('INSERT OR IGNORE INTO dialogues (session_id, turn_index, content, content_length) VALUES (?, ?, ?, ?)');
              const insertMany = _db.transaction((rows) => {
                let n = 0;
                for (const it of rows) {
                  const r = stmt.run(sessionId, it.turn_index, it.content || '', (it.content || '').length);
                  if (r.changes > 0) n++;
                }
                return n;
              });
              const inserted = insertMany(items);
              _db.close();
              logger.info(`[Dialogue] 快照入库 session=${sessionId} 收到=${items.length} 新增=${inserted}`);
              if (ws && ws.readyState === 1) {
                ws.send(JSON.stringify({ type: 'dialogue_snapshot_ack', sessionId, received: items.length, inserted }));
              }
            } catch(e) {
              logger.error('[Dialogue] 快照入库失败', { error: e.message });
            }
            break;
          }

          case 'browser_eval':
            forwardToBrowser(ws, clients, browserToolPending, logger, { msg, resultType: 'browser_eval_result', tool: 'eval_js', params: { code: msg.code, tabId: msg.tabId || null, allFrames: msg.allFrames || false }, timeout: msg.timeout || 90000 });
            break;
            

          case 'browser_screenshot':
            forwardToBrowser(ws, clients, browserToolPending, logger, { msg, resultType: 'browser_screenshot_result', tool: 'screenshot', params: { tabId: msg.tabId || null } });
            break;

          case 'browser_list_tabs':
            forwardToBrowser(ws, clients, browserToolPending, logger, { msg, resultType: 'browser_list_tabs_result', tool: 'list_tabs', params: {} });
            break;

          case 'ping':
            ws.send('{"type":"pong"}');
            break;

          case 'phone_reply': {
            try {
              const pData = JSON.stringify({text: msg.text || msg.payload?.text || ''});
              const pReq = http.request({hostname:"localhost",port:8769,path:"/reply",method:"POST",headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(pData)}}, () => {});
              pReq.write(pData);
              pReq.end();
              ws.send(JSON.stringify({type:'phone_reply_result', success:true}));
              logger.info('[WS] phone_reply sent');
            } catch(e) {
              ws.send(JSON.stringify({type:'phone_reply_result', success:false, error:e.message}));
              logger.error('[WS] phone_reply error: ' + e.message);
            }
            break;
          }

          case 'browser_tool_result': {
            logger.info(`[BrowserTool] 收到result callId=${msg.callId} pendingKeys=[${Array.from(browserToolPending.keys()).join(',')}] success=${msg.success} result=${String(JSON.stringify(msg.result) || 'UNDEF').substring(0,200)} error=${msg.error || 'none'}`);
            const pending = browserToolPending.get(msg.callId);
            if (pending) {
              if (msg.success) {
                const resultStr = typeof msg.result === 'string' ? msg.result : JSON.stringify(msg.result);
                // 跳过空结果（多client竞争：非执行者可能返回空），等真正的执行结果
                if (!resultStr || resultStr === '' || resultStr === '(undefined)' || resultStr === 'undefined' || resultStr === 'null') {
                  logger.warning(`[BrowserTool] 跳过空结果: ${msg.callId} result=${resultStr} (等待其他client返回实际内容)`);
                  return; // 不删pending不清timer，等下一个client
                }
                clearTimeout(pending.timeout);
                browserToolPending.delete(msg.callId);
                logger.info(`[BrowserTool] 结果返回: ${msg.callId} result=${resultStr.substring(0,200)}`);
                // 记录 eval_js 到 commands 表
                try { const _hid = history.add(pending._tool || 'eval_js', { code: (pending._code || '').substring(0, 500) }, true, resultStr.substring(0, 5000)); logger.info(`[BrowserTool] eval_js 记录到DB: #${_hid} tool=${pending._tool}`); } catch(e) { logger.error(`[BrowserTool] eval_js 记录失败: ${e.message}`); }
                pending.resolve(msg.result);
              } else {
                // 多tab竞争：失败结果先不reject，等其他tab可能返回成功
                pending._failCount = (pending._failCount || 0) + 1;
                if (pending._failCount < clients.size) {
                  logger.warning(`[BrowserTool] tab失败(${pending._failCount}/${clients.size})，等其他tab: ${msg.callId} - ${msg.error}`);
                  return; // 不删pending不清timer，等下一个tab
                }
                clearTimeout(pending.timeout);
                browserToolPending.delete(msg.callId);
                logger.error(`[BrowserTool] 执行失败: ${msg.callId} - ${msg.error}`);
                // 记录失败的 eval_js 到 commands 表
                try { history.add(pending._tool || 'eval_js', { code: (pending._code || '').substring(0, 500) }, false, null, msg.error); } catch(e) {}
                pending.reject(new Error(msg.error));
              }
            } else {
              logger.warning(`[BrowserTool] 未找到 pending: ${msg.callId}`);
            }
            break;
          }
            
          case 'list_tools':
            ws.send(JSON.stringify({ type: 'tools_list', tools: getAllTools() }));
            break;
          
          // ===== 新增: 工具热刷新 =====
          case 'reload_tools':
            try {
              logger.info('[WS] 收到 reload_tools 请求');
              const reloadResult = await hub.reload();
              
              // 通知请求方
              ws.send(JSON.stringify({
                type: 'reload_tools_result',
                success: true,
                toolCount: reloadResult.toolCount,
                tools: getAllTools()
              }));
              
              // 广播给所有客户端
              broadcast({
                type: 'tools_updated',
                tools: getAllTools(),
                timestamp: Date.now()
              });
              
              logger.success(`[WS] 工具刷新完成，已广播给 ${clients.size} 个客户端`);
            } catch (e) {
              logger.error('[WS] reload_tools 失败:', e.message);
              ws.send(JSON.stringify({
                type: 'reload_tools_result',
                success: false,
                error: e.message
              }));
            }
            break;
          
          // ===== 服务器重启 =====
          case 'restart_server':
            try {
              logger.info('[WS] 收到服务器重启请求');
              
              // 立即回复客户端
              ws.send(JSON.stringify({
                type: 'restart_initiated',
                message: '服务器将在 2 秒后重启',
                timestamp: Date.now()
              }));
              
              // 广播给所有客户端
              broadcast({
                type: 'server_restarting',
                message: '服务器正在重启，请稍候...',
                timestamp: Date.now()
              });
              
              // 延迟关闭，确保消息发送完成
              setTimeout(() => {
                logger.info('[WS] 开始重启流程...');
                
                // 关闭所有连接
                clients.forEach(client => {
                  try {
                    client.close();
                  } catch(e) {}
                });
                
                // 关闭 WebSocket 服务器
                wss.close(() => {
                  logger.info('[WS] WebSocket 服务器已关闭');
                });
                
                // 触发外部重启
                // exec already imported at top
                exec('touch /tmp/agent-restart-trigger', (err) => {
                  if (err) {
                    logger.error('[WS] 触发重启失败:', err.message);
                  } else {
                    logger.info('[WS] 重启触发器已创建');
                  }
                  
                  // 退出进程
                  setTimeout(() => {
                    process.exit(0);
                  }, 500);
                });
              }, 2000);
              
            } catch (e) {
              logger.error('[WS] restart_server 失败:', e.message);
              ws.send(JSON.stringify({
                type: 'restart_failed',
                error: e.message
              }));
            }
            break;
          
          case 'health_check':
            try {
              const status = await healthChecker.runAll(hub);
              ws.send(JSON.stringify({
                type: 'health_status',
                ...status
              }));
            } catch (e) {
              ws.send(JSON.stringify({
                type: 'health_status',
                healthy: false,
                error: e.message
              }));
            }
            break;
          
          // ===== 批量任务执行 =====
          case 'tool_batch':
            if (!taskEngine) {
              ws.send(JSON.stringify({ type: 'batch_error', error: 'TaskEngine 未初始化' }));
              break;
            }
            try {
              const { id: batchId, steps, options } = msg;
              logger.info(`[WS] 收到批量任务: ${batchId}, ${steps?.length || 0} 步`);
              
              const _batchSessionId = resolveMessageSessionId(msg);
              const _runBatch = () => taskEngine.executeBatch(
                batchId || `batch-${Date.now()}`,
                steps || [],
                options || {},
                (stepResult) => {
                  // 每步完成时发送结果
                  ws.send(JSON.stringify({
                    type: 'batch_step_result',
                    batchId,
                    ...stepResult
                  }));
                }
              );
              const result = await (history && typeof history.runWithSession === 'function'
                ? history.runWithSession(_batchSessionId, _runBatch)
                : _runBatch());
              
              ws.send(JSON.stringify({
                type: 'batch_complete',
                ...result
              }));
              
              logger.success(`[WS] 批量任务完成: ${result.stepsCompleted}/${result.totalSteps} 成功`);
            } catch (e) {
              logger.error('[WS] 批量任务失败:', e.message);
              ws.send(JSON.stringify({
                type: 'batch_error',
                error: e.message
              }));
            }
            break;
          
          case 'resume_task':
            if (!taskEngine) {
              ws.send(JSON.stringify({ type: 'resume_error', error: 'TaskEngine 未初始化' }));
              break;
            }
            try {
              const result = await taskEngine.resumeTask(
                msg.taskId,
                (stepResult) => {
                  ws.send(JSON.stringify({
                    type: 'batch_step_result',
                    taskId: msg.taskId,
                    ...stepResult
                  }));
                }
              );
              ws.send(JSON.stringify({ type: 'resume_complete', ...result }));
            } catch (e) {
              ws.send(JSON.stringify({ type: 'resume_error', error: e.message }));
            }
            break;
          
          case 'task_status':
            if (!taskEngine) {
              ws.send(JSON.stringify({ type: 'task_status_result', error: 'TaskEngine 未初始化' }));
              break;
            }
            const status = taskEngine.getTaskStatus(msg.taskId);
            ws.send(JSON.stringify({ type: 'task_status_result', ...status }));
            break;
          
          case 'ai_text': {
            if (!global._aiBridge) {
              const { createAiBridge: cab } = await import('./ai-bridge.js');
              global._aiBridge = cab({ handleToolCall, taskEngine, logger });
            }
            await global._aiBridge(ws, msg);
            break;
          }

          case 'retry_last': {
            // 确保 ai-bridge 已初始化
            if (!global._aiBridge) {
              const { createAiBridge: cab } = await import('./ai-bridge.js');
              global._aiBridge = cab({ handleToolCall, taskEngine, logger });
            }
            // 优先级: 1) ai-bridge ΩCODE  2) handleToolCall  3) DB
            if (global.__LAST_OMEGA__ && global._aiBridge.retryLast) {
              await global._aiBridge.retryLast(ws, msg);
            } else if (global.__LAST_TOOL_CALL__) {
              const { tool, params } = global.__LAST_TOOL_CALL__;
              logger.info('[Retry] Re-executing last tool_call: ' + tool);
              await handleToolCall(ws, { type: 'tool_call', tool, params, id: 'retry-' + Date.now() });
            } else {
              // fallback: 从 commands 表取最后一条
              const last = dbApi.query("SELECT tool, params FROM commands ORDER BY id DESC LIMIT 1");
              if (last && last[0]) {
                const tool = last[0].tool;
                let params;
                try { params = JSON.parse(last[0].params); } catch(e) { params = last[0].params; }
                logger.info('[Retry] DB fallback: ' + tool);
                await handleToolCall(ws, { type: 'tool_call', tool, params, id: 'retry-' + Date.now() });
              } else {
                ws.send(JSON.stringify({ type: 'inject_result', text: '**[Retry]** 没有可重试的命令' }));
              }
            }
            break;
          }

                    // ── 委托 ws-handlers 处理 ──
          default: {
            if (wsHandlers[msg.type]) {
              await wsHandlers[msg.type](msg);
            } else {
              logger.warning(`未知消息类型: ${msg.type}`);
            }
            break;
          }
            
        }
      } catch (e) {
        logger.error('处理消息失败', { error: e.message, data: data.toString().slice(0, 200) });
        // Return error to client
        try {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'JSON parse failed: ' + e.message,
            hint: 'May contain special characters causing parse error'
          }));
        } catch (sendErr) {
          logger.error('Failed to send error', { error: sendErr.message });
        }
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      if (ws === browserWs) {
        browserWs = null;
        global._browserWs = null;
        logger.info('[Browser] background.js 连接已断开');
      }
      // 注销该连接关联的 agent
      const agentId = agents.unregister(ws);
      logger.info(`客户端断开, 当前连接数: ${clients.size}${agentId ? `, 已注销 Agent: ${agentId}` : ''}`);
    });

    ws.on('error', e => logger.error('WebSocket 错误', { error: e.message }));
  });

  const skillsCount = skillsManager.getSkillsList().length;
  
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🤖 Genspark Agent Server v2.1 (支持命令重试)            ║
║                                                           ║
║   WebSocket: ws://${config.server.host}:${config.server.port}                     ║
║   工具数量: ${hub.tools.length.toString().padEnd(3)} 个                                  ║
║   Skills:   ${skillsCount.toString().padEnd(3)} 个                                  ║
║   安全检查: ${config.safety ? '✅ 已启用' : '❌ 未启用'}                              ║
║   日志记录: ${config.logging?.enabled ? '✅ 已启用' : '❌ 未启用'}                              ║
║   命令重试: ✅ 已启用                                     ║
║                                                           ║
║   等待客户端连接...                                       ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
`);
}

// Teams Agent v3 - 启动 node 端 agent loop
try {
  teamsAgent.start({ handleToolCall, logger, clients, browserToolPending, getTaskEngine: () => taskEngine });
  logger.info("Teams Agent v3 已启动");
} catch(e) {
  logger.warning("Teams Agent 启动失败: " + e.message);
}

// 优雅退出
process.on('SIGINT', () => {
  logger.info('正在关闭服务器...');
  hub.stop();
  process.exit(0);
});

main().catch(e => {
  logger.error('启动失败', { error: e.message });
  process.exit(1);
});
