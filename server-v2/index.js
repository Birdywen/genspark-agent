// Genspark Agent Server v2 - 整合版
// MCP Hub + 安全检查 + 日志记录 + Skills 系统 + 命令重试

import { WebSocketServer } from 'ws';
import { spawn } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import Logger from './logger.js';
import Safety from './safety.js';
import SkillsManager from './skills.js';
import { existsSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(path.join(__dirname, 'config.json'), 'utf-8'));

// 初始化日志和安全模块
const logger = new Logger(config.logging);
const safety = new Safety(config.safety, logger);

// 初始化 Skills 管理器
const skillsManager = new SkillsManager();
skillsManager.load();

// ==================== 命令历史管理 ====================
const HISTORY_FILE = path.join(__dirname, 'command-history.json');
const MAX_HISTORY = 100;

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
  
  if (commandHistory.length > MAX_HISTORY) {
    commandHistory = commandHistory.slice(-MAX_HISTORY);
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
    return (r.tools || []).map(t => ({ ...t, _server: this.name }));
  }

  call(name, args) {
    return this.send('tools/call', { name, arguments: args || {} });
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
}

const hub = new MCPHub();

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
    
    const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
    
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
    const historyId = isRetry ? originalId : addToHistory(tool, params, false, null, e.message);
    
    // 如果是重试，更新原记录
    if (isRetry && originalId) {
      const entry = getHistoryById(originalId);
      if (entry) {
        entry.retriedAt = new Date().toISOString();
        entry.error = e.message;
        saveHistory();
      }
    }
    
    logger.error(`工具执行失败: ${tool}`, { error: e.message });
    ws.send(JSON.stringify({
      type: 'tool_result',
      id,
      historyId,
      tool,
      success: false,
      error: `[#${historyId}] 错误: ${e.message}`
    }));
  }
}

// ==================== 主函数 ====================
async function main() {
  // 加载历史记录
  loadHistory();
  
  await hub.start();

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
      logger.info(`客户端断开, 当前连接数: ${clients.size}`);
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
