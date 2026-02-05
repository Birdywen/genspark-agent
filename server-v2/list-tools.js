#!/usr/bin/env node
// 查询 genspark-agent 服务器的工具列表
const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:8765');
let printed = false;

ws.on('open', () => {
  // 不需要发送 list_tools，连接时就会收到工具列表
});

ws.on('message', (data) => {
  if (printed) return;
  const msg = JSON.parse(data);
  if (msg.type === 'connected' && msg.tools) {
    printTools(msg.tools);
    printed = true;
    ws.close();
    process.exit(0);
  }
});

ws.on('error', (e) => {
  console.error('连接失败:', e.message);
  process.exit(1);
});

function printTools(tools) {
  // 按 _server 分组
  const byServer = {};
  tools.forEach(t => {
    const server = t._server || 'unknown';
    if (!byServer[server]) byServer[server] = [];
    byServer[server].push(t.name);
  });
  
  console.log(`\n总计 ${tools.length} 个工具，来自 ${Object.keys(byServer).length} 个 MCP Server:\n`);
  
  Object.entries(byServer).sort().forEach(([server, names]) => {
    console.log(`【${server}】(${names.length} 个)`);
    console.log(`  ${names.join(', ')}`);
    console.log();
  });
}

setTimeout(() => {
  if (!printed) {
    console.error('超时');
    process.exit(1);
  }
}, 5000);
