/**
 * 异步命令执行器
 * 自动检测长时间运行的命令，转为后台执行并监控日志
 */

import { spawn, exec } from 'child_process';
import { writeFileSync, readFileSync, existsSync, unlinkSync, watchFile, unwatchFile, mkdirSync, readdirSync, statSync } from 'fs';
import path from 'path';

export default class AsyncExecutor {
  constructor(logger) {
    this.logger = logger;
    this.logDir = path.join(process.cwd(), 'async-logs');
    this.runningProcesses = new Map();
    
    // 需要后台执行的命令模式
    this.asyncPatterns = [
      /^node\s+.*index\.js/i,           // node server
      /^npm\s+(start|run|install)/i,    // npm commands
      /^yarn\s+(start|install)/i,       // yarn commands  
      /^python.*server/i,               // python servers
      /^uvicorn|gunicorn|flask/i,       // python web servers
      /^docker\s+(build|run|compose)/i, // docker commands
      /^brew\s+install/i,               // homebrew
      /^pip\s+install/i,                // pip install
      /^cargo\s+build/i,                // rust build
      /^make\b/i,                       // make
      /^gradle|mvn/i,                   // java build
    ];
    
    // 确保日志目录存在
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * 判断命令是否需要异步执行
   */
  shouldRunAsync(command) {
    return this.asyncPatterns.some(pattern => pattern.test(command));
  }

  /**
   * 执行命令 - 自动选择同步或异步模式
   */
  async execute(command, options = {}) {
    const { 
      forceAsync = false, 
      forceSync = false,
      timeout = 30000,
      onOutput = null 
    } = options;

    // 强制同步或命令不匹配异步模式
    if (forceSync || (!forceAsync && !this.shouldRunAsync(command))) {
      return this.executeSync(command, timeout);
    }

    // 异步执行
    return this.executeAsync(command, { timeout, onOutput });
  }

  /**
   * 同步执行（带超时）
   */
  executeSync(command, timeout = 30000) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      
      exec(command, { 
        timeout, 
        maxBuffer: 10 * 1024 * 1024,
        shell: '/bin/bash'
      }, (error, stdout, stderr) => {
        const duration = Date.now() - startTime;
        
        if (error) {
          if (error.killed || error.code === 'ETIMEDOUT') {
            resolve({
              success: false,
              error: `命令超时 (${timeout/1000}秒)`,
              suggestion: '此命令可能需要较长时间，建议使用后台执行模式',
              duration
            });
          } else {
            resolve({
              success: false,
              error: error.message,
              stderr: stderr?.slice(-2000),
              duration
            });
          }
          return;
        }
        
        resolve({
          success: true,
          output: stdout,
          stderr: stderr || undefined,
          duration
        });
      });
    });
  }

  /**
   * 异步执行（后台运行 + 日志监控）
   */
  async executeAsync(command, options = {}) {
    const { timeout = 60000, onOutput = null } = options;
    const processId = `async-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const logFile = path.join(this.logDir, `${processId}.log`);
    const pidFile = path.join(this.logDir, `${processId}.pid`);
    
    this.logger?.info(`[AsyncExecutor] 启动异步命令: ${processId}`);
    this.logger?.info(`[AsyncExecutor] 日志文件: ${logFile}`);

    return new Promise((resolve) => {
      // 启动后台进程
      const shellCommand = `(${command}) > "${logFile}" 2>&1 & echo $! > "${pidFile}"`;
      
      exec(shellCommand, { shell: '/bin/bash' }, (error) => {
        if (error) {
          resolve({
            success: false,
            error: `启动失败: ${error.message}`,
            processId
          });
          return;
        }

        // 等待 PID 文件生成
        setTimeout(() => {
          let pid = null;
          if (existsSync(pidFile)) {
            pid = readFileSync(pidFile, 'utf8').trim();
          }

          this.runningProcesses.set(processId, {
            pid,
            command,
            logFile,
            startTime: Date.now()
          });

          // 监控日志文件
          this.monitorLog(processId, logFile, timeout, onOutput, resolve);
        }, 500);
      });
    });
  }

  /**
   * 监控日志文件
   */
  monitorLog(processId, logFile, timeout, onOutput, resolve) {
    const startTime = Date.now();
    let lastSize = 0;
    let outputBuffer = '';
    let resolved = false;
    
    // 成功模式
    const successPatterns = [
      /listening on|started|running|ready|server.*started/i,
      /✅|success|completed|done/i,
      /\[Main\].*初始化/,
      /WebSocket.*listening/i
    ];
    
    // 错误模式
    const errorPatterns = [
      /error:|exception:|failed:|fatal:/i,
      /EADDRINUSE|EACCES|ENOENT/i,
      /Cannot find module/i,
      /SyntaxError|TypeError|ReferenceError/i
    ];

    const checkLog = () => {
      if (resolved) return;
      
      if (!existsSync(logFile)) {
        return; // 文件还未创建
      }

      try {
        const content = readFileSync(logFile, 'utf8');
        const newContent = content.slice(lastSize);
        lastSize = content.length;
        
        if (newContent) {
          outputBuffer += newContent;
          onOutput?.(newContent);
          
          // 检查成功模式
          if (successPatterns.some(p => p.test(outputBuffer))) {
            resolved = true;
            clearInterval(checkInterval);
            clearTimeout(timeoutId);
            
            resolve({
              success: true,
              output: outputBuffer.slice(-5000),
              processId,
              mode: 'async',
              logFile,
              message: '命令已在后台启动并运行成功'
            });
            return;
          }
          
          // 检查错误模式
          if (errorPatterns.some(p => p.test(newContent))) {
            resolved = true;
            clearInterval(checkInterval);
            clearTimeout(timeoutId);
            
            resolve({
              success: false,
              error: '检测到错误',
              output: outputBuffer.slice(-5000),
              processId,
              mode: 'async',
              logFile
            });
            return;
          }
        }
      } catch (e) {
        // 文件读取错误，继续等待
      }
    };

    // 定期检查日志
    const checkInterval = setInterval(checkLog, 500);
    
    // 首次检查
    setTimeout(checkLog, 200);

    // 超时处理
    const timeoutId = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      clearInterval(checkInterval);
      
      // 超时但可能仍在运行
      const hasOutput = outputBuffer.length > 0;
      
      resolve({
        success: hasOutput, // 有输出认为启动成功
        output: outputBuffer.slice(-5000) || '(无输出)',
        processId,
        mode: 'async',
        logFile,
        message: hasOutput 
          ? `命令已在后台运行 (${timeout/1000}秒内有输出)` 
          : `命令可能仍在运行，请检查日志: ${logFile}`,
        warning: '超时但进程可能仍在后台运行'
      });
    }, timeout);
  }

  /**
   * 获取进程状态
   */
  getProcessStatus(processId) {
    const proc = this.runningProcesses.get(processId);
    if (!proc) {
      return { exists: false };
    }

    let isRunning = false;
    if (proc.pid) {
      try {
        process.kill(parseInt(proc.pid), 0);
        isRunning = true;
      } catch (e) {
        isRunning = false;
      }
    }

    let lastOutput = '';
    if (existsSync(proc.logFile)) {
      const content = readFileSync(proc.logFile, 'utf8');
      lastOutput = content.slice(-2000);
    }

    return {
      exists: true,
      processId,
      pid: proc.pid,
      command: proc.command,
      isRunning,
      logFile: proc.logFile,
      lastOutput,
      uptime: Date.now() - proc.startTime
    };
  }

  /**
   * 停止进程
   */
  stopProcess(processId) {
    const proc = this.runningProcesses.get(processId);
    if (!proc || !proc.pid) {
      return { success: false, error: '进程不存在' };
    }

    try {
      process.kill(parseInt(proc.pid), 'SIGTERM');
      this.runningProcesses.delete(processId);
      return { success: true, message: `进程 ${proc.pid} 已停止` };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  /**
   * 读取进程日志
   */
  readLog(processId, tail = 100) {
    const proc = this.runningProcesses.get(processId);
    const logFile = proc?.logFile || path.join(this.logDir, `${processId}.log`);
    
    if (!existsSync(logFile)) {
      return { success: false, error: '日志文件不存在' };
    }

    const content = readFileSync(logFile, 'utf8');
    const lines = content.split('\n');
    const lastLines = lines.slice(-tail).join('\n');

    return {
      success: true,
      logFile,
      lines: lines.length,
      content: lastLines
    };
  }

  /**
   * 清理旧日志
   */
  cleanupLogs(maxAge = 24 * 60 * 60 * 1000) {
    const now = Date.now();
    let cleaned = 0;
    
    if (!existsSync(this.logDir)) return { cleaned: 0 };
    
    const files = readdirSync(this.logDir);
    for (const file of files) {
      const filePath = path.join(this.logDir, file);
      const stat = statSync(filePath);
      if (now - stat.mtimeMs > maxAge) {
        unlinkSync(filePath);
        cleaned++;
      }
    }
    
    return { cleaned };
  }
}
