#!/usr/bin/env node
/**
 * Watchdog Service - 独立的守护进程
 * 功能：监控并重启 genspark-agent 主服务器
 * 端口：8766
 */

import { createServer } from 'http';
import { spawn, exec } from 'child_process';
import { existsSync, unlinkSync, writeFileSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = 8766;
const TRIGGER_FILE = '/tmp/genspark-restart-trigger';
const NOTIFY_FILE = '/tmp/genspark-agent-notify.json';
const RESTART_COOLDOWN = 5000;

let lastRestart = 0;
let isRestarting = false;
let mainPid = null;

function log(msg) {
  console.log(`[${new Date().toISOString()}] [watchdog] ${msg}`);
}

// 加载敏感环境变量
const secretsPath = join(homedir(), '.agent_secrets');
if (existsSync(secretsPath)) {
  const secrets = readFileSync(secretsPath, 'utf8');
  secrets.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) process.env[match[1]] = match[2];
  });
  log('Loaded secrets from ~/.agent_secrets');
}

function notify(message, type = 'info') {
  const notification = { timestamp: new Date().toISOString(), type, message };
  writeFileSync(NOTIFY_FILE, JSON.stringify(notification, null, 2));
  log(`NOTIFY: ${message}`);
}

async function restartMainServer(reason = 'manual') {
  const now = Date.now();
  
  if (isRestarting) {
    return { success: false, message: 'Already restarting' };
  }
  
  if (now - lastRestart < RESTART_COOLDOWN) {
    return { success: false, message: 'Cooldown active' };
  }
  
  isRestarting = true;
  lastRestart = now;
  
  notify('🔄 Restarting server...', 'restart');
  log(`Restarting main server (reason: ${reason})...`);
  
  try {
    // Kill existing process
    await new Promise((resolve) => {
      exec('pkill -f "node.*index.js"', () => resolve());
    });
    
    await new Promise(r => setTimeout(r, 1000));
    
    // Start new process
    const child = spawn('node', ['index.js'], {
      cwd: __dirname,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env }
    });
    
    mainPid = child.pid;
    child.unref();
    
    log(`Main server started with PID: ${mainPid}`);
    notify(`✅ Server restarted successfully (PID: ${mainPid})`, 'success');
    
    isRestarting = false;
    return { success: true, pid: mainPid };
    
  } catch (err) {
    isRestarting = false;
    notify(`❌ Restart failed: ${err.message}`, 'error');
    return { success: false, message: err.message };
  }
}

function checkMainServer() {
  return new Promise((resolve) => {
    exec('pgrep -f "node.*index.js"', (err, stdout) => {
      resolve(err ? { running: false } : { running: true, pid: stdout.trim().split('\n')[0] });
    });
  });
}

const server = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const path = req.url.split('?')[0];
  
  if (path === '/restart') {
    const result = await restartMainServer('http-request');
    res.statusCode = result.success ? 200 : 429;
    res.end(JSON.stringify(result));
  } else if (path === '/status') {
    const status = await checkMainServer();
    res.end(JSON.stringify({ watchdog: 'running', mainServer: status, lastRestart: lastRestart ? new Date(lastRestart).toISOString() : null }));
  } else if (path === '/health') {
    res.end(JSON.stringify({ status: 'ok' }));
  } else if (path === '/notify') {
    // Get current notification
    if (existsSync(NOTIFY_FILE)) {
      const data = readFileSync(NOTIFY_FILE, 'utf-8');
      res.end(data);
    } else {
      res.end(JSON.stringify({ message: null }));
    }
  } else {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

setInterval(() => {
  if (existsSync(TRIGGER_FILE)) {
    log('Trigger file detected!');
    unlinkSync(TRIGGER_FILE);
    restartMainServer('file-trigger');
  }
}, 1000);

server.listen(PORT, () => {
  log(`Watchdog running on port ${PORT}`);
  notify('👀 Watchdog started', 'info');
});

process.on('SIGINT', () => { server.close(); process.exit(0); });
process.on('SIGTERM', () => { server.close(); process.exit(0); });
