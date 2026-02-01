// State Manager Enhanced - 集成高级变量解析器

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import VariableResolver from './variable-resolver.js';

// 任务状态枚举
const TaskState = {
  PENDING: 'pending',
  RUNNING: 'running',
  SUCCESS: 'success',
  FAILED: 'failed',
  RETRYING: 'retrying',
  PAUSED: 'paused',
  NEED_USER: 'need_user'
};

class StateManager {
  constructor(logger, storagePath = null) {
    this.logger = logger;
    this.storagePath = storagePath;
    // 当前活跃任务: taskId -> TaskState
    this.tasks = new Map();
    // 任务变量存储: taskId -> { varName: value }
    this.variables = new Map();
    // 高级变量解析器
    this.resolver = new VariableResolver(logger);
  }

  // 创建新任务
  createTask(taskId, steps = [], options = {}) {
    const task = {
      id: taskId,
      state: TaskState.PENDING,
      steps,
      currentStep: 0,
      totalSteps: steps.length,
      results: [],
      checkpoints: [],
      options: {
        stopOnError: true,
        timeout: 120000,
        ...options
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      error: null
    };
    
    this.tasks.set(taskId, task);
    this.variables.set(taskId, {});
    
    this.logger.info(`[StateManager] 创建任务: ${taskId}, ${steps.length} 步`);
    return task;
  }

  // 获取任务
  getTask(taskId) {
    return this.tasks.get(taskId);
  }

  // 更新任务状态
  updateState(taskId, newState, extra = {}) {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    
    const oldState = task.state;
    task.state = newState;
    task.updatedAt = Date.now();
    Object.assign(task, extra);
    
    this.logger.info(`[StateManager] 任务 ${taskId}: ${oldState} -> ${newState}`);
    return task;
  }

  // 记录步骤结果（增强版）
  recordStepResult(taskId, stepIndex, result) {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    
    task.results[stepIndex] = {
      ...result,
      timestamp: Date.now()
    };
    task.currentStep = stepIndex + 1;
    task.updatedAt = Date.now();
    
    // 如果步骤有 saveAs，保存到变量（支持多种格式）
    const step = task.steps[stepIndex];
    if (step?.saveAs && result.success) {
      let value = result.result;
      
      // 尝试解析 JSON
      if (typeof value === 'string') {
        try {
          const parsed = JSON.parse(value);
          value = parsed;
        } catch (e) {
          // 保持字符串
        }
      }
      
      // 保存变量（扁平化存储）
      this.setVariable(taskId, step.saveAs, value);
      
      this.logger.info(`[StateManager] 保存变量: ${step.saveAs} = ${typeof value === 'object' ? JSON.stringify(value).substring(0, 100) + '...' : value}`);
    }
    
    return task;
  }

  // 设置变量
  setVariable(taskId, name, value) {
    const vars = this.variables.get(taskId) || {};
    vars[name] = value;
    this.variables.set(taskId, vars);
  }

  // 获取变量
  getVariable(taskId, name) {
    const vars = this.variables.get(taskId);
    return vars ? vars[name] : undefined;
  }

  // 获取所有变量
  getAllVariables(taskId) {
    return this.variables.get(taskId) || {};
  }

  // 模板替换（使用高级解析器）
  resolveTemplate(taskId, template) {
    const variables = this.variables.get(taskId) || {};
    
    try {
      const resolved = this.resolver.resolve(template, variables);
      
      // 记录解析信息（仅调试）
      if (this.logger.level === 'debug' && typeof template === 'string' && template.includes('{{')) {
        this.logger.debug(`[StateManager] 模板解析:`);
        this.logger.debug(`  输入: ${template}`);
        this.logger.debug(`  输出: ${resolved}`);
      }
      
      return resolved;
    } catch (e) {
      this.logger.error(`[StateManager] 模板解析失败: ${e.message}`);
      return template; // 返回原始模板
    }
  }

  // 评估条件（增强版）
  evaluateCondition(taskId, condition) {
    if (!condition) return true;
    
    const vars = this.variables.get(taskId) || {};
    const task = this.tasks.get(taskId);
    
    // 简单字符串条件
    if (typeof condition === 'string') {
      if (condition === 'success') {
        if (!task || task.results.length === 0) return false;
        const lastResult = task.results[task.results.length - 1];
        return lastResult?.success === true;
      }
      
      // 变量存在性检查
      return vars[condition] !== undefined;
    }
    
    // 对象条件
    if (typeof condition === 'object') {
      const { var: varName, success, contains, regex, exists, equals } = condition;
      
      // 存在性检查
      if (exists !== undefined) {
        return (vars[varName] !== undefined) === exists;
      }
      
      const varValue = vars[varName];
      
      // 相等性检查
      if (equals !== undefined) {
        return varValue === equals;
      }
      
      if (!varValue) return false;
      
      // success 检查
      if (success !== undefined) {
        if (typeof varValue === 'object' && varValue.success !== undefined) {
          return varValue.success === success;
        }
        return false;
      }
      
      // contains 检查
      if (contains) {
        const resultStr = typeof varValue === 'object' 
          ? JSON.stringify(varValue) 
          : String(varValue);
        return resultStr.includes(contains);
      }
      
      // regex 检查
      if (regex) {
        const resultStr = typeof varValue === 'object' 
          ? JSON.stringify(varValue) 
          : String(varValue);
        return new RegExp(regex).test(resultStr);
      }
    }
    
    return false;
  }

  // 创建检查点
  createCheckpoint(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    
    const checkpoint = {
      timestamp: Date.now(),
      currentStep: task.currentStep,
      state: task.state,
      results: [...task.results],
      variables: { ...this.variables.get(taskId) }
    };
    
    task.checkpoints.push(checkpoint);
    return checkpoint;
  }

  // 恢复到检查点
  restoreCheckpoint(taskId, checkpointIndex) {
    const task = this.tasks.get(taskId);
    if (!task || !task.checkpoints[checkpointIndex]) return null;
    
    const checkpoint = task.checkpoints[checkpointIndex];
    task.currentStep = checkpoint.currentStep;
    task.state = checkpoint.state;
    task.results = [...checkpoint.results];
    this.variables.set(taskId, { ...checkpoint.variables });
    
    this.logger.info(`[StateManager] 恢复到检查点 ${checkpointIndex}`);
    return task;
  }

  // 清理任务
  cleanup(taskId) {
    this.tasks.delete(taskId);
    this.variables.delete(taskId);
    this.logger.info(`[StateManager] 清理任务: ${taskId}`);
  }

  // 获取任务统计
  getStats(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    
    const completed = task.results.filter(r => r.success).length;
    const failed = task.results.filter(r => !r.success && !r.skipped).length;
    const skipped = task.results.filter(r => r.skipped).length;
    
    return {
      total: task.totalSteps,
      completed,
      failed,
      skipped,
      pending: task.totalSteps - completed - failed - skipped,
      progress: task.totalSteps > 0 ? (completed / task.totalSteps * 100).toFixed(1) : 0
    };
  }
}

export default StateManager;
export { TaskState };
