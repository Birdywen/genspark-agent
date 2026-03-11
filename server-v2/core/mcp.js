// core/mcp.js — MCP Connection + Hub (从 index.js 提取)
import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_DIR = path.join(__dirname, '..');

let logger = { info: console.log, warning: console.warn, error: console.error, success: console.log };

function setLogger(l) { logger = l; }

class MCPConnection {
  constructor(name, cmd, args, env = {}, options = {}) {
    this.name = name;
    this.cmd = cmd;
    this.args = args;
    this.env = env;
    this.startupTimeout = options.startupTimeout || 5000;
    this.requestTimeout = options.requestTimeout || 60000;
    this.transport = options.transport || 'stdio'; // 'stdio' or 'sse'
    this.url = options.url || null; // SSE endpoint URL
    this.process = null;
    this.requestId = 0;
    this.pending = new Map();
    this.buffer = '';
    this.tools = [];
    this.ready = false;
    this.sseAbort = null;
    this.messageEndpoint = null; // POST endpoint for SSE
  }

  async start() {
    if (this.transport === 'sse') {
      await this.startSSE();
    } else {
      await this.startStdio();
    }
  }

  // === STDIO transport ===
  async startStdio() {
    logger.info(`[${this.name}] 启动中 (stdio)...`);
    
    this.process = spawn(this.cmd, this.args, { 
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...this.env }
    });
    
    this.process.stdout.on('data', d => this.onStdioData(d));
    this.process.stderr.on('data', d => logger.warning(`[${this.name}] stderr: ${d.toString().trim()}`));
    this.process.on('error', e => logger.error(`[${this.name}] error: ${e.message}`));
    this.process.on('close', code => {
      if (!this.ready) {
        logger.warning(`[${this.name}] 进程退出, code: ${code}`);
      }
    });
    
    await new Promise(r => setTimeout(r, this.startupTimeout));
    
    if (this.process.exitCode !== null) {
      throw new Error(`进程已退出, code: ${this.process.exitCode}`);
    }
    
    await this.init();
    this.tools = await this.getTools();
    this.ready = true;
    this._logReady();
  }

  // === SSE transport ===
  async startSSE() {
    logger.info(`[${this.name}] 连接中 (sse: ${this.url})...`);
    
    this.sseAbort = new AbortController();
    
    // Connect to SSE endpoint
    const response = await fetch(this.url, {
      headers: { 'Accept': 'text/event-stream' },
      signal: this.sseAbort.signal,
    });
    
    if (!response.ok) {
      throw new Error(`SSE connection failed: ${response.status} ${response.statusText}`);
    }
    
    // Parse SSE stream in background
    this._readSSEStream(response.body);
    
    // Wait for endpoint event (SSE servers send the POST endpoint URL)
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('SSE endpoint timeout')), this.startupTimeout);
      const check = () => {
        if (this.messageEndpoint) {
          clearTimeout(timeout);
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
    
    logger.info(`[${this.name}] SSE connected, POST endpoint: ${this.messageEndpoint}`);
    
    await this.init();
    this.tools = await this.getTools();
    this.ready = true;
    this._logReady();
  }

  async _readSSEStream(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let eventType = '';
    let eventData = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        
        for (const line of lines) {
          if (line.startsWith('event:')) {
            eventType = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            eventData = line.slice(5).trim();
          } else if (line === '') {
            // End of event
            if (eventType === 'endpoint' && eventData) {
              // Resolve relative URL against SSE base URL
              try {
                this.messageEndpoint = new URL(eventData, this.url).href;
              } catch {
                this.messageEndpoint = eventData;
              }
            } else if (eventType === 'message' && eventData) {
              try {
                const msg = JSON.parse(eventData);
                if (msg.id !== undefined && this.pending.has(msg.id)) {
                  const { resolve, reject } = this.pending.get(msg.id);
                  this.pending.delete(msg.id);
                  msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
                }
              } catch {}
            }
            eventType = '';
            eventData = '';
          }
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        logger.error(`[${this.name}] SSE stream error: ${e.message}`);
      }
    }
  }

  _logReady() {
    logger.success(`[${this.name}] 就绪, ${this.tools.length} 个工具`);
    try {
      const names = this.tools.map(t => t.name);
      const preview = names.slice(0, 40);
      logger.info(`[${this.name}] tools: ${preview.join(', ')}${names.length > preview.length ? ` ... (+${names.length - preview.length})` : ''}`);
    } catch (e) {
      logger.warning(`[${this.name}] tools 列表打印失败: ${e.message}`);
    }
  }

  // === Data handling ===
  onStdioData(data) {
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

  // === Send (supports both transports) ===
  send(method, params = {}, options = {}) {
    const id = ++this.requestId;
    const timeout = options.timeout || this.requestTimeout;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params });

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      
      if (this.transport === 'sse') {
        // POST to message endpoint
        fetch(this.messageEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
        }).catch(e => {
          this.pending.delete(id);
          reject(new Error(`SSE POST failed: ${e.message}`));
        });
      } else {
        // Write to stdin
        this.process.stdin.write(payload + '\n');
      }
      
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('timeout'));
        }
      }, timeout);
    });
  }

  async init() {
    await this.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'genspark-agent', version: '2.0' }
    });
    
    // Send initialized notification
    const notification = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' });
    if (this.transport === 'sse') {
      await fetch(this.messageEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: notification,
      });
    } else {
      this.process.stdin.write(notification + '\n');
    }
  }

  async getTools() {
    const r = await this.send('tools/list');
    const needsPrefix = this.name.startsWith('ssh');
    return (r.tools || []).map(t => ({
      ...t,
      name: needsPrefix ? `${this.name}:${t.name}` : t.name,
      _originalName: t.name,
      _server: this.name
    }));
  }

  call(name, args, options = {}) {
    const originalName = name.includes(':') ? name.split(':')[1] : name;
    return this.send('tools/call', { name: originalName, arguments: args || {} }, options);
  }

  stop() {
    if (this.sseAbort) {
      this.sseAbort.abort();
      this.sseAbort = null;
    }
    this.process?.kill();
  }
}

class MCPHub {
  constructor() {
    this.conns = new Map();
    this.tools = [];
  }

  async start() {
    const startTime = Date.now();
    const entries = Object.entries(config.mcpServers);
    
    // 并行启动所有 MCP servers
    const results = await Promise.allSettled(
      entries.map(async ([name, cfg]) => {
        const isSSE = !!cfg.url;
        const options = {
          startupTimeout: cfg.startupTimeout || (isSSE ? 10000 : 5000),
          requestTimeout: cfg.requestTimeout || 60000,
          transport: isSSE ? 'sse' : 'stdio',
          url: cfg.url || null,
        };
        const c = new MCPConnection(name, cfg.command, cfg.args, cfg.env, options);
        await c.start();
        return { name, conn: c };
      })
    );
    
    for (const r of results) {
      if (r.status === 'fulfilled') {
        this.conns.set(r.value.name, r.value.conn);
        this.tools.push(...r.value.conn.tools);
      } else {
        logger.error(`MCP 启动失败: ${r.reason?.message || r.reason}`);
      }
    }
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.success(`MCP Hub 就绪, 总工具数: ${this.tools.length} (${elapsed}s)`);
  }

  // 工具名别名映射 - 修复AI幻觉导致的工具未找到错误
  static toolAliases = {
    'navigate': 'browser_navigate',
    'browser_nav': 'browser_navigate',
    'screenshot': 'take_screenshot',
    'crawler': 'read_file',
    'browser_eval': 'eval_js',
    'list_tabs': 'browser_list_tabs',
    'broadcast': 'eval_js',
    'run': 'run_process',
    '_command': 'run_process',
    '_file': 'write_file',
  };

  findConn(tool) {
    // 先尝试原名
    for (const [, c] of this.conns) {
      if (c.tools.some(t => t.name === tool)) return c;
    }
    // 别名 fallback
    const alias = this.constructor.toolAliases[tool];
    if (alias) {
      logger.warn(`工具名映射: ${tool} → ${alias}`);
      for (const [, c] of this.conns) {
        if (c.tools.some(t => t.name === alias)) return c;
      }
    }
    return null;
  }

  async call(tool, args, options = {}) {
    const c = this.findConn(tool);
    if (!c) throw new Error('工具未找到: ' + tool);
    return c.call(tool, args, options);
  }

  stop() {
    for (const [, c] of this.conns) c.stop();
  }

  // 热刷新：重新加载所有 MCP 连接和工具
  async reload() {
    logger.info('[MCPHub] 开始热刷新...');
    
    // 1. 停止所有现有连接
    for (const [name, c] of this.conns) {
      logger.info(`[MCPHub] 停止 ${name}`);
      c.stop();
    }
    this.conns.clear();
    this.tools = [];
    
    // 2. 重新读取配置
    const newConfig = JSON.parse(readFileSync(path.join(__dirname, 'config.json'), 'utf-8'));
    const expandedConfig = expandEnvVars(newConfig);
    
    // 3. 并行重新启动所有 MCP server
    const reloadStart = Date.now();
    const entries = Object.entries(expandedConfig.mcpServers);
    const results = await Promise.allSettled(
      entries.map(async ([name, cfg]) => {
        const isSSE = !!cfg.url;
        const options = {
          startupTimeout: cfg.startupTimeout || (isSSE ? 10000 : 5000),
          requestTimeout: cfg.requestTimeout || 60000,
          transport: isSSE ? 'sse' : 'stdio',
          url: cfg.url || null,
        };
        const c = new MCPConnection(name, cfg.command, cfg.args, cfg.env, options);
        await c.start();
        return { name, conn: c };
      })
    );
    
    for (const r of results) {
      if (r.status === 'fulfilled') {
        this.conns.set(r.value.name, r.value.conn);
        this.tools.push(...r.value.conn.tools);
      } else {
        logger.error(`[MCPHub] 重启失败: ${r.reason?.message || r.reason}`);
      }
    }
    
    logger.success(`[MCPHub] 热刷新完成, 总工具数: ${this.tools.length}`);
    return { success: true, toolCount: this.tools.length };
  }
}


export { MCPConnection, MCPHub, setLogger };
export default MCPHub;
