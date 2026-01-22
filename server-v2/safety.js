// Safety 模块 - 安全检查和权限控制

import path from 'path';

class Safety {
  constructor(config, logger) {
    this.config = config || {};
    this.logger = logger;
    this.pendingConfirmations = new Map();
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

    return {
      allowed: false,
      reason: `路径不允许: ${normalizedPath}`
    };
  }

  isCommandSafe(command) {
    if (!this.config.blockedCommands && !this.config.allowedCommands) {
      return { safe: true };
    }
    
    const cmd = command.toLowerCase().trim();

    // 检查黑名单
    if (this.config.blockedCommands) {
      for (const blocked of this.config.blockedCommands) {
        if (cmd.includes(blocked.toLowerCase())) {
          return { safe: false, reason: `命令被阻止: ${blocked}` };
        }
      }
    }

    // 检查白名单
    if (this.config.allowedCommands) {
      const baseCmd = cmd.split(' ')[0];
      const isAllowed = this.config.allowedCommands.some(
        allowed => baseCmd === allowed || baseCmd.endsWith('/' + allowed)
      );

      if (!isAllowed) {
        return { safe: false, reason: `命令不在白名单: ${baseCmd}` };
      }
    }

    return { safe: true };
  }

  requiresConfirmation(operation) {
    if (!this.config.requireConfirmation) {
      return false;
    }
    return this.config.dangerousOperations?.includes(operation) || false;
  }

  createConfirmationRequest(id, operation, params) {
    return new Promise((resolve) => {
      this.logger.info(`创建确认请求: ${id}`);
      
      this.pendingConfirmations.set(id, {
        operation,
        params,
        resolve,
        timestamp: Date.now()
      });

      // 60秒超时
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
    // 路径检查
    if (params.path) {
      const pathCheck = this.isPathAllowed(params.path);
      if (!pathCheck.allowed) {
        return { allowed: false, reason: pathCheck.reason };
      }
    }

    // 命令检查 (针对 shell/command 类工具)
    if (params.command) {
      const cmdCheck = this.isCommandSafe(params.command);
      if (!cmdCheck.safe) {
        return { allowed: false, reason: cmdCheck.reason };
      }
    }

    // 确认检查
    if (this.requiresConfirmation(operation) && broadcastConfirmRequest) {
      const confirmId = Date.now().toString();
      
      this.logger.info(`请求用户确认: ${operation}`);
      
      broadcastConfirmRequest({
        type: 'confirm_operation',
        id: confirmId,
        operation,
        params
      });
      
      const result = await this.createConfirmationRequest(confirmId, operation, params);
      
      if (!result.approved) {
        return { allowed: false, reason: result.reason || '用户拒绝' };
      }
    }

    return { allowed: true };
  }
}

export default Safety;
