// Logger 模块 - 记录所有操作日志

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class Logger {
  constructor(config) {
    this.enabled = config?.enabled ?? true;
    this.consoleOutput = config?.console ?? true;
    this.logFile = config?.file ? path.resolve(__dirname, config.file) : null;
    
    // 确保日志目录存在
    if (this.logFile) {
      const logDir = path.dirname(this.logFile);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
    }
  }

  _formatMessage(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const entry = {
      timestamp,
      level,
      message,
      ...(data && { data })
    };
    return entry;
  }

  _write(entry) {
    if (!this.enabled) return;

    const jsonLine = JSON.stringify(entry);

    // 写入文件
    if (this.logFile) {
      fs.appendFileSync(this.logFile, jsonLine + '\n');
    }

    // 控制台输出
    if (this.consoleOutput) {
      const colors = {
        info: '\x1b[36m',    // cyan
        success: '\x1b[32m', // green
        warning: '\x1b[33m', // yellow
        error: '\x1b[31m',   // red
        tool: '\x1b[35m',    // magenta
        reset: '\x1b[0m'
      };
      
      const color = colors[entry.level] || colors.info;
      const time = entry.timestamp.split('T')[1].split('.')[0];
      console.log(`${color}[${time}] [${entry.level.toUpperCase()}]${colors.reset} ${entry.message}`);
      
      if (entry.data) {
        console.log(`  └─ ${JSON.stringify(entry.data).slice(0, 200)}`);
      }
    }
  }

  info(message, data = null) {
    this._write(this._formatMessage('info', message, data));
  }

  success(message, data = null) {
    this._write(this._formatMessage('success', message, data));
  }

  warning(message, data = null) {
    this._write(this._formatMessage('warning', message, data));
  }

  error(message, data = null) {
    this._write(this._formatMessage('error', message, data));
  }

  tool(toolName, params, result = null) {
    this._write(this._formatMessage('tool', `Tool: ${toolName}`, { params, result }));
  }

  operation(operation, params, approved, result = null) {
    this._write(this._formatMessage('info', `Operation: ${operation}`, {
      params,
      approved,
      result
    }));
  }
}

export default Logger;
