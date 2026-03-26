// State Manager v2 - 增强版状态机
// 新增: 表达式条件引擎, 分支逻辑支持, forEach/while 循环状态管理

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import VariableResolver from './variable-resolver.js';

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
    this.tasks = new Map();
    this.variables = new Map();
    this.resolver = new VariableResolver(logger);
  }

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
        timeout: 600000,
        maxLoopIterations: 50,
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

  getTask(taskId) {
    return this.tasks.get(taskId);
  }

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

  recordStepResult(taskId, stepIndex, result) {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    
    task.results[stepIndex] = {
      ...result,
      timestamp: Date.now()
    };
    task.currentStep = stepIndex + 1;
    task.updatedAt = Date.now();
    
    const step = task.steps[stepIndex];
    if (step?.saveAs) {
      // v2.2: 统一存 {success, result, error} 对象，不管成败
      let parsedResult = result.result;
      if (typeof parsedResult === 'string') {
        parsedResult = parsedResult.trim();
        try { parsedResult = JSON.parse(parsedResult); } catch (e) {}
      }
      const value = result.success
        ? { success: true, result: parsedResult }
        : { success: false, error: result.error, errorType: result.errorType };
      this.setVariable(taskId, step.saveAs, value);
      this.logger.info(`[StateManager] 💾 保存变量: ${step.saveAs} = ${typeof value === 'object' ? JSON.stringify(value).substring(0,100) : String(value).substring(0,100)}`);
    }
    
    return task;
  }

  createCheckpoint(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    
    const checkpoint = {
      step: task.currentStep,
      state: task.state,
      results: [...task.results],
      variables: JSON.parse(JSON.stringify(this.variables.get(taskId) || {})),
      timestamp: Date.now()
    };
    
    task.checkpoints.push(checkpoint);
    this.logger.info(`[StateManager] 任务 ${taskId}: 创建检查点 @ step ${checkpoint.step}`);
    return checkpoint;
  }

  restoreFromCheckpoint(taskId, checkpointIndex = -1) {
    const task = this.tasks.get(taskId);
    if (!task || task.checkpoints.length === 0) return null;
    
    const idx = checkpointIndex < 0 ? task.checkpoints.length + checkpointIndex : checkpointIndex;
    const checkpoint = task.checkpoints[idx];
    if (!checkpoint) return null;
    
    task.currentStep = checkpoint.step;
    task.state = TaskState.PAUSED;
    task.results = [...checkpoint.results];
    this.variables.set(taskId, JSON.parse(JSON.stringify(checkpoint.variables)));
    task.updatedAt = Date.now();
    
    this.logger.info(`[StateManager] 任务 ${taskId}: 从检查点 ${idx} 恢复到 step ${checkpoint.step}`);
    return task;
  }

  setVariable(taskId, name, value) {
    const vars = this.variables.get(taskId);
    if (vars) {
      // 支持深度设置: "result.status" -> vars.result.status
      if (name.includes('.')) {
        const parts = name.split('.');
        let obj = vars;
        for (let i = 0; i < parts.length - 1; i++) {
          if (!obj[parts[i]] || typeof obj[parts[i]] !== 'object') {
            obj[parts[i]] = {};
          }
          obj = obj[parts[i]];
        }
        obj[parts[parts.length - 1]] = value;
      } else {
        vars[name] = value;
      }
    }
  }

  getVariable(taskId, name) {
    const vars = this.variables.get(taskId) || {};
    return this.resolver._accessValue(name, vars);
  }

  getAllVariables(taskId) {
    return this.variables.get(taskId) || {};
  }

  /**
   * 模板替换 - v2: 递归处理对象和数组
   */
  resolveTemplate(taskId, template) {
    try {
      const vars = this.variables.get(taskId) || {};
      return this.resolver.resolve(template, vars);
    } catch (error) {
      this.logger.error('[StateManager] 模板解析失败:', error.message);
      return template;
    }
  }

  /**
   * 条件评估 v2 - 支持旧格式 + 新表达式格式
   */
  evaluateCondition(taskId, condition) {
    this.logger.info('[StateManager] 🔍 评估条件:', JSON.stringify(condition));
    if (!condition) return true;
    
    const vars = this.variables.get(taskId) || {};
    
    // === 新格式: 字符串表达式 ===
    if (typeof condition === 'string') {
      // 兼容旧格式 'success'
      if (condition === 'success') {
        const task = this.tasks.get(taskId);
        if (!task || task.results.length === 0) return false;
        const lastResult = task.results[task.results.length - 1];
        return lastResult?.success === true;
      }
      
      // 新: 表达式求值
      try {
        return this.resolver.evaluateExpression(condition, vars);
      } catch (e) {
        this.logger.error('[StateManager] 表达式求值失败:', condition, e.message);
        return false;
      }
    }
    
    // === 旧格式: 对象条件（完全兼容） ===
    if (typeof condition === 'object') {
      const { var: varName, success, contains, regex, equals, exists, expr } = condition;
      
      // 新: expr 字段支持表达式
      if (expr) {
        try {
          return this.resolver.evaluateExpression(expr, vars);
        } catch (e) {
          this.logger.error('[StateManager] expr 求值失败:', expr, e.message);
          return false;
        }
      }
      
      const varValue = varName ? this.resolver._accessValue(varName, vars) : undefined;
      
      if (exists !== undefined) {
        return exists ? varValue !== undefined && varValue !== null : varValue === undefined || varValue === null;
      }
      
      if (equals !== undefined) {
        return varValue == equals;
      }
      
      if (success !== undefined) {
        if (success === true) return varValue !== undefined;
        if (success === false) return varValue === undefined;
        if (typeof varValue === 'object' && varValue !== null && 'success' in varValue) {
          return varValue.success === success;
        }
        return false;
      }
      
      if (contains) {
        if (varValue === undefined) return false;
        const resultStr = typeof varValue === 'string' ? varValue : JSON.stringify(varValue);
        return resultStr.includes(contains);
      }
      
      if (regex) {
        if (varValue === undefined) return false;
        const resultStr = typeof varValue === 'string' ? varValue : JSON.stringify(varValue);
        return new RegExp(regex).test(resultStr);
      }
    }
    
    return true;
  }

  completeTask(taskId, success, error = null) {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    
    task.state = success ? TaskState.SUCCESS : TaskState.FAILED;
    task.completedAt = Date.now();
    task.error = error;
    task.updatedAt = Date.now();
    
    this.logger.info(`[StateManager] 任务 ${taskId}: 完成 (${task.state})`);
    
    if (this.storagePath) {
      this.saveTask(taskId);
    }
    
    return task;
  }

  saveTask(taskId) {
    if (!this.storagePath) return;
    const task = this.tasks.get(taskId);
    if (!task) return;
    
    try {
      if (!existsSync(this.storagePath)) {
        mkdirSync(this.storagePath, { recursive: true });
      }
      const filePath = path.join(this.storagePath, `task-${taskId}.json`);
      writeFileSync(filePath, JSON.stringify({
        task,
        variables: this.variables.get(taskId)
      }, null, 2));
      this.logger.info(`[StateManager] 任务 ${taskId} 已保存`);
    } catch (e) {
      this.logger.error(`[StateManager] 保存任务失败: ${e.message}`);
    }
  }

  loadTask(taskId) {
    if (!this.storagePath) return null;
    const filePath = path.join(this.storagePath, `task-${taskId}.json`);
    if (!existsSync(filePath)) return null;
    
    try {
      const data = JSON.parse(readFileSync(filePath, 'utf-8'));
      this.tasks.set(taskId, data.task);
      this.variables.set(taskId, data.variables || {});
      this.logger.info(`[StateManager] 任务 ${taskId} 已加载`);
      return data.task;
    } catch (e) {
      this.logger.error(`[StateManager] 加载任务失败: ${e.message}`);
      return null;
    }
  }

  cleanup(maxAge = 30 * 60 * 1000) {
    const now = Date.now();
    let cleaned = 0;
    for (const [taskId, task] of this.tasks) {
      if (task.state === TaskState.SUCCESS || task.state === TaskState.FAILED) {
        if (now - task.updatedAt > maxAge) {
          this.tasks.delete(taskId);
          this.variables.delete(taskId);
          cleaned++;
        }
      }
    }
    if (cleaned > 0) {
      this.logger.info(`[StateManager] 清理了 ${cleaned} 个过期任务`);
    }
  }

  getTaskSummary(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    return {
      id: task.id,
      state: task.state,
      progress: `${task.currentStep}/${task.totalSteps}`,
      successSteps: task.results.filter(r => r?.success).length,
      failedSteps: task.results.filter(r => r && !r.success).length,
      duration: task.completedAt ? task.completedAt - task.createdAt : Date.now() - task.createdAt,
      error: task.error
    };
  }
}

export { TaskState };
export default StateManager;
