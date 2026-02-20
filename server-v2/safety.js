// Safety 模块 - 安全检查和权限控制 v2.1
// 修复: shell 解释器 -c 参数绕过漏洞

import path from 'path';

const SHELL_INTERPRETERS = new Set([
  'bash', 'sh', 'zsh', 'fish', 'dash', 'ksh',
  'python', 'python3', 'python2',
  'node', 'nodejs',
  'ruby', 'perl', 'php'
]);

const INTERPRETER_EXEC_FLAGS = ['-c', '-e', '--eval', '--exec'];

class Safety {
  constructor(config, logger) {
    this.config = config || {};
    this.logger = logger;
    this.pendingConfirmations = new Map();
    this.DANGEROUS_PATTERNS = [
      /rm\s+-[rf]+\s+[\/~*]/,
      /sudo\s+(rm|su|bash|sh)/,
      /mkfs/,
      /dd\s+if=/,
      /:\(\)\s*\{.*:\|:.*\}/,
      /chmod\s+-R\s+777\s+\//,
      /chown.*root/,
      />\s*\/etc\//,
      />\s*\/usr\//,
      />\s*\/System\//,
      /shutdown|reboot|halt/,
      /curl[^|]*\|\s*(ba)?sh/,
      /wget[^|]*\|\s*(ba)?sh/,
    ];
  }

  isPathAllowed(targetPath) {
    if (!this.config.allowedPaths || this.config.allowedPaths.length === 0) {
      return { allowed: true };
    }
    const normalizedPath = path.resolve(targetPath);
    for (const allowedPath of this.config.allowedPaths) {
      const normalizedAllowed = path.resolve(allowedPath);
      if (normalizedPath.startsWith(normalizedAllowed)) {
        return { allowed: true };
      }
    }
    return { allowed: false, reason: `路径不允许: ${normalizedPath}` };
  }

  isCommandSafe(command) {
    if (!this.config.blockedCommands && !this.config.allowedCommands) {
      return { safe: true };
    }
    const cmd = command.toLowerCase().trim();

    // 第一层：黑名单
    if (this.config.blockedCommands) {
      for (const blocked of this.config.blockedCommands) {
        const b = blocked.toLowerCase();
        const escaped = b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp('(?:^|[;&|\\s])' + escaped + '(?:[\\s;&|]|$)');
        if (pattern.test(cmd)) {
          return { safe: false, reason: `命令被阻止: ${blocked}` };
        }
      }
    }

    // 第二层：shell 解释器 -c 绕过检测
    const bypassCheck = this._checkShellInterpreterBypass(command);
    if (!bypassCheck.safe) return bypassCheck;

    // 第三层：白名单
    if (this.config.allowedCommands) {
      const baseCmd = cmd.split(/\s+/)[0].split('/').pop();
      const isAllowed = this.config.allowedCommands.some(
        allowed => baseCmd === allowed.toLowerCase()
      );
      if (!isAllowed) {
        return { safe: false, reason: `命令不在白名单: ${baseCmd}` };
      }
    }

    return { safe: true };
  }

  _checkShellInterpreterBypass(command) {
    const tokens = command.trim().split(/\s+/);
    if (tokens.length < 3) return { safe: true };
    const baseBin = tokens[0].split('/').pop().toLowerCase();
    if (!SHELL_INTERPRETERS.has(baseBin)) return { safe: true };
    const hasExecFlag = tokens.some(t => INTERPRETER_EXEC_FLAGS.includes(t.toLowerCase()));
    if (!hasExecFlag) return { safe: true };
    const execFlagIndex = tokens.findIndex(t => INTERPRETER_EXEC_FLAGS.includes(t.toLowerCase()));
    const payload = tokens.slice(execFlagIndex + 1).join(' ').replace(/^['"]/,'').replace(/['"]$/,'');
    this.logger.info(`[Safety] shell bypass check: ${baseBin} payload: ${payload.substring(0, 100)}`);
    for (const pattern of this.DANGEROUS_PATTERNS) {
      if (pattern.test(payload)) {
        return { safe: false, reason: `检测到 shell 解释器绕过: ${baseBin} -c "${payload.substring(0, 80)}"` };
      }
    }
    return { safe: true };
  }

  _checkStdinContent(command, stdin) {
    if (!command || !stdin) return { safe: true };
    const baseBin = command.trim().split(/\s+/)[0].split('/').pop().toLowerCase();
    const isShell = ['bash', 'sh', 'zsh', 'fish', 'dash'].includes(baseBin);
    if (!isShell) return { safe: true };
    this.logger.info(`[Safety] stdin check (${baseBin}): ${stdin.substring(0, 100)}`);
    for (const pattern of this.DANGEROUS_PATTERNS) {
      if (pattern.test(stdin)) {
        return { safe: false, reason: `stdin 内容触发危险模式` };
      }
    }
    if (this.config.blockedCommands) {
      const stdinLower = stdin.toLowerCase();
      for (const blocked of this.config.blockedCommands) {
        const b = blocked.toLowerCase();
        const escaped = b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp('(?:^|[;&|\\s\\n])' + escaped + '(?:[\\s;&|\\n]|$)');
        if (pattern.test(stdinLower)) {
          return { safe: false, reason: `stdin 内容被阻止: ${blocked}` };
        }
      }
    }
    return { safe: true };
  }

  requiresConfirmation(operation) {
    if (!this.config.requireConfirmation) return false;
    return this.config.dangerousOperations?.includes(operation) || false;
  }

  createConfirmationRequest(id, operation, params) {
    return new Promise((resolve) => {
      this.logger.info(`创建确认请求: ${id}`);
      this.pendingConfirmations.set(id, { operation, params, resolve, timestamp: Date.now() });
      setTimeout(() => {
        if (this.pendingConfirmations.has(id)) {
          this.logger.warning(`确认超时: ${id}`);
          this.pendingConfirmations.delete(id);
          resolve({ approved: false, reason: '确认超时' });
        }
      }, 60000);
    });
  }

  handleConfirmation(id, approved) {
    this.logger.info(`收到确认结果: ${id}, approved: ${approved}`);
    let pending = this.pendingConfirmations.get(id);
    if (!pending) {
      for (const [key, value] of this.pendingConfirmations.entries()) {
        pending = value;
        this.pendingConfirmations.delete(key);
        break;
      }
    } else {
      this.pendingConfirmations.delete(id);
    }
    if (pending) {
      pending.resolve({ approved });
      this.logger.success(`确认已处理: ${pending.operation}, approved: ${approved}`);
      return true;
    }
    this.logger.warning(`找不到待确认请求: ${id}`);
    return false;
  }

  async checkOperation(operation, params, broadcastConfirmRequest) {
    this.logger.info(`[Safety] checkOperation: operation=${operation}`);

    if (params.path) {
      const pathCheck = this.isPathAllowed(params.path);
      if (!pathCheck.allowed) return { allowed: false, reason: pathCheck.reason };
    }

    const isRemoteTool = operation.startsWith('ssh-');

    if (params.command && !isRemoteTool) {
      const cmdCheck = this.isCommandSafe(params.command);
      if (!cmdCheck.safe) return { allowed: false, reason: cmdCheck.reason };
    }

    if (params.stdin && !isRemoteTool) {
      const stdinCheck = this._checkStdinContent(params.command, params.stdin);
      if (!stdinCheck.safe) return { allowed: false, reason: stdinCheck.reason };
    }

    if (this.requiresConfirmation(operation) && broadcastConfirmRequest) {
      const confirmId = Date.now().toString();
      this.logger.info(`请求用户确认: ${operation}`);
      broadcastConfirmRequest({ type: 'confirm_operation', id: confirmId, operation, params });
      const result = await this.createConfirmationRequest(confirmId, operation, params);
      if (!result.approved) return { allowed: false, reason: result.reason || '用户拒绝' };
    }

    return { allowed: true };
  }
}

export default Safety;
