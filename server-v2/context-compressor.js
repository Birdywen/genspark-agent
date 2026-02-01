/**
 * 上下文压缩模块
 * 长对话自动总结，保留关键信息，避免 token 超限
 */

export default class ContextCompressor {
  constructor(logger) {
    this.logger = logger;
    this.maxContextLength = 50000;  // 最大上下文字符数
    this.compressionThreshold = 40000;  // 触发压缩的阈值
    this.preserveRecentCount = 10;  // 保留最近N条完整消息
    
    // 重要内容模式（不压缩）
    this.importantPatterns = [
      /\b(error|错误|失败|Error|ERROR)\b/i,
      /\b(todo|TODO|待办|任务)\b/,
      /\b(重要|注意|警告|warning|IMPORTANT)\b/i,
      /\b(密码|password|token|key|secret)\b/i,
      /\b(版本|version|v\d+\.\d+)\b/i,
      /^#{1,3}\s+/m,  // Markdown 标题
      /```[\s\S]*?```/,  // 代码块
      /@DONE|@RETRY/,
      /里程碑|milestone/i
    ];
    
    // 可压缩内容模式
    this.compressiblePatterns = [
      /\[执行结果\][\s\S]*?(?=\[执行结果\]|$)/g,  // 重复的执行结果
      /```[\s\S]{500,}?```/g,  // 超长代码块
      /^\s*[-*]\s+.{10,}$/gm,  // 长列表项
    ];
  }

  /**
   * 压缩上下文
   */
  compress(messages) {
    if (!Array.isArray(messages) || messages.length === 0) {
      return { messages, compressed: false };
    }

    const totalLength = this.calculateLength(messages);
    
    if (totalLength < this.compressionThreshold) {
      return { messages, compressed: false, totalLength };
    }

    this.logger?.info(`[Compressor] 开始压缩，当前长度: ${totalLength}`);
    
    // 分离：保留最近的 + 需要压缩的
    const recentMessages = messages.slice(-this.preserveRecentCount);
    const olderMessages = messages.slice(0, -this.preserveRecentCount);
    
    // 压缩旧消息
    const summary = this.summarizeMessages(olderMessages);
    
    // 构建压缩后的上下文
    const compressedMessages = [
      {
        role: 'system',
        content: `[历史摘要 - ${olderMessages.length} 条消息已压缩]\n${summary}`
      },
      ...recentMessages
    ];
    
    const newLength = this.calculateLength(compressedMessages);
    this.logger?.info(`[Compressor] 压缩完成: ${totalLength} -> ${newLength} (节省 ${Math.round((1 - newLength/totalLength) * 100)}%)`);
    
    return {
      messages: compressedMessages,
      compressed: true,
      originalLength: totalLength,
      compressedLength: newLength,
      summarizedCount: olderMessages.length
    };
  }

  /**
   * 生成消息摘要
   */
  summarizeMessages(messages) {
    const sections = {
      tasks: [],      // 执行的任务
      files: new Set(),  // 涉及的文件
      errors: [],     // 错误信息
      decisions: [],  // 重要决策
      milestones: []  // 里程碑
    };

    for (const msg of messages) {
      const content = msg.content || '';
      
      // 提取文件路径
      const filePaths = content.match(/\/[\w\/\-\.]+\.(js|json|md|txt|py|ts|css|html)/g);
      if (filePaths) {
        filePaths.forEach(p => sections.files.add(p));
      }
      
      // 提取错误
      if (/error|错误|失败|Error/i.test(content)) {
        const errorLine = this.extractKeyLine(content, /error|错误|失败/i);
        if (errorLine && !sections.errors.includes(errorLine)) {
          sections.errors.push(errorLine.slice(0, 100));
        }
      }
      
      // 提取任务完成
      if (/@DONE|完成|成功/.test(content)) {
        const taskLine = this.extractKeyLine(content, /完成|成功|@DONE/);
        if (taskLine) {
          sections.tasks.push(taskLine.slice(0, 80));
        }
      }
      
      // 提取里程碑
      if (/里程碑|milestone/i.test(content)) {
        const milestone = this.extractKeyLine(content, /里程碑|milestone/i);
        if (milestone) {
          sections.milestones.push(milestone.slice(0, 100));
        }
      }
      
      // 提取重要决策
      if (/决定|选择|采用|使用|方案/.test(content)) {
        const decision = this.extractKeyLine(content, /决定|选择|采用/);
        if (decision && decision.length > 20) {
          sections.decisions.push(decision.slice(0, 100));
        }
      }
    }

    // 构建摘要
    let summary = '';
    
    if (sections.milestones.length > 0) {
      summary += `**里程碑:**\n${sections.milestones.slice(-5).map(m => `- ${m}`).join('\n')}\n\n`;
    }
    
    if (sections.tasks.length > 0) {
      summary += `**已完成任务:** ${sections.tasks.length} 项\n`;
      summary += sections.tasks.slice(-5).map(t => `- ${t}`).join('\n') + '\n\n';
    }
    
    if (sections.files.size > 0) {
      const fileList = Array.from(sections.files).slice(-10);
      summary += `**涉及文件:** ${fileList.join(', ')}\n\n`;
    }
    
    if (sections.errors.length > 0) {
      summary += `**遇到的错误:** ${sections.errors.length} 个\n`;
      summary += sections.errors.slice(-3).map(e => `- ${e}`).join('\n') + '\n\n';
    }
    
    if (sections.decisions.length > 0) {
      summary += `**重要决策:**\n${sections.decisions.slice(-3).map(d => `- ${d}`).join('\n')}\n\n`;
    }

    return summary || '(无重要信息)';
  }

  /**
   * 提取关键行
   */
  extractKeyLine(content, pattern) {
    const lines = content.split('\n');
    for (const line of lines) {
      if (pattern.test(line) && line.trim().length > 10) {
        return line.trim();
      }
    }
    return null;
  }

  /**
   * 计算消息总长度
   */
  calculateLength(messages) {
    return messages.reduce((sum, msg) => {
      return sum + (msg.content?.length || 0);
    }, 0);
  }

  /**
   * 压缩单条消息（用于实时压缩）
   */
  compressMessage(content, maxLength = 2000) {
    if (content.length <= maxLength) {
      return content;
    }

    // 检查是否包含重要内容
    const hasImportant = this.importantPatterns.some(p => p.test(content));
    
    if (hasImportant) {
      // 保留重要部分，压缩其他
      return this.smartTruncate(content, maxLength);
    }
    
    // 简单截断
    return content.slice(0, maxLength - 50) + '\n\n...(已截断 ' + (content.length - maxLength) + ' 字符)';
  }

  /**
   * 智能截断（保留头尾和重要部分）
   */
  smartTruncate(content, maxLength) {
    const headLength = Math.floor(maxLength * 0.3);
    const tailLength = Math.floor(maxLength * 0.5);
    const middleIndicator = '\n\n... [中间内容已省略] ...\n\n';
    
    const head = content.slice(0, headLength);
    const tail = content.slice(-tailLength);
    
    return head + middleIndicator + tail;
  }

  /**
   * 提取执行结果摘要
   */
  summarizeToolResult(result, toolName) {
    if (typeof result !== 'string') {
      result = JSON.stringify(result);
    }
    
    if (result.length <= 500) {
      return result;
    }

    // 根据工具类型定制摘要
    switch (toolName) {
      case 'list_directory':
        const items = result.split('\n').filter(l => l.trim());
        if (items.length > 20) {
          return items.slice(0, 10).join('\n') + 
                 `\n... (共 ${items.length} 项，省略 ${items.length - 15} 项) ...\n` +
                 items.slice(-5).join('\n');
        }
        break;
        
      case 'read_file':
        if (result.length > 1000) {
          const lines = result.split('\n');
          return `[文件内容 ${lines.length} 行, ${result.length} 字符]\n` +
                 lines.slice(0, 20).join('\n') +
                 '\n... (内容已截断)';
        }
        break;
        
      case 'run_command':
        if (result.length > 800) {
          return result.slice(0, 400) + 
                 '\n... (输出已截断) ...\n' +
                 result.slice(-300);
        }
        break;
    }
    
    return this.smartTruncate(result, 500);
  }

  /**
   * 获取压缩统计
   */
  getStats(messages) {
    const totalLength = this.calculateLength(messages);
    return {
      messageCount: messages.length,
      totalLength,
      needsCompression: totalLength > this.compressionThreshold,
      compressionRatio: totalLength > 0 ? 
        Math.round((this.compressionThreshold / totalLength) * 100) + '%' : '100%'
    };
  }
}
