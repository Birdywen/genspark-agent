// Webhook Server - 允许外部服务触发 Agent 任务
// 运行: node webhook-server.js

import http from 'http';
import crypto from 'crypto';
import { WebSocket } from 'ws';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(path.join(__dirname, '../server/config.json'), 'utf-8'));

const WEBHOOK_PORT = config.webhook?.port || 8766;
const WEBHOOK_SECRET = config.webhook?.secret || 'change-this-secret';
const AGENT_WS_URL = `ws://${config.server.host}:${config.server.port}`;

// 验证 webhook 签名
function verifySignature(payload, signature) {
  if (!signature) return false;
  const expected = crypto.createHmac('sha256', WEBHOOK_SECRET)
    .update(payload)
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(`sha256=${expected}`),
    Buffer.from(signature)
  );
}

// 发送任务到 Agent
async function sendToAgent(task, tools = []) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(AGENT_WS_URL);
    
    ws.on('open', () => {
      console.log('[Webhook] 连接到 Agent 服务器');
      ws.send(JSON.stringify({
        type: 'start_task',
        task,
        requestedTools: tools
      }));
    });

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      console.log('[Webhook] 收到响应:', msg.type);
      
      if (msg.type === 'task_complete' || msg.type === 'error') {
        ws.close();
        resolve(msg);
      }
    });

    ws.on('error', (err) => {
      console.error('[Webhook] WebSocket 错误:', err.message);
      reject(err);
    });

    setTimeout(() => {
      ws.close();
      resolve({ type: 'timeout', message: '任务已发送，等待执行' });
    }, 5000);
  });
}

// HTTP 服务器
const server = http.createServer(async (req, res) => {
  // CORS 头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Webhook-Signature');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // 健康检查
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', port: WEBHOOK_PORT }));
    return;
  }

  // Webhook 端点
  if (req.method === 'POST' && req.url === '/webhook') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        // 验证签名（可选）
        const signature = req.headers['x-webhook-signature'];
        if (WEBHOOK_SECRET !== 'change-this-secret' && !verifySignature(body, signature)) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid signature' }));
          return;
        }

        const payload = JSON.parse(body);
        console.log('[Webhook] 收到请求:', payload);

        // 发送到 Agent
        const result = await sendToAgent(payload.task, payload.tools);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, result }));
      } catch (err) {
        console.error('[Webhook] 错误:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 快捷端点：直接执行工具
  if (req.method === 'POST' && req.url === '/execute') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { tool, params } = JSON.parse(body);
        console.log('[Webhook] 执行工具:', tool, params);

        const ws = new WebSocket(AGENT_WS_URL);
        
        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'tool_call', tool, params, id: Date.now().toString() }));
        });

        ws.on('message', (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'tool_result') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(msg));
            ws.close();
          }
        });

        ws.on('error', (err) => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        });
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(WEBHOOK_PORT, () => {
  console.log(`
╔════════════════════════════════════════════╗
║     Webhook Server 已启动                   ║
╠════════════════════════════════════════════╣
║  端口: ${WEBHOOK_PORT}                              ║
║  健康检查: http://localhost:${WEBHOOK_PORT}/health   ║
║  Webhook: POST http://localhost:${WEBHOOK_PORT}/webhook ║
║  执行工具: POST http://localhost:${WEBHOOK_PORT}/execute ║
╚════════════════════════════════════════════╝

示例调用:
  curl http://localhost:${WEBHOOK_PORT}/health

  curl -X POST http://localhost:${WEBHOOK_PORT}/execute \\
    -H "Content-Type: application/json" \\
    -d '{"tool":"list_directory","params":{"path":"/tmp"}}'

  curl -X POST http://localhost:${WEBHOOK_PORT}/webhook \\
    -H "Content-Type: application/json" \\
    -d '{"task":"列出workspace目录"}'
  `);
});
