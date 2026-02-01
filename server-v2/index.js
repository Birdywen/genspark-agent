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

  send(method, params = {}) {
    const id = ++this.requestId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.process.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('timeout'));
        }
      }, this.requestTimeout);
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

  call(name, args) {
    // 如果工具名有前缀，提取原始名称发送给 MCP server
    const originalName = name.includes(':') ? name.split(':')[1] : name;
    return this.send('tools/call', { name: originalName, arguments: args || {} });
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

  async call(tool, args) {
    const c = this.findConn(tool);
    if (!c) throw new Error('工具未找到: ' + tool);
    return c.call(tool, args);
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

// 初始化录制器
const recorder = new Recorder(logger, path.join(__dirname, 'recordings'));

// ==================== 工具调用处理（含历史记录）====================
async function handleToolCall(ws, message, isRetry = false, originalId = null) {
  const { tool, params, id } = message;
  
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
    const r = await hub.call(tool, params);
    let result = r;
    
    if (r && r.content && Array.isArray(r.content)) {
      result = r.content.map(c => c.text || c).join('\n');
    }
    
    let resultStr = typeof result === 'string' ? result : JSON.stringify(result);
    
    // 截断 take_snapshot 结果，限制返回的元素数量
    if (tool === 'take_snapshot' && resultStr.length > 8000) {
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
    ws.send(JSON.stringify(response));
    logger.info(`[WS] 发送结果: id=${id}, tool=${tool}, historyId=${historyId}`);
  } catch (e) {
    // 使用错误分类器分析错误
    const classified = errorClassifier.wrapError(e, tool);
    
    const historyId = isRetry ? originalId : addToHistory(tool, params, false, null, e.message);
    
    // 如果是重试，更新原记录
    if (isRetry && originalId) {
      const entry = getHistoryById(originalId);
      if (entry) {
        entry.retriedAt = new Date().toISOString();
        entry.error = e.message;
        entry.errorType = classified.errorType;
        saveHistory();
      }
    }
    
    logger.error(`工具执行失败: ${tool} [${classified.errorType}]`, { error: e.message });
    
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
  const autoHealer = new AutoHealer(logger, hub);
  const resultCache = new ResultCache(logger);
  const contextCompressor = new ContextCompressor(logger);
  logger.info('[Main] SelfValidator, GoalManager, AsyncExecutor, AutoHealer, ResultCache, ContextCompressor 已初始化');

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
                msg.recordingId || `rec-${Date.now()}`,
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
              
              // 转换为 tool_batch 格式并执行
              const batch = recorder.toToolBatch(loadResult.recording);
              logger.info(`[WS] 回放录制: ${msg.recordingId}, ${batch.steps.length} 步`);
              
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
