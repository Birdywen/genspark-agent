// Genspark Agent Server - 主入口
// WebSocket 服务器 + 工具执行器

import { WebSocketServer } from 'ws';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import Logger from './logger.js';
import Safety from './safety.js';
import Tools from './tools.js';
import MCPClient from './mcp-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 加载配置
const config = JSON.parse(readFileSync(path.join(__dirname, 'config.json'), 'utf-8'));

// 初始化模块
const logger = new Logger(config.logging);
const safety = new Safety(config.safety, logger);
const tools = new Tools(config.safety, safety, logger);

// 可选：初始化浏览器 MCP Client
let mcpClient = null;
async function initBrowser() {
  if (mcpClient) return mcpClient;
  mcpClient = new MCPClient(logger);
  await mcpClient.start({
    headless: config.browser?.headless,
    userDataDir: config.browser?.userDataDir
  });
  logger.success('Playwright MCP 已启动');
  return mcpClient;
}

// 存储连接的客户端
const clients = new Set();

// 广播消息给所有客户端
function broadcast(message) {
  const data = JSON.stringify(message);
  clients.forEach(client => {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(data);
    }
  });
}

// 发送确认请求到扩展
function requestConfirmation(id, operation, params) {
  broadcast({
    type: 'confirm_operation',
    id,
    operation,
    params
  });
}

// 处理工具调用
async function handleToolCall(ws, message) {
  const { tool, params, id } = message;
  
  logger.info(`收到工具调用请求: ${tool}`, { id, params });

  let result;
  
  // 检查是否是浏览器工具
  if (tool.startsWith('browser_')) {
    try {
      const mcp = await initBrowser();
      const mcpResult = await mcp.call(tool, params);
      result = { success: true, result: mcpResult };
    } catch (e) {
      result = { success: false, error: e.message };
    }
  } else {
    result = await tools.execute(tool, params, requestConfirmation);
  }

  // 发送结果回扩展
  ws.send(JSON.stringify({
    type: 'tool_result',
    id,
    tool,
    ...result
  }));
}

// 处理确认结果
function handleConfirmResult(message) {
  const { id, approved } = message;
  safety.handleConfirmation(id, approved);
}

// 启动任务
function handleStartTask(ws, message) {
  const { task } = message;
  logger.info(`启动新任务: ${task}`);

  // 发送工具列表和任务到扩展
  ws.send(JSON.stringify({
    type: 'start_task',
    task,
    tools: tools.getDefinitions()
  }));
}

// 创建 WebSocket 服务器
const wss = new WebSocketServer({ 
  port: config.server.port,
  host: config.server.host
});

wss.on('connection', (ws) => {
  clients.add(ws);
  logger.success(`客户端已连接，当前连接数: ${clients.size}`);

  // 发送欢迎消息和工具列表
  ws.send(JSON.stringify({
    type: 'connected',
    message: 'Genspark Agent Server 已连接',
    tools: tools.getDefinitions()
  }));

  // 更新工具列表
  ws.send(JSON.stringify({
    type: 'update_tools',
    tools: tools.getDefinitions()
  }));

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      logger.info(`收到消息: ${message.type}`, message);

      switch (message.type) {
        case 'tool_call':
          await handleToolCall(ws, message);
          break;

        case 'confirm_result':
          handleConfirmResult(message);
          break;

        case 'start_task':
          handleStartTask(ws, message);
          break;

        case 'agent_stopped':
          logger.warning('Agent 已停止');
          break;

        case 'task_complete':
          logger.success(`任务完成: ${message.summary}`);
          break;

        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;

        default:
          logger.warning(`未知消息类型: ${message.type}`);
      }
    } catch (error) {
      logger.error('处理消息失败', { error: error.message });
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    logger.info(`客户端断开，当前连接数: ${clients.size}`);
  });

  ws.on('error', (error) => {
    logger.error('WebSocket 错误', { error: error.message });
  });
});

// 启动消息
console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🤖 Genspark Agent Server                                ║
║                                                           ║
║   WebSocket: ws://${config.server.host}:${config.server.port}                     ║
║                                                           ║
║   可用工具: ${tools.getDefinitions().length} 个                                   ║
║   安全路径: ${config.safety.allowedPaths[0]}               
║                                                           ║
║   等待 Chrome 扩展连接...                                 ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
`);

logger.info('服务器已启动', { 
  port: config.server.port, 
  host: config.server.host 
});
