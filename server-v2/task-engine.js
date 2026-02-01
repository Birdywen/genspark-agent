// Task Engine - 批量任务执行引擎

import StateManager, { TaskState } from './state-manager.js';

class TaskEngine {
  constructor(logger, hub, safety, errorClassifier) {
    this.logger = logger;
    this.hub = hub;
    this.safety = safety;
    this.errorClassifier = errorClassifier;
    this.stateManager = new StateManager(logger);
  }

  // 执行批量任务
  async executeBatch(batchId, steps, options = {}, onStepComplete = null) {
    const task = this.stateManager.createTask(batchId, steps, options);
    this.stateManager.updateState(batchId, TaskState.RUNNING);
    
    const results = [];
    let success = true;
    
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      
      // 检查条件
      if (step.when && !this.stateManager.evaluateCondition(batchId, step.when)) {
        this.logger.info(`[TaskEngine] 跳过步骤 ${i}: 条件不满足`);
        results.push({
          stepIndex: i,
          skipped: true,
          reason: 'condition_not_met'
        });
        continue;
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
        results.push(stepResult);
        this.stateManager.recordStepResult(batchId, i, stepResult);
        
        if (options.stopOnError !== false) {
          success = false;
          break;
        }
        continue;
      }
      
      // 执行工具调用
      try {
        this.logger.info(`[TaskEngine] 执行步骤 ${i}: ${step.tool}`);
        const result = await this.hub.call(step.tool, resolvedParams);
        
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
        
        results.push(stepResult);
        this.stateManager.recordStepResult(batchId, i, stepResult);
        
        // 回调
        if (onStepComplete) {
          onStepComplete(stepResult);
        }
        
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
        
        results.push(stepResult);
        this.stateManager.recordStepResult(batchId, i, stepResult);
        
        // 回调
        if (onStepComplete) {
          onStepComplete(stepResult);
        }
        
        if (options.stopOnError !== false) {
          success = false;
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
        const result = await this.hub.call(step.tool, resolvedParams);
        
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
