// 守护服务器 - 专门负责管理主服务器的启动/重启
import { WebSocketServer } from 'ws';
import { spawn, exec } from 'child_process';
import { existsSync, writeFileSync, readFileSync, unlinkSync, appendFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DAEMON_PORT = 8766;
const MAIN_PORT = 8765;
const PID_FILE = '/tmp/agent-main-server.pid';
const LOG_FILE = '/tmp/agent-daemon.log';

let mainServerProcess = null;

function log(msg) {
  const timestamp = new Date().toISOString();
  const logMsg = `[${timestamp}] ${msg}\n`;
  console.log(logMsg.trim());
  try {
    appendFileSync(LOG_FILE, logMsg);
  } catch(e) {}
}

// 启动主服务器
function startMainServer() {
  return new Promise((resolve, reject) => {
    log('🚀 启动主服务器...');
    
    // 先杀死旧进程
    if (existsSync(PID_FILE)) {
      try {
        const oldPid = readFileSync(PID_FILE, 'utf-8').trim();
        log(`🔪 杀死旧进程: ${oldPid}`);
        exec(`kill -9 ${oldPid}`, () => {});
      } catch(e) {
        log(`⚠️  无法杀死旧进程: ${e.message}`);
      }
    }
    
    // 确保端口释放
    exec(`lsof -ti :${MAIN_PORT} | xargs kill -9 2>/dev/null || true`, () => {
      setTimeout(() => {
        // 启动新进程
        mainServerProcess = spawn('node', ['index.js'], {
          cwd: __dirname,
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: false
        });
        
        // 保存PID
        writeFileSync(PID_FILE, mainServerProcess.pid.toString());
        log(`✅ 主服务器已启动 (PID: ${mainServerProcess.pid})`);
        
        // 监听输出
        mainServerProcess.stdout.on('data', (data) => {
          process.stdout.write(`[主] ${data.toString()}`);
        });
        
        mainServerProcess.stderr.on('data', (data) => {
          process.stderr.write(`[主] ${data.toString()}`);
        });
        
        // 监听退出
        mainServerProcess.on('exit', (code) => {
          log(`⚠️  主服务器退出 (code: ${code})`);
          mainServerProcess = null;
          if (existsSync(PID_FILE)) {
            unlinkSync(PID_FILE);
          }
        });
        
        resolve(mainServerProcess.pid);
      }, 2000);
    });
  });
}

// 停止主服务器
function stopMainServer() {
  return new Promise((resolve) => {
    if (mainServerProcess) {
      log('🛑 停止主服务器...');
      mainServerProcess.kill('SIGTERM');
      setTimeout(() => {
        if (mainServerProcess && !mainServerProcess.killed) {
          mainServerProcess.kill('SIGKILL');
        }
        resolve();
      }, 3000);
    } else {
      resolve();
    }
  });
}

// 重启主服务器
async function restartMainServer() {
  log('🔄 开始重启主服务器...');
  await stopMainServer();
  await new Promise(r => setTimeout(r, 2000));
  const pid = await startMainServer();
  log(`✅ 重启完成，新PID: ${pid}`);
  return pid;
}

// 检查主服务器状态
function checkMainServer() {
  return new Promise((resolve) => {
    exec(`lsof -ti :${MAIN_PORT}`, (err, stdout) => {
      if (err || !stdout.trim()) {
        resolve({ running: false, pid: null });
      } else {
        const pid = stdout.trim().split('\n')[0];
        resolve({ running: true, pid: parseInt(pid) });
      }
    });
  });
}

// 启动守护服务器
const wss = new WebSocketServer({ port: DAEMON_PORT });

log(`╔═══════════════════════════════════════════════════════════╗`);
log(`║   🛡️  Genspark Agent - 守护服务器                        ║`);
log(`║   端口: ${DAEMON_PORT}                                          ║`);
log(`║   管理: 主服务器 (端口 ${MAIN_PORT})                            ║`);
log(`╚═══════════════════════════════════════════════════════════╝`);

wss.on('connection', (ws) => {
  log('🔌 守护客户端已连接');
  
  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      log(`📨 收到命令: ${msg.command}`);
      
      let response = {};
      
      switch(msg.command) {
        case 'start':
          if (mainServerProcess) {
            response = { success: false, error: '主服务器已在运行' };
          } else {
            const pid = await startMainServer();
            response = { success: true, pid };
          }
          break;
          
        case 'stop':
          await stopMainServer();
          response = { success: true };
          break;
          
        case 'restart':
          const newPid = await restartMainServer();
          response = { success: true, pid: newPid };
          break;
          
        case 'status':
          const status = await checkMainServer();
          response = { success: true, ...status };
          break;
          
        default:
          response = { success: false, error: '未知命令' };
      }
      
      ws.send(JSON.stringify(response));
      
    } catch(e) {
      log(`❌ 处理命令失败: ${e.message}`);
      ws.send(JSON.stringify({ success: false, error: e.message }));
    }
  });
  
  ws.on('close', () => {
    log('🔌 守护客户端已断开');
  });
});

// 启动时自动启动主服务器
startMainServer().catch(e => {
  log(`❌ 启动主服务器失败: ${e.message}`);
});

// 优雅退出
process.on('SIGINT', async () => {
  log('\n收到 SIGINT，准备退出...');
  await stopMainServer();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  log('\n收到 SIGTERM，准备退出...');
  await stopMainServer();
  process.exit(0);
});

log('✅ 守护服务器启动完成，等待连接...');
