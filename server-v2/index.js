import { WebSocketServer } from 'ws';
import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(path.join(__dirname, 'config.json'), 'utf-8'));
class MCPConnection {
constructor(name, cmd, args) {
this.name = name;
this.cmd = cmd;
this.args = args;
this.process = null;
this.requestId = 0;
this.pending = new Map();
this.buffer = '';
this.tools = [];
}
async start() {
console.log(`[${this.name}] 启动中...`);
this.process = spawn(this.cmd, this.args, { stdio: ['pipe', 'pipe', 'pipe'] });
this.process.stdout.on('data', d => this.onData(d));
this.process.stderr.on('data', d => console.log(`[${this.name}] err:`, d.toString().trim()));
this.process.on('error', e => console.error(`[${this.name}] error:`, e));
await new Promise(r => setTimeout(r, 2000));
await this.init();
this.tools = await this.getTools();
console.log(`[${this.name}] 就绪, ${this.tools.length} 个工具`);
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
setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout')); } }, 30000);
});
}
async init() {
await this.send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'hub', version: '1.0' } });
this.process.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
}
async getTools() {
const r = await this.send('tools/list');
return (r.tools || []).map(t => ({ ...t, _server: this.name }));
}
call(name, args) { return this.send('tools/call', { name, arguments: args || {} }); }
stop() { this.process?.kill(); }
}
class MCPHub {
constructor() { this.conns = new Map(); this.tools = []; }
async start() {
for (const [name, cfg] of Object.entries(config.mcpServers)) {
const c = new MCPConnection(name, cfg.command, cfg.args);
try { await c.start(); this.conns.set(name, c); this.tools.push(...c.tools); }
catch (e) { console.error(`[${name}] 启动失败:`, e.message); }
}
console.log('总工具数:', this.tools.length);
}
findConn(tool) {
for (const [, c] of this.conns) { if (c.tools.some(t => t.name === tool)) return c; }
return null;
}
async call(tool, args) {
const c = this.findConn(tool);
if (!c) throw new Error('工具未找到: ' + tool);
return c.call(tool, args);
}
}
const hub = new MCPHub();
async function main() {
await hub.start();
const wss = new WebSocketServer({ port: config.server.port, host: config.server.host });
wss.on('connection', ws => {
console.log('客户端已连接');
ws.send(JSON.stringify({ type: 'connected', tools: hub.tools }));
ws.on('message', async data => {
try {
const msg = JSON.parse(data.toString());
if (msg.type === 'tool_call') {
console.log('调用:', msg.tool);
try {
const r = await hub.call(msg.tool, msg.params);
let result = r;
if (r && r.content && Array.isArray(r.content)) {
  result = r.content.map(c => c.text || c).join('\n');
}
ws.send(JSON.stringify({ type: 'tool_result', id: msg.id, tool: msg.tool, success: true, result }));
} catch (e) {
ws.send(JSON.stringify({ type: 'tool_result', id: msg.id, tool: msg.tool, success: false, error: e.message }));
}
} else if (msg.type === 'ping') { ws.send('{"type":"pong"}'); }
} catch (e) { console.error('错误:', e); }
});
});
console.log('\n=== MCP Hub ===\nws://' + config.server.host + ':' + config.server.port);
}
main().catch(console.error);
