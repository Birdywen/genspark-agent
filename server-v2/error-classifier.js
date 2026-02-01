// Error Classifier - 错误分类与修复建议模块

class ErrorClassifier {
  constructor() {
    // 错误模式定义
    this.patterns = [
      // 超时类
      {
        type: 'TIMEOUT',
        patterns: [/timeout/i, /timed? out/i, /ETIMEDOUT/i],
        recoverable: true,
        suggestion: '操作超时，可尝试: 1) 重试 2) 拆分任务 3) 后台执行 (nohup cmd &)',
        retryStrategy: { maxRetries: 2, delay: 1000 }
      },
      // 文件/路径不存在
      {
        type: 'NOT_FOUND',
        patterns: [/not found/i, /enoent/i, /no such file/i, /does not exist/i],
        recoverable: false,
        suggestion: '文件或路径不存在，请用 list_directory 确认路径是否正确'
      },
      // 权限问题
      {
        type: 'PERMISSION_DENIED',
        patterns: [/permission denied/i, /eacces/i, /access denied/i, /not permitted/i],
        recoverable: false,
        suggestion: '权限不足，请检查: 1) 路径是否在允许目录内 2) 文件权限设置'
      },
      // 浏览器未安装
      {
        type: 'BROWSER_MISSING',
        patterns: [/browser.*not.*install/i, /executable.*not.*found/i, /chromium.*missing/i],
        recoverable: true,
        suggestion: '浏览器未安装，请执行: npx playwright install chromium',
        retryStrategy: { maxRetries: 0 }  // 需要手动修复后重试
      },
      // 页面/上下文已关闭
      {
        type: 'PAGE_CLOSED',
        patterns: [/page.*closed/i, /context.*destroyed/i, /target.*closed/i, /session.*closed/i],
        recoverable: true,
        suggestion: '页面已关闭，系统将尝试重建上下文',
        retryStrategy: { maxRetries: 1, delay: 500, action: 'rebuild_context' }
      },
      // 元素未找到
      {
        type: 'ELEMENT_NOT_FOUND',
        patterns: [/element.*not.*found/i, /selector.*not.*found/i, /no.*element.*match/i, /uid.*not.*found/i],
        recoverable: true,
        suggestion: '元素未找到，建议: 1) 重新 take_snapshot 获取最新 uid 2) 检查选择器',
        retryStrategy: { maxRetries: 1, delay: 500, action: 'refresh_snapshot' }
      },
      // 网络错误
      {
        type: 'NETWORK_ERROR',
        patterns: [/network/i, /econnrefused/i, /econnreset/i, /socket hang up/i, /fetch failed/i],
        recoverable: true,
        suggestion: '网络错误，请检查网络连接后重试',
        retryStrategy: { maxRetries: 3, delay: 2000 }
      },
      // 语法/参数错误
      {
        type: 'INVALID_PARAMS',
        patterns: [/invalid.*param/i, /invalid.*argument/i, /expected.*string/i, /validation.*error/i, /schema.*error/i],
        recoverable: false,
        suggestion: '参数错误，请检查工具调用的参数格式是否正确'
      },
      // 命令不存在
      {
        type: 'COMMAND_NOT_FOUND',
        patterns: [/command not found/i, /not recognized/i, /unknown command/i],
        recoverable: false,
        suggestion: '命令不存在，请检查命令是否已安装或拼写是否正确'
      },
      // 工具未找到
      {
        type: 'TOOL_NOT_FOUND',
        patterns: [/tool.*not.*found/i, /unknown tool/i, /工具未找到/i],
        recoverable: true,
        suggestion: '工具未找到，可能需要刷新工具列表 (点击 🔧 按钮)',
        retryStrategy: { maxRetries: 1, delay: 500, action: 'reload_tools' }
      },
      // 进程退出
      {
        type: 'PROCESS_EXIT',
        patterns: [/process.*exit/i, /exited.*code/i, /spawn.*error/i],
        recoverable: true,
        suggestion: 'MCP 进程异常退出，尝试刷新工具列表重连',
        retryStrategy: { maxRetries: 1, delay: 1000, action: 'reload_tools' }
      }
    ];
  }

  // 分类错误
  classify(error) {
    const errorStr = typeof error === 'string' ? error : (error.message || String(error));
    
    for (const pattern of this.patterns) {
      for (const regex of pattern.patterns) {
        if (regex.test(errorStr)) {
          return {
            type: pattern.type,
            originalError: errorStr,
            recoverable: pattern.recoverable,
            suggestion: pattern.suggestion,
            retryStrategy: pattern.retryStrategy || null
          };
        }
      }
    }
    
    // 未知错误
    return {
      type: 'UNKNOWN',
      originalError: errorStr,
      recoverable: false,
      suggestion: '未知错误，请查看详细错误信息'
    };
  }

  // 包装错误响应
  wrapError(error, tool) {
    const classified = this.classify(error);
    return {
      success: false,
      tool,
      errorType: classified.type,
      error: classified.originalError,
      recoverable: classified.recoverable,
      suggestion: classified.suggestion,
      retryStrategy: classified.retryStrategy
    };
  }

  // 判断是否应该自动重试
  shouldAutoRetry(classifiedError, attemptCount = 0) {
    if (!classifiedError.recoverable) return false;
    if (!classifiedError.retryStrategy) return false;
    
    const { maxRetries } = classifiedError.retryStrategy;
    return attemptCount < maxRetries;
  }

  // 获取重试延迟
  getRetryDelay(classifiedError) {
    return classifiedError.retryStrategy?.delay || 1000;
  }

  // 获取重试前的修复动作
  getRetryAction(classifiedError) {
    return classifiedError.retryStrategy?.action || null;
  }
}

export default ErrorClassifier;
