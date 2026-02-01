// 目标管理器 - 目标驱动的闭环执行
// 目标设定 → 计划生成 → 执行 → 验证 → 差距分析 → 调整

import { writeFileSync, readFileSync, existsSync } from 'fs';
import path from 'path';

class GoalManager {
  constructor(logger, validator, stateManager) {
    this.logger = logger;
    this.validator = validator;
    this.stateManager = stateManager;
    this.activeGoals = new Map();
    this.goalHistory = [];
    this.storagePath = path.join(process.cwd(), 'goals');
  }
  
  /**
   * 创建目标
   */
  createGoal(goalId, definition) {
    const goal = {
      id: goalId,
      description: definition.description,
      status: 'pending',
      createdAt: new Date().toISOString(),
      
      // 成功标准
      successCriteria: definition.successCriteria || [],
      
      // 执行计划
      plan: definition.plan || [],
      currentStep: 0,
      
      // 执行历史
      history: [],
      
      // 差距分析
      gaps: [],
      
      // 配置
      maxAttempts: definition.maxAttempts || 3,
      autoAdjust: definition.autoAdjust !== false
    };
    
    this.activeGoals.set(goalId, goal);
    this.logger.info(`[GoalManager] 创建目标: ${goalId} - ${definition.description}`);
    
    return goal;
  }
  
  /**
   * 执行目标
   */
  async executeGoal(goalId, onProgress = null) {
    const goal = this.activeGoals.get(goalId);
    if (!goal) {
      return { success: false, error: '目标不存在' };
    }
    
    goal.status = 'running';
    goal.startedAt = new Date().toISOString();
    
    let attempt = 0;
    
    while (attempt < goal.maxAttempts) {
      attempt++;
      this.logger.info(`[GoalManager] 执行目标 ${goalId} (尝试 ${attempt}/${goal.maxAttempts})`);
      
      // 执行计划中的每一步
      const executionResult = await this._executePlan(goal, onProgress);
      
      // 验证成功标准
      const validationResult = await this._validateCriteria(goal);
      
      goal.history.push({
        attempt,
        timestamp: new Date().toISOString(),
        executionResult,
        validationResult
      });
      
      if (validationResult.allMet) {
        goal.status = 'completed';
        goal.completedAt = new Date().toISOString();
        this.logger.success(`[GoalManager] 目标达成: ${goalId}`);
        
        this._archiveGoal(goal);
        return {
          success: true,
          goal,
          attempts: attempt,
          message: '目标已达成'
        };
      }
      
      // 差距分析
      goal.gaps = this._analyzeGaps(validationResult);
      this.logger.warning(`[GoalManager] 目标未达成，发现 ${goal.gaps.length} 个差距`);
      
      // 自动调整计划
      if (goal.autoAdjust && attempt < goal.maxAttempts) {
        const adjusted = await this._adjustPlan(goal);
        if (adjusted) {
          this.logger.info(`[GoalManager] 计划已调整，重新执行`);
          goal.currentStep = 0;
          continue;
        }
      }
      
      // 无法调整或达到最大尝试次数
      break;
    }
    
    goal.status = 'failed';
    goal.failedAt = new Date().toISOString();
    this._archiveGoal(goal);
    
    return {
      success: false,
      goal,
      attempts: attempt,
      gaps: goal.gaps,
      message: '目标未能达成'
    };
  }
  
  async _executePlan(goal, onProgress) {
    const results = [];
    
    for (let i = goal.currentStep; i < goal.plan.length; i++) {
      const step = goal.plan[i];
      goal.currentStep = i;
      
      this.logger.info(`[GoalManager] 执行步骤 ${i + 1}/${goal.plan.length}: ${step.tool}`);
      
      const result = await this.validator.executeWithValidation(
        step.tool,
        step.params,
        { maxRetries: step.maxRetries || 1 }
      );
      
      results.push({
        step: i,
        tool: step.tool,
        result
      });
      
      if (onProgress) {
        onProgress({
          type: 'step_complete',
          goalId: goal.id,
          step: i,
          total: goal.plan.length,
          result
        });
      }
      
      if (!result.success && step.required !== false) {
        this.logger.error(`[GoalManager] 必要步骤失败: ${step.tool}`);
        break;
      }
    }
    
    return {
      stepsCompleted: results.filter(r => r.result.success).length,
      totalSteps: goal.plan.length,
      results
    };
  }
  
  async _validateCriteria(goal) {
    const results = [];
    let allMet = true;
    
    for (const criteria of goal.successCriteria) {
      const check = await this.validator._checkCriteria(criteria);
      results.push(check);
      if (!check.met) {
        allMet = false;
      }
    }
    
    return { allMet, results };
  }
  
  _analyzeGaps(validationResult) {
    const gaps = [];
    
    for (const result of validationResult.results) {
      if (!result.met) {
        gaps.push({
          criteria: result.criteria,
          reason: result.message,
          suggestedAction: this._suggestAction(result.criteria)
        });
      }
    }
    
    return gaps;
  }
  
  _suggestAction(criteria) {
    switch (criteria.type) {
      case 'file_exists':
        return { tool: 'write_file', params: { path: criteria.path, content: '' } };
      case 'file_contains':
        return { tool: 'edit_file', description: `添加内容: ${criteria.text}` };
      case 'command_succeeds':
        return { tool: 'run_command', params: { command: criteria.command } };
      default:
        return null;
    }
  }
  
  async _adjustPlan(goal) {
    // 根据差距调整计划
    let adjusted = false;
    
    for (const gap of goal.gaps) {
      if (gap.suggestedAction) {
        // 添加修复步骤到计划
        goal.plan.push({
          tool: gap.suggestedAction.tool,
          params: gap.suggestedAction.params,
          description: `自动修复: ${gap.reason}`,
          autoAdded: true
        });
        adjusted = true;
      }
    }
    
    return adjusted;
  }
  
  _archiveGoal(goal) {
    this.goalHistory.push(goal);
    this.activeGoals.delete(goal.id);
    
    // 保存到文件
    try {
      const archivePath = path.join(this.storagePath, `${goal.id}.json`);
      writeFileSync(archivePath, JSON.stringify(goal, null, 2));
    } catch (e) {
      this.logger.warning(`[GoalManager] 无法保存目标存档: ${e.message}`);
    }
  }
  
  /**
   * 获取目标状态
   */
  getGoalStatus(goalId) {
    const goal = this.activeGoals.get(goalId);
    if (!goal) {
      return { exists: false };
    }
    
    return {
      exists: true,
      id: goal.id,
      status: goal.status,
      description: goal.description,
      progress: `${goal.currentStep}/${goal.plan.length}`,
      gaps: goal.gaps
    };
  }
  
  /**
   * 列出所有目标
   */
  listGoals() {
    return {
      active: Array.from(this.activeGoals.values()).map(g => ({
        id: g.id,
        description: g.description,
        status: g.status,
        progress: `${g.currentStep}/${g.plan.length}`
      })),
      completed: this.goalHistory.filter(g => g.status === 'completed').length,
      failed: this.goalHistory.filter(g => g.status === 'failed').length
    };
  }
}

export default GoalManager;
