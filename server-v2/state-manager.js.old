// State Manager - 任务状态机管理模块

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';

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

  // 记录步骤结果
  recordStepResult(taskId, stepIndex, result) {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    
    task.results[stepIndex] = {
      ...result,
      timestamp: Date.now()
    };
    task.currentStep = stepIndex + 1;
    task.updatedAt = Date.now();
    
    // 如果步骤有 saveAs，保存到变量
    const step = task.steps[stepIndex];
    if (step?.saveAs && result.success) {
      this.setVariable(taskId, step.saveAs, {
        success: result.success,
        result: result.result,
        tool: step.tool
      });
    }
    
    return task;
  }

  // 创建检查点
  createCheckpoint(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    
    const checkpoint = {
      step: task.currentStep,
      state: task.state,
      results: [...task.results],
      variables: { ...this.variables.get(taskId) },
      timestamp: Date.now()
    };
    
    task.checkpoints.push(checkpoint);
    this.logger.info(`[StateManager] 任务 ${taskId}: 创建检查点 @ step ${checkpoint.step}`);
    
    return checkpoint;
  }

  // 从检查点恢复
  restoreFromCheckpoint(taskId, checkpointIndex = -1) {
    const task = this.tasks.get(taskId);
    if (!task || task.checkpoints.length === 0) return null;
    
    const idx = checkpointIndex < 0 ? task.checkpoints.length + checkpointIndex : checkpointIndex;
    const checkpoint = task.checkpoints[idx];
    if (!checkpoint) return null;
    
    task.currentStep = checkpoint.step;
    task.state = TaskState.PAUSED;
    task.results = [...checkpoint.results];
    this.variables.set(taskId, { ...checkpoint.variables });
    task.updatedAt = Date.now();
    
    this.logger.info(`[StateManager] 任务 ${taskId}: 从检查点 ${idx} 恢复到 step ${checkpoint.step}`);
    return task;
  }

  // 设置变量
  setVariable(taskId, name, value) {
    const vars = this.variables.get(taskId);
    if (vars) {
      vars[name] = value;
    }
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

  // 模板替换: 将 {{var.field}} 替换为实际值
  resolveTemplate(taskId, template) {
    if (typeof template !== 'string') {
      if (typeof template === 'object' && template !== null) {
        const resolved = {};
        for (const [key, value] of Object.entries(template)) {
          resolved[key] = this.resolveTemplate(taskId, value);
        }
        return resolved;
      }
      return template;
    }
    
    const vars = this.variables.get(taskId) || {};
    
    return template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
      const parts = path.trim().split('.');
      let value = vars;
      
      for (const part of parts) {
        if (value && typeof value === 'object') {
          value = value[part];
        } else {
          return match; // 保持原样
        }
      }
      
      if (value === undefined) return match;
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value);
    });
  }

  // 评估条件
  evaluateCondition(taskId, condition) {
    if (!condition) return true;
    
    const vars = this.variables.get(taskId) || {};
    
    // 简单字符串条件
    if (condition === 'success') {
      // 检查上一步是否成功
      const task = this.tasks.get(taskId);
      if (!task || task.results.length === 0) return false;
      const lastResult = task.results[task.results.length - 1];
      return lastResult?.success === true;
    }
    
    // 对象条件
    if (typeof condition === 'object') {
      const { var: varName, success, contains, regex } = condition;
      const varValue = vars[varName];
      
      if (!varValue) return false;
      
      if (success !== undefined) {
        return varValue.success === success;
      }
      
      if (contains) {
        const resultStr = typeof varValue.result === 'string' 
          ? varValue.result 
          : JSON.stringify(varValue.result);
        return resultStr.includes(contains);
      }
      
      if (regex) {
        const resultStr = typeof varValue.result === 'string' 
          ? varValue.result 
          : JSON.stringify(varValue.result);
        return new RegExp(regex).test(resultStr);
      }
    }
    
    return true;
  }

  // 完成任务
  completeTask(taskId, success, error = null) {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    
    task.state = success ? TaskState.SUCCESS : TaskState.FAILED;
    task.completedAt = Date.now();
    task.error = error;
    task.updatedAt = Date.now();
    
    this.logger.info(`[StateManager] 任务 ${taskId}: 完成 (${task.state})`);
    
    // 保存到文件（可选）
    if (this.storagePath) {
      this.saveTask(taskId);
    }
    
    return task;
  }

  // 保存任务到文件
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

  // 从文件加载任务
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

  // 清理已完成的任务
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

  // 获取任务摘要
  getTaskSummary(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    
    return {
      id: task.id,
      state: task.state,
      progress: `${task.currentStep}/${task.totalSteps}`,
      successSteps: task.results.filter(r => r?.success).length,
      failedSteps: task.results.filter(r => r && !r.success).length,
      duration: task.completedAt 
        ? task.completedAt - task.createdAt 
        : Date.now() - task.createdAt,
      error: task.error
    };
  }
}

export { TaskState };
export default StateManager;
