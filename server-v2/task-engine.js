// Task Engine - 批量任务执行引擎

import StateManager, { TaskState } from './state-manager.js';

class TaskEngine {
  constructor(logger, hub, safety, errorClassifier) {
    this.logger = logger;
    this.hub = hub;
    this.safety = safety;
    this.errorClassifier = errorClassifier;
    this.stateManager = new StateManager(logger);
    this.browserCallHandler = null;
  }

  static BROWSER_TOOLS = ['list_tabs', 'eval_js', 'js_flow'];

  // 工具别名映射（与 index.js TOOL_ALIASES 保持同步）
  static TOOL_ALIASES = {
    'run_command': { target: 'run_process', transform: (p) => ({ command_line: p.command, mode: 'shell', ...(p.stdin && { stdin: p.stdin }), ...(p.timeout && { timeout_ms: p.timeout * 1000 }), ...(p.cwd && { cwd: p.cwd }) }) }
  };

  resolveAlias(tool, params) {
    const alias = TaskEngine.TOOL_ALIASES[tool];
    if (alias) {
      return { tool: alias.target, params: alias.transform ? alias.transform(params) : params };
    }
    return { tool, params };
  }

  setBrowserCallHandler(handler) {
    this.browserCallHandler = handler;
  }

  /**
   * 将步骤按 parallel 标记分组
   * 连续的 parallel:true 步骤会被分到同一组
   */
  groupStepsByParallel(steps) {
    const groups = [];
    let currentGroup = [];
    
    for (let i = 0; i < steps.length; i++) {
      const step = { ...steps[i], originalIndex: i };
      
      if (step.parallel && currentGroup.length > 0 && currentGroup[0].parallel) {
        // 加入当前并行组
        currentGroup.push(step);
      } else {
        // 开始新组
        if (currentGroup.length > 0) {
          groups.push(currentGroup);
        }
        currentGroup = [step];
      }
    }
    
    if (currentGroup.length > 0) {
      groups.push(currentGroup);
    }
    
    return groups;
  }

  /**
   * 执行单个步骤
   */
  async executeStep(batchId, step, options, onStepComplete) {
    const i = step.originalIndex;
    
    // 检查条件
    if (step.when && !this.stateManager.evaluateCondition(batchId, step.when)) {
      this.logger.info(`[TaskEngine] 跳过步骤 ${i}: 条件不满足`);
      const result = {
        stepIndex: i,
        skipped: true,
        reason: 'condition_not_met'
      };
      if (onStepComplete) onStepComplete(result);
      return result;
    }
    
    // 解析模板
    const resolvedParams = this.stateManager.resolveTemplate(batchId, step.params);
    
    // 安全检查
    const safetyCheck = await this.safety.checkOperation(step.tool, resolvedParams);
    if (!safetyCheck.allowed) {
      const stepResult = {
        stepIndex: i,
        tool: step.tool,
        success: false,
        error: safetyCheck.reason
      };
      this.stateManager.recordStepResult(batchId, i, stepResult);
      if (onStepComplete) onStepComplete(stepResult);
      return stepResult;
    }
    
    // 执行工具调用
    try {
      this.logger.info(`[TaskEngine] 执行步骤 ${i}: ${step.tool}`);
      
      // 浏览器端工具走 browserCallHandler
      const isBrowserTool = TaskEngine.BROWSER_TOOLS.includes(step.tool);
      let result;
      if (isBrowserTool && this.browserCallHandler) {
        this.logger.info(`[TaskEngine] 浏览器工具 ${step.tool}，委托浏览器执行`);
        result = await this.browserCallHandler(step.tool, resolvedParams);
      } else {
        const resolved = this.resolveAlias(step.tool, resolvedParams);
        result = await this.hub.call(resolved.tool, resolved.params);
      }
      
      let resultStr = result;
      if (result && result.content && Array.isArray(result.content)) {
        resultStr = result.content.map(c => c.text || c).join('\n');
      }
      
      const stepResult = {
        stepIndex: i,
        tool: step.tool,
        success: true,
        result: typeof resultStr === 'string' ? resultStr : JSON.stringify(resultStr)
      };
      
      this.stateManager.recordStepResult(batchId, i, stepResult);
      if (onStepComplete) onStepComplete(stepResult);
      
      return stepResult;
      
    } catch (e) {
      const classified = this.errorClassifier.wrapError(e, step.tool);
      
      const stepResult = {
        stepIndex: i,
        tool: step.tool,
        success: false,
        error: e.message,
        errorType: classified.errorType,
        recoverable: classified.recoverable,
        suggestion: classified.suggestion
      };
      
      this.stateManager.recordStepResult(batchId, i, stepResult);
      if (onStepComplete) onStepComplete(stepResult);
      
      return stepResult;
    }
  }

  /**
   * 执行批量任务（支持并行）
   */
  async executeBatch(batchId, steps, options = {}, onStepComplete = null) {
    const task = this.stateManager.createTask(batchId, steps, options);
    this.stateManager.updateState(batchId, TaskState.RUNNING);
    
    // 按 parallel 标记分组
    const groups = this.groupStepsByParallel(steps);
    this.logger.info(`[TaskEngine] 批量任务分组: ${groups.length} 组，总计 ${steps.length} 步`);
    
    const results = [];
    let success = true;
    
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
      const group = groups[groupIndex];
      const isParallelGroup = group.length > 1 && group[0].parallel;
      
      if (isParallelGroup) {
        this.logger.info(`[TaskEngine] 并行执行组 ${groupIndex + 1}: ${group.length} 步`);
        
        // 并行执行
        const groupResults = await Promise.all(
          group.map(step => this.executeStep(batchId, step, options, onStepComplete))
        );
        
        results.push(...groupResults);
        
        // 检查是否有失败
        const hasFailure = groupResults.some(r => !r.skipped && !r.success);
        if (hasFailure && options.stopOnError !== false) {
          success = false;
          break;
        }
        
      } else {
        // 顺序执行
        this.logger.info(`[TaskEngine] 顺序执行组 ${groupIndex + 1}: ${group.length} 步`);
        
        for (const step of group) {
          const stepResult = await this.executeStep(batchId, step, options, onStepComplete);
          results.push(stepResult);
          
          // 检查是否需要停止
          if (!stepResult.skipped && !stepResult.success && options.stopOnError !== false) {
            success = false;
            break;
          }
        }
        
        if (!success && options.stopOnError !== false) {
          break;
        }
      }
    }
    
    // 完成任务
    this.stateManager.completeTask(batchId, success);
    
    return {
      batchId,
      success,
      stepsCompleted: results.filter(r => r.success).length,
      stepsFailed: results.filter(r => !r.skipped && !r.success).length,
      stepsSkipped: results.filter(r => r.skipped).length,
      totalSteps: steps.length,
      results
    };
  }

  // 从断点继续执行
  async resumeTask(taskId, onStepComplete = null) {
    const task = this.stateManager.getTask(taskId);
    if (!task) {
      return { success: false, error: '任务不存在' };
    }
    
    if (task.state === TaskState.SUCCESS) {
      return { success: true, message: '任务已完成' };
    }
    
    // 从当前步骤继续
    const remainingSteps = task.steps.slice(task.currentStep);
    if (remainingSteps.length === 0) {
      return { success: true, message: '没有剩余步骤' };
    }
    
    this.logger.info(`[TaskEngine] 继续任务 ${taskId}: 从步骤 ${task.currentStep} 开始`);
    
    // 重用现有任务状态，继续执行
    this.stateManager.updateState(taskId, TaskState.RUNNING);
    
    const results = [...task.results];
    let success = true;
    
    for (let i = task.currentStep; i < task.steps.length; i++) {
      const step = task.steps[i];
      
      // 检查条件
      if (step.when && !this.stateManager.evaluateCondition(taskId, step.when)) {
        results.push({ stepIndex: i, skipped: true, reason: 'condition_not_met' });
        continue;
      }
      
      const resolvedParams = this.stateManager.resolveTemplate(taskId, step.params);
      
      try {
        const resolved = this.resolveAlias(step.tool, resolvedParams);
        const result = await this.hub.call(resolved.tool, resolved.params);
        
        let resultStr = result;
        if (result && result.content && Array.isArray(result.content)) {
          resultStr = result.content.map(c => c.text || c).join('\n');
        }
        
        const stepResult = {
          stepIndex: i,
          tool: step.tool,
          success: true,
          result: typeof resultStr === 'string' ? resultStr : JSON.stringify(resultStr)
        };
        
        results[i] = stepResult;
        this.stateManager.recordStepResult(taskId, i, stepResult);
        
        if (onStepComplete) onStepComplete(stepResult);
        
      } catch (e) {
        const classified = this.errorClassifier.wrapError(e, step.tool);
        
        const stepResult = {
          stepIndex: i,
          tool: step.tool,
          success: false,
          error: e.message,
          errorType: classified.errorType
        };
        
        results[i] = stepResult;
        this.stateManager.recordStepResult(taskId, i, stepResult);
        
        if (onStepComplete) onStepComplete(stepResult);
        
        if (task.options.stopOnError !== false) {
          success = false;
          break;
        }
      }
    }
    
    this.stateManager.completeTask(taskId, success);
    
    return {
      taskId,
      success,
      stepsCompleted: results.filter(r => r?.success).length,
      totalSteps: task.steps.length,
      results
    };
  }

  // 获取任务状态
  getTaskStatus(taskId) {
    return this.stateManager.getTaskSummary(taskId);
  }

  // 创建检查点
  createCheckpoint(taskId) {
    return this.stateManager.createCheckpoint(taskId);
  }

  // 从检查点恢复
  restoreCheckpoint(taskId, checkpointIndex = -1) {
    return this.stateManager.restoreFromCheckpoint(taskId, checkpointIndex);
  }
}

export default TaskEngine;
