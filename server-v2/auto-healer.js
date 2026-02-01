/**
 * 错误自愈模块
 * 自动检测常见错误并尝试修复后重试
 */

import { existsSync, mkdirSync } from 'fs';
import path from 'path';

export default class AutoHealer {
  constructor(logger, hub) {
    this.logger = logger;
    this.hub = hub;
    this.maxRetries = 3;
    this.retryDelay = 1000;
    
    // 错误模式 -> 修复策略
    this.healingStrategies = {
      // 路径不存在
      'ENOENT': {
        detect: (error, tool, params) => {
          return error.includes('ENOENT') || 
                 error.includes('no such file or directory') ||
                 error.includes('does not exist');
        },
        heal: async (error, tool, params) => {
          // 如果是写文件，尝试创建目录
          if (tool === 'write_file' || tool === 'edit_file') {
            const filePath = params.path;
            const dir = path.dirname(filePath);
            if (!existsSync(dir)) {
              this.logger?.info(`[AutoHealer] 创建目录: ${dir}`);
              mkdirSync(dir, { recursive: true });
              return { healed: true, message: `已创建目录: ${dir}` };
            }
          }
          return { healed: false };
        }
      },
      
      // 文件被占用
      'EBUSY': {
        detect: (error) => {
          return error.includes('EBUSY') || 
                 error.includes('resource busy') ||
                 error.includes('file is being used');
        },
        heal: async (error, tool, params) => {
          this.logger?.info(`[AutoHealer] 文件被占用，等待 ${this.retryDelay}ms 后重试`);
          await this.sleep(this.retryDelay);
          return { healed: true, message: '等待后重试' };
        }
      },
      
      // 权限不足
      'EACCES': {
        detect: (error) => {
          return error.includes('EACCES') || 
                 error.includes('permission denied');
        },
        heal: async (error, tool, params) => {
          // 权限问题通常无法自动修复，但可以提供建议
          const filePath = params.path || params.command;
          return { 
            healed: false, 
            suggestion: `权限不足，请尝试: sudo chmod 755 ${filePath} 或检查文件所有者`
          };
        }
      },
      
      // edit_file 匹配失败
      'MATCH_FAILED': {
        detect: (error, tool) => {
          return tool === 'edit_file' && 
                 (error.includes('Could not find') || 
                  error.includes('not found') ||
                  error.includes('No match'));
        },
        heal: async (error, tool, params) => {
          // 尝试查找相似内容
          if (params.edits && params.edits[0]?.oldText) {
            const oldText = params.edits[0].oldText;
            const firstLine = oldText.split('\n')[0].trim();
            if (firstLine.length > 10) {
              this.logger?.info(`[AutoHealer] 尝试查找: ${firstLine.slice(0, 50)}...`);
              try {
                const grepResult = await this.hub.callTool('run_command', {
                  command: `grep -n "${firstLine.replace(/"/g, '\\"').slice(0, 50)}" "${params.path}" | head -5`
                });
                if (grepResult.content) {
                  return {
                    healed: false,
                    suggestion: `未找到精确匹配，相似内容:\n${grepResult.content}`,
                    context: grepResult.content
                  };
                }
              } catch (e) {
                // grep 失败，继续
              }
            }
          }
          return { healed: false, suggestion: '请检查 oldText 是否与文件内容完全匹配（包括空格和换行）' };
        }
      },
      
      // 命令超时
      'TIMEOUT': {
        detect: (error) => {
          return error.includes('timeout') || 
                 error.includes('ETIMEDOUT') ||
                 error.includes('timed out');
        },
        heal: async (error, tool, params) => {
          if (tool === 'run_command') {
            return {
              healed: false,
              suggestion: '命令超时，建议:\n1. 使用 nohup cmd & 后台执行\n2. 拆分为更小的任务\n3. 增加超时时间'
            };
          }
          return { healed: false };
        }
      },
      
      // 端口被占用
      'EADDRINUSE': {
        detect: (error) => {
          return error.includes('EADDRINUSE') || 
                 error.includes('address already in use');
        },
        heal: async (error, tool, params) => {
          // 尝试提取端口号
          const portMatch = error.match(/:([0-9]+)/);
          const port = portMatch ? portMatch[1] : '未知';
          return {
            healed: false,
            suggestion: `端口 ${port} 被占用，建议:\n1. lsof -i :${port} 查看占用进程\n2. kill -9 $(lsof -t -i :${port}) 强制关闭\n3. 使用其他端口`
          };
        }
      },
      
      // JSON 解析错误
      'JSON_PARSE': {
        detect: (error) => {
          return error.includes('JSON') && 
                 (error.includes('parse') || error.includes('Unexpected'));
        },
        heal: async (error, tool, params) => {
          return {
            healed: false,
            suggestion: 'JSON 格式错误，请检查:\n1. 引号是否正确转义\n2. 是否有多余的逗号\n3. 中文引号是否误用'
          };
        }
      },

      // 模块未找到
      'MODULE_NOT_FOUND': {
        detect: (error) => {
          return error.includes('Cannot find module') || 
                 error.includes('MODULE_NOT_FOUND');
        },
        heal: async (error, tool, params) => {
          const moduleMatch = error.match(/Cannot find module ['"]([^'"]+)['"]/);
          const moduleName = moduleMatch ? moduleMatch[1] : '未知模块';
          return {
            healed: false,
            suggestion: `模块 ${moduleName} 未找到，建议:\n1. npm install ${moduleName}\n2. 检查 import/require 路径\n3. 检查 package.json 依赖`
          };
        }
      }
    };
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 执行工具调用，带自动错误修复
   */
  async executeWithHealing(tool, params, options = {}) {
    const { maxRetries = this.maxRetries } = options;
    let lastError = null;
    let lastHealResult = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.logger?.info(`[AutoHealer] 执行 ${tool} (尝试 ${attempt}/${maxRetries})`);
        
        const result = await this.hub.callTool(tool, params);
        
        // 检查结果是否包含错误
        const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
        if (this.isErrorResult(resultStr)) {
          throw new Error(resultStr);
        }
        
        // 成功
        return {
          success: true,
          result,
          attempts: attempt,
          healed: attempt > 1
        };
        
      } catch (error) {
        lastError = error.message || String(error);
        this.logger?.warn(`[AutoHealer] 错误: ${lastError.slice(0, 100)}`);
        
        // 尝试修复
        const healResult = await this.tryHeal(lastError, tool, params);
        lastHealResult = healResult;
        
        if (healResult.healed) {
          this.logger?.info(`[AutoHealer] 已修复: ${healResult.message}`);
          // 修复成功，继续重试
          continue;
        } else {
          // 无法修复
          if (healResult.suggestion) {
            this.logger?.info(`[AutoHealer] 建议: ${healResult.suggestion}`);
          }
          break;
        }
      }
    }
    
    // 所有重试都失败
    return {
      success: false,
      error: lastError,
      attempts: maxRetries,
      suggestion: lastHealResult?.suggestion,
      context: lastHealResult?.context
    };
  }

  /**
   * 检查结果是否为错误
   */
  isErrorResult(result) {
    const errorPatterns = [
      'ENOENT', 'EACCES', 'EBUSY', 'EADDRINUSE',
      'Error:', 'error:', 'failed', 'Failed',
      'Could not find', 'not found', 'No such file'
    ];
    return errorPatterns.some(p => result.includes(p));
  }

  /**
   * 尝试修复错误
   */
  async tryHeal(error, tool, params) {
    for (const [name, strategy] of Object.entries(this.healingStrategies)) {
      if (strategy.detect(error, tool, params)) {
        this.logger?.info(`[AutoHealer] 检测到 ${name} 类型错误，尝试修复...`);
        return await strategy.heal(error, tool, params);
      }
    }
    
    // 未知错误类型
    return { healed: false };
  }

  /**
   * 获取错误类型
   */
  getErrorType(error) {
    for (const [name, strategy] of Object.entries(this.healingStrategies)) {
      if (strategy.detect(error, '', {})) {
        return name;
      }
    }
    return 'UNKNOWN';
  }

  /**
   * 获取修复建议
   */
  async getSuggestion(error, tool, params) {
    const healResult = await this.tryHeal(error, tool, params);
    return healResult.suggestion || '未找到具体建议，请检查错误信息';
  }
}
