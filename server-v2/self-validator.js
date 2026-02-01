// 自验证执行器 - 闭环自证系统核心
// 执行 → 验证 → 差距分析 → 自动修复

class SelfValidator {
  constructor(logger, hub) {
    this.logger = logger;
    this.hub = hub;
    
    // 验证规则：工具 -> 验证方法
    this.validationRules = {
      // 文件操作验证
      write_file: async (params, result) => {
        if (!result.success) return { valid: false, reason: '写入失败' };
        // 读取文件确认内容
        const readResult = await this.hub.call('read_file', { path: params.path });
        if (!readResult.success) {
          return { valid: false, reason: '验证读取失败', canRetry: true };
        }
        const written = this._extractContent(readResult);
        const expected = params.content;
        if (written.includes(expected.slice(0, 100))) {
          return { valid: true, message: '文件内容验证通过' };
        }
        return { valid: false, reason: '内容不匹配', expected: expected.slice(0, 100), actual: written.slice(0, 100) };
      },
      
      edit_file: async (params, result) => {
        if (!result.success) return { valid: false, reason: '编辑失败' };
        // 读取文件确认修改
        const readResult = await this.hub.call('read_file', { path: params.path });
        if (!readResult.success) {
          return { valid: false, reason: '验证读取失败', canRetry: true };
        }
        const content = this._extractContent(readResult);
        // 检查所有 newText 是否存在
        for (const edit of params.edits || []) {
          if (edit.newText && !content.includes(edit.newText.slice(0, 50))) {
            return { valid: false, reason: '编辑内容未找到', expected: edit.newText.slice(0, 50) };
          }
        }
        return { valid: true, message: '编辑验证通过' };
      },
      
      create_directory: async (params, result) => {
        if (!result.success) return { valid: false, reason: '创建失败' };
        const listResult = await this.hub.call('list_directory', { path: params.path });
        if (listResult.success) {
          return { valid: true, message: '目录存在验证通过' };
        }
        return { valid: false, reason: '目录不存在', canRetry: true };
      },
      
      run_command: async (params, result) => {
        if (!result.success) {
          // 分析错误类型
          const error = result.error || '';
          if (error.includes('not found')) {
            return { valid: false, reason: '命令不存在', canRetry: false };
          }
          if (error.includes('permission')) {
            return { valid: false, reason: '权限不足', canRetry: false };
          }
          if (error.includes('timeout')) {
            return { valid: false, reason: '执行超时', canRetry: true, suggestion: '使用后台执行' };
          }
          return { valid: false, reason: error, canRetry: true };
        }
        return { valid: true, message: '命令执行成功' };
      },
      
      // Git 操作验证
      'git_commit': async (params, result) => {
        if (!result.success) return { valid: false, reason: '提交失败' };
        // 检查最新提交
        const logResult = await this.hub.call('run_command', {
          command: `git -C ${params.cwd || '.'} log --oneline -1`
        });
        if (logResult.success) {
          return { valid: true, message: '提交验证通过', commitId: this._extractContent(logResult).slice(0, 7) };
        }
        return { valid: false, reason: '无法验证提交' };
      }
    };
  }
  
  _extractContent(result) {
    if (typeof result === 'string') return result;
    if (result.content) {
      if (Array.isArray(result.content)) {
        return result.content.map(c => c.text || '').join('');
      }
      return result.content;
    }
    if (result.result) return this._extractContent(result.result);
    if (result.stdout) return result.stdout;
    return JSON.stringify(result);
  }
  
  /**
   * 执行并验证
   */
  async executeWithValidation(tool, params, options = {}) {
    const { maxRetries = 2, autoFix = true } = options;
    
    this.logger.info(`[Validator] 执行: ${tool}`);
    
    let lastResult = null;
    let lastValidation = null;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // 执行工具
      const result = await this.hub.call(tool, params);
      lastResult = result;
      
      // 获取验证规则
      const validator = this.validationRules[tool];
      if (!validator) {
        // 无验证规则，直接返回
        return { success: result.success, result, validated: false };
      }
      
      // 执行验证
      const validation = await validator(params, result);
      lastValidation = validation;
      
      if (validation.valid) {
        this.logger.success(`[Validator] ${tool} 验证通过: ${validation.message}`);
        return { 
          success: true, 
          result, 
          validated: true, 
          validation,
          attempts: attempt + 1
        };
      }
      
      this.logger.warning(`[Validator] ${tool} 验证失败 (尝试 ${attempt + 1}/${maxRetries + 1}): ${validation.reason}`);
      
      // 检查是否可重试
      if (!validation.canRetry || attempt >= maxRetries) {
        break;
      }
      
      // 自动修复尝试
      if (autoFix && validation.suggestion) {
        this.logger.info(`[Validator] 尝试自动修复: ${validation.suggestion}`);
      }
      
      // 等待后重试
      await new Promise(r => setTimeout(r, 1000));
    }
    
    return {
      success: false,
      result: lastResult,
      validated: true,
      validation: lastValidation,
      attempts: maxRetries + 1
    };
  }
  
  /**
   * 目标驱动执行
   * goal: { description, successCriteria: [...], actions: [...] }
   */
  async executeGoal(goal) {
    this.logger.info(`[Validator] 开始目标: ${goal.description}`);
    
    const results = [];
    let allSuccess = true;
    
    for (const action of goal.actions) {
      const result = await this.executeWithValidation(action.tool, action.params);
      results.push({ action, result });
      
      if (!result.success) {
        allSuccess = false;
        if (goal.stopOnError !== false) {
          break;
        }
      }
    }
    
    // 检查成功标准
    let criteriaResults = [];
    if (goal.successCriteria && allSuccess) {
      for (const criteria of goal.successCriteria) {
        const check = await this._checkCriteria(criteria);
        criteriaResults.push(check);
        if (!check.met) {
          allSuccess = false;
        }
      }
    }
    
    const summary = {
      goal: goal.description,
      success: allSuccess,
      actionsCompleted: results.filter(r => r.result.success).length,
      totalActions: goal.actions.length,
      criteriaResults,
      results
    };
    
    this.logger.info(`[Validator] 目标${allSuccess ? '达成' : '未达成'}: ${goal.description}`);
    
    return summary;
  }
  
  async _checkCriteria(criteria) {
    // criteria: { type: 'file_exists', path: '...' }
    // criteria: { type: 'file_contains', path: '...', text: '...' }
    // criteria: { type: 'command_succeeds', command: '...' }
    
    switch (criteria.type) {
      case 'file_exists': {
        const result = await this.hub.call('get_file_info', { path: criteria.path });
        return { criteria, met: result.success, message: result.success ? '文件存在' : '文件不存在' };
      }
      case 'file_contains': {
        const result = await this.hub.call('read_file', { path: criteria.path });
        if (!result.success) return { criteria, met: false, message: '无法读取文件' };
        const content = this._extractContent(result);
        const contains = content.includes(criteria.text);
        return { criteria, met: contains, message: contains ? '包含目标文本' : '不包含目标文本' };
      }
      case 'command_succeeds': {
        const result = await this.hub.call('run_command', { command: criteria.command });
        return { criteria, met: result.success, message: result.success ? '命令成功' : '命令失败' };
      }
      default:
        return { criteria, met: false, message: '未知标准类型' };
    }
  }
}

export default SelfValidator;
