// Retry Manager - 自动重试管理模块

class RetryManager {
  constructor(logger, errorClassifier) {
    this.logger = logger;
    this.errorClassifier = errorClassifier;
    // 记录每个工具调用的重试次数: callId -> { attempts, lastError }
    this.retryState = new Map();
  }

  // 获取调用的重试状态
  getRetryState(callId) {
    return this.retryState.get(callId) || { attempts: 0, lastError: null };
  }

  // 记录一次重试
  recordAttempt(callId, error) {
    const state = this.getRetryState(callId);
    state.attempts++;
    state.lastError = error;
    state.lastAttemptTime = Date.now();
    this.retryState.set(callId, state);
    
    // 5分钟后清理
    setTimeout(() => this.retryState.delete(callId), 5 * 60 * 1000);
    
    return state;
  }

  // 判断是否应该自动重试
  shouldRetry(callId, error) {
    const classified = this.errorClassifier.classify(error);
    const state = this.getRetryState(callId);
    
    // 不可恢复的错误不重试
    if (!classified.recoverable) {
      return { shouldRetry: false, reason: 'not_recoverable' };
    }
    
    // 没有重试策略不重试
    if (!classified.retryStrategy) {
      return { shouldRetry: false, reason: 'no_retry_strategy' };
    }
    
    const { maxRetries } = classified.retryStrategy;
    
    // 超过最大重试次数不重试
    if (state.attempts >= maxRetries) {
      return { shouldRetry: false, reason: 'max_retries_exceeded', attempts: state.attempts };
    }
    
    return {
      shouldRetry: true,
      delay: classified.retryStrategy.delay || 1000,
      action: classified.retryStrategy.action || null,
      attemptNumber: state.attempts + 1,
      maxRetries
    };
  }

  // 执行重试前的修复动作
  async executePreRetryAction(action, hub) {
    this.logger.info(`[RetryManager] 执行修复动作: ${action}`);
    
    switch (action) {
      case 'reload_tools':
        // 重新加载工具
        await hub.reload();
        return { success: true, message: '工具已重新加载' };
        
      case 'rebuild_context':
        // 对于 Playwright，这个需要在 MCP 侧处理
        // 这里只是标记需要重建
        return { success: true, message: '标记需要重建上下文' };
        
      case 'refresh_snapshot':
        // 提示需要刷新快照
        return { success: true, message: '建议重新 take_snapshot' };
        
      default:
        return { success: false, message: '未知动作: ' + action };
    }
  }

  // 创建带重试的工具调用包装器
  async executeWithRetry(callId, tool, params, executeFn, hub) {
    let lastError = null;
    let attempts = 0;
    const maxAttempts = 3; // 最多尝试3次（1次原始 + 2次重试）
    
    while (attempts < maxAttempts) {
      try {
        attempts++;
        this.logger.info(`[RetryManager] 执行 ${tool} (尝试 ${attempts}/${maxAttempts})`);
        
        const result = await executeFn();
        
        // 成功，清理状态
        this.retryState.delete(callId);
        return { success: true, result, attempts };
        
      } catch (error) {
        lastError = error;
        this.recordAttempt(callId, error.message);
        
        const retryDecision = this.shouldRetry(callId, error);
        
        if (!retryDecision.shouldRetry) {
          this.logger.warning(`[RetryManager] 不再重试 ${tool}: ${retryDecision.reason}`);
          break;
        }
        
        this.logger.info(`[RetryManager] 将在 ${retryDecision.delay}ms 后重试 ${tool}`);
        
        // 执行修复动作
        if (retryDecision.action) {
          await this.executePreRetryAction(retryDecision.action, hub);
        }
        
        // 等待后重试
        await new Promise(resolve => setTimeout(resolve, retryDecision.delay));
      }
    }
    
    // 所有重试都失败
    return { 
      success: false, 
      error: lastError, 
      attempts,
      classified: this.errorClassifier.wrapError(lastError, tool)
    };
  }

  // 清理过期的重试状态
  cleanup() {
    const now = Date.now();
    const expireTime = 5 * 60 * 1000; // 5分钟
    
    for (const [callId, state] of this.retryState) {
      if (now - state.lastAttemptTime > expireTime) {
        this.retryState.delete(callId);
      }
    }
  }
}

export default RetryManager;
