// Genspark Agent Server v2 - 整合版
// MCP Hub + 安全检查 + 日志记录 + Skills 系统 + 命令重试

import { WebSocketServer } from 'ws';
import { spawn } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
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
import ResultCache from './result-cache.js';
import ContextCompressor from './context-compressor.js';
import TaskPlanner from './task-planner.js';
import WorkflowTemplate from './workflow-template.js';
import CheckpointManager from './checkpoint-manager.js';
import ProcessManager from './process-manager.js';
import { existsSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 展开配置中的环境变量 ${VAR_NAME}
function expandEnvVars(obj) {
  if (typeof obj === 'string') {
    return obj.replace(/\$\{([^}]+)\}/g, (_, name) => process.env[name] || '');
  }
  if (Array.isArray(obj)) {
    return obj.map(expandEnvVars);
  }
  if (obj && typeof obj === 'object') {
    const result = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = expandEnvVars(v);
    }
    return result;
  }
  return obj;
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
const HISTORY_FILE = path.join(__dirname, 'command-history.json');
const ARCHIVE_DIR = path.join(__dirname, 'history-archives');
const MAX_HISTORY = 500;  // 保留更多历史供上下文恢复
const ARCHIVE_THRESHOLD = 400;  // 超过此数量时归档旧记录

let commandHistory = [];
let historyIdCounter = 1;

function loadHistory() {
  try {
    if (existsSync(HISTORY_FILE)) {
      const data = JSON.parse(readFileSync(HISTORY_FILE, 'utf-8'));
      commandHistory = data.history || [];
      historyIdCounter = data.nextId || 1;
      logger.info(`加载了 ${commandHistory.length} 条历史记录`);
    }
  } catch (e) {
    logger.warning('加载历史记录失败: ' + e.message);
    commandHistory = [];
    historyIdCounter = 1;
  }
}

function saveHistory() {
  try {
    writeFileSync(HISTORY_FILE, JSON.stringify({
      history: commandHistory,
      nextId: historyIdCounter
    }, null, 2));
  } catch (e) {
    logger.warning('保存历史记录失败: ' + e.message);
  }
}

// 归档旧历史记录
function archiveOldHistory() {
  try {
    // 确保归档目录存在
    if (!existsSync(ARCHIVE_DIR)) {
      mkdirSync(ARCHIVE_DIR, { recursive: true });
    }
    
    // 计算要归档的数量（保留最近 ARCHIVE_THRESHOLD 条）
    const toArchive = commandHistory.slice(0, commandHistory.length - ARCHIVE_THRESHOLD);
    commandHistory = commandHistory.slice(-ARCHIVE_THRESHOLD);
    
    if (toArchive.length === 0) return;
    
    // 生成归档文件名（按日期）
    const date = new Date().toISOString().split('T')[0];
    const archiveFile = path.join(ARCHIVE_DIR, `archive-${date}.json`);
    
    // 如果当天已有归档，追加；否则新建
    let archiveData = { archived: [], meta: {} };
    if (existsSync(archiveFile)) {
      archiveData = JSON.parse(readFileSync(archiveFile, 'utf-8'));
    }
    
    archiveData.archived.push(...toArchive);
    archiveData.meta.lastUpdate = new Date().toISOString();
    archiveData.meta.count = archiveData.archived.length;
    archiveData.meta.idRange = {
      from: archiveData.archived[0]?.id,
      to: archiveData.archived[archiveData.archived.length - 1]?.id
    };
    
    writeFileSync(archiveFile, JSON.stringify(archiveData, null, 2));
    logger.info(`归档了 ${toArchive.length} 条历史记录到 ${archiveFile}`);
  } catch (e) {
    logger.warning('归档历史记录失败: ' + e.message);
    // 归档失败时，简单截断
    commandHistory = commandHistory.slice(-MAX_HISTORY);
  }
}

function addToHistory(tool, params, success, resultPreview, error = null) {
  const entry = {
    id: historyIdCounter++,
    timestamp: new Date().toISOString(),
    tool,
    params,
    success,
    resultPreview: (resultPreview || '').substring(0, 500),
    error: error || null
  };
  
  commandHistory.push(entry);
  
  // 自动归档：当超过阈值时，归档旧记录
  if (commandHistory.length > MAX_HISTORY) {
    archiveOldHistory();
  }
  
  saveHistory();
  
  
  return entry.id;
}

function getHistory(count = 20) {
  return commandHistory.slice(-count).reverse();
}

function getHistoryById(id) {
  return commandHistory.find(h => h.id === id);
}

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

// 广播消息
function broadcast(message) {
  const data = typeof message === 'string' ? message : JSON.stringify(message);
  clients.forEach(client => {
    if (client.readyState === 1) client.send(data);
  });
}

class MCPConnection {
  constructor(name, cmd, args, env = {}, options = {}) {
    this.name = name;
    this.cmd = cmd;
    this.args = args;
    this.env = env;
    this.startupTimeout = options.startupTimeout || 5000;
    this.requestTimeout = options.requestTimeout || 60000;
    this.process = null;
    this.requestId = 0;
    this.pending = new Map();
    this.buffer = '';
    this.tools = [];
    this.ready = false;
  }

  async start() {
    logger.info(`[${this.name}] 启动中...`);
    
    this.process = spawn(this.cmd, this.args, { 
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...this.env }
    });
    
    this.process.stdout.on('data', d => this.onData(d));
    this.process.stderr.on('data', d => logger.warning(`[${this.name}] stderr: ${d.toString().trim()}`));
    this.process.on('error', e => logger.error(`[${this.name}] error: ${e.message}`));
    this.process.on('close', code => {
      if (!this.ready) {
        logger.warning(`[${this.name}] 进程退出, code: ${code}`);
      }
    });
    
    await new Promise(r => setTimeout(r, this.startupTimeout));
    
    if (this.process.exitCode !== null) {
      throw new Error(`进程已退出, code: ${this.process.exitCode}`);
    }
    
    await this.init();
    this.tools = await this.getTools();
    this.ready = true;
    logger.success(`[${this.name}] 就绪, ${this.tools.length} 个工具`);
    // 打印工具名（截断），方便在日志中确认每个 MCP server 暴露了哪些 tools
    try {
      const names = this.tools.map(t => t.name);
      const preview = names.slice(0, 40);
      logger.info(`[${this.name}] tools: ${preview.join(', ')}${names.length > preview.length ? ` ... (+${names.length - preview.length})` : ''}`);
    } catch (e) {
      logger.warning(`[${this.name}] tools 列表打印失败: ${e.message}`);
    }
  }

  onData(data) {
    this.buffer += data.toString();
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop();
    
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
        }
      } catch {}
    }
  }

  send(method, params = {}, options = {}) {
    const id = ++this.requestId;
    const timeout = options.timeout || this.requestTimeout;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.process.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('timeout'));
        }
      }, timeout);
    });
  }

  async init() {
    await this.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'genspark-agent', version: '2.0' }
    });
    this.process.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
  }

  async getTools() {
    const r = await this.send('tools/list');
    // 对 ssh 开头的 server 添加前缀避免工具名冲突
    const needsPrefix = this.name.startsWith('ssh');
    return (r.tools || []).map(t => ({
      ...t,
      name: needsPrefix ? `${this.name}:${t.name}` : t.name,
      _originalName: t.name,
      _server: this.name
    }));
  }

  call(name, args, options = {}) {
    // 如果工具名有前缀，提取原始名称发送给 MCP server
    const originalName = name.includes(':') ? name.split(':')[1] : name;
    return this.send('tools/call', { name: originalName, arguments: args || {} }, options);
  }

  stop() {
    this.process?.kill();
  }
}

class MCPHub {
  constructor() {
    this.conns = new Map();
    this.tools = [];
  }

  async start() {
    for (const [name, cfg] of Object.entries(config.mcpServers)) {
      const options = {
        startupTimeout: cfg.startupTimeout || 5000,
        requestTimeout: cfg.requestTimeout || 60000
      };
      
      const c = new MCPConnection(name, cfg.command, cfg.args, cfg.env, options);
      try {
        await c.start();
        this.conns.set(name, c);
        this.tools.push(...c.tools);
      } catch (e) {
        logger.error(`[${name}] 启动失败: ${e.message}`);
      }
    }
    logger.success(`MCP Hub 就绪, 总工具数: ${this.tools.length}`);
  }

  findConn(tool) {
    for (const [, c] of this.conns) {
      if (c.tools.some(t => t.name === tool)) return c;
    }
    return null;
  }

  async call(tool, args, options = {}) {
    const c = this.findConn(tool);
    if (!c) throw new Error('工具未找到: ' + tool);
    return c.call(tool, args, options);
  }

  stop() {
    for (const [, c] of this.conns) c.stop();
  }

  // 热刷新：重新加载所有 MCP 连接和工具
  async reload() {
    logger.info('[MCPHub] 开始热刷新...');
    
    // 1. 停止所有现有连接
    for (const [name, c] of this.conns) {
      logger.info(`[MCPHub] 停止 ${name}`);
      c.stop();
    }
    this.conns.clear();
    this.tools = [];
    
    // 2. 重新读取配置
    const newConfig = JSON.parse(readFileSync(path.join(__dirname, 'config.json'), 'utf-8'));
    const expandedConfig = expandEnvVars(newConfig);
    
    // 3. 重新启动所有 MCP server
    for (const [name, cfg] of Object.entries(expandedConfig.mcpServers)) {
      const options = {
        startupTimeout: cfg.startupTimeout || 5000,
        requestTimeout: cfg.requestTimeout || 60000
      };
      
      const c = new MCPConnection(name, cfg.command, cfg.args, cfg.env, options);
      try {
        await c.start();
        this.conns.set(name, c);
        this.tools.push(...c.tools);
      } catch (e) {
        logger.error(`[${name}] 重启失败: ${e.message}`);
      }
    }
    
    logger.success(`[MCPHub] 热刷新完成, 总工具数: ${this.tools.length}`);
    return { success: true, toolCount: this.tools.length };
  }
}

const hub = new MCPHub();

// 初始化重试管理器
const retryManager = new RetryManager(logger, errorClassifier);

// TaskEngine 将在 main() 中 hub.start() 后初始化
let taskEngine = null;
let autoHealer = null;

// 初始化录制器
const recorder = new Recorder(logger, path.join(__dirname, 'recordings'));

// 初始化后台进程管理器
const processManager = new ProcessManager();

// ==================== 工具调用处理（含历史记录）====================
// 工具别名映射
const TOOL_ALIASES = {
  'run_command': { target: 'run_process', transform: (p) => ({ command_line: p.command, mode: 'shell', ...(p.stdin && { stdin: p.stdin }), ...(p.stdinFile && { stdinFile: p.stdinFile }), ...(p.timeout && { timeout_ms: p.timeout * 1000 }), ...(p.cwd && { cwd: p.cwd }) }) },
  'bg_run': null,
  'bg_status': null,
  'bg_kill': null
};

async function handleToolCall(ws, message, isRetry = false, originalId = null) {
  let { tool, params, id } = message;
  
  // 后台进程管理器 - 直接处理，不走 MCP
  if (tool === 'bg_run' || tool === 'bg_status' || tool === 'bg_kill') {
    const historyId = addToHistory(tool, params, true, null, null);
    let result;
    if (tool === 'bg_run') {
      result = processManager.run(params.command, { cwd: params.cwd, shell: params.shell }, (completedSlot) => {
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
  if (tool === 'run_command' && params.command && !params.stdin && !params.stdinFile) {
    const cmd = params.command.trim();
    // 正常的 command 应该是 "bash", "python3", "/usr/bin/env" 等
    // 如果没有 stdin 但 command 包含空格且不像路径，说明参数被损坏
    if (cmd.includes(' ') && !cmd.startsWith('/') && !cmd.startsWith('./')) {
      logger.warning(`[防御] run_command 参数异常: command="${cmd}" 无 stdin，疑似参数拼接损跳过执行`);
      const historyId = addToHistory(tool, params, false, null, '参数损坏: command 和 stdin 被拼接');
      ws.send(JSON.stringify({
        type: 'tool_result', id, historyId, tool,
        success: false,
        error: `[#${historyId}] 参数异常: command="${cmd}" (无stdin)，疑似 SSE 传输损坏，等待重试`
      }));
      return;
    }
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
    ];
    const isLong = longPatterns.some(p => p.test(cmd));
    if (isLong && !params._noAutoRoute) {
      logger.info(`[智能路由] run_command → bg_run (检测到长时间命令)`);
      const historyId = addToHistory('bg_run', params, true, null, null);
      const result = processManager.run(params.command, { cwd: params.cwd });
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

  // 别名映射
  if (TOOL_ALIASES[tool]) {
    const alias = TOOL_ALIASES[tool];
    if (alias) {
      logger.info(`工具别名: ${tool} → ${alias.target}`);
      params = alias.transform ? alias.transform(params) : params;
      tool = alias.target;
    }
  }
  
  // ── 复杂命令自动脚本化：防止转义问题 ──
  // 策略：检测到复杂命令时，将原始命令写入临时脚本文件再执行
  // 这样即使上游 SSE 传输已丢字符，至少 server→shell 这段不会二次损坏
  if (tool === 'run_process' && params.command_line && !params._noAutoScript) {
    const cmd = params.command_line;
    const hasHighRiskChars = /['"`$\\|&;(){}\[\]]/.test(cmd);
    const isLong = cmd.length > 200;
    const hasNestedQuotes = (cmd.match(/'/g) || []).length >= 2 && (cmd.match(/"/g) || []).length >= 2;
    const hasPipe = cmd.includes(' | ');
    
    if ((isLong && hasHighRiskChars) || hasNestedQuotes || (isLong && hasPipe)) {
      try {
        const scriptPath = `/private/tmp/cmd_${Date.now()}.sh`;
        writeFileSync(scriptPath, `#!/bin/bash\n${cmd}\n`, { mode: 0o755 });
        logger.info(`[AutoScript] 复杂命令写入脚本: ${scriptPath} (${cmd.length} chars)`);
        params = { ...params, command_line: `bash ${scriptPath}`, _noAutoScript: true };
      } catch (e) {
        logger.warn(`[AutoScript] 写入脚本失败: ${e.message}`);
      }
    }
  }

  logger.info(`${isRetry ? '[重试] ' : ''}工具调用: ${tool}`, params);

  // 安全检查
  const safetyCheck = await safety.checkOperation(tool, params || {}, broadcast);
  
  if (!safetyCheck.allowed) {
    logger.warning(`安全检查未通过: ${safetyCheck.reason}`);
    
    // 记录失败的调用
    const historyId = addToHistory(tool, params, false, null, safetyCheck.reason);
    
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
    // ── payload file 引用解析：从临时文件读取大段内容 ──
    const fileRefFields = [['contentFile', 'content'], ['stdinFile', 'stdin'], ['codeFile', 'code']];
    for (const [fileField, targetField] of fileRefFields) {
      if (params[fileField] && typeof params[fileField] === 'string') {
        try {
          const fileContent = readFileSync(params[fileField], 'utf-8');
          params[targetField] = fileContent;
          const _tmpFile = params[fileField];
          delete params[fileField];
          logger.info('[PayloadFile] 从文件加载 ' + targetField + ': ' + fileContent.length + ' chars <- ' + params[fileField]);
          // 清理临时文件
          try { unlinkSync(_tmpFile); } catch(e) {}
        } catch (e) {
          logger.warning('[PayloadFile] 读取失败 ' + fileField + ': ' + e.message);
        }
      }
    }

    // ── base64 内容解码：彻底解决 SSE 传输转义损坏 ──
    // 当 content/stdin/code 字段以 'base64:' 前缀开头时，自动解码
    const BASE64_PREFIX = 'base64:';
    const base64Fields = ['content', 'stdin', 'code'];
    for (const field of base64Fields) {
      if (params[field] && typeof params[field] === 'string' && params[field].startsWith(BASE64_PREFIX)) {
        try {
          params[field] = Buffer.from(params[field].slice(BASE64_PREFIX.length), 'base64').toString('utf-8');
          logger.info(`[Base64Decode] 解码字段 ${field}: ${params[field].length} chars`);
        } catch (e) {
          logger.warning(`[Base64Decode] 解码失败 ${field}: ${e.message}`);
        }
      }
    }
    // edits 数组中的 oldText/newText 也支持 base64
    if (params.edits && Array.isArray(params.edits)) {
      for (const edit of params.edits) {
        for (const ef of ['oldText', 'newText']) {
          if (edit[ef] && typeof edit[ef] === 'string' && edit[ef].startsWith(BASE64_PREFIX)) {
            try {
              edit[ef] = Buffer.from(edit[ef].slice(BASE64_PREFIX.length), 'base64').toString('utf-8');
            } catch (e) {
              logger.warning(`[Base64Decode] edits.${ef} 解码失败: ${e.message}`);
            }
          }
        }
      }
    }

    // 支持灵活 timeout: 从原始 message 中提取
    const callTimeout = message.params?.timeout ? parseInt(message.params.timeout) : undefined;
    const callOptions = callTimeout ? { timeout: callTimeout } : {};
    const r = await hub.call(tool, params, callOptions);
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
    const historyId = isRetry ? originalId : addToHistory(tool, params, true, resultStr);
    
    // 如果是重试，更新原记录
    if (isRetry && originalId) {
      const entry = getHistoryById(originalId);
      if (entry) {
        entry.success = true;
        entry.resultPreview = resultStr.substring(0, 500);
        entry.retriedAt = new Date().toISOString();
        entry.error = null;
        saveHistory();
      }
    }
    
    logger.tool(tool, params, resultStr.slice(0, 200));
    
    // 如果有活跃录制，记录此步骤
    for (const [recId, rec] of recorder.activeRecordings) {
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
            const historyId = addToHistory(retryTool, retryParams, true, resultStr);
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
    const historyId = isRetry ? originalId : addToHistory(tool, params, false, null, e.message);
    
    if (isRetry && originalId) {
      const entry = getHistoryById(originalId);
      if (entry) {
        entry.retriedAt = new Date().toISOString();
        entry.error = e.message;
        entry.errorType = classified.errorType;
        saveHistory();
      }
    }
    
    // 如果有活跃录制，记录失败步骤
    for (const [recId, rec] of recorder.activeRecordings) {
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
async function main() {
  // 加载历史记录
  loadHistory();
  
  await hub.start();

  // 初始化任务引擎
  taskEngine = new TaskEngine(logger, hub, safety, errorClassifier);
  logger.info('[Main] TaskEngine 已初始化');

  // 初始化自验证器和目标管理器
  const selfValidator = new SelfValidator(logger, hub);
  const goalManager = new GoalManager(logger, selfValidator, taskEngine.stateManager);
  const asyncExecutor = new AsyncExecutor(logger);
  autoHealer = new AutoHealer(logger, hub);
  const resultCache = new ResultCache(logger);
  const contextCompressor = new ContextCompressor(logger);
  
  // 第三阶段模块: 智能任务规划、工作流模板、断点续传
  const taskPlanner = new TaskPlanner(logger, taskEngine.stateManager);
  const checkpointManager = new CheckpointManager(logger, taskEngine.stateManager);
  const workflowTemplate = new WorkflowTemplate(logger, taskPlanner);
  logger.info('[Main] SelfValidator, GoalManager, AsyncExecutor, AutoHealer, ResultCache, ContextCompressor, TaskPlanner, WorkflowTemplate, CheckpointManager 已初始化');

  // 启动时运行健康检查
  const healthStatus = await healthChecker.runAll(hub);
  if (!healthStatus.healthy) {
    logger.warning('⚠️  部分组件异常，请查看上方日志');
  }

  const wss = new WebSocketServer({
    port: config.server.port,
    host: config.server.host
  });

  // 浏览器工具的 pending Promise 管理
  const browserToolPending = new Map();

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
          case 'tool_call':
            await handleToolCall(ws, msg);
            break;
            
          case 'confirm_result':
            safety.handleConfirmation(msg.id, msg.approved);
            break;
            
          case 'ping':
            ws.send('{"type":"pong"}');
            break;

          case 'browser_tool_result': {
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
          
          // ===== 目标驱动执行 =====
          
          // ===== 第三阶段: 智能规划、工作流、断点续传 =====
          case "task_plan":
            {
              if (!taskPlanner) {
                ws.send(JSON.stringify({ type: "plan_error", error: "TaskPlanner 未初始化" }));
                break;
              }
              try {
                const plan = taskPlanner.analyze(msg.params.goal || msg.params.task || msg.params.steps, msg.params.context || {});
                const visualization = taskPlanner.visualize(plan);
                ws.send(JSON.stringify({ type: "plan_result", plan, visualization }));
                logger.info("[WS] 任务规划完成:", plan.id);
              } catch (e) {
                ws.send(JSON.stringify({ type: "plan_error", error: e.message }));
              }
            }
            break;
          
          case "workflow_execute":
            logger.info("[WS] workflow_execute FULL MSG:", JSON.stringify(msg));
            {
              if (!workflowTemplate || !taskEngine) {
                ws.send(JSON.stringify({ type: "workflow_error", error: "WorkflowTemplate 未初始化" }));
                break;
              }
              try {
                const { template, variables: vars } = msg.params;
                const workflow = workflowTemplate.instantiate(template, vars || {});
                if (!workflow.success) {
                  ws.send(JSON.stringify({ type: "workflow_error", error: workflow.error, missing: workflow.missing }));
                  break;
                }
                logger.info("[WS] 执行工作流:", workflow.workflowId);
                // 创建检查点
                const checkpoint = checkpointManager.create(workflow.workflowId, {
                  steps: workflow.steps,
                  description: workflow.name,
                  source: "workflow"
                });
                // 执行工作流步骤
                const result = await taskEngine.executeBatch(
                  workflow.workflowId,
                  workflow.steps,
                  { stopOnError: false },
                  (stepResult) => {
                    checkpointManager.updateStep(checkpoint.id, stepResult.stepIndex, stepResult);
                    ws.send(JSON.stringify({ type: "workflow_step", workflowId: workflow.workflowId, ...stepResult }));
                  }
                );
                checkpointManager.complete(checkpoint.id);
                ws.send(JSON.stringify({ type: "workflow_complete", ...result, workflowId: workflow.workflowId }));
              } catch (e) {
                logger.error("[WS] 工作流执行失败:", e.message);
                ws.send(JSON.stringify({ type: "workflow_error", error: e.message }));
              }
            }
            break;
          
          case "task_resume":
            {
              if (!checkpointManager || !taskEngine) {
                ws.send(JSON.stringify({ type: "resume_error", error: "CheckpointManager 未初始化" }));
                break;
              }
              try {
                const { checkpointId, taskId } = msg.params;
                const cpId = checkpointId || taskId;
                const recovery = checkpointManager.recover(cpId);
                if (!recovery.success) {
                  ws.send(JSON.stringify({ type: "resume_error", error: recovery.error }));
                  break;
                }
                logger.info("[WS] 恢复任务:", cpId, "从步骤", recovery.resumeFrom);
                ws.send(JSON.stringify({ type: "resume_started", ...recovery }));
                // 执行剩余步骤
                const result = await taskEngine.executeBatch(
                  cpId + "_resumed",
                  recovery.pendingSteps.map(p => p.step),
                  recovery.options,
                  (stepResult) => {
                    checkpointManager.updateStep(cpId, recovery.resumeFrom + stepResult.stepIndex, stepResult);
                    ws.send(JSON.stringify({ type: "resume_step", checkpointId: cpId, ...stepResult }));
                  }
                );
                checkpointManager.complete(cpId);
                ws.send(JSON.stringify({ type: "resume_complete", checkpointId: cpId, ...result }));
              } catch (e) {
                logger.error("[WS] 断点续传失败:", e.message);
                ws.send(JSON.stringify({ type: "resume_error", error: e.message }));
              }
            }
            break;
          
          case "checkpoint_action":
            {
              if (!checkpointManager) {
                ws.send(JSON.stringify({ type: "checkpoint_error", error: "CheckpointManager 未初始化" }));
                break;
              }
              try {
                const { action, checkpointId, taskId } = msg.params;
                let result;
                switch (action) {
                  case "list":
                    result = { checkpoints: checkpointManager.list(msg.params.filter || {}) };
                    break;
                  case "get":
                    result = { checkpoint: checkpointManager.get(checkpointId || taskId) };
                    break;
                  case "delete":
                    result = { deleted: checkpointManager.delete(checkpointId || taskId) };
                    break;
                  case "pause":
                    result = { paused: checkpointManager.pause(checkpointId || taskId) };
                    break;
                  case "recoverable":
                    result = { recoverable: checkpointManager.listRecoverable() };
                    break;
                  case "cleanup":
                    result = { cleaned: checkpointManager.cleanup(msg.params.options || {}) };
                    break;
                  case "report":
                    result = { report: checkpointManager.generateReport(checkpointId || taskId) };
                    break;
                  default:
                    result = { error: "未知操作: " + action };
                }
                ws.send(JSON.stringify({ type: "checkpoint_result", action, ...result }));
              } catch (e) {
                ws.send(JSON.stringify({ type: "checkpoint_error", error: e.message }));
              }
            }
            break;
          
          case "list_templates":
            {
              if (!workflowTemplate) {
                ws.send(JSON.stringify({ type: "templates_error", error: "WorkflowTemplate 未初始化" }));
                break;
              }
              const templates = workflowTemplate.listTemplates();
              ws.send(JSON.stringify({ type: "templates_list", templates }));
            }
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

          // ===== 自动修复执行 =====
          case 'healed_execute':
            {
              logger.info(`[WS] 自修复执行: ${msg.tool}`);
              const result = await autoHealer.executeWithHealing(
                msg.tool,
                msg.params,
                msg.options || {}
              );
              ws.send(JSON.stringify({
                type: 'healed_result',
                tool: msg.tool,
                ...result
              }));
            }
            break;

          // ===== 缓存相关 =====
          case 'cached_execute':
            {
              // 先检查缓存
              const cached = resultCache.get(msg.tool, msg.params);
              if (cached) {
                logger.info(`[WS] 缓存命中: ${msg.tool}`);
                ws.send(JSON.stringify({
                  type: 'cached_result',
                  tool: msg.tool,
                  ...cached
                }));
              } else {
                // 执行并缓存
                logger.info(`[WS] 执行并缓存: ${msg.tool}`);
                const result = await hub.callTool(msg.tool, msg.params);
                resultCache.set(msg.tool, msg.params, { success: true, result });
                ws.send(JSON.stringify({
                  type: 'cached_result',
                  tool: msg.tool,
                  success: true,
                  result,
                  cached: false
                }));
              }
            }
            break;

          case 'cache_stats':
            {
              const stats = resultCache.getStats();
              ws.send(JSON.stringify({
                type: 'cache_stats_result',
                ...stats
              }));
            }
            break;

          case 'cache_clear':
            {
              const cleared = resultCache.clear();
              ws.send(JSON.stringify({
                type: 'cache_clear_result',
                cleared
              }));
            }
            break;

          case 'cache_invalidate':
            {
              const invalidated = resultCache.invalidate(msg.pattern);
              ws.send(JSON.stringify({
                type: 'cache_invalidate_result',
                pattern: msg.pattern,
                invalidated
              }));
            }
            break;

          // ===== 上下文压缩 =====
          // ===== 第三阶段: 智能任务规划 =====
          case 'plan_task':
            {
              logger.info('[WS] 任务规划请求');
              const plan = taskPlanner.analyze(msg.task, msg.context || {});
              ws.send(JSON.stringify({ 
                type: 'plan_result', 
                ...plan,
                visualization: plan.success ? taskPlanner.visualize(plan) : null
              }));
            }
            break;
          
          case 'list_patterns':
            {
              const patterns = Object.keys(taskPlanner.patterns);
              ws.send(JSON.stringify({ type: 'patterns_list', patterns }));
            }
            break;
          
          // ===== 工作流模板 =====
          case 'list_workflows':
            {
              const templates = workflowTemplate.listTemplates();
              ws.send(JSON.stringify({ type: 'workflows_list', templates }));
            }
            break;
          
          case 'get_workflow':
            {
              const template = workflowTemplate.getTemplate(msg.templateId);
              const docs = template ? workflowTemplate.generateDocs(msg.templateId) : null;
              ws.send(JSON.stringify({ type: 'workflow_detail', template, docs }));
            }
            break;
          
          case 'run_workflow':
            {
              logger.info('[WS] 执行工作流: ' + msg.templateId);
              const instance = workflowTemplate.instantiate(msg.templateId, msg.variables || {});
              
              if (!instance.success) {
                ws.send(JSON.stringify({ type: 'workflow_error', ...instance }));
                break;
              }
              
              // 创建检查点
              const checkpoint = checkpointManager.create(
                msg.taskId || 'wf-' + Date.now(),
                {
                  description: instance.templateName,
                  steps: instance.steps,
                  variables: instance.variables
                }
              );
              
              // 执行任务
              checkpointManager.updateState(checkpoint.id, 'running');
              
              const result = await taskEngine.executeBatch(
                checkpoint.id,
                instance.steps,
                { stopOnError: false },
                (stepResult) => {
                  checkpointManager.updateStep(checkpoint.id, stepResult.stepIndex, stepResult);
                  ws.send(JSON.stringify({ type: 'workflow_step', checkpointId: checkpoint.id, ...stepResult }));
                }
              );
              
              checkpointManager.updateState(checkpoint.id, result.success ? 'completed' : 'failed');
              ws.send(JSON.stringify({ 
                type: 'workflow_complete', 
                checkpointId: checkpoint.id,
                ...result 
              }));
            }
            break;
          
          case 'save_workflow':
            {
              const filePath = workflowTemplate.saveTemplate(msg.templateId, msg.template);
              ws.send(JSON.stringify({ type: 'workflow_saved', templateId: msg.templateId, filePath }));
            }
            break;
          
          // ===== 断点续传 =====
          case 'list_checkpoints':
            {
              const resumable = checkpointManager.listResumable();
              ws.send(JSON.stringify({ type: 'checkpoints_list', checkpoints: resumable }));
            }
            break;
          
          case 'checkpoint_status':
            {
              const checkpoint = checkpointManager.get(msg.taskId);
              const report = checkpoint ? checkpointManager.generateReport(msg.taskId) : null;
              ws.send(JSON.stringify({ type: 'checkpoint_detail', checkpoint, report }));
            }
            break;
          
          case 'resume_checkpoint':
            {
              logger.info('[WS] 恢复检查点: ' + msg.taskId);
              const resumeInfo = checkpointManager.resume(msg.taskId);
              
              if (!resumeInfo.success) {
                ws.send(JSON.stringify({ type: 'resume_error', ...resumeInfo }));
                break;
              }
              
              // 继续执行未完成的步骤
              const stepsToRun = resumeInfo.pendingSteps.map(p => p.step);
              
              checkpointManager.updateState(msg.taskId, 'running');
              
              const result = await taskEngine.executeBatch(
                msg.taskId,
                stepsToRun,
                { stopOnError: false, context: resumeInfo.context },
                (stepResult) => {
                  const actualIndex = resumeInfo.pendingSteps[stepResult.stepIndex]?.index ?? stepResult.stepIndex;
                  checkpointManager.updateStep(msg.taskId, actualIndex, stepResult);
                  ws.send(JSON.stringify({ type: 'resume_step', taskId: msg.taskId, ...stepResult }));
                }
              );
              
              checkpointManager.updateState(msg.taskId, result.success ? 'completed' : 'paused');
              ws.send(JSON.stringify({ 
                type: 'resume_complete', 
                taskId: msg.taskId,
                ...result,
                report: checkpointManager.generateReport(msg.taskId)
              }));
            }
            break;
          
          case 'delete_checkpoint':
            {
              checkpointManager.delete(msg.taskId);
              ws.send(JSON.stringify({ type: 'checkpoint_deleted', taskId: msg.taskId }));
            }
            break;
          
          case 'cleanup_checkpoints':
            {
              const cleaned = checkpointManager.cleanup(msg.maxAge);
              ws.send(JSON.stringify({ type: 'checkpoints_cleaned', count: cleaned }));
            }
            break;
          
          case 'compress_context':
            {
              logger.info(`[WS] 压缩上下文: ${msg.messages?.length || 0} 条消息`);
              const result = contextCompressor.compress(msg.messages || []);
              ws.send(JSON.stringify({
                type: 'compress_result',
                ...result
              }));
            }
            break;

          case 'compress_message':
            {
              const compressed = contextCompressor.compressMessage(
                msg.content,
                msg.maxLength || 2000
              );
              ws.send(JSON.stringify({
                type: 'compress_message_result',
                original: msg.content?.length || 0,
                compressed: compressed.length,
                content: compressed
              }));
            }
            break;

          case 'summarize_result':
            {
              const summary = contextCompressor.summarizeToolResult(
                msg.result,
                msg.toolName
              );
              ws.send(JSON.stringify({
                type: 'summarize_result_result',
                original: msg.result?.length || 0,
                summarized: summary.length,
                content: summary
              }));
            }
            break;

          case 'context_stats':
            {
              const stats = contextCompressor.getStats(msg.messages || []);
              ws.send(JSON.stringify({
                type: 'context_stats_result',
                ...stats
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
            const history = getHistory(count);
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
            const entry = getHistoryById(msg.historyId);
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
            const detail = getHistoryById(msg.historyId);
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
