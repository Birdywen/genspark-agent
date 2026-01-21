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

// 安全检查
function isPathAllowed(filePath) {
  const resolved = path.resolve(filePath);
  return ALLOWED_PATHS.some(allowed => resolved.startsWith(allowed));
}

function isCommandAllowed(command) {
  const cmd = command.trim().split(/\s+/)[0];
  return ALLOWED_COMMANDS.includes(cmd);
}

// 创建 MCP Server
const server = new Server(
  { name: 'genspark-agent', version: '1.0.0' },
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
    }
  ]
}));

// 处理工具调用
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'read_file': {
        if (!isPathAllowed(args.path)) {
          return { content: [{ type: 'text', text: `错误: 路径不允许 ${args.path}` }] };
        }
        const content = await fs.readFile(args.path, 'utf-8');
        return { content: [{ type: 'text', text: content }] };
      }

      case 'write_file': {
        if (!isPathAllowed(args.path)) {
          return { content: [{ type: 'text', text: `错误: 路径不允许 ${args.path}` }] };
        }
        await fs.writeFile(args.path, args.content, 'utf-8');
        return { content: [{ type: 'text', text: `已写入文件: ${args.path}` }] };
      }

      case 'list_directory': {
        if (!isPathAllowed(args.path)) {
          return { content: [{ type: 'text', text: `错误: 路径不允许 ${args.path}` }] };
        }
        const items = await fs.readdir(args.path, { withFileTypes: true });
        const result = items.map(item => ({
          name: item.name,
          type: item.isDirectory() ? 'directory' : 'file'
        }));
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'execute_shell': {
        if (!isCommandAllowed(args.command)) {
          return { content: [{ type: 'text', text: `错误: 命令不在白名单: ${args.command}` }] };
        }
        const { stdout, stderr } = await execAsync(args.command, { timeout: 30000 });
        return { content: [{ type: 'text', text: stdout || stderr || '(无输出)' }] };
      }

      case 'search_files': {
        if (!isPathAllowed(args.directory)) {
          return { content: [{ type: 'text', text: `错误: 路径不允许 ${args.directory}` }] };
        }
        const { stdout } = await execAsync(
          `find "${args.directory}" -name "${args.pattern}" -type f 2>/dev/null | head -50`
        );
        return { content: [{ type: 'text', text: stdout || '未找到匹配文件' }] };
      }

      default:
        return { content: [{ type: 'text', text: `未知工具: ${name}` }] };
    }
  } catch (error) {
    return { content: [{ type: 'text', text: `错误: ${error.message}` }] };
  }
});

// 启动服务器
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Genspark MCP Server 已启动');
}

main().catch(console.error);
