// Checkpoint Manager - 断点续传系统
// 状态持久化 → 检查点创建 → 任务恢复 → 幂等性保证

import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import path from 'path';

/**
 * 检查点状态
 */
const CheckpointState = {
  CREATED: 'created',
  RUNNING: 'running',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  FAILED: 'failed',
  RESUMING: 'resuming'
};

/**
 * 断点续传管理器
 */
class CheckpointManager {
  constructor(logger, stateManager, options = {}) {
    this.logger = logger;
    this.stateManager = stateManager;
    this.options = {
      checkpointDir: options.checkpointDir || path.join(process.cwd(), 'checkpoints'),
      autoSaveInterval: options.autoSaveInterval || 5000,  // 自动保存间隔
      maxCheckpoints: options.maxCheckpoints || 50,        // 最大检查点数
      compressionEnabled: options.compressionEnabled || false
    };
    
    this.activeCheckpoints = new Map();
    this.autoSaveTimers = new Map();
    
    this._ensureDir();
    this._loadExistingCheckpoints();
  }
  
  /**
   * 确保检查点目录存在
   */
  _ensureDir() {
    if (!existsSync(this.options.checkpointDir)) {
      mkdirSync(this.options.checkpointDir, { recursive: true });
      this.logger.info(`[CheckpointManager] 创建检查点目录: ${this.options.checkpointDir}`);
    }
  }
  
  /**
   * 加载已存在的检查点
   */
  _loadExistingCheckpoints() {
    try {
      const files = readdirSync(this.options.checkpointDir)
        .filter(f => f.endsWith('.checkpoint.json'));
      
      for (const file of files) {
        try {
          const content = readFileSync(path.join(this.options.checkpointDir, file), 'utf-8');
          const checkpoint = JSON.parse(content);
          
          // 只加载未完成的检查点
          if (checkpoint.state !== CheckpointState.COMPLETED) {
            this.activeCheckpoints.set(checkpoint.id, checkpoint);
            this.logger.info(`[CheckpointManager] 恢复检查点: ${checkpoint.id} (${checkpoint.state})`);
          }
        } catch (e) {
          this.logger.warn(`[CheckpointManager] 加载检查点失败: ${file}`, e.message);
        }
      }
      
      this.logger.info(`[CheckpointManager] 已加载 ${this.activeCheckpoints.size} 个未完成检查点`);
    } catch (e) {
      // 目录可能不存在
    }
  }
  
  /**
   * 创建新检查点
   */
  create(taskId, taskData) {
    const checkpoint = {
      id: taskId,
      state: CheckpointState.CREATED,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      
      // 任务信息
      task: {
        description: taskData.description || '',
        steps: taskData.steps || [],
        totalSteps: (taskData.steps || []).length,
        variables: taskData.variables || {},
        options: taskData.options || {}
      },
      
      // 执行进度
      progress: {
        currentStep: 0,
        completedSteps: [],
        failedSteps: [],
        skippedSteps: []
      },
      
      // 执行结果
      results: {},
      
      // 变量存储 (步骤间传递)
      context: {},
      
      // 错误记录
      errors: [],
      
      // 恢复历史
      resumeHistory: [],
      
      // 幂等性键值 (防止重复执行)
      idempotencyKeys: {}
    };
    
    this.activeCheckpoints.set(taskId, checkpoint);
    this._save(checkpoint);
    this._startAutoSave(taskId);
    
    this.logger.info(`[CheckpointManager] 创建检查点: ${taskId}`);
    return checkpoint;
  }
  
  /**
   * 获取检查点
   */
  get(taskId) {
    return this.activeCheckpoints.get(taskId);
  }
  
  /**
   * 列出所有可恢复的任务
   */
  listResumable() {
    const resumable = [];
    
    for (const [id, cp] of this.activeCheckpoints) {
      if (cp.state !== CheckpointState.COMPLETED) {
        resumable.push({
          id,
          description: cp.task.description,
          state: cp.state,
          progress: `${cp.progress.completedSteps.length}/${cp.task.totalSteps}`,
          createdAt: cp.createdAt,
          updatedAt: cp.updatedAt,
          lastError: cp.errors.length > 0 ? cp.errors[cp.errors.length - 1] : null
        });
      }
    }
    
    return resumable.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }
  
  /**
   * 更新步骤执行状态
   */
  updateStep(taskId, stepIndex, result) {
    const checkpoint = this.activeCheckpoints.get(taskId);
    if (!checkpoint) return null;
    
    checkpoint.updatedAt = new Date().toISOString();
    checkpoint.progress.currentStep = stepIndex + 1;
    
    // 记录结果
    checkpoint.results[stepIndex] = {
      ...result,
      timestamp: new Date().toISOString()
    };
    
    // 更新完成/失败列表
    if (result.success) {
      if (!checkpoint.progress.completedSteps.includes(stepIndex)) {
        checkpoint.progress.completedSteps.push(stepIndex);
      }
      
      // 保存 saveAs 变量
      if (result.saveAs && result.value !== undefined) {
        checkpoint.context[result.saveAs] = result.value;
      }
    } else {
      if (!checkpoint.progress.failedSteps.includes(stepIndex)) {
        checkpoint.progress.failedSteps.push(stepIndex);
      }
      checkpoint.errors.push({
        stepIndex,
        error: result.error,
        timestamp: new Date().toISOString()
      });
    }
    
    // 生成幂等性键
    const step = checkpoint.task.steps[stepIndex];
    if (step) {
      const idempotencyKey = this._generateIdempotencyKey(step);
      checkpoint.idempotencyKeys[idempotencyKey] = {
        stepIndex,
        result: result.success,
        timestamp: new Date().toISOString()
      };
    }
    
    this._save(checkpoint);
    return checkpoint;
  }
  
  /**
   * 标记步骤跳过
   */
  skipStep(taskId, stepIndex, reason) {
    const checkpoint = this.activeCheckpoints.get(taskId);
    if (!checkpoint) return null;
    
    checkpoint.progress.skippedSteps.push(stepIndex);
    checkpoint.results[stepIndex] = {
      skipped: true,
      reason,
      timestamp: new Date().toISOString()
    };
    
    this._save(checkpoint);
    return checkpoint;
  }
  
  /**
   * 更新检查点状态
   */
  updateState(taskId, state, extra = {}) {
    const checkpoint = this.activeCheckpoints.get(taskId);
    if (!checkpoint) return null;
    
    checkpoint.state = state;
    checkpoint.updatedAt = new Date().toISOString();
    Object.assign(checkpoint, extra);
    
    this._save(checkpoint);
    this.logger.info(`[CheckpointManager] 检查点 ${taskId} 状态: ${state}`);
    
    // 如果完成，停止自动保存
    if (state === CheckpointState.COMPLETED) {
      this._stopAutoSave(taskId);
    }
    
    return checkpoint;
  }
  
  /**
   * 恢复任务执行
   */
  resume(taskId) {
    let checkpoint = this.activeCheckpoints.get(taskId);
    
    // 如果内存中没有，尝试从磁盘加载
    if (!checkpoint) {
      const filePath = path.join(this.options.checkpointDir, taskId + '.checkpoint.json');
      if (existsSync(filePath)) {
        try {
          const content = readFileSync(filePath, 'utf-8');
          checkpoint = JSON.parse(content);
          this.activeCheckpoints.set(taskId, checkpoint);
          this.logger.info('[CheckpointManager] 从磁盘加载检查点:', taskId);
        } catch (e) {
          return { success: false, error: '加载检查点失败: ' + e.message };
        }
      }
    }
    
    if (!checkpoint) {
      return { success: false, error: '检查点不存在' };
    }
    
    // 兼容性处理：确保所有必要字段存在
    if (!checkpoint.results) checkpoint.results = {};
    if (!checkpoint.context) checkpoint.context = {};
    if (!checkpoint.errors) checkpoint.errors = [];
    if (!checkpoint.resumeHistory) checkpoint.resumeHistory = [];
    if (!checkpoint.idempotencyKeys) checkpoint.idempotencyKeys = {};
    if (!checkpoint.progress) {
      checkpoint.progress = {
        currentStep: 0,
        completedSteps: [],
        failedSteps: [],
        skippedSteps: []
      };
    } else {
      if (!checkpoint.progress.completedSteps) checkpoint.progress.completedSteps = [];
      if (!checkpoint.progress.failedSteps) checkpoint.progress.failedSteps = [];
      if (!checkpoint.progress.skippedSteps) checkpoint.progress.skippedSteps = [];
    }
    
    if (checkpoint.state === CheckpointState.COMPLETED) {
      return { success: false, error: '任务已完成，无需恢复' };
    }
    
    // 记录恢复历史
    checkpoint.resumeHistory.push({
      timestamp: new Date().toISOString(),
      fromStep: checkpoint.progress.currentStep,
      previousState: checkpoint.state
    });
    
    // 更新状态
    checkpoint.state = CheckpointState.RESUMING;
    checkpoint.updatedAt = new Date().toISOString();
    
    // 计算需要执行的步骤
    const completedSet = new Set(checkpoint.progress.completedSteps);
    const skippedSet = new Set(checkpoint.progress.skippedSteps);
    
    const pendingSteps = [];
    for (let i = 0; i < checkpoint.task.steps.length; i++) {
      if (!completedSet.has(i) && !skippedSet.has(i)) {
        pendingSteps.push({
          index: i,
          step: checkpoint.task.steps[i]
        });
      }
    }
    
    this._save(checkpoint);
    this._startAutoSave(taskId);
    
    this.logger.info(`[CheckpointManager] 恢复任务 ${taskId}, 待执行: ${pendingSteps.length} 步`);
    
    return {
      success: true,
      checkpoint,
      pendingSteps,
      context: checkpoint.context,  // 传递已保存的变量
      resumeFrom: checkpoint.progress.currentStep
    };
  }
  
  /**
   * 检查步骤是否已执行 (幂等性)
   */
  isStepExecuted(taskId, step) {
    const checkpoint = this.activeCheckpoints.get(taskId);
    if (!checkpoint) return false;
    
    const idempotencyKey = this._generateIdempotencyKey(step);
    return !!checkpoint.idempotencyKeys[idempotencyKey];
  }
  
  /**
   * 获取步骤的历史执行结果
   */
  getStepResult(taskId, stepIndex) {
    const checkpoint = this.activeCheckpoints.get(taskId);
    if (!checkpoint) return null;
    
    return checkpoint.results[stepIndex] || null;
  }
  
  /**
   * 生成幂等性键
   */
  _generateIdempotencyKey(step) {
    const keyParts = [
      step.tool,
      JSON.stringify(step.params || {})
    ];
    return keyParts.join('::');
  }
  
  /**
   * 保存检查点到磁盘
   */
  _save(checkpoint) {
    const filePath = path.join(
      this.options.checkpointDir,
      `${checkpoint.id}.checkpoint.json`
    );
    
    try {
      writeFileSync(filePath, JSON.stringify(checkpoint, null, 2));
    } catch (e) {
      this.logger.error(`[CheckpointManager] 保存失败: ${e.message}`);
    }
  }
  
  /**
   * 启动自动保存
   */
  _startAutoSave(taskId) {
    if (this.autoSaveTimers.has(taskId)) return;
    
    const timer = setInterval(() => {
      const checkpoint = this.activeCheckpoints.get(taskId);
      if (checkpoint) {
        this._save(checkpoint);
      }
    }, this.options.autoSaveInterval);
    
    this.autoSaveTimers.set(taskId, timer);
  }
  
  /**
   * 停止自动保存
   */
  _stopAutoSave(taskId) {
    const timer = this.autoSaveTimers.get(taskId);
    if (timer) {
      clearInterval(timer);
      this.autoSaveTimers.delete(taskId);
    }
  }
  
  /**
   * 删除检查点
   */

  // 标记任务完成
  complete(taskId) {    return this.updateState(taskId, "completed");
  }

  recover(taskId) {
    return this.resume(taskId);
  }

  delete(taskId) {
    this._stopAutoSave(taskId);
    this.activeCheckpoints.delete(taskId);
    
    const filePath = path.join(
      this.options.checkpointDir,
      `${taskId}.checkpoint.json`
    );
    
    try {
      if (existsSync(filePath)) {
        unlinkSync(filePath);
        this.logger.info(`[CheckpointManager] 删除检查点: ${taskId}`);
      }
    } catch (e) {
      this.logger.error(`[CheckpointManager] 删除失败: ${e.message}`);
    }
  }
  
  /**
   * 清理过期检查点
   */
  cleanup(maxAge = 7 * 24 * 60 * 60 * 1000) { // 默认 7 天
    const now = Date.now();
    let cleaned = 0;
    
    for (const [id, checkpoint] of this.activeCheckpoints) {
      const age = now - new Date(checkpoint.updatedAt).getTime();
      
      if (age > maxAge && checkpoint.state === CheckpointState.COMPLETED) {
        this.delete(id);
        cleaned++;
      }
    }
    
    // 限制检查点总数
    const allCheckpoints = [...this.activeCheckpoints.entries()]
      .sort((a, b) => new Date(b[1].updatedAt) - new Date(a[1].updatedAt));
    
    while (allCheckpoints.length > this.options.maxCheckpoints) {
      const [oldestId] = allCheckpoints.pop();
      this.delete(oldestId);
      cleaned++;
    }
    
    this.logger.info(`[CheckpointManager] 清理了 ${cleaned} 个检查点`);
    return cleaned;
  }
  
  /**
   * 生成恢复报告
   */
  generateReport(taskId) {
    const checkpoint = this.activeCheckpoints.get(taskId);
    if (!checkpoint) return null;
    
    const total = checkpoint.task.totalSteps;
    const completed = checkpoint.progress.completedSteps.length;
    const failed = checkpoint.progress.failedSteps.length;
    const skipped = checkpoint.progress.skippedSteps.length;
    const pending = total - completed - skipped;
    
    let report = `\n📊 任务检查点报告: ${taskId}\n`;
    report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    report += `状态: ${checkpoint.state}\n`;
    report += `描述: ${checkpoint.task.description || '无'}\n`;
    report += `创建: ${checkpoint.createdAt}\n`;
    report += `更新: ${checkpoint.updatedAt}\n\n`;
    
    report += `📈 进度: ${completed}/${total} (${Math.round(completed/total*100)}%)\n`;
    report += `  ✅ 完成: ${completed}\n`;
    report += `  ❌ 失败: ${failed}\n`;
    report += `  ⏭️  跳过: ${skipped}\n`;
    report += `  ⏳ 待执行: ${pending}\n\n`;
    
    if (checkpoint.errors.length > 0) {
      report += `⚠️ 最近错误:\n`;
      checkpoint.errors.slice(-3).forEach(err => {
        report += `  - Step ${err.stepIndex}: ${err.error}\n`;
      });
      report += `\n`;
    }
    
    if (checkpoint.resumeHistory.length > 0) {
      report += `🔄 恢复历史: ${checkpoint.resumeHistory.length} 次\n`;
    }
    
    report += `\n💡 可用命令:\n`;
    report += `  恢复执行: ΩRESUME{"taskId":"${taskId}"}\n`;
    report += `  删除检查点: ΩCHECKPOINT{"action":"delete","taskId":"${taskId}"}\n`;
    
    return report;
  }
}

export default CheckpointManager;
export { CheckpointState };
