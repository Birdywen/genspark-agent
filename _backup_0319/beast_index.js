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
import { spawn } from 'child_process';
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
import http from "http";
import ProcessManager from './process-manager.js';
import { existsSync } from 'fs';
import Router from "./core/router.js";
import Metrics from "./core/metrics.js";
import { resolvePayloadFiles, decodeBase64Fields, parseParams, autoScript, resolveTimeout, parseResult, sendSuccess, sendError } from './core/pipeline.js';
import { resolve as resolveAlias } from "./core/alias.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import { MCPHub, expandEnvVars } from './core/mcp-hub.js';

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
import agents from './core/agents.js';
import { createHandlers } from './core/ws-handlers.js';
import teamsAgent from './teams-agent.js';
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

async function handleToolCall(ws, message, isRetry = false, originalId = null) {
  let { tool, params, id } = message;

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
      // 安全检查
      const safetyCheck = await safety.checkOperation(tool, params || {}, broadcast);
      if (!safetyCheck.allowed) {
        const historyId = history.add(tool, params, false, null, safetyCheck.reason);
        sendError(ws, { id, historyId, tool, error: safetyCheck.reason });
        return;
      }
      // 自动脚本化
      params = autoScript(tool, params, logger);
      // 超时策略
      const callOptions = resolveTimeout(tool, params, message);
      try {
        const r = await router.dispatch(tool, params, ws, message, callOptions);
        if (r && r.delegate) {
          logger.info('[Router] DELEGATE: ' + tool + ' (fallthrough)');
        } else if (r && r.handled) {
          _routerHandled = true;
          history.add(tool, params, true, JSON.stringify(r).slice(0, 500));
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
            for (const client of clients) {
              if (client.readyState === 1) {
                client.send(JSON.stringify({ type: "browser_tool_call", callId: vfsCallId, tool: "eval_js", params: { code: r.browserEval } }));
              }
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
            history.updateById(originalId, { success: true, resultPreview: (result || '').substring(0, 500), retriedAt: new Date().toISOString(), error: null });
          }
          const historyId = isRetry ? originalId : history.add(tool, params, success, (result || '').slice(0, 500), success ? null : result);
          // recorder
          for (const [recId, rec] of (recorder.activeRecordings instanceof Map ? recorder.activeRecordings : [])) {
            if (rec.status === 'recording') {
              recorder.recordStep(recId, { tool, params, result: { success, result: (result || '').slice(0, 500) }, duration: Date.now() - (message.startTime || Date.now()) });
            }
          }
          if (success) {
            sendSuccess(ws, { id, historyId, tool, result: isRetry ? '[重试 #' + historyId + '] ' + result : result, images });
          } else {
            sendError(ws, { id, historyId, tool, error: result });
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
                const retryHistoryId = history.add(retryTool, retryParams, true, (retryResult || '').slice(0, 500));
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
        sendError(ws, { id, historyId, tool, error: e.message, errorType: classified.errorType, recoverable: classified.recoverable, suggestion: classified.suggestion });
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
    timeout: timer
  });
  for (const client of clients) {
    if (client !== ws && client.readyState === 1) {
      client.send(JSON.stringify({ type: 'browser_tool_call', callId, tool, params }));
    }
  }
  logger.info(`[Browser] 转发 ${tool} 到浏览器: ${callId}`);
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

  const wss = new WebSocketServer({
    port: config.server.port,
    host: config.server.host
  });

  wss.on('connection', ws => {
    clients.add(ws);
    logger.success(`客户端已连接, 当前连接数: ${clients.size}`);

    // 设置浏览器工具回调：ΩBATCH 中的 js_flow/eval_js/list_tabs 通过 ws 委托浏览器执行
    if (taskEngine) {
      taskEngine.setBrowserCallHandler(async (tool, params) => {
        const callId = `browser_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            browserToolPending.delete(callId);
            reject(new Error(`浏览器工具 ${tool} 超时 (60s)`));
          }, params.timeout || 60000);

          browserToolPending.set(callId, { resolve, reject, timeout });

          ws.send(JSON.stringify({
            type: 'browser_tool_call',
            callId,
            tool,
            params
          }));
          logger.info(`[BrowserTool] 发送到浏览器: ${tool} (${callId})`);
        });
      });
    }

    ws.send(JSON.stringify({
      type: 'connected',
      message: 'Genspark Agent Server v2.1 已连接 (支持命令重试)',
      tools: hub.tools,
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
            logger.info(`[BrowserTool] 收到result callId=${msg.callId} pendingKeys=[${Array.from(browserToolPending.keys()).join(',')}] success=${msg.success}`);
            const pending = browserToolPending.get(msg.callId);
            if (pending) {
              if (msg.success) {
                const resultStr = typeof msg.result === 'string' ? msg.result : JSON.stringify(msg.result);
                // 跳过空结果（多tab竞争：第一个tab可能没await Promise就返回空）
                if (!resultStr || resultStr === '' || resultStr === '(undefined)') {
                  logger.warning(`[BrowserTool] 跳过空结果: ${msg.callId} (等待其他tab返回实际内容)`);
                  return; // 不删pending不清timer，等下一个tab的结果
                }
                clearTimeout(pending.timeout);
                browserToolPending.delete(msg.callId);
                logger.info(`[BrowserTool] 结果返回: ${msg.callId} result=${resultStr.substring(0,200)}`);
                pending.resolve(msg.result);
              } else {
                clearTimeout(pending.timeout);
                browserToolPending.delete(msg.callId);
                logger.error(`[BrowserTool] 执行失败: ${msg.callId} - ${msg.error}`);
                pending.reject(new Error(msg.error));
              }
            } else {
              logger.warning(`[BrowserTool] 未找到 pending: ${msg.callId}`);
            }
            break;
          }
            
          case 'list_tools':
            ws.send(JSON.stringify({ type: 'tools_list', tools: hub.tools }));
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
                tools: hub.tools
              }));
              
              // 广播给所有客户端
              broadcast({
                type: 'tools_updated',
                tools: hub.tools,
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
                const { exec } = require('child_process');
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
              
              const result = await taskEngine.executeBatch(
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
  teamsAgent.start({ handleToolCall, logger, clients, browserToolPending });
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
