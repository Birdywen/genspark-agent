#!/usr/bin/env node
// MCP Server - Model Context Protocol 标准实现
// 可被 Claude Desktop 或其他 MCP 客户端调用

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// 配置
const ALLOWED_PATHS = [
  '/Users/yay/workspace',
  '/Users/yay/Documents',
  '/Users/yay/Downloads',
  '/Users/yay/Desktop',
  '/tmp'
];

const ALLOWED_COMMANDS = [
  'ls', 'cat', 'head', 'tail', 'echo', 'pwd', 'date', 'whoami', 'which',
  'grep', 'sed', 'awk', 'find', 'wc', 'sort', 'uniq', 'cut', 'diff',
  'python', 'python3', 'node', 'npm', 'npx',
  'curl', 'wget', 'git', 'mkdir', 'touch', 'cp', 'mv',
  'tar', 'zip', 'unzip', 'open', 'pbcopy', 'pbpaste'
];

// ==================== 命令历史管理 ====================
const HISTORY_FILE = '/tmp/mcp-command-history.json';
const MAX_HISTORY = 50;  // 最多保存50条

let commandHistory = [];
let historyIdCounter = 1;

// 加载历史记录
async function loadHistory() {
  try {
    const data = await fs.readFile(HISTORY_FILE, 'utf-8');
    const saved = JSON.parse(data);
    commandHistory = saved.history || [];
    historyIdCounter = saved.nextId || 1;
  } catch (e) {
    // 文件不存在或解析失败，使用默认值
    commandHistory = [];
    historyIdCounter = 1;
  }
}

// 保存历史记录
async function saveHistory() {
  try {
    await fs.writeFile(HISTORY_FILE, JSON.stringify({
      history: commandHistory,
      nextId: historyIdCounter
    }, null, 2));
  } catch (e) {
    console.error('保存历史记录失败:', e.message);
  }
}

// 添加历史记录
function addToHistory(toolName, args, success, resultPreview) {
  const entry = {
    id: historyIdCounter++,
    timestamp: new Date().toISOString(),
    tool: toolName,
    args: args,
    success: success,
    resultPreview: resultPreview?.substring(0, 200) || ''
  };
  
  commandHistory.push(entry);
  
  // 保持历史记录在限制内
  if (commandHistory.length > MAX_HISTORY) {
    commandHistory = commandHistory.slice(-MAX_HISTORY);
  }
  
  // 异步保存，不阻塞返回
  saveHistory();
  
  return entry.id;
}

// 获取历史记录
function getHistory(count = 10) {
  return commandHistory.slice(-count).reverse();
}

// 根据 ID 获取历史记录
function getHistoryById(id) {
  return commandHistory.find(h => h.id === id);
}

// ==================== 安全检查 ====================
function isPathAllowed(filePath) {
  const resolved = path.resolve(filePath);
  return ALLOWED_PATHS.some(allowed => resolved.startsWith(allowed));
}

function isCommandAllowed(command) {
  const cmd = command.trim().split(/\s+/)[0];
  return ALLOWED_COMMANDS.includes(cmd);
}

// ==================== 工具执行逻辑 ====================
async function executeTool(name, args, isRetry = false) {
  let result;
  let success = true;
  
  try {
    switch (name) {
      case 'read_file': {
        if (!isPathAllowed(args.path)) {
          result = `错误: 路径不允许 ${args.path}`;
          success = false;
        } else {
          result = await fs.readFile(args.path, 'utf-8');
        }
        break;
      }

      case 'write_file': {
        if (!isPathAllowed(args.path)) {
          result = `错误: 路径不允许 ${args.path}`;
          success = false;
        } else {
          await fs.writeFile(args.path, args.content, 'utf-8');
          result = `已写入文件: ${args.path} (${args.content.length} 字符)`;
        }
        break;
      }

      case 'list_directory': {
        if (!isPathAllowed(args.path)) {
          result = `错误: 路径不允许 ${args.path}`;
          success = false;
        } else {
          const items = await fs.readdir(args.path, { withFileTypes: true });
          const list = items.map(item => ({
            name: item.name,
            type: item.isDirectory() ? 'directory' : 'file'
          }));
          result = JSON.stringify(list, null, 2);
        }
        break;
      }

      case 'execute_shell': {
        if (!isCommandAllowed(args.command)) {
          result = `错误: 命令不在白名单: ${args.command}`;
          success = false;
        } else {
          const { stdout, stderr } = await execAsync(args.command, { timeout: 30000 });
          result = stdout || stderr || '(无输出)';
        }
        break;
      }

      case 'search_files': {
        if (!isPathAllowed(args.directory)) {
          result = `错误: 路径不允许 ${args.directory}`;
          success = false;
        } else {
          const { stdout } = await execAsync(
            `find "${args.directory}" -name "${args.pattern}" -type f 2>/dev/null | head -50`
          );
          result = stdout || '未找到匹配文件';
        }
        break;
      }

      default:
        result = `未知工具: ${name}`;
        success = false;
    }
  } catch (error) {
    result = `错误: ${error.message}`;
    success = false;
  }

  // 记录历史（retry 命令本身和 history 命令不记录）
  if (!isRetry && name !== 'list_history' && name !== 'retry') {
    const historyId = addToHistory(name, args, success, result);
    // 在结果前面加上 ID 提示
    result = `[#${historyId}] ${result}`;
  }

  return { content: [{ type: 'text', text: result }] };
}

// ==================== 创建 MCP Server ====================
const server = new Server(
  { name: 'genspark-agent', version: '1.1.0' },
  { capabilities: { tools: {} } }
);

// 定义可用工具
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'read_file',
      description: '读取文件内容',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' }
        },
        required: ['path']
      }
    },
    {
      name: 'write_file',
      description: '写入文件内容',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' },
          content: { type: 'string', description: '文件内容' }
        },
        required: ['path', 'content']
      }
    },
    {
      name: 'list_directory',
      description: '列出目录内容',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '目录路径' }
        },
        required: ['path']
      }
    },
    {
      name: 'execute_shell',
      description: '执行 Shell 命令（仅限白名单命令）',
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell 命令' }
        },
        required: ['command']
      }
    },
    {
      name: 'search_files',
      description: '搜索文件',
      inputSchema: {
        type: 'object',
        properties: {
          directory: { type: 'string', description: '搜索目录' },
          pattern: { type: 'string', description: '文件名模式，如 *.js' }
        },
        required: ['directory', 'pattern']
      }
    },
    // ===== 新增：历史记录相关工具 =====
    {
      name: 'list_history',
      description: '列出最近的命令执行历史，可用于查看历史 ID 以便重试',
      inputSchema: {
        type: 'object',
        properties: {
          count: { type: 'number', description: '显示数量，默认 10' }
        }
      }
    },
    {
      name: 'retry',
      description: '根据历史 ID 重新执行之前的命令。当命令执行失败时，用户只需说"重试 #ID"即可',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'number', description: '历史记录 ID（如 #42 中的 42）' }
        },
        required: ['id']
      }
    }
  ]
}));

// 处理工具调用
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // 处理历史记录相关命令
  if (name === 'list_history') {
    const count = args.count || 10;
    const history = getHistory(count);
    
    if (history.length === 0) {
      return { content: [{ type: 'text', text: '暂无历史记录' }] };
    }
    
    const formatted = history.map(h => {
      const status = h.success ? '✓' : '✗';
      const argsPreview = JSON.stringify(h.args).substring(0, 80);
      return `#${h.id} [${status}] ${h.tool}(${argsPreview}...)\n    时间: ${h.timestamp}`;
    }).join('\n\n');
    
    return { content: [{ type: 'text', text: `最近 ${history.length} 条命令:\n\n${formatted}` }] };
  }

  if (name === 'retry') {
    const entry = getHistoryById(args.id);
    
    if (!entry) {
      return { content: [{ type: 'text', text: `错误: 找不到历史记录 #${args.id}` }] };
    }
    
    console.error(`[Retry] 重新执行 #${entry.id}: ${entry.tool}`);
    
    // 重新执行，标记为 retry 避免重复记录
    const result = await executeTool(entry.tool, entry.args, true);
    
    // 更新原历史记录的状态
    entry.success = !result.content[0].text.startsWith('错误');
    entry.resultPreview = result.content[0].text.substring(0, 200);
    entry.retryAt = new Date().toISOString();
    saveHistory();
    
    return { content: [{ type: 'text', text: `[重试 #${entry.id}] ${result.content[0].text}` }] };
  }

  // 执行普通工具
  return await executeTool(name, args);
});

// ==================== 启动服务器 ====================
async function main() {
  // 加载历史记录
  await loadHistory();
  
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Genspark MCP Server v1.1.0 已启动 (支持命令重试)');
}

main().catch(console.error);
