// core/mcp-hub.js — MCP 连接管理 (从 index.js 提取)
import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';

function expandEnvVars(obj) {
  if (typeof obj === 'string') {
    return obj.replace(/\$\{([^}]+)\}/g, (_, name) => process.env[name] || '');
  }
  if (Array.isArray(obj)) {
    return obj.map(expandEnvVars);
  }
  if (obj && typeof obj === 'object') {
    const result = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = expandEnvVars(v);
    }
    return result;
  }
  return obj;
}

class MCPConnection {
  constructor(name, cmd, args, env = {}, options = {}, logger = null) {
    this.name = name;
    this.cmd = cmd;
    this.args = args;
    this.env = env;
    this.startupTimeout = options.startupTimeout || 5000;
    this.requestTimeout = options.requestTimeout || 60000;
    this.transport = options.transport || 'stdio';
    this.url = options.url || null;
    this.process = null;
    this.requestId = 0;
    this.pending = new Map();
    this.buffer = '';
    this.tools = [];
    this.ready = false;
    this.sseAbort = null;
    this.messageEndpoint = null;
    this.logger = logger || console;
  }

  async start() {
    if (this.transport === 'sse') {
      await this.startSSE();
    } else {
      await this.startStdio();
    }
  }

  async startStdio() {
    this.logger.info(`[${this.name}] 启动中 (stdio)...`);
    
    this.process = spawn(this.cmd, this.args, { 
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...this.env }
    });
    
    this.process.stdout.on('data', d => this.onStdioData(d));
    this.process.stderr.on('data', d => this.logger.warning(`[${this.name}] stderr: ${d.toString().trim()}`));
    this.process.on('error', e => this.logger.error(`[${this.name}] error: ${e.message}`));
    this.process.on('close', code => {
      if (!this.ready) {
        this.logger.warning(`[${this.name}] 进程退出, code: ${code}`);
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

  async startSSE() {
    this.logger.info(`[${this.name}] 连接中 (sse: ${this.url})...`);
    
    this.sseAbort = new AbortController();
    
    const response = await fetch(this.url, {
      headers: { 'Accept': 'text/event-stream' },
      signal: this.sseAbort.signal
    });
    
    if (!response.ok) throw new Error(`SSE HTTP ${response.status}`);
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    
    this._startSSEReader(reader, decoder);
    
    await new Promise(r => setTimeout(r, 2000));
    
    if (!this.messageEndpoint) {
      const baseUrl = new URL(this.url);
      this.messageEndpoint = `${baseUrl.origin}/message`;
    }
    
    this.logger.info(`[${this.name}] SSE connected, POST endpoint: ${this.messageEndpoint}`);
    
    await this.init();
    this.tools = await this.getTools();
    this.ready = true;
    this._logReady();
  }

  _startSSEReader(reader, decoder) {
    let sseBuffer = '';
    const readLoop = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          sseBuffer += decoder.decode(value, { stream: true });
          
          const lines = sseBuffer.split('\n');
          sseBuffer = lines.pop();
          
          for (const line of lines) {
            if (line.startsWith('event: endpoint')) {
              continue;
            }
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data.startsWith('/message')) {
                const baseUrl = new URL(this.url);
                this.messageEndpoint = `${baseUrl.origin}${data.trim()}`;
              } else {
                try {
                  const msg = JSON.parse(data);
                  this.onMessage(msg);
                } catch {}
              }
            }
          }
        }
      } catch (e) {
        if (e.name !== 'AbortError') {
          this.logger.error(`[${this.name}] SSE stream error: ${e.message}`);
        }
      }
    };
    readLoop();
  }

  _logReady() {
    this.logger.success(`[${this.name}] 就绪, ${this.tools.length} 个工具`);
    try {
      const names = this.tools.map(t => t.name);
      const preview = names.slice(0, 10);
      this.logger.info(`[${this.name}] tools: ${preview.join(', ')}${names.length > preview.length ? ` ... (+${names.length - preview.length})` : ''}`);
    } catch (e) {
      this.logger.warning(`[${this.name}] tools 列表打印失败: ${e.message}`);
    }
  }

  onStdioData(data) {
    this.buffer += data.toString();
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        this.onMessage(JSON.parse(line));
      } catch {}
    }
  }

  onMessage(msg) {
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      resolve(msg);
    }
  }

  async send(msg) {
    msg.jsonrpc = '2.0';
    msg.id = ++this.requestId;
    
    if (this.transport === 'sse') {
      const resp = await fetch(this.messageEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(msg)
      });
      if (!resp.ok) throw new Error(`SSE POST failed: ${resp.status}`);
    } else {
      this.process.stdin.write(JSON.stringify(msg) + '\n');
    }
    
    return new Promise((resolve, reject) => {
      this.pending.set(msg.id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(msg.id)) {
          this.pending.delete(msg.id);
          reject(new Error(`请求超时 (${this.requestTimeout}ms)`));
        }
      }, this.requestTimeout);
    });
  }

  async init() {
    await this.send({ method: 'initialize', params: { 
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'genspark-agent', version: '2.0' }
    }});
    await this.send({ method: 'notifications/initialized' });
  }

  async getTools() {
    const r = await this.send({ method: 'tools/list' });
    return r.result?.tools || [];
  }

  async call(tool, args, options = {}) {
    const timeout = options.timeout || this.requestTimeout;
    const oldTimeout = this.requestTimeout;
    this.requestTimeout = timeout;
    try {
      const r = await this.send({ method: 'tools/call', params: { name: tool, arguments: args } });
      return r.result || r;
    } finally {
      this.requestTimeout = oldTimeout;
    }
  }

  stop() {
    if (this.sseAbort) {
      this.sseAbort.abort();
      this.sseAbort = null;
    }
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.ready = false;
  }
}

class MCPHub {
  constructor({ config, configPath, logger } = {}) {
    this.conns = new Map();
    this.tools = [];
    this.config = config;
    this.configPath = configPath;
    this.logger = logger || console;
  }

  async start() {
    const startTime = Date.now();
    const entries = Object.entries(this.config.mcpServers);
    
    const results = await Promise.allSettled(
      entries.map(async ([name, cfg]) => {
        const isSSE = !!cfg.url;
        const options = {
          startupTimeout: cfg.startupTimeout || (isSSE ? 10000 : 5000),
          requestTimeout: cfg.requestTimeout || 60000,
          transport: isSSE ? 'sse' : 'stdio',
          url: cfg.url || null,
        };
        const c = new MCPConnection(name, cfg.command, cfg.args, cfg.env, options, this.logger);
        await c.start();
        return { name, conn: c };
      })
    );
    
    for (const r of results) {
      if (r.status === 'fulfilled') {
        this.conns.set(r.value.name, r.value.conn);
        this.tools.push(...r.value.conn.tools);
      } else {
        this.logger.error(`MCP 启动失败: ${r.reason?.message || r.reason}`);
      }
    }
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    this.logger.success(`MCP Hub 就绪, 总工具数: ${this.tools.length} (${elapsed}s)`);
  }

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
    for (const [, c] of this.conns) {
      if (c.tools.some(t => t.name === tool)) return c;
    }
    const alias = this.constructor.toolAliases[tool];
    if (alias) {
      this.logger.warn(`工具名映射: ${tool} → ${alias}`);
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

  async reload() {
    this.logger.info('[MCPHub] 开始热刷新...');
    
    for (const [name, c] of this.conns) {
      this.logger.info(`[MCPHub] 停止 ${name}`);
      c.stop();
    }
    this.conns.clear();
    this.tools = [];
    
    const newConfig = JSON.parse(readFileSync(this.configPath, 'utf-8'));
    const expandedConfig = expandEnvVars(newConfig);
    this.config = expandedConfig;
    
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
        const c = new MCPConnection(name, cfg.command, cfg.args, cfg.env, options, this.logger);
        await c.start();
        return { name, conn: c };
      })
    );
    
    for (const r of results) {
      if (r.status === 'fulfilled') {
        this.conns.set(r.value.name, r.value.conn);
        this.tools.push(...r.value.conn.tools);
      } else {
        this.logger.error(`[MCPHub] 重启失败: ${r.reason?.message || r.reason}`);
      }
    }
    
    this.logger.success(`[MCPHub] 热刷新完成, 总工具数: ${this.tools.length}`);
    return { success: true, toolCount: this.tools.length };
  }
}

export { MCPConnection, MCPHub, expandEnvVars };
export default MCPHub;
