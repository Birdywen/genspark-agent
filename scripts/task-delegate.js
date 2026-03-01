#!/usr/bin/env node
/**
 * Task Delegate v2.0 - 将任务委派给 Kimi/DeepSeek 执行
 * 
 * 用法:
 *   node task-delegate.js "任务描述"
 *   node task-delegate.js --model deepseek "任务描述"
 *   node task-delegate.js --model kimi --max-turns 20 "任务描述"
 * 
 * 通过原生 function calling (OpenAI 兼容格式) 调用工具
 */

const WebSocket = require('/Users/yay/workspace/genspark-agent/server-v2/node_modules/ws');
const https = require('https');
const fs = require('fs');
const path = require('path');

// === 从 .env.api 读取配置 ===
const envFile = fs.readFileSync('/Users/yay/workspace/genspark-agent/server-v2/.env.api', 'utf8');
const env = {};
envFile.split('\n').forEach(line => {
  const m = line.match(/^([A-Z_]+)=(.+)/);
  if (m) env[m[1]] = m[2];
});

const PROVIDERS = {
  kimi: {
    baseUrl: 'https://api.moonshot.ai/v1',
    apiKey: env.KIMI_API_KEY,
    model: 'moonshot-v1-128k',  // 用 128k 版本，支持长上下文
    name: 'Kimi'
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com',
    apiKey: env.DEEPSEEK_API_KEY,
    model: 'deepseek-chat',
    name: 'DeepSeek'
  }
};

const WS_URL = 'ws://localhost:8765';
const DEFAULT_PROVIDER = 'kimi';
const MAX_TURNS = 15;
const TOOL_TIMEOUT = 60000;

// === 解析参数 ===
const args = process.argv.slice(2);
let providerName = DEFAULT_PROVIDER;
let maxTurns = MAX_TURNS;
let task = '';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--model' && args[i + 1]) { providerName = args[++i]; }
  else if (args[i] === '--max-turns' && args[i + 1]) { maxTurns = parseInt(args[++i]); }
  else { task += (task ? ' ' : '') + args[i]; }
}

if (!task) {
  console.error('用法: node task-delegate.js [--model kimi|deepseek] [--max-turns 15] "任务描述"');
  process.exit(1);
}

const provider = PROVIDERS[providerName] || PROVIDERS[DEFAULT_PROVIDER];
if (!provider.apiKey) {
  console.error(`错误: ${providerName} API key 未配置`);
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
    ws.on('open', () => { log('[WS]', C.green, '已连接'); resolve(); });
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.id && toolCallbacks[msg.id]) {
          toolCallbacks[msg.id](msg);
          delete toolCallbacks[msg.id];
        }
        if (msg.tools && toolCallbacks['__tools__']) {
          toolCallbacks['__tools__'](msg);
          delete toolCallbacks['__tools__'];
        }
      } catch (e) {}
    });
    ws.on('error', reject);
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
    const id = 'td_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    toolCallbacks[id] = (msg) => {
      const result = msg.result || msg.content || msg.error || JSON.stringify(msg);
      resolve(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
    };
    ws.send(JSON.stringify({ type: 'tool_call', id, tool, params }));
    setTimeout(() => {
      if (toolCallbacks[id]) {
        delete toolCallbacks[id];
        reject(new Error(`工具 ${tool} 执行超时 (${TOOL_TIMEOUT / 1000}s)`));
      }
    }, TOOL_TIMEOUT);
  });
}

// === 构造 OpenAI function calling tools ===
function cleanSchema(schema) {
  if (!schema || typeof schema !== 'object') return { type: 'object', properties: {} };
  const cleaned = { type: 'object' };
  if (schema.properties) {
    cleaned.properties = {};
    for (const [key, val] of Object.entries(schema.properties)) {
      const prop = { ...val };
      // 确保每个属性都有 type
      if (!prop.type && prop.enum) prop.type = 'string';
      if (!prop.type && !prop.enum) prop.type = 'string';
      // 清理 array items
      if (prop.type === 'array' && prop.items && !prop.items.type) prop.items.type = 'string';
      cleaned.properties[key] = prop;
    }
  } else {
    cleaned.properties = {};
  }
  if (schema.required) cleaned.required = schema.required;
  return cleaned;
}

function buildFunctionTools(mcpTools) {
  const useful = ['read_file', 'read_text_file', 'write_file', 'edit_file',
    'list_directory', 'directory_tree', 'search_files', 'run_process',
    'find_text', 'get_symbols', 'create_directory', 'move_file',
    'get_file_info', 'read_multiple_files'];

  return mcpTools
    .filter(t => useful.includes(t.name))
    .map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description || t.name,
        parameters: cleanSchema(t.inputSchema)
      }
    }));
}

// === API 调用 (OpenAI 兼容) ===
function callAI(messages, tools) {
  return new Promise((resolve, reject) => {
    const url = new URL(provider.baseUrl + '/chat/completions');
    const body = JSON.stringify({
      model: provider.model,
      messages,
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: 'auto',
      max_tokens: 4096
    });

    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey}`,
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const d = JSON.parse(data);
          if (d.error) {
            reject(new Error(`API 错误: ${d.error.message || JSON.stringify(d.error)}`));
            return;
          }
          const choice = d.choices?.[0];
          if (!choice) {
            reject(new Error('API 返回无 choices'));
            return;
          }
          const usage = d.usage || {};
          log('[API]', C.gray, `tokens: ${usage.prompt_tokens || '?'}→${usage.completion_tokens || '?'}`);
          resolve(choice.message);
        } catch (e) {
          reject(new Error('响应解析失败: ' + data.substring(0, 300)));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// === System Prompt ===
const SYSTEM_PROMPT = `你是一个高效精确的任务执行 Agent。通过工具调用完成用户交给你的任务。

## 核心原则

1. **准确性第一** — 确保每一步的结果都是准确的，不估算、不猜测、不编造
2. **逐步验证** — 每次操作后验证结果，确认成功再进行下一步
3. **完整覆盖** — 如果任务涉及多个文件/项目，确保每一个都处理到，不能遗漏
4. **先读后写** — 修改文件前先读取确认内容，写入后读取验证

## 工具使用规则

- **run_process**: 执行 bash 命令，参数 mode="shell", command_line="命令"
- **read_multiple_files**: 一次最多读 3-4 个小文件，文件多时分批读取
- **write_file**: 写入完整文件内容
- **edit_file**: 小修改用 edit_file（需要提供 edits 数组，每项含 oldText 和 newText）
- 如果一个工具返回的结果被截断或不完整，用其他方式补充（如 run_process + wc -l）

## 数据收集要求

- 统计行数等数值时，优先用 run_process 执行 wc -l 等精确命令，而非从文件内容中数
- 分析文件用途时，读取文件头部注释（head -5）即可，不需要读完整文件
- 结果中不能有空白或 0 值（除非真实如此），发现有遗漏要补充

## 环境

- macOS arm64 (Apple Silicon)
- 可用: bash, python3, node, git, curl, jq, sed, awk
- 允许目录: /Users/yay/workspace, /private/tmp
- macOS 的 /tmp 实际是 /private/tmp

## 输出要求

- 任务完成后，用自然语言简要说明完成了什么
- 如果生成了文件，说明文件路径和内容摘要`;

// === 主循环 ===
async function main() {
  log('[任务]', C.bold + C.cyan, task);
  log('[模型]', C.blue, `${provider.name} (${provider.model})`);
  log('[轮次上限]', C.blue, String(maxTurns));
  console.log('');

  await connectWS();
  const mcpTools = await getTools();
  log('[工具]', C.green, `已加载 ${mcpTools.length} 个 MCP 工具`);

  const fnTools = buildFunctionTools(mcpTools);
  log('[函数]', C.green, `已注册 ${fnTools.length} 个 function tools`);

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: task }
  ];

  for (let turn = 1; turn <= maxTurns; turn++) {
    log(`\n[轮次 ${turn}/${maxTurns}]`, C.bold + C.yellow, '调用 AI...');

    let aiMsg;
    try {
      aiMsg = await callAI(messages, fnTools);
    } catch (e) {
      log('[错误]', C.red, e.message);
      break;
    }

    // 显示文本回复
    if (aiMsg.content) {
      const display = aiMsg.content.length > 500 ? aiMsg.content.substring(0, 500) + '...' : aiMsg.content;
      console.log(`${C.gray}${display}${C.reset}`);
    }

    // 加入对话历史
    messages.push(aiMsg);

    // 检查是否有工具调用
    const toolCalls = aiMsg.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      // 没有工具调用，任务应该完成了
      log('\n[完成]', C.bold + C.green, '任务已完成');
      break;
    }

    // 执行所有工具调用
    for (const tc of toolCalls) {
      const fnName = tc.function.name;
      let fnArgs;
      try {
        fnArgs = JSON.parse(tc.function.arguments);
      } catch (e) {
        log('[解析错误]', C.red, `${fnName} 参数无效: ${tc.function.arguments.substring(0, 100)}`);
        messages.push({ role: 'tool', tool_call_id: tc.id, content: '参数解析失败: ' + e.message });
        continue;
      }

      log('[工具]', C.cyan, `${fnName}(${JSON.stringify(fnArgs).substring(0, 120)})`);

      try {
        const result = await callTool(fnName, fnArgs);
        const trunc = result.length > 3000 ? result.substring(0, 3000) + '\n...(截断)' : result;
        log('[结果]', C.green, trunc.substring(0, 200) + (trunc.length > 200 ? '...' : ''));
        messages.push({ role: 'tool', tool_call_id: tc.id, content: trunc });
      } catch (e) {
        log('[失败]', C.red, e.message);
        messages.push({ role: 'tool', tool_call_id: tc.id, content: '执行失败: ' + e.message });
      }
    }
  }

  if (ws) ws.close();
  process.exit(0);
}

main().catch(e => {
  console.error(`${C.red}致命错误: ${e.message}${C.reset}`);
  if (ws) ws.close();
  process.exit(1);
});