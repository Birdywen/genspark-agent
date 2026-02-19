/**
 * 错误自愈模块 v2
 * 自动检测常见错误并尝试修复后重试
 * 集成到 handleToolCall 主流程中
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';

export default class AutoHealer {
  constructor(logger, hub) {
    this.logger = logger;
    this.hub = hub;
    this.maxRetries = 2;
    this.retryDelay = 1000;

    // 错误模式 -> 修复策略
    this.healingStrategies = [
      // ── 1. 路径不存在：自动创建目录 ──
      {
        name: 'ENOENT',
        detect: (error, tool, params) => {
          return (error.includes('ENOENT') ||
                 error.includes('no such file or directory') ||
                 error.includes('does not exist')) &&
                 (tool === 'write_file' || tool === 'edit_file');
        },
        heal: async (error, tool, params) => {
          const filePath = params.path;
          if (!filePath) return { healed: false };
          const dir = path.dirname(filePath);
          if (!existsSync(dir)) {
            this.logger?.info(`[AutoHealer] 创建目录: ${dir}`);
            mkdirSync(dir, { recursive: true });
            return { healed: true, message: `已创建目录: ${dir}`, retry: true };
          }
          return { healed: false };
        }
      },

      // ── 2. 文件被占用：等待后重试 ──
      {
        name: 'EBUSY',
        detect: (error) => {
          return error.includes('EBUSY') ||
                 error.includes('resource busy') ||
                 error.includes('file is being used');
        },
        heal: async () => {
          this.logger?.info(`[AutoHealer] 文件被占用，等待 ${this.retryDelay}ms`);
          await this.sleep(this.retryDelay);
          return { healed: true, message: '等待后重试', retry: true };
        }
      },

      // ── 3. edit_file 匹配失败：自动读取文件查找相似内容 ──
      {
        name: 'EDIT_MATCH_FAILED',
        detect: (error, tool) => {
          return tool === 'edit_file' &&
                 (error.includes('Could not find') ||
                  error.includes('not found in') ||
                  error.includes('No match') ||
                  error.includes('oldText'));
        },
        heal: async (error, tool, params) => {
          if (!params.edits || !params.edits[0]?.oldText || !params.path) {
            return { healed: false };
          }
          try {
            // 读取文件内容
            const readResult = await this.callTool('read_file', { path: params.path });
            if (!readResult) return { healed: false };

            const fileContent = this.extractText(readResult);
            const oldText = params.edits[0].oldText;

            // 尝试修剪空白差异后匹配
            const trimmedOld = oldText.replace(/[ \t]+$/gm, '');
            const trimmedContent = fileContent.replace(/[ \t]+$/gm, '');

            if (trimmedContent.includes(trimmedOld)) {
              // 找到了，是尾部空格差异导致的
              // 找出文件中实际的文本
              const lines = fileContent.split('\n');
              const searchLines = oldText.split('\n');
              const firstSearchLine = searchLines[0].trim();

              let startIdx = -1;
              for (let i = 0; i < lines.length; i++) {
                if (lines[i].trim() === firstSearchLine) {
                  // 验证后续行也匹配
                  let match = true;
                  for (let j = 1; j < searchLines.length && i + j < lines.length; j++) {
                    if (lines[i + j].trim() !== searchLines[j].trim()) {
                      match = false;
                      break;
                    }
                  }
                  if (match) {
                    startIdx = i;
                    break;
                  }
                }
              }

              if (startIdx >= 0) {
                const actualOldText = lines.slice(startIdx, startIdx + searchLines.length).join('\n');
                return {
                  healed: true,
                  message: `尾部空格差异，已修正 oldText`,
                  retry: true,
                  modifiedParams: {
                    ...params,
                    edits: [{ oldText: actualOldText, newText: params.edits[0].newText }]
                  }
                };
              }
            }

            // 返回文件片段帮助 AI 定位
            const firstLine = oldText.split('\n')[0].trim();
            let context = '';
            const lines2 = fileContent.split('\n');
            for (let i = 0; i < lines2.length; i++) {
              if (lines2[i].includes(firstLine.substring(0, 30))) {
                const start = Math.max(0, i - 2);
                const end = Math.min(lines2.length, i + 5);
                context = lines2.slice(start, end).map((l, idx) => `${start + idx + 1}: ${l}`).join('\n');
                break;
              }
            }

            return {
              healed: false,
              suggestion: context
                ? `未精确匹配，文件中相似内容 (行号仅供参考):\n${context}`
                : '未找到匹配内容，建议 read_file 查看文件后重试'
            };
          } catch (e) {
            this.logger?.warn(`[AutoHealer] edit_file 自愈失败: ${e.message}`);
            return { healed: false };
          }
        }
      },

      // ── 4. ffmpeg 参数错误：自动转脚本执行 ──
      {
        name: 'FFMPEG_ARGS',
        detect: (error, tool, params) => {
          if (tool !== 'run_process' && tool !== 'run_command') return false;
          const cmd = params.command_line || params.command || '';
          return cmd.includes('ffmpeg') &&
                 (error.includes('No such filter') ||
                  error.includes('Unrecognized option') ||
                  error.includes('Invalid option') ||
                  error.includes('not found') ||
                  error.includes('No such file or directory'));
        },
        heal: async (error, tool, params) => {
          const cmd = params.command_line || params.command || '';
          // 如果已经是脚本执行方式，不再重试
          if (cmd.startsWith('bash ') && cmd.includes('/private/tmp/')) {
            return { healed: false, suggestion: 'ffmpeg 脚本执行仍失败，请检查参数' };
          }
          try {
            const scriptPath = `/private/tmp/ff_auto_${Date.now()}.sh`;
            writeFileSync(scriptPath, `#!/bin/bash\n${cmd}\n`, { mode: 0o755 });
            this.logger?.info(`[AutoHealer] ffmpeg 命令写入脚本: ${scriptPath}`);
            return {
              healed: true,
              message: `ffmpeg 参数解析失败，已转为脚本执行`,
              retry: true,
              modifiedParams: {
                command_line: `bash ${scriptPath}`,
                mode: 'shell'
              },
              modifiedTool: 'run_process'
            };
          } catch (e) {
            return { healed: false };
          }
        }
      },

      // ── 5. eval_js 超时：标记不要盲目重试 ──
      {
        name: 'EVAL_JS_TIMEOUT',
        detect: (error, tool) => {
          return (tool === 'eval_js' || tool === 'js_flow') &&
                 (error.includes('timeout') || error.includes('Timeout'));
        },
        heal: async (error, tool, params) => {
          // eval_js 超时不自动重试，因为请求可能已经在后台成功
          return {
            healed: false,
            suggestion: 'eval_js 超时不代表请求未发出，请先检查操作是否已生效，不要直接重试以避免重复消耗'
          };
        }
      },

      // ── 6. 命令超时：建议后台执行 ──
      {
        name: 'COMMAND_TIMEOUT',
        detect: (error, tool) => {
          return (tool === 'run_process' || tool === 'run_command') &&
                 (error.includes('timeout') || error.includes('Timeout') || error.includes('ETIMEDOUT'));
        },
        heal: async (error, tool, params) => {
          const cmd = params.command_line || params.command || '';
          return {
            healed: false,
            suggestion: `命令超时，建议使用 bg_run 后台执行: ${cmd.substring(0, 100)}`
          };
        }
      },

      // ── 7. 端口被占用 ──
      {
        name: 'PORT_IN_USE',
        detect: (error) => {
          return error.includes('EADDRINUSE') || error.includes('address already in use');
        },
        heal: async (error) => {
          const portMatch = error.match(/:([0-9]+)/);
          const port = portMatch ? portMatch[1] : null;
          if (port) {
            return {
              healed: false,
              suggestion: `端口 ${port} 被占用。用 lsof -i :${port} 查看占用进程`
            };
          }
          return { healed: false };
        }
      },

      // ── 8. 模块未找到 ──
      {
        name: 'MODULE_NOT_FOUND',
        detect: (error) => {
          return error.includes('Cannot find module') || error.includes('MODULE_NOT_FOUND');
        },
        heal: async (error) => {
          const moduleMatch = error.match(/Cannot find module ['"]([^'"]+)['"]/);
          const moduleName = moduleMatch ? moduleMatch[1] : null;
          return {
            healed: false,
            suggestion: moduleName
              ? `模块 ${moduleName} 未找到，尝试 npm install ${moduleName}`
              : '模块未找到，检查 import/require 路径'
          };
        }
      },

      // ── 9. JSON 解析错误 ──
      {
        name: 'JSON_PARSE',
        detect: (error) => {
          return error.includes('JSON') &&
                 (error.includes('parse') || error.includes('Unexpected'));
        },
        heal: async () => {
          return {
            healed: false,
            suggestion: 'JSON 格式错误，检查引号转义、多余逗号、中文引号'
          };
        }
      },

      // ── 10. /tmp 路径问题 (macOS) ──
      {
        name: 'TMP_PATH',
        detect: (error, tool, params) => {
          const filePath = params.path || params.command_line || '';
          return error.includes('Access denied') &&
                 filePath.includes('/tmp/') &&
                 !filePath.includes('/private/tmp/');
        },
        heal: async (error, tool, params) => {
          // 自动将 /tmp/ 替换为 /private/tmp/
          const fixPath = (p) => p.replace(/\/tmp\//g, '/private/tmp/');
          const modifiedParams = { ...params };
          if (modifiedParams.path) {
            modifiedParams.path = fixPath(modifiedParams.path);
          }
          if (modifiedParams.command_line) {
            modifiedParams.command_line = fixPath(modifiedParams.command_line);
          }
          this.logger?.info(`[AutoHealer] /tmp/ → /private/tmp/`);
          return {
            healed: true,
            message: '已将 /tmp/ 修正为 /private/tmp/',
            retry: true,
            modifiedParams
          };
        }
      }
    ];
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 从 MCP 结果中提取文本
   */
  extractText(result) {
    if (typeof result === 'string') return result;
    if (result && result.content && Array.isArray(result.content)) {
      return result.content
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join('\n');
    }
    return JSON.stringify(result);
  }

  /**
   * 调用 MCP 工具（通过 hub）
   */
  async callTool(tool, params) {
    try {
      return await this.hub.call(tool, params);
    } catch (e) {
      this.logger?.warn(`[AutoHealer] callTool ${tool} 失败: ${e.message}`);
      return null;
    }
  }

  /**
   * 尝试自愈 - 返回 { healed, retry, message, suggestion, modifiedParams, modifiedTool }
   */
  async tryHeal(error, tool, params) {
    const errorStr = typeof error === 'string' ? error : (error.message || String(error));

    for (const strategy of this.healingStrategies) {
      try {
        if (strategy.detect(errorStr, tool, params)) {
          this.logger?.info(`[AutoHealer] 匹配策略: ${strategy.name}`);
          const result = await strategy.heal(errorStr, tool, params);
          if (result.healed || result.suggestion) {
            return result;
          }
        }
      } catch (e) {
        this.logger?.warn(`[AutoHealer] 策略 ${strategy.name} 执行失败: ${e.message}`);
      }
    }

    return { healed: false };
  }
}
