import { spawn } from 'child_process';
import { EventEmitter } from 'events';
export default class MCPClient extends EventEmitter {
constructor(logger) {
super();
this.logger = logger;
this.process = null;
this.requestId = 0;
this.pendingRequests = new Map();
this.buffer = '';
}
async start(opts = {}) {
const args = ['@playwright/mcp@latest'];
if (opts.headless) args.push('--headless');
if (opts.userDataDir) args.push('--user-data-dir', opts.userDataDir);
this.logger?.info('启动 MCP...', { args });
this.process = spawn('npx', args, { stdio: ['pipe', 'pipe', 'pipe'] });
this.process.stdout.on('data', d => this._onData(d));
this.process.stderr.on('data', d => this.logger?.debug('stderr: ' + d));
this.process.on('error', e => this.emit('error', e));
await new Promise(r => setTimeout(r, 2000));
await this._init();
this.logger?.success('MCP 已就绪');
return this;
}
_onData(data) {
this.buffer += data.toString();
const lines = this.buffer.split('\n');
this.buffer = lines.pop();
for (const l of lines) {
if (!l.trim()) continue;
try {
const m = JSON.parse(l);
if (m.id !== undefined && this.pendingRequests.has(m.id)) {
const { resolve, reject } = this.pendingRequests.get(m.id);
this.pendingRequests.delete(m.id);
m.error ? reject(new Error(m.error.message)) : resolve(m.result);
}
} catch {}
}
}
_send(method, params = {}) {
const id = ++this.requestId;
const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
return new Promise((resolve, reject) => {
this.pendingRequests.set(id, { resolve, reject });
this.process.stdin.write(msg);
setTimeout(() => {
if (this.pendingRequests.has(id)) {
this.pendingRequests.delete(id);
reject(new Error('timeout'));
}
}, 30000);
});
}
async _init() {
await this._send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'genspark', version: '1.0' }
    });
    this.process.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
  }
  listTools() { return this._send('tools/list').then(r => r.tools || []); }
  call(name, args) { return this._send('tools/call', { name, arguments: args || {} }); }
  close() { this.process?.kill(); }
}
