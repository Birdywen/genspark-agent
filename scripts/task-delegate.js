#!/usr/bin/env node
/**
 * Task Delegate v1.0 - 将任务委派给 DeepSeek/Kimi 执行
 * 
 * 用法:
 *   node task-delegate.js "创建一个 /tmp/test.txt 文件，内容为 hello world"
 *   node task-delegate.js --model moonshot-v1-auto "任务描述"
 *   node task-delegate.js --model deepseek-chat --max-turns 10 "任务描述"
 * 
 * 工作原理:
 *   1. 把 MCP 工具列表 + 任务发给 DeepSeek/Kimi
 *   2. 模型输出结构化工具调用
 *   3. 脚本通过 WebSocket 执行工具
 *   4. 把结果喂回模型
 *   5. 循环直到任务完成
 */

const WebSocket = require('/Users/yay/workspace/genspark-agent/server-v2/node_modules/ws');
const https = require('https');
const http = require('http');
const path = require('path');

// === 配置 ===
const ONEMIN_API_KEY = 'c81dc363907e8c1777e37fde4c6abd319135d71fa4a4a7c723c00ae6f4dc6da4';
const ONEMIN_API = 'https://api.1min.ai/api/features';
const WS_URL = 'ws://localhost:8765';
const DEFAULT_MODEL = 'deepseek-chat';
const MAX_TURNS = 15;
const TOOL_TIMEOUT = 30000;

// === 解析参数 ===
const args = process.argv.slice(2);
let model = DEFAULT_MODEL;
let maxTurns = MAX_TURNS;
let task = '';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--model' && args[i + 1]) { model = args[++i]; }
  else if (args[i] === '--max-turns' && args[i + 1]) { maxTurns = parseInt(args[++i]); }
  else { task += (task ? ' ' : '') + args[i]; }
}

if (!task) {
  console.error('用法: node task-delegate.js [--model deepseek-chat] [--max-turns 15] "任务描述"');
  console.error('模型: deepseek-chat, moonshot-v1-auto, gpt-4.1-mini, claude-sonnet-4-20250514');
  process.exit(1);
}

// === 颜色输出 ===
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', cyan: '\x1b[36m', gray: '\x1b[90m',
};

function log(prefix, color, msg) {
  console.log(`${color}${prefix}${C.reset} ${msg}`);
}

// === WebSocket 工具执行 ===
let ws = null;
let toolCallbacks = {};

function connectWS() {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(WS_URL);
    ws.on('open', () => {
      log('[WS]', C.green, '已连接');
      resolve();
    });
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        // 工具结果回调
        if (msg.id && toolCallbacks[msg.id]) {
          toolCallbacks[msg.id](msg);
          delete toolCallbacks[msg.id];
        }
        // 工具列表回调
        if (msg.tools && toolCallbacks['__tools__']) {
          toolCallbacks['__tools__'](msg);
          delete toolCallbacks['__tools__'];
        }
      } catch (e) {}
    });
    ws.on('error', (e) => reject(e));
    ws.on('close', () => { log('[WS]', C.yellow, '断开'); });
  });
}

function getTools() {
  return new Promise((resolve, reject) => {
    toolCallbacks['__tools__'] = (msg) => resolve(msg.tools || []);
    ws.send(JSON.stringify({ type: 'get_tools' }));
    setTimeout(() => reject(new Error('获取工具列表超时')), 5000);
  });
}

function callTool(tool, params) {
  return new Promise((resolve, reject) => {
    const id = 'delegate_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    toolCallbacks[id] = (msg) => {
      const result = msg.result || msg.content || msg.error || JSON.stringify(msg);
      resolve(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
    };
    ws.send(JSON.stringify({
      type: 'tool_call',
      id,
      tool,
      params
    }));
    setTimeout(() => {
      if (toolCallbacks[id]) {
        delete toolCallbacks[id];
        reject(new Error(`工具 ${tool} 执行超时 (${TOOL_TIMEOUT / 1000}s)`));
      }
    }, TOOL_TIMEOUT);
  });
}

// === 1min.ai API 调用 ===
function callAI(messages) {
  return new Promise((resolve, reject) => {
    // 把 messages 数组拼成单个 prompt（1min.ai 不支持 messages 格式）
    let prompt = '';
    for (const msg of messages) {
      if (msg.role === 'system') prompt += msg.content + '\n\n';
      else if (msg.role === 'user') prompt += `[用户] ${msg.content}\n\n`;
      else if (msg.role === 'assistant') prompt += `[助手] ${msg.content}\n\n`;
    }

    const body = JSON.stringify({
      type: 'CHAT_WITH_AI',
      model: model,
      promptObject: { prompt: prompt.trim() }
    });

    const url = new URL(ONEMIN_API);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'API-KEY': ONEMIN_API_KEY,
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const d = JSON.parse(data);
          const rec = d.aiRecord || {};
          const detail = rec.aiRecordDetail || {};
          const result = detail.resultObject || [''];
          const text = result[0] || '';
          const credits = rec.credits_used || '?';
          log('[AI]', C.gray, `(${credits} credits)`);
          resolve(text);
        } catch (e) {
          reject(new Error('AI 响应解析失败: ' + data.substring(0, 200)));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// === 构造 System Prompt ===
function buildSystemPrompt(tools) {
  // 筛选常用工具，避免 prompt 太长
  const usefulTools = tools.filter(t => {
    const name = t.name;
    return ['read_file', 'read_text_file', 'write_file', 'edit_file', 'list_directory',
            'directory_tree', 'search_files', 'run_process', 'find_text', 'get_symbols',
            'create_directory', 'move_file', 'get_file_info'].includes(name);
  });

  const toolDocs = usefulTools.map(t => {
    const params = t.inputSchema?.properties || {};
    const required = t.inputSchema?.required || [];
    const paramList = Object.entries(params).map(([k, v]) => {
      const req = required.includes(k) ? '必填' : '可选';
      return `    ${k} (${v.type || 'string'}, ${req}): ${v.description || ''}`;
    }).join('\n');
    return `  ${t.name}: ${t.description || ''}\n${paramList}`;
  }).join('\n\n');

  return `你是一个任务执行 Agent。你可以通过工具调用来完成任务。

## 可用工具

${toolDocs}

## 工具调用格式

当你需要调用工具时，输出以下格式（必须严格遵守）：

\`\`\`tool_call
{"tool": "工具名", "params": {"参数名": "参数值"}}
\`\`\`

重要规则：
1. 每次回复最多调用一个工具
2. tool_call 必须是合法 JSON
3. run_process 用于执行命令: {"tool": "run_process", "params": {"command": "bash", "stdin": "echo hello"}}
4. 等待工具执行结果后再决定下一步
5. 任务完成后输出: @DONE 并简要说明完成了什么
6. 如果遇到错误，分析原因并尝试修复，最多重试 2 次
7. 禁止编造工具执行结果

## 环境
- macOS arm64 (Apple Silicon)
- 可用命令: bash, python3, node, git, curl, jq, sed, awk
- 允许目录: /Users/yay/workspace, /tmp, /private/tmp
- 注意: macOS 的 /tmp 实际是 /private/tmp`;
}

// === 解析工具调用 ===
function parseToolCall(text) {
  const match = text.match(/```tool_call\s*\n([\s\S]*?)```/);
  if (!match) return null;
  try {
    return JSON.parse(match[1].trim());
  } catch (e) {
    log('[解析]', C.red, `工具调用 JSON 无效: ${match[1].trim()}`);
    return null;
  }
}

// === 主循环 ===
async function main() {
  log('[任务]', C.bold + C.cyan, task);
  log('[模型]', C.blue, model);
  log('[最大轮次]', C.blue, String(maxTurns));
  console.log('');

  // 连接 WebSocket
  await connectWS();

  // 获取工具列表
  const tools = await getTools();
  log('[工具]', C.green, `已加载 ${tools.length} 个工具`);

  // 构造对话
  const systemPrompt = buildSystemPrompt(tools);
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `请执行以下任务：\n\n${task}` }
  ];

  for (let turn = 1; turn <= maxTurns; turn++) {
    log(`\n[轮次 ${turn}/${maxTurns}]`, C.bold + C.yellow, '调用 AI...');

    const response = await callAI(messages);

    if (!response || response.length < 2) {
      log('[错误]', C.red, 'AI 返回空响应');
      break;
    }

    // 显示 AI 回复（截断显示）
    const displayText = response.length > 500 ? response.substring(0, 500) + '...' : response;
    console.log(`${C.gray}${displayText}${C.reset}`);

    messages.push({ role: 'assistant', content: response });

    // 检查是否完成
    if (response.includes('@DONE')) {
      log('\n[完成]', C.bold + C.green, '任务已完成');
      break;
    }

    // 解析工具调用
    const toolCall = parseToolCall(response);
    if (!toolCall) {
      // 没有工具调用也没有 @DONE，提醒模型
      messages.push({ role: 'user', content: '请继续执行任务。如果需要执行操作，请使用工具调用格式。如果已完成，请输出 @DONE。' });
      continue;
    }

    log('[工具调用]', C.cyan, `${toolCall.tool}(${JSON.stringify(toolCall.params).substring(0, 100)})`);

    try {
      const result = await callTool(toolCall.tool, toolCall.params);
      const truncResult = result.length > 3000 ? result.substring(0, 3000) + '\n...(输出截断)' : result;
      log('[结果]', C.green, truncResult.substring(0, 200) + (truncResult.length > 200 ? '...' : ''));
      messages.push({ role: 'user', content: `工具执行结果:\n\`\`\`\n${truncResult}\n\`\`\`` });
    } catch (e) {
      log('[错误]', C.red, e.message);
      messages.push({ role: 'user', content: `工具执行失败: ${e.message}` });
    }
  }

  // 清理
  if (ws) ws.close();
  process.exit(0);
}

main().catch(e => {
  console.error(`${C.red}致命错误: ${e.message}${C.reset}`);
  if (ws) ws.close();
  process.exit(1);
});