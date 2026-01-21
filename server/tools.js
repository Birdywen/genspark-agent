// Tools 模块 - 工具定义和执行

import fs from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import https from 'https';
import http from 'http';

const execAsync = promisify(exec);

class Tools {
  constructor(config, safety, logger) {
    this.config = config;
    this.safety = safety;
    this.logger = logger;
    
    // 工具定义
    this.toolDefinitions = [
      {
        name: 'read_file',
        description: '读取文件内容',
        params: { path: 'string (文件路径)' }
      },
      {
        name: 'write_file',
        description: '写入文件内容（危险操作，需确认）',
        params: { path: 'string (文件路径)', content: 'string (文件内容)' }
      },
      {
        name: 'list_directory',
        description: '列出目录内容',
        params: { path: 'string (目录路径)' }
      },
      {
        name: 'create_directory',
        description: '创建目录',
        params: { path: 'string (目录路径)' }
      },
      {
        name: 'delete_file',
        description: '删除文件（危险操作，需确认）',
        params: { path: 'string (文件路径)' }
      },
      {
        name: 'execute_shell',
        description: '执行Shell命令（危险操作，需确认，仅限白名单命令）',
        params: { command: 'string (Shell命令)' }
      },
      {
        name: 'http_get',
        description: '发送HTTP GET请求',
        params: { url: 'string (URL地址)' }
      },
      {
        name: 'http_post',
        description: '发送HTTP POST请求',
        params: { url: 'string (URL地址)', body: 'object (请求体)', headers: 'object (可选，请求头)' }
      },
      {
        name: 'search_files',
        description: '搜索文件',
        params: { directory: 'string (目录)', pattern: 'string (文件名模式，如 *.js)' }
      },
      {
        name: 'get_file_info',
        description: '获取文件信息',
        params: { path: 'string (文件路径)' }
      },
      {
        name: 'edit_file',
        description: '搜索并替换文件中的内容',
        params: { path: 'string', search: 'string', replace: 'string' }
      }
    ];
  }

  // 获取所有工具定义
  getDefinitions() {
    return this.toolDefinitions;
  }

  // 执行工具
  async execute(toolName, params, requestConfirmation) {
    this.logger.info(`执行工具: ${toolName}`, params);

    // 安全检查
    const safetyCheck = await this.safety.checkOperation(
      toolName, 
      params, 
      requestConfirmation
    );

    if (!safetyCheck.allowed) {
      return {
        success: false,
        error: safetyCheck.reason
      };
    }

    try {
      let result;
      
      switch (toolName) {
        case 'read_file':
          result = await this.readFile(params.path);
          break;
        case 'write_file':
          result = await this.writeFile(params.path, params.content);
          break;
        case 'list_directory':
          result = await this.listDirectory(params.path);
          break;
        case 'create_directory':
          result = await this.createDirectory(params.path);
          break;
        case 'delete_file':
          result = await this.deleteFile(params.path);
          break;
        case 'execute_shell':
          result = await this.executeShell(params.command);
          break;
        case 'http_get':
          result = await this.httpGet(params.url);
          break;
        case 'http_post':
          result = await this.httpPost(params.url, params.body, params.headers);
          break;
        case 'search_files':
          result = await this.searchFiles(params.directory, params.pattern);
          break;
        case 'get_file_info':
          result = await this.getFileInfo(params.path);
          break;
        case 'edit_file':
          result = await this.editFile(params.path, params.search, params.replace);
          break;
        default:
          return { success: false, error: `未知工具: ${toolName}` };
      }

      this.logger.tool(toolName, params, result);
      return { success: true, result };

    } catch (error) {
      this.logger.error(`工具执行失败: ${toolName}`, { error: error.message });
      return { success: false, error: error.message };
    }
  }

  // ============== 文件操作 ==============

  async readFile(filePath) {
    const resolvedPath = path.resolve(filePath);
    const content = await fs.readFile(resolvedPath, 'utf-8');
    return {
      path: resolvedPath,
      content,
      size: content.length
    };
  }

  async writeFile(filePath, content) {
    const resolvedPath = path.resolve(filePath);
    await fs.writeFile(resolvedPath, content, 'utf-8');
    return {
      path: resolvedPath,
      written: true,
      size: content.length
    };
  }

  async listDirectory(dirPath) {
    const resolvedPath = path.resolve(dirPath);
    const entries = await fs.readdir(resolvedPath, { withFileTypes: true });
    
    const items = entries.map(entry => ({
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : 'file',
      path: path.join(resolvedPath, entry.name)
    }));

    return {
      path: resolvedPath,
      items,
      count: items.length
    };
  }

  async createDirectory(dirPath) {
    const resolvedPath = path.resolve(dirPath);
    await fs.mkdir(resolvedPath, { recursive: true });
    return {
      path: resolvedPath,
      created: true
    };
  }

  async deleteFile(filePath) {
    const resolvedPath = path.resolve(filePath);
    await fs.unlink(resolvedPath);
    return {
      path: resolvedPath,
      deleted: true
    };
  }

  async getFileInfo(filePath) {
    const resolvedPath = path.resolve(filePath);
    const stats = await fs.stat(resolvedPath);
    
    return {
      path: resolvedPath,
      size: stats.size,
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory(),
      created: stats.birthtime,
      modified: stats.mtime,
      accessed: stats.atime
    };
  }

  async editFile(filePath, search, replace) {
const resolvedPath = path.resolve(filePath);
if (!existsSync(resolvedPath)) throw new Error('文件不存在: ' + resolvedPath);
let fc = await fs.readFile(resolvedPath, 'utf-8');
if (!fc.includes(search)) throw new Error('未找到匹配内容');
await fs.writeFile(resolvedPath, fc.replace(search, replace), 'utf-8');
return { path: resolvedPath, replaced: true };
}
async searchFiles(directory, pattern) {
    const resolvedPath = path.resolve(directory);
    const results = [];
    
    const search = async (dir) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          await search(fullPath);
        } else {
          // 简单的通配符匹配
          const regex = new RegExp(
            '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
          );
          if (regex.test(entry.name)) {
            results.push(fullPath);
          }
        }
      }
    };

    await search(resolvedPath);
    return { pattern, directory: resolvedPath, matches: results, count: results.length };
  }

  // ============== Shell 执行 ==============

  async executeShell(command) {
    const { stdout, stderr } = await execAsync(command, {
      timeout: 60000,
      cwd: this.config.allowedPaths[0] || process.cwd()
    });

    return {
      command,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      success: true
    };
  }

  // ============== HTTP 请求 ==============

  httpGet(url) {
    return new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http;
      
      client.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          resolve({
            url,
            statusCode: res.statusCode,
            headers: res.headers,
            body: data
          });
        });
      }).on('error', reject);
    });
  }

  httpPost(url, body, headers = {}) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const client = url.startsWith('https') ? https : http;
      
      const postData = JSON.stringify(body || {});
      
      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (url.startsWith('https') ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          ...headers
        }
      };

      const req = client.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          resolve({
            url,
            statusCode: res.statusCode,
            headers: res.headers,
            body: data
          });
        });
      });

      req.on('error', reject);
      req.write(postData);
      req.end();
    });
  }
}

export default Tools;
