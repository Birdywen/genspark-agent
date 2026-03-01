#!/usr/bin/env node
/**
 * Context Compress API v1.1 - 通过 ask_proxy API 自动压缩对话
 * 
 * 消息结构:
 *   [0] 原始 system prompt (保持标题)
 *   [1] user: echo hello (模拟连通性测试)
 *   [2] assistant: hello (模拟测试通过)
 *   [3] user: 压缩总结 (包含强制规则 + 上下文)
 * 
 * 用法:
 *   node context-compress-api.js <project_id> <tab_id> <summary_file> [first_msg_file]
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { WebSocket } = require(path.join(__dirname, '../server-v2/node_modules/ws'));

const WS_URL = 'ws://localhost:8765';
const MODEL = 'claude-opus-4-6';

// 参数解析
const args = process.argv.slice(2);
if (args.length < 3) {
  console.error(`
Context Compress API v1.1

用法:
  node context-compress-api.js <project_id> <tab_id> <summary_file> [first_msg_file]

参数:
  project_id     目标对话的 project ID
  tab_id         目标 tab ID (从 list_tabs 获取)
  summary_file   压缩总结文件
  first_msg_file 第一条消息文件 (默认: /private/tmp/first-msg.txt)
`);
  process.exit(1);
}

const projectId = args[0];
const tabId = parseInt(args[1], 10);
const summaryFile = args[2];
const firstMsgFile = args[3] || '/private/tmp/first-msg.txt';

const summary = fs.readFileSync(summaryFile, 'utf8').trim();
const firstMsg = fs.readFileSync(firstMsgFile, 'utf8').trim();

if (!summary) { console.error('❌ 空的压缩总结'); process.exit(1); }
if (!firstMsg) { console.error('❌ 空的第一条消息'); process.exit(1); }
if (isNaN(tabId)) { console.error('❌ tab_id 必须是数字'); process.exit(1); }

console.log('🔄 Context Compress API v1.1');
console.log(`   Project:   ${projectId}`);
console.log(`   Tab ID:    ${tabId}`);
console.log(`   1st msg:   ${firstMsg.length} chars`);
console.log(`   Summary:   ${summary.length} chars`);
console.log(`   Model:     ${MODEL}`);
console.log('');

// 构造消息序列
const messages = [
  { id: projectId, role: 'user', content: firstMsg },
  { id: crypto.randomUUID(), role: 'assistant', content: '**[执行结果]** `run_process` ✓ 成功:\n```\nhello\n```' },
  { id: crypto.randomUUID(), role: 'user', content: summary }
];

const requestBody = {
  ai_chat_model: MODEL,
  ai_chat_enable_search: false,
  ai_chat_disable_personalization: true,
  use_moa_proxy: false,
  moa_models: [],
  writingContent: null,
  type: 'ai_chat',
  project_id: projectId,
  messages: messages,
  user_s_input: summary.substring(0, 200),
  is_private: true,
  push_token: ''
};

const bodyHex = Buffer.from(JSON.stringify(requestBody), 'utf8').toString('hex');

const jsCode = `
var hex = '${bodyHex}';
var bytes = [];
for (var i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.substr(i, 2), 16));
var bodyJson = new TextDecoder().decode(new Uint8Array(bytes));

return fetch('/api/agent/ask_proxy', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  credentials: 'include',
  body: bodyJson
}).then(function(r) {
  if (!r.ok) return 'ERROR: HTTP ' + r.status;
  var reader = r.body.getReader();
  var decoder = new TextDecoder();
  var content = '';
  function read() {
    return reader.read().then(function(result) {
      if (result.done) {
        setTimeout(function(){ location.reload(); }, 1500);
        return 'COMPRESS_DONE: ' + content.substring(0, 300) + ' | RELOADING';
      }
      var text = decoder.decode(result.value, {stream: true});
      var lines = text.split('\\n');
      for (var i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('data: ')) {
          try {
            var data = JSON.parse(lines[i].substring(6));
            if (data.type === 'message_field_delta' && data.field_name === 'content') {
              content += data.delta;
            }
          } catch(e) {}
        }
      }
      return read();
    });
  }
  return read();
});
`;

const ws = new WebSocket(WS_URL);
ws.on('error', (err) => {
  console.error('❌ WebSocket 连接失败:', err.message);
  process.exit(1);
});
ws.on('open', () => {
  console.log('📡 发送压缩请求...');
  ws.send(JSON.stringify({
    type: 'browser_eval',
    id: 'compress_' + Date.now(),
    code: jsCode,
    tabId: tabId,
    timeout: 90000
  }));
});
ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.type === 'browser_eval_result') {
    if (msg.success) {
      console.log('✅ ' + msg.result);
      console.log('');
      console.log('🎉 压缩完成！页面将在 1.5 秒后刷新。');
    } else {
      console.error('❌ 执行失败:', msg.error);
    }
    ws.close();
    process.exit(msg.success ? 0 : 1);
  }
});
setTimeout(() => { console.error('❌ 超时 (90s)'); ws.close(); process.exit(1); }, 95000);
