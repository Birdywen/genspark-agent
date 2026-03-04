#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Client } from 'ssh2';
import { z } from 'zod';
import fs from 'fs';

// ── Parse CLI args ──────────────────────────────────────────
function parseArgv() {
  const config = {};
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq === -1) config[arg.slice(2)] = true;
      else config[arg.slice(2, eq)] = arg.slice(eq + 1);
    }
  }
  return config;
}

const cfg = parseArgv();
const HOST = cfg.host;
const PORT = parseInt(cfg.port || '22');
const USER = cfg.user;
const KEY = cfg.key;
const PASSWORD = cfg.password;
const DEFAULT_TIMEOUT = parseInt(cfg.timeout || '120000');
const MAX_CHARS = cfg.maxChars === 'none' ? Infinity : parseInt(cfg.maxChars || '100000');

if (!HOST || !USER) {
  console.error('Usage: node index.js --host=IP --user=USER [--key=PATH] [--password=PASS] [--port=22] [--timeout=120000] [--maxChars=none]');
  process.exit(1);
}

// ── SSH Connection Manager ──────────────────────────────────
class SSHManager {
  constructor() {
    this.conn = null;
    this.connecting = null;
  }

  async connect() {
    if (this.conn && this._isAlive()) return;
    if (this.connecting) return this.connecting;

    this.connecting = new Promise((resolve, reject) => {
      const conn = new Client();
      const timer = setTimeout(() => {
        conn.end();
        reject(new Error('SSH connection timeout'));
      }, 30000);

      conn.on('ready', () => {
        clearTimeout(timer);
        this.conn = conn;
        this.connecting = null;
        resolve();
      });
      conn.on('error', (err) => {
        clearTimeout(timer);
        this.conn = null;
        this.connecting = null;
        reject(err);
      });
      conn.on('end', () => { this.conn = null; this.connecting = null; });
      conn.on('close', () => { this.conn = null; this.connecting = null; });

      const sshConfig = {
        host: HOST, port: PORT, username: USER,
        keepaliveInterval: 15000,
        keepaliveCountMax: 3,
        readyTimeout: 30000,
      };
      if (KEY) {
        try { sshConfig.privateKey = fs.readFileSync(KEY); }
        catch (e) { reject(new Error(`Cannot read key file: ${KEY}`)); return; }
      }
      if (PASSWORD) sshConfig.password = PASSWORD;
      conn.connect(sshConfig);
    });
    return this.connecting;
  }

  _isAlive() {
    return this.conn && this.conn._sock && !this.conn._sock.destroyed;
  }

  async ensureConnected() {
    if (!this._isAlive()) await this.connect();
  }

  async exec(command, timeout = DEFAULT_TIMEOUT) {
    await this.ensureConnected();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Command timed out after ${timeout}ms`));
      }, timeout);

      this.conn.exec(command, (err, stream) => {
        if (err) { clearTimeout(timer); reject(err); return; }
        let stdout = '', stderr = '';
        stream.on('data', (d) => { stdout += d.toString(); });
        stream.stderr.on('data', (d) => { stderr += d.toString(); });
        stream.on('close', (code) => {
          clearTimeout(timer);
          resolve({ stdout, stderr, code: code || 0 });
        });
      });
    });
  }

  async _sftp() {
    await this.ensureConnected();
    return new Promise((resolve, reject) => {
      this.conn.sftp((err, sftp) => {
        if (err) reject(err);
        else resolve(sftp);
      });
    });
  }

  async readFile(remotePath) {
    const sftp = await this._sftp();
    return new Promise((resolve, reject) => {
      let data = '';
      const stream = sftp.createReadStream(remotePath, { encoding: 'utf8' });
      stream.on('data', (chunk) => { data += chunk; });
      stream.on('end', () => { sftp.end(); resolve(data); });
      stream.on('error', (err) => { sftp.end(); reject(err); });
    });
  }

  async writeFile(remotePath, content) {
    const sftp = await this._sftp();
    return new Promise((resolve, reject) => {
      const stream = sftp.createWriteStream(remotePath, { encoding: 'utf8' });
      stream.on('close', () => { sftp.end(); resolve(); });
      stream.on('error', (err) => { sftp.end(); reject(err); });
      stream.end(content);
    });
  }

  async stat(remotePath) {
    const sftp = await this._sftp();
    return new Promise((resolve, reject) => {
      sftp.stat(remotePath, (err, stats) => {
        sftp.end();
        if (err) reject(err);
        else resolve(stats);
      });
    });
  }

  close() {
    if (this.conn) { this.conn.end(); this.conn = null; }
  }
}

const ssh = new SSHManager();

function truncate(text, max = MAX_CHARS) {
  if (!text || max === Infinity || text.length <= max) return text;
  const half = Math.floor(max / 2);
  return text.slice(0, half) + `\n\n... [truncated ${text.length - max} chars] ...\n\n` + text.slice(-half);
}

// ── MCP Server ──────────────────────────────────────────────
const server = new McpServer({
  name: `ssh-${cfg.name || HOST}`,
  version: '1.0.0',
  capabilities: { tools: {} },
});

// ── Tool: exec ──────────────────────────────────────────────
server.tool(
  'exec',
  'Execute a shell command on the remote SSH server',
  { command: z.string().describe('Shell command to execute'),
    timeout: z.number().optional().describe('Timeout in ms (default 120000)') },
  async ({ command, timeout }) => {
    try {
      const result = await ssh.exec(command, timeout || DEFAULT_TIMEOUT);
      let output = '';
      if (result.stdout) output += result.stdout;
      if (result.stderr) output += (output ? '\n' : '') + result.stderr;
      if (!output) output = `(no output, exit code: ${result.code})`;
      return { content: [{ type: 'text', text: truncate(output) }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
    }
  }
);

// ── Tool: read_file ─────────────────────────────────────────
server.tool(
  'read_file',
  'Read a file from the remote server via SFTP (no shell escaping)',
  { path: z.string().describe('Absolute path on remote server'),
    maxLines: z.number().optional().describe('Max lines to return'),
    offset: z.number().optional().describe('Start from line number (0-based)') },
  async ({ path, maxLines, offset }) => {
    try {
      let content = await ssh.readFile(path);
      if (offset || maxLines) {
        const lines = content.split('\n');
        const start = offset || 0;
        const end = maxLines ? start + maxLines : lines.length;
        content = lines.slice(start, end).join('\n');
        if (start > 0 || end < lines.length) {
          content = `[lines ${start}-${Math.min(end, lines.length) - 1} of ${lines.length}]\n` + content;
        }
      }
      return { content: [{ type: 'text', text: truncate(content) }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
    }
  }
);

// ── Tool: write_file ────────────────────────────────────────
server.tool(
  'write_file',
  'Write content to a file on the remote server via SFTP (zero escaping)',
  { path: z.string().describe('Absolute path on remote server'),
    content: z.string().describe('File content to write'),
    backup: z.boolean().optional().describe('Create .bak backup (default: true)') },
  async ({ path: filePath, content, backup }) => {
    try {
      if (backup !== false) {
        try {
          await ssh.stat(filePath);
          await ssh.writeFile(filePath + '.bak', await ssh.readFile(filePath));
        } catch { /* file doesn't exist */ }
      }
      await ssh.writeFile(filePath, content);
      const written = await ssh.readFile(filePath);
      const lines = written.split('\n').length;
      const bytes = Buffer.byteLength(written, 'utf8');
      return { content: [{ type: 'text', text: `Written ${bytes} bytes (${lines} lines) to ${filePath}` }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
    }
  }
);

// ── Tool: edit_file ─────────────────────────────────────────
// Supports two calling conventions:
// 1. edits array: [{ oldText, newText }, ...]  (JSON clients)
// 2. Single oldText + newText params (ΩHERE heredoc format)
server.tool(
  'edit_file',
  'Find and replace text in a remote file via SFTP. Zero shell escaping. Use @oldText<< and @newText<< heredoc params for exact matching.',
  { path: z.string().describe('Absolute path on remote server'),
    edits: z.array(z.object({
      oldText: z.string(), newText: z.string()
    })).optional().describe('Array of replacements (JSON mode)'),
    oldText: z.string().optional().describe('Text to find (heredoc mode)'),
    newText: z.string().optional().describe('Replacement text (heredoc mode)'),
    backup: z.boolean().optional().describe('Create .bak backup (default: true)') },
  async ({ path: filePath, edits, oldText, newText, backup }) => {
    try {
      let content = await ssh.readFile(filePath);

      // Normalize edits: support both array and single oldText/newText
      let editList = [];
      if (edits && Array.isArray(edits) && edits.length > 0) {
        editList = edits;
      } else if (oldText !== undefined && newText !== undefined) {
        editList = [{ oldText, newText }];
      } else {
        return { content: [{ type: 'text', text: 'Error: provide either edits array or oldText+newText params' }], isError: true };
      }

      if (backup !== false) {
        await ssh.writeFile(filePath + '.bak', content);
      }

      const results = [];
      for (const edit of editList) {
        if (!content.includes(edit.oldText)) {
          results.push(`NOT FOUND: "${edit.oldText.substring(0, 100)}"`);
          continue;
        }
        const count = content.split(edit.oldText).length - 1;
        content = content.replace(edit.oldText, edit.newText);
        results.push(`REPLACED (${count}x): "${edit.oldText.substring(0, 60)}" → "${edit.newText.substring(0, 60)}"`);
      }

      await ssh.writeFile(filePath, content);
      return { content: [{ type: 'text', text: results.join('\n') }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
    }
  }
);

// ── Tool: list_dir ──────────────────────────────────────────
server.tool(
  'list_dir',
  'List directory contents on the remote server via SFTP',
  { path: z.string().describe('Absolute directory path') },
  async ({ path: dirPath }) => {
    try {
      const sftp = await ssh._sftp();
      const list = await new Promise((resolve, reject) => {
        sftp.readdir(dirPath, (err, list) => { sftp.end(); if (err) reject(err); else resolve(list); });
      });
      const output = list
        .sort((a, b) => {
          const aDir = a.longname.startsWith('d') ? 0 : 1;
          const bDir = b.longname.startsWith('d') ? 0 : 1;
          return aDir !== bDir ? aDir - bDir : a.filename.localeCompare(b.filename);
        })
        .map(f => {
          const type = f.longname.startsWith('d') ? '[D]' : '   ';
          const size = f.attrs.size;
          const sizeStr = size > 1048576 ? (size/1048576).toFixed(1)+'M' : size > 1024 ? (size/1024).toFixed(0)+'K' : size+'B';
          return `${type} ${f.filename} (${sizeStr})`;
        })
        .join('\n');
      return { content: [{ type: 'text', text: output || '(empty directory)' }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
    }
  }
);

// ── Start ───────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`SSH MCP server connected to ${USER}@${HOST}:${PORT}`);

process.on('SIGINT', () => { ssh.close(); process.exit(0); });
process.on('SIGTERM', () => { ssh.close(); process.exit(0); });
