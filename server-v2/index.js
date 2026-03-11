// Genspark Agent Server v2 - 整合版
// MCP Hub + 安全检查 + 日志记录 + Skills 系统 + 命令重试

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
// [已删除] ResultCache, ContextCompressor (未使用)
// [已删除] TaskPlanner, WorkflowTemplate, CheckpointManager (未使用)
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
const registeredAgents = new Map();

function registerAgent(ws, agentId, site) {
  // 如果已有同名 agent，先移除旧的
  if (registeredAgents.has(agentId)) {
    const old = registeredAgents.get(agentId);
    if (old.ws !== ws) {
      logger.info(`Agent ${agentId} 重新注册 (旧: ${old.site} -> 新: ${site})`);
    }
  }
  registeredAgents.set(agentId, { ws, site, lastSeen: Date.now() });
  logger.info(`注册 Agent: ${agentId} @ ${site}, 当前总数: ${registeredAgents.size}`);
}

function unregisterAgent(ws) {
  for (const [agentId, info] of registeredAgents) {
    if (info.ws === ws) {
      registeredAgents.delete(agentId);
      logger.info(`注销 Agent: ${agentId}`);
      return agentId;
    }
  }
  return null;
}

function sendCrossExtensionMessage(fromAgent, toAgent, message) {
  const target = registeredAgents.get(toAgent);
  if (!target) {
    return { success: false, error: `Agent "${toAgent}" 不在线` };
  }
  
  try {
    target.ws.send(JSON.stringify({
      type: 'cross_extension_message',
      from: fromAgent,
      to: toAgent,
      message: message,
      timestamp: Date.now()
    }));
    logger.info(`跨扩展消息: ${fromAgent} -> ${toAgent}`);
    return { success: true };
  } catch (e) {
    logger.error(`发送跨扩展消息失败: ${e.message}`);
    return { success: false, error: e.message };
  }
}

function getOnlineAgents() {
  const agents = [];
  for (const [agentId, info] of registeredAgents) {
    agents.push({ agentId, site: info.site, lastSeen: info.lastSeen });
  }
  return agents;
}

// ==================== 命令历史管理 ====================
import history from "./core/history.js";
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
  if (tool === '_metrics') {
    const summary = metrics ? metrics.getSummary() : {};
    const top = metrics ? metrics.getTopTools() : [];
    ws.send(JSON.stringify({ type: 'tool_result', id, tool, success: true, result: JSON.stringify({ summary, top }, null, 2) }));
    return;
  }

  // ── Router Phase 2: trace 观察模式 ──
  if (typeof router !== "undefined" && router) {
    const driver = router.handlers.get(tool);
    if (driver) {
      const _routerStart = Date.now(); logger.info("[Router] trace: " + tool + " -> " + driver.name);
    }
  }
  
  // 后台进程管理器 - 直接处理，不走 MCP
  if (tool === 'bg_run' || tool === 'bg_status' || tool === 'bg_kill') {
    const historyId = history.add(tool, params, true, null, null);
    let result;
    if (tool === 'bg_run') {
      // stdin/stdinFile fix: stdinFile is a temp file already containing the stdin content
      logger.info('[bg_run] params keys: ' + JSON.stringify(Object.keys(params)));
      let bgCommand = params.command;
      if (params.stdinFile) {
        bgCommand = (params.command || 'bash') + ' ' + params.stdinFile;
        logger.info('[bg_run] using stdinFile: ' + params.stdinFile);
      } else if (params.stdin) {
        const tmpScript = '/private/tmp/bg_run_' + Date.now() + '.sh';
        writeFileSync(tmpScript, params.stdin, { mode: 0o755 });
        bgCommand = (params.command || 'bash') + ' ' + tmpScript;
        logger.info('[bg_run] stdin -> tmpScript: ' + tmpScript);
      }
      result = processManager.run(bgCommand, { cwd: params.cwd, shell: params.shell }, (completedSlot) => {
        // 进程完成时自动通知前端
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
          logger.info("[bg_complete] 准备推送到手机, slot=" + completedSlot.slotId);
          // 自动推送到手机
          try {
            const pStatus = completedSlot.exitCode === 0 ? "✅" : "❌";
            const pMsg = pStatus + " bg_run slot " + completedSlot.slotId + " 完成 (" + (completedSlot.elapsed ? Math.round(completedSlot.elapsed/1000) : "?") + "s) exit=" + completedSlot.exitCode;
            const pData = JSON.stringify({text: pMsg});
            const pReq = http.request({hostname:"localhost",port:8769,path:"/reply",method:"POST",headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(pData)}}, () => {});
            pReq.write(pData);
            pReq.end();
            logger.info("[bg_complete] 推送请求已发送");
          } catch(pe) { logger.error("[bg_complete] 推送异常: " + pe.message); }
        } catch (e) {

          logger.error(`[bg_complete] 通知发送失败: ${e.message}`);
        }
      });
    } else if (tool === 'bg_status') {
      result = processManager.status(params.slotId, { lastN: params.lastN });
    } else {
      result = processManager.kill(params.slotId);
    }
    ws.send(JSON.stringify({
      type: 'tool_result',
      id,
      historyId,
      tool,
      success: result.success,
      result: JSON.stringify(result, null, 2),
      error: result.success ? undefined : result.error
    }));
    return;
  }

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
    if (execMatch) {
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

  // ── replay: 一键重试历史命令 ──
  if (tool === 'replay') {
    const targetId = parseInt(params.id || params.historyId);
    if (!targetId) {
      ws.send(JSON.stringify({ type: 'tool_result', id, tool, success: false, error: 'replay 需要 id 参数（历史命令 ID）' }));
      return;
    }
    const entry = history.getById(targetId);
    if (!entry) {
      ws.send(JSON.stringify({ type: 'tool_result', id, tool, success: false, error: `找不到历史命令 #${targetId}` }));
      return;
    }
    logger.info(`[replay] 重放历史命令 #${targetId}: ${entry.tool}`);
    // 还原原始 tool 和 params，走正常流程
    const replayMsg = { type: 'tool_call', id, tool: entry.tool, params: { ...entry.params } };
    // 如果原始是 run_process（由 run_command 别名转换来的），还原成 run_command
    if (entry.tool === 'run_process' && entry.params.command_line === 'bash' && entry.params.stdin) {
      replayMsg.tool = 'run_command';
      replayMsg.params = { command: 'bash', stdin: entry.params.stdin };
      if (entry.params.cwd) replayMsg.params.cwd = entry.params.cwd;
    }
    await handleToolCall(ws, replayMsg, true, targetId);
    return;
  }

  // ── delay_run: 延迟执行命令（替代 sleep，不阻塞消息通道） ──
  if (tool === 'delay_run') {
    const delay = parseInt(params.delay || params.seconds || 0) * 1000;
    const command = params.command;
    if (!command) {
      ws.send(JSON.stringify({ type: 'tool_result', id, tool, success: false, error: 'delay_run 需要 command 参数' }));
      return;
    }
    if (delay > 600000) {
      ws.send(JSON.stringify({ type: 'tool_result', id, tool, success: false, error: '延迟不能超过 600 秒' }));
      return;
    }
    const historyId = history.add('delay_run', params, true, null, null);
    logger.info(`[delay_run] ${delay/1000}s 后执行: ${command.substring(0, 100)}`);
    
    // 立即返回确认
    ws.send(JSON.stringify({
      type: 'tool_result', id, historyId, tool: 'delay_run',
      success: true,
      result: `[#${historyId}] 已安排 ${delay/1000}s 后执行，将以 bg_run 方式运行`
    }));

    // 延迟后启动
    setTimeout(() => {
      const result = processManager.run(command, { cwd: params.cwd }, (completedSlot) => {
        try {
          ws.send(JSON.stringify({
            type: 'bg_complete', tool: 'delay_run',
            slotId: completedSlot.slotId, exitCode: completedSlot.exitCode,
            elapsed: completedSlot.elapsed, lastOutput: completedSlot.lastOutput,
            success: completedSlot.exitCode === 0
          }));
        } catch (e) { logger.error('[delay_run] 完成通知失败: ' + e.message); }
      });
      logger.info(`[delay_run] 延迟 ${delay/1000}s 到期，bg_run 启动: slot=${result.slotId || '?'}`);
      // 发通知告诉前端已开始
      try {
        ws.send(JSON.stringify({
          type: 'tool_result', id: 'delay_run_started_' + historyId,
          tool: 'delay_run', success: true,
          result: `[delay_run #${historyId}] 延迟到期，已启动 bg_run: ${JSON.stringify(result)}`
        }));
      } catch(e) {}
    }, delay);
    return;
  }

  // ── vfs_write: 大内容直写 VFS messages[] 通道 ──
  // AI 调用: ΩHERE vfs_write @slot=toolkit @key=xxx @content<<EOF ... EOF
  // 也支持写 name通道: ΩHERE vfs_write @slot=toolkit @content<<EOF ... EOF (不传 key)
  if (tool === 'vfs_write' || tool === 'vfs_read' || tool === 'vfs_delete' || tool === 'vfs_list' || tool === 'vfs_query' || tool === 'vfs_search' || tool === 'vfs_exec' || tool === 'vfs_backup') {
    // [payloadFile 已在 pipeline.resolvePayloadFiles 统一处理]
    logger.info(`[VFS] ${tool} 收到参数: slot=${params.slot} key=${params.key} contentLen=${params.content?.length} contentPreview=${JSON.stringify((params.content || '').substring(0, 100))}`);
    const historyId = history.add(tool, { slot: params.slot, key: params.key, contentLen: params.content?.length }, true, null, null);
    
    // 需要浏览器执行（因为要用 Genspark cookie）
    const vfsCallId = `browser_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    let jsCode;
    if (tool === 'vfs_write') {
      if (!params.slot) {
        ws.send(JSON.stringify({ type: 'tool_result', id, historyId, tool, success: false, error: 'vfs_write 需要 slot 参数' }));
        return;
      }
      if (params.key) {
        // 写入 messages[] 通道 (key-value)
        const contentJson = JSON.stringify(params.content || '');
        const keyJson = JSON.stringify(params.key);
        jsCode = `return window.vfs.writeMsg(${JSON.stringify(params.slot)}, ${keyJson}, ${contentJson}).then(function(r) { return 'writeMsg ok: ' + JSON.stringify(r); })`;
      } else {
        // 写入 name 通道 (原始字符串)
        const contentJson = JSON.stringify(params.content || '');
        jsCode = `return window.vfs.write(${JSON.stringify(params.slot)}, ${contentJson}).then(function(r) { return 'write ok: ' + JSON.stringify(r); })`;
      }
    } else if (tool === 'vfs_read') {
      if (!params.slot) {
        ws.send(JSON.stringify({ type: 'tool_result', id, historyId, tool, success: false, error: 'vfs_read 需要 slot 参数' }));
        return;
      }
      if (params.key) {
        jsCode = `return window.vfs.readMsg(${JSON.stringify(params.slot)}, ${JSON.stringify(params.key)}).then(function(r) { return JSON.stringify(r); })`;
      } else if (params.keys) {
        jsCode = `return window.vfs.listMsg(${JSON.stringify(params.slot)}).then(function(r) { return JSON.stringify(r); })`;
      } else {
        jsCode = `return window.vfs.read(${JSON.stringify(params.slot)}).then(function(r) { return r; })`;
      }
    } else if (tool === 'vfs_delete') {
      if (!params.slot || !params.key) {
        ws.send(JSON.stringify({ type: 'tool_result', id, historyId, tool, success: false, error: 'vfs_delete 需要 slot 和 key 参数' }));
        return;
      }
      jsCode = `return window.vfs.deleteMsg(${JSON.stringify(params.slot)}, ${JSON.stringify(params.key)}).then(function(r) { return 'deleteMsg ok: ' + JSON.stringify(r); })`;

    // ── vfs_list: 列出 slots 或某 slot 的 messages keys ──
    } else if (tool === 'vfs_list') {
      if (params.slot) {
        jsCode = `return window.vfs.listMsg(${JSON.stringify(params.slot)}).then(function(r) { return JSON.stringify(r); })`;
      } else {
        jsCode = `return window.vfs.ls().then(function(r) { return JSON.stringify(r); })`;
      }

    // ── vfs_query: 按条件查询 messages ──
    } else if (tool === 'vfs_query') {
      if (!params.slot) {
        ws.send(JSON.stringify({ type: 'tool_result', id, historyId, tool, success: false, error: 'vfs_query 需要 slot 参数' }));
        return;
      }
      const qOpts = {};
      if (params.prefix) qOpts.prefix = params.prefix;
      if (params.exclude) qOpts.exclude = params.exclude;
      if (params.contains) qOpts.contains = params.contains;
      if (params.limit) qOpts.limit = parseInt(params.limit);
      jsCode = `return window.vfs.query(${JSON.stringify(params.slot)}, ${JSON.stringify(qOpts)}).then(function(r) { return JSON.stringify(r); })`;

    // ── vfs_search: 全局关键词搜索 ──
    } else if (tool === 'vfs_search') {
      if (!params.keyword) {
        ws.send(JSON.stringify({ type: 'tool_result', id, historyId, tool, success: false, error: 'vfs_search 需要 keyword 参数' }));
        return;
      }
      jsCode = `return window.vfs.search(${JSON.stringify(params.keyword)}).then(function(r) { return JSON.stringify(r); })`;

    // ── vfs_exec: 执行 VFS slot 中的代码 ──
    } else if (tool === 'vfs_exec') {
      if (!params.slot) {
        ws.send(JSON.stringify({ type: 'tool_result', id, historyId, tool, success: false, error: 'vfs_exec 需要 slot 参数' }));
        return;
      }
      const execArgs = params.args ? JSON.stringify(params.args) : 'undefined';
      if (params.key) {
        jsCode = `return window.vfs.execMsg(${JSON.stringify(params.slot)}, ${JSON.stringify(params.key)}, ${execArgs}).then(function(r) { return JSON.stringify(r); })`;
      } else {
        jsCode = `return window.vfs.exec(${JSON.stringify(params.slot)}, ${execArgs}).then(function(r) { return JSON.stringify(r); })`;
      }

    // ── vfs_backup: 一键备份 ──
    } else if (tool === 'vfs_backup') {
      const bkOpts = {};
      if (params.messages === 'false' || params.messages === false) bkOpts.messages = false;
      jsCode = `return window.vfs.backup(${JSON.stringify(bkOpts)}).then(function(r) { return JSON.stringify(r); })`;
    }

    // 委托浏览器执行
    const vfsPromise = new Promise((resolve, reject) => {
      const vfsTimeout = setTimeout(() => {
        browserToolPending.delete(vfsCallId);
        reject(new Error('vfs 操作超时 (30s)'));
      }, 30000);
      browserToolPending.set(vfsCallId, { resolve, reject, timeout: vfsTimeout });
      // 广播给浏览器扩展
      for (const client of clients) {
        if (client.readyState === 1) {
          client.send(JSON.stringify({ type: 'browser_tool_call', callId: vfsCallId, tool: 'eval_js', params: { code: jsCode } }));
        }
      }
      logger.info(`[VFS] ${tool} 委托浏览器执行: ${vfsCallId} slot=${params.slot} key=${params.key || '(name)'}`);
    });

    try {
      const vfsResult = await vfsPromise;
      ws.send(JSON.stringify({ type: 'tool_result', id, historyId, tool, success: true, result: typeof vfsResult === 'string' ? vfsResult : JSON.stringify(vfsResult) }));
    } catch (vfsErr) {
      ws.send(JSON.stringify({ type: 'tool_result', id, historyId, tool, success: false, error: vfsErr.message }));
    }
    return;
  }

  if (tool === 'run_command' && params.command) {
    const cmd = params.command.toLowerCase();
    const longPatterns = [
      /\bpip3?\s+install\b/,
      /\bnpm\s+install\b/,
      /\bnpm\s+ci\b/,
      /\byarn\s+(install|add)\b/,
      /\bpnpm\s+(install|add)\b/,
      /\bbrew\s+install\b/,
      /\bcargo\s+build\b/,
      /\bmake\b(?!dir)/,
      /\bcmake\s+--build\b/,
      /\bgit\s+clone\b/,
      /\bdocker\s+(build|pull)\b/,
      /\bdemucs\b/,
      /\bwhisper\b/,
      /\bbasic[_-]pitch\b/,
      /\bnohup\b/,
      /\bnpx\s+next\s+(dev|build|start)\b/,
      /\bnext\s+(dev|build|start)\b/,
      /\bscp\s+-/,
      /\brsync\b/,
      /\bwrangler\s+(deploy|publish)\b/,
      /\bcurl\b.*(-o|--output).*\.(mp[34]|zip|tar|gz|iso)\b/,
      /\bnpm\s+run\s+(dev|build|start)\b/,
    ];
    const isLong = longPatterns.some(p => p.test(cmd));
    // 检测 sleep 命令也走 bg_run（sleep 在普通执行模式下必定 timeout）
    const hasSleep = /\bsleep\s+\d/.test(cmd) || (params.stdin && /\bsleep\s+\d/.test(params.stdin));
    const shouldBgRun = isLong || hasSleep;
    if (shouldBgRun && !params._noAutoRoute) {
      logger.info(`[智能路由] run_command → bg_run (${hasSleep ? '检测到sleep' : '检测到长时间命令'})`);
      const historyId = history.add('bg_run', params, true, null, null);
      // 如果有 stdin，写成临时脚本文件再执行（processManager.run 不支持 stdin pipe）
      let bgCommand = params.command;
      if (params.stdin) {
        const tmpScript = '/private/tmp/bg_run_' + Date.now() + '.sh';
        writeFileSync(tmpScript, params.stdin, { mode: 0o755 });
        bgCommand = 'bash ' + tmpScript + ' ; rm -f ' + tmpScript;
      }
      const result = processManager.run(bgCommand, { cwd: params.cwd });
      ws.send(JSON.stringify({
        type: 'tool_result',
        id,
        historyId,
        tool: 'bg_run (auto)',
        success: result.success,
        result: JSON.stringify(result, null, 2),
        error: result.success ? undefined : result.error
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
  const ROUTER_INTERCEPT = (process.env.ROUTER_INTERCEPT || 'ssh,filesystem,vfs,browser,shell').split(',');
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
      try {
        const r = await router.dispatch(tool, params, ws, message);
        if (r && r.delegate) {
          logger.info('[Router] DELEGATE: ' + tool + ' (fallthrough)');
        } else if (r && r.handled) {
          // driver 自己处理了 ws.send (如 shell)
          _routerHandled = true;
          history.add(tool, params, true, JSON.stringify(r).slice(0, 500));
          logger.info('[Router] HANDLED: ' + tool + ' (driver self-sent)');
        } else {
          _routerHandled = true;
          const { result, images } = parseResult(r);
          const success = !(r && r.isError);
          const historyId = history.add(tool, params, success, (result || '').slice(0, 500), success ? null : result);
          if (success) {
            sendSuccess(ws, { id, historyId, tool, result, images });
          } else {
            sendError(ws, { id, historyId, tool, error: result });
          }
        }
      } catch(e) {
        _routerHandled = true;
        const historyId = history.add(tool, params, false, null, e.message);
        sendError(ws, { id, historyId, tool, error: e.message });
      }
      if (_routerHandled) return;
    }
  }


  // [已迁移到 pipeline.autoScript + Router]

  logger.info(`${isRetry ? '[重试] ' : ''}工具调用: ${tool}`, params);

  // 安全检查
  const safetyCheck = await safety.checkOperation(tool, params || {}, broadcast);
  
  if (!safetyCheck.allowed) {
    logger.warning(`安全检查未通过: ${safetyCheck.reason}`);
    
    // 记录失败的调用
    const historyId = history.add(tool, params, false, null, safetyCheck.reason);
    
    ws.send(JSON.stringify({
      type: 'tool_result',
      id,
      historyId: isRetry ? originalId : historyId,
      tool,
      success: false,
      error: `[#${isRetry ? originalId : historyId}] ${safetyCheck.reason}`
    }));
    return;
  }

  try {
    // [已迁移到 pipeline.resolvePayloadFiles + decodeBase64Fields]
    // 支持灵活 timeout: 从原始 message 中提取
    let callTimeout = message.params?.timeout ? parseInt(message.params.timeout) : undefined;
    // SSH 工具默认给 120s timeout，长命令自动延长
    if (!callTimeout && tool.startsWith('ssh-')) {
      const sshCmd = (params.command || '').toLowerCase();
      const isLongSSH = /nohup|pipeline|--test|npms+install|pip3?s+install|gits+clone|dockers+(build|pull)|demucs|whisper|ffmpeg/.test(sshCmd);
      callTimeout = isLongSSH ? 600000 : 120000; // 10min for long, 2min default
      if (isLongSSH) logger.info('[SSH] 检测到长时间命令，超时延长至 600s: ' + sshCmd.substring(0, 80));
    }
    // vfs-exec.sh / vx.sh 命令自动延长超时（这些命令需要返回值，不能走 bg_run）
    if (!callTimeout && tool === 'run_process') {
      const cmd = (params.command_line || '') + ' ' + (params.stdin || '');
      if (/vfs-exec\.sh|vx\.sh/.test(cmd)) {
        // 从命令中提取超时参数，如 "vfs-exec.sh /tmp/x.js 120000" → 120000+30000 缓冲
        const timeoutMatch = cmd.match(/vfs-exec\.sh\s+\S+\s+(\d+)/);
        const scriptTimeout = timeoutMatch ? parseInt(timeoutMatch[1]) : 90000;
        callTimeout = scriptTimeout + 30000; // 脚本超时 + 30s 缓冲
        logger.info('[VFS-EXEC] 自动延长超时至 ' + (callTimeout/1000) + 's');
      }
    }
    const callOptions = callTimeout ? { timeout: callTimeout } : {};

    // ── write_file 保护: 检测内容截断 ──
    if (tool === 'write_file' && params.content !== undefined) {
      const contentLines = (params.content.match(/\n/g) || []).length + 1;
      const contentLen = params.content.length;
      // 警告: content 只有 1 行但非常短，可能被截断
      if (contentLines <= 1 && contentLen < 50) {
        logger.warning(`[WriteProtect] ⚠️ write_file 内容疑似截断: ${contentLen} chars, ${contentLines} 行 → ${params.path}`);
      }
      // 记录写入前的信息，用于写入后验证（存到闭包变量，不污染 params）
    }
    const _writeProtectInfo = (tool === 'write_file' && params.content !== undefined)
      ? { expectedLen: params.content.length, expectedLines: (params.content.match(/\n/g) || []).length + 1, path: params.path }
      : null;

    // ── edit_file 保护: 记录 edits 信息用于诊断 ──
    if (tool === 'edit_file' && params.edits && Array.isArray(params.edits)) {
      for (let ei = 0; ei < params.edits.length; ei++) {
        const edit = params.edits[ei];
        if (edit.oldText && edit.oldText.length < 5) {
          logger.warning(`[EditProtect] ⚠️ edit_file edits[${ei}].oldText 过短 (${edit.oldText.length} chars)，可能匹配错误`);
        }
      }
    }

    const r = await hub.call(tool, params, callOptions);

    // ── write_file 写入后验证 ──
    if (_writeProtectInfo) {
      try {
        const wp = _writeProtectInfo;
        const validPath = wp.path.startsWith('/') ? wp.path : path.resolve(wp.path);
        const actualContent = readFileSync(validPath, 'utf-8');
        const actualLen = actualContent.length;
        const actualLines = (actualContent.match(/\n/g) || []).length + 1;
        if (actualLen !== wp.expectedLen) {
          logger.error(`[WriteProtect] ❌ write_file 验证失败! 期望 ${wp.expectedLen} chars / ${wp.expectedLines} 行, 实际 ${actualLen} chars / ${actualLines} 行 → ${wp.path}`);
        } else {
          logger.info(`[WriteProtect] ✅ write_file 验证通过: ${actualLen} chars, ${actualLines} 行 → ${wp.path}`);
        }
      } catch(wpErr) {
        logger.warning(`[WriteProtect] 验证跳过: ${wpErr.message}`);
      }
    }
    let result = r;
    
    if (r && r.content && Array.isArray(r.content)) {
      const textParts = [];
      const imageParts = [];
      for (const c of r.content) {
        if (c.type === 'text') {
          textParts.push(c.text);
        } else if (c.type === 'image') {
          imageParts.push({ type: 'image', data: c.data, mimeType: c.mimeType || 'image/png' });
        } else if (typeof c === 'string') {
          textParts.push(c);
        } else {
          textParts.push(JSON.stringify(c));
        }
      }
      result = textParts.join('\n');
      // 如果有图片，附加到 response 中
      if (imageParts.length > 0) {
        result = result || '(图片内容)';
        // 将图片数据存储，供前端使用
        r._images = imageParts;
      }
    }
    
    let resultStr = typeof result === 'string' ? result : JSON.stringify(result);
    
    // 截断 take_snapshot 结果，限制返回的元素数量
    if (tool === 'take_snapshot' && resultStr.length > 3000) {
      const lines = resultStr.split('\n');
      const maxLines = params.maxElements || 150; // 默认最多150个元素
      if (lines.length > maxLines) {
        resultStr = lines.slice(0, maxLines).join('\n') + `\n\n... (内容已截断，共 ${lines.length} 行，显示前 ${maxLines} 行)`;
      }
    }
    
    // 记录成功的调用
    const historyId = isRetry ? originalId : history.add(tool, params, true, resultStr);
    
    // 如果是重试，更新原记录
    if (isRetry && originalId) {
      history.updateById(originalId, {
        success: true,
        resultPreview: resultStr.substring(0, 500),
        retriedAt: new Date().toISOString(),
        error: null
      });
    }
    
    logger.tool(tool, params, resultStr.slice(0, 200));
    
    // 如果有活跃录制，记录此步骤
    for (const [recId, rec] of (recorder.activeRecordings instanceof Map ? recorder.activeRecordings : [])) {
      if (rec.status === 'recording') {
        recorder.recordStep(recId, {
          tool,
          params,
          result: { success: true, result: resultStr },
          duration: Date.now() - (message.startTime || Date.now())
        });
      }
    }
    
    const response = {
      type: 'tool_result',
      id,
      historyId,
      tool,
      success: true,
      result: isRetry ? `[重试 #${historyId}] ${resultStr}` : `[#${historyId}] ${resultStr}`
    };
    // 如果有图片数据，保存到临时文件并附加路径信息
    if (r && r._images && r._images.length > 0) {
      const savedPaths = [];
      for (let i = 0; i < r._images.length; i++) {
        const img = r._images[i];
        const ext = img.mimeType === 'image/jpeg' ? 'jpg' : 'png';
        const imgPath = `/private/tmp/media-${id}-${i}.${ext}`;
        try {
          writeFileSync(imgPath, Buffer.from(img.data, 'base64'));
          savedPaths.push(imgPath);
        } catch (e) {
          logger.error(`[WS] 保存图片失败: ${e.message}`);
        }
      }
      if (savedPaths.length > 0) {
        response.result += `\n图片已保存: ${savedPaths.join(', ')}`;
        response.images = savedPaths;
      }
    }
    ws.send(JSON.stringify(response));
    logger.info(`[WS] 发送结果: id=${id}, tool=${tool}, historyId=${historyId}`);
  } catch (e) {
    // 使用错误分类器分析错误
    const classified = errorClassifier.wrapError(e, tool);
    
    logger.error(`工具执行失败: ${tool} [${classified.errorType}]`, { error: e.message });

    // ── AutoHealer: 尝试自愈 ──
    if (autoHealer && !isRetry) {
      try {
        const healResult = await autoHealer.tryHeal(e.message || String(e), tool, params);
        
        if (healResult.healed && healResult.retry) {
          const retryTool = healResult.modifiedTool || tool;
          const retryParams = healResult.modifiedParams || params;
          logger.info(`[AutoHealer] 自愈成功 (${healResult.message})，重试 ${retryTool}`);
          try {
            const callOptions = message.params?.timeout ? { timeout: parseInt(message.params.timeout) } : {};
            const r = await hub.call(retryTool, retryParams, callOptions);
            let result = r;
            if (r && r.content && Array.isArray(r.content)) {
              result = r.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
            }
            let resultStr = typeof result === 'string' ? result : JSON.stringify(result);
            const historyId = history.add(retryTool, retryParams, true, resultStr);
            logger.info(`[AutoHealer] 重试成功: ${retryTool}`);
            
            ws.send(JSON.stringify({
              type: 'tool_result',
              id,
              historyId,
              tool: retryTool,
              success: true,
              result: `[#${historyId}] [自愈: ${healResult.message}] ${resultStr}`
            }));
            return;
          } catch (retryErr) {
            logger.warn(`[AutoHealer] 重试也失败: ${retryErr.message}`);
            // 继续走正常失败流程
          }
        }
        
        // 自愈有建议但无法自动修复，附加到错误信息
        if (healResult.suggestion) {
          classified.suggestion = (classified.suggestion || '') + '\n[AutoHealer] ' + healResult.suggestion;
        }
      } catch (healErr) {
        logger.warn(`[AutoHealer] 自愈过程异常: ${healErr.message}`);
      }
    }

    // ── 正常失败流程 ──
    const historyId = isRetry ? originalId : history.add(tool, params, false, null, e.message);
    
    if (isRetry && originalId) {
      history.updateById(originalId, {
        retriedAt: new Date().toISOString(),
        error: e.message,
        errorType: classified.errorType
      });
    }
    
    // 如果有活跃录制，记录失败步骤
    for (const [recId, rec] of (recorder.activeRecordings instanceof Map ? recorder.activeRecordings : [])) {
      if (rec.status === 'recording') {
        recorder.recordStep(recId, {
          tool,
          params,
          result: { success: false, error: e.message, errorType: classified.errorType },
          duration: Date.now() - (message.startTime || Date.now())
        });
      }
    }
    
    ws.send(JSON.stringify({
      type: 'tool_result',
      id,
      historyId,
      tool,
      success: false,
      errorType: classified.errorType,
      recoverable: classified.recoverable,
      suggestion: classified.suggestion,
      error: `[#${historyId}] 错误: ${e.message}`
    }));
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
  
  await hub.start();

  // 初始化任务引擎
  taskEngine = new TaskEngine(logger, hub, safety, errorClassifier);
  logger.info('[Main] TaskEngine 已初始化');

  // ── 工具路由器 (Phase 1 灰度) ──
  router = new Router(logger);
  metrics = new Metrics(logger);
  router.setFallback(handleToolCall);
  await router.loadDrivers({ processManager, logger, addToHistory: history.add, hub });
  logger.info("[Router] 工具路由器已初始化, tools: " + JSON.stringify(router.listTools()));

  // 初始化自验证器和目标管理器
  const selfValidator = new SelfValidator(logger, hub);
  const goalManager = new GoalManager(logger, selfValidator, taskEngine.stateManager);
  const asyncExecutor = new AsyncExecutor(logger);
  autoHealer = new AutoHealer(logger, hub);
  // [已删除] resultCache, contextCompressor
  
  // 第三阶段模块: 智能任务规划、工作流模板、断点续传
  // [已删除] taskPlanner, checkpointManager, workflowTemplate 初始化
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
              clearTimeout(pending.timeout);
              browserToolPending.delete(msg.callId);
              if (msg.success) {
                logger.info(`[BrowserTool] 结果返回: ${msg.callId}`);
                pending.resolve(msg.result);
              } else {
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
          
          case 'create_goal':
            {
              const goal = goalManager.createGoal(
                msg.goalId || `goal-${Date.now()}`,
                msg.definition
              );
              ws.send(JSON.stringify({ type: 'goal_created', goal }));
            }
            break;
          
          case 'execute_goal':
            {
              logger.info(`[WS] 执行目标: ${msg.goalId}`);
              const result = await goalManager.executeGoal(
                msg.goalId,
                (progress) => {
                  ws.send(JSON.stringify({ type: 'goal_progress', ...progress }));
                }
              );
              ws.send(JSON.stringify({ type: 'goal_complete', ...result }));
            }
            break;
          
          case 'goal_status':
            {
              const status = goalManager.getGoalStatus(msg.goalId);
              ws.send(JSON.stringify({ type: 'goal_status_result', ...status }));
            }
            break;
          
          case 'list_goals':
            {
              const goals = goalManager.listGoals();
              ws.send(JSON.stringify({ type: 'goals_list', ...goals }));
            }
            break;
          
          case 'validated_execute':
            {
              // 带验证的单工具执行
              logger.info(`[WS] 验证执行: ${msg.tool}`);
              const result = await selfValidator.executeWithValidation(
                msg.tool,
                msg.params,
                msg.options || {}
              );
              ws.send(JSON.stringify({ 
                type: 'validated_result', 
                tool: msg.tool,
                ...result 
              }));
            }
            break;

          // ===== 异步命令执行 =====
          case 'async_execute':
            {
              // 异步执行命令（自动后台+日志监控）
              logger.info(`[WS] 异步执行: ${msg.command?.slice(0, 50)}...`);
              const result = await asyncExecutor.execute(
                msg.command,
                {
                  forceAsync: msg.forceAsync || false,
                  timeout: msg.timeout || 30000,
                  onOutput: (output) => {
                    // 实时发送输出
                    ws.send(JSON.stringify({
                      type: 'async_output',
                      processId: result?.processId,
                      output
                    }));
                  }
                }
              );
              ws.send(JSON.stringify({
                type: 'async_result',
                ...result
              }));
            }
            break;

          case 'async_status':
            {
              // 获取异步进程状态
              const status = asyncExecutor.getProcessStatus(msg.processId);
              ws.send(JSON.stringify({
                type: 'async_status_result',
                ...status
              }));
            }
            break;

          case 'async_stop':
            {
              // 停止异步进程
              const result = asyncExecutor.stopProcess(msg.processId);
              ws.send(JSON.stringify({
                type: 'async_stop_result',
                processId: msg.processId,
                ...result
              }));
            }
            break;

          case 'async_log':
            {
              // 读取异步进程日志
              const result = asyncExecutor.readLog(msg.processId, msg.tail || 100);
              ws.send(JSON.stringify({
                type: 'async_log_result',
                processId: msg.processId,
                ...result
              }));
            }
            break;


          
          // ===== 录制相关 =====
          case 'start_recording':
            {
              const result = recorder.startRecording(
                msg.name || msg.recordingId || `rec-${Date.now()}`,
                msg.name
              );
              ws.send(JSON.stringify({ type: 'recording_started', ...result }));
            }
            break;
          
          case 'stop_recording':
            {
              const result = recorder.stopRecording(msg.recordingId);
              ws.send(JSON.stringify({ type: 'recording_stopped', ...result }));
            }
            break;
          
          case 'list_recordings':
            {
              const recordings = recorder.listRecordings();
              ws.send(JSON.stringify({ type: 'recordings_list', recordings }));
            }
            break;
          
          case 'load_recording':
            {
              const result = recorder.loadRecording(msg.recordingId);
              ws.send(JSON.stringify({ type: 'recording_loaded', ...result }));
            }
            break;
          
          case 'replay_recording':
            {
              const loadResult = recorder.loadRecording(msg.recordingId);
              if (!loadResult.success) {
                ws.send(JSON.stringify({ type: 'replay_error', error: loadResult.error }));
                break;
              }
              
              // 转换为 tool_batch 格式并执行 (支持参数化和循环)
              const replayOptions = {
                variables: msg.variables || {},
                foreach: msg.foreach || null,
                foreachVar: msg.foreachVar || 'item',
                stopOnError: msg.stopOnError !== false
              };
              const batch = recorder.toToolBatch(loadResult.recording, replayOptions);
              
              const paramInfo = Object.keys(replayOptions.variables).length > 0 
                ? `, 参数: ${JSON.stringify(replayOptions.variables)}` : '';
              const loopInfo = replayOptions.foreach 
                ? `, 循环: ${replayOptions.foreach.length} 次` : '';
              logger.info(`[WS] 回放录制: ${msg.recordingId}, ${batch.steps.length} 步${paramInfo}${loopInfo}`);
              
              const result = await taskEngine.executeBatch(
                batch.id,
                batch.steps,
                batch.options,
                (stepResult) => {
                  ws.send(JSON.stringify({
                    type: 'replay_step_result',
                    recordingId: msg.recordingId,
                    ...stepResult
                  }));
                }
              );
              
              ws.send(JSON.stringify({
                type: 'replay_complete',
                recordingId: msg.recordingId,
                ...result
              }));
            }
            break;
          
          case 'delete_recording':
            {
              const result = recorder.deleteRecording(msg.recordingId);
              ws.send(JSON.stringify({ type: 'recording_deleted', ...result }));
            }
            break;
          
          // ===== 新增: 历史记录相关 =====
          case 'list_history':
            const count = msg.count || 20;
            const history = history.get(count);
            ws.send(JSON.stringify({ 
              type: 'history_list', 
              history: history.map(h => ({
                id: h.id,
                timestamp: h.timestamp,
                tool: h.tool,
                params: h.params,
                success: h.success,
                error: h.error,
                preview: h.resultPreview?.substring(0, 100)
              }))
            }));
            break;
            
          case 'retry':
            const entry = history.getById(msg.historyId);
            if (!entry) {
              ws.send(JSON.stringify({
                type: 'tool_result',
                id: msg.id,
                success: false,
                error: `找不到历史记录 #${msg.historyId}`
              }));
            } else {
              logger.info(`重试历史命令 #${entry.id}: ${entry.tool}`);
              await handleToolCall(ws, {
                tool: entry.tool,
                params: entry.params,
                id: msg.id
              }, true, entry.id);
            }
            break;
            
          case 'get_history_detail':
            const detail = history.getById(msg.historyId);
            ws.send(JSON.stringify({
              type: 'history_detail',
              entry: detail || null
            }));
            break;
          
          // Skills 相关
          case 'list_skills':
            ws.send(JSON.stringify({ 
              type: 'skills_list', 
              skills: skillsManager.getSkillsList() 
            }));
            break;
            
          case 'get_skills_prompt':
            ws.send(JSON.stringify({ 
              type: 'skills_prompt', 
              prompt: skillsManager.getSystemPrompt() 
            }));
            break;
            
          case 'get_skill_reference':
            const ref = skillsManager.getReference(msg.skill, msg.reference);
            ws.send(JSON.stringify({ 
              type: 'skill_reference', 
              skill: msg.skill,
              reference: msg.reference,
              content: ref 
            }));
            break;
            
          case 'list_skill_references':
            const refs = skillsManager.listReferences(msg.skill);
            ws.send(JSON.stringify({ 
              type: 'skill_references_list', 
              skill: msg.skill,
              references: refs 
            }));
            break;
          
          // ===== 跨扩展通信 =====
          case 'register_agent':
            if (msg.agentId) {
              registerAgent(ws, msg.agentId, msg.site || 'unknown');
              ws.send(JSON.stringify({
                type: 'agent_registered',
                agentId: msg.agentId,
                success: true
              }));
            }
            break;
          
          case 'cross_extension_send':
            if (msg.to && msg.message) {
              const fromAgent = msg.from || 'unknown';
              const result = sendCrossExtensionMessage(fromAgent, msg.to, msg.message);
              ws.send(JSON.stringify({
                type: 'cross_extension_result',
                ...result,
                to: msg.to
              }));
            }
            break;
          
          case 'list_online_agents':
            ws.send(JSON.stringify({
              type: 'online_agents',
              agents: getOnlineAgents()
            }));
            break;

          case 'broadcast':
            // 转发消息给所有其他客户端（用于 bridge -> background.js -> content.js）
            if (msg.payload) {
              logger.info("广播消息: " + (msg.payload.type || "unknown"));
              for (const client of clients) {
                if (client !== ws && client.readyState === 1) {
                  client.send(JSON.stringify(msg.payload));
                }
              }
              ws.send(JSON.stringify({ type: "broadcast_result", success: true }));
            }
            break;
            
          default:
            logger.warning(`未知消息类型: ${msg.type}`);
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
      const agentId = unregisterAgent(ws);
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
