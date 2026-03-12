// Task Engine v2 - 增强版执行引擎
// 新增: if/else/elseIf 分支, forEach/while 循环, compute 变量运算, sub-batch 子任务

import StateManager, { TaskState } from './state-manager.js';

class TaskEngine {
  constructor(logger, hub, safety, errorClassifier, router) {
    this.logger = logger;
    this.hub = hub;
    this.safety = safety;
    this.errorClassifier = errorClassifier;
    this.router = router;
    this.stateManager = new StateManager(logger);
    this.browserCallHandler = null;
  }

  static BROWSER_TOOLS = ['list_tabs', 'eval_js', 'js_flow'];

  static TOOL_ALIASES = {
    'run_command': { target: 'run_process', transform: (p) => ({ command_line: p.command, mode: 'shell', ...(p.stdin && { stdin: p.stdin }), ...(p.timeout && { timeout_ms: p.timeout * 1000 }), ...(p.cwd && { cwd: p.cwd }) }) }
  };

  // 控制流步骤类型（不是工具调用）
  static CONTROL_TYPES = ['if', 'forEach', 'while', 'compute', 'log', 'checkpoint', 'setVar'];

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
   * v2: 展开步骤 - 将 if/forEach/while 等控制流展开为可执行序列
   * 返回展开后的步骤列表（运行时动态展开，非预处理）
   */
  async executeBatch(batchId, steps, options = {}, onStepComplete = null) {
    const task = this.stateManager.createTask(batchId, steps, options);
    this.stateManager.updateState(batchId, TaskState.RUNNING);

    const results = [];
    let success = true;

    try {
      success = await this._executeSteps(batchId, steps, results, options, onStepComplete);
    } catch (e) {
      this.logger.error(`[TaskEngine] 批量执行异常: ${e.message}`);
      success = false;
    }

    this.stateManager.completeTask(batchId, success);

    return {
      batchId,
      success,
      stepsCompleted: results.filter(r => r.success).length,
      stepsFailed: results.filter(r => !r.skipped && !r.success).length,
      stepsSkipped: results.filter(r => r.skipped).length,
      totalSteps: results.length,
      results
    };
  }

  /**
   * 核心: 递归执行步骤列表
   */
  async _executeSteps(batchId, steps, results, options, onStepComplete, depth = 0) {
    if (depth > 10) {
      this.logger.error('[TaskEngine] 递归深度超限!');
      return false;
    }

    const maxLoop = options.maxLoopIterations || this.stateManager.getTask(batchId)?.options?.maxLoopIterations || 50;
    let success = true;

    // 分组: 连续 parallel 步骤合并
    const groups = this._groupSteps(steps);

    for (const group of groups) {
      if (!success && options.stopOnError !== false) break;

      if (group.length > 1 && group[0].parallel) {
        // 并行执行
        const groupResults = await Promise.all(
          group.map((step, idx) => this._dispatchStep(batchId, step, results.length + idx, options, onStepComplete, depth))
        );
        results.push(...groupResults);
        if (groupResults.some(r => !r.skipped && !r.success)) {
          success = false;
        }
      } else {
        // 顺序执行
        for (const step of group) {
          if (!success && options.stopOnError !== false) break;

          const result = await this._dispatchStep(batchId, step, results.length, options, onStepComplete, depth);
          results.push(result);

          if (!result.skipped && !result.success && options.stopOnError !== false) {
            success = false;
          }
        }
      }
    }

    return success;
  }

  /**
   * 分发步骤: 工具调用 or 控制流
   */
  async _dispatchStep(batchId, step, stepIndex, options, onStepComplete, depth) {
    // when 条件检查
    if (step.when && !this.stateManager.evaluateCondition(batchId, step.when)) {
      const result = { stepIndex, skipped: true, reason: 'condition_not_met', tool: step.tool || step.type };
      if (onStepComplete) onStepComplete(result);
      return result;
    }

    const type = step.type || step.tool;

    // 控制流步骤
    if (step.type === 'if') return this._executeIf(batchId, step, stepIndex, options, onStepComplete, depth);
    if (step.type === 'forEach') return this._executeForEach(batchId, step, stepIndex, options, onStepComplete, depth);
    if (step.type === 'while') return this._executeWhile(batchId, step, stepIndex, options, onStepComplete, depth);
    if (step.type === 'compute') return this._executeCompute(batchId, step, stepIndex, onStepComplete);
    if (step.type === 'setVar') return this._executeSetVar(batchId, step, stepIndex, onStepComplete);
    if (step.type === 'log') return this._executeLog(batchId, step, stepIndex, onStepComplete);
    if (step.type === 'checkpoint') return this._executeCheckpoint(batchId, step, stepIndex, onStepComplete);

    // 工具调用步骤
    return this._executeToolStep(batchId, step, stepIndex, options, onStepComplete);
  }

  /**
   * if/elseIf/else 分支逻辑
   * 格式: { type:"if", condition:"expr", then:[steps], elseIf:[{condition,then}], else:[steps] }
   */
  async _executeIf(batchId, step, stepIndex, options, onStepComplete, depth) {
    this.logger.info(`[TaskEngine] IF 分支 @ step ${stepIndex}`);
    const results = [];

    // 主条件
    if (this.stateManager.evaluateCondition(batchId, step.condition)) {
      this.logger.info('[TaskEngine] IF 条件命中 → 执行 then');
      const ok = await this._executeSteps(batchId, step.then || [], results, options, onStepComplete, depth + 1);
      return { stepIndex, type: 'if', branch: 'then', success: ok, results, tool: 'if' };
    }

    // elseIf 链
    if (step.elseIf && Array.isArray(step.elseIf)) {
      for (let i = 0; i < step.elseIf.length; i++) {
        const branch = step.elseIf[i];
        if (this.stateManager.evaluateCondition(batchId, branch.condition)) {
          this.logger.info(`[TaskEngine] ELSE-IF #${i} 条件命中`);
          const ok = await this._executeSteps(batchId, branch.then || [], results, options, onStepComplete, depth + 1);
          return { stepIndex, type: 'if', branch: `elseIf_${i}`, success: ok, results, tool: 'if' };
        }
      }
    }

    // else
    if (step.else && Array.isArray(step.else)) {
      this.logger.info('[TaskEngine] 走 ELSE 分支');
      const ok = await this._executeSteps(batchId, step.else, results, options, onStepComplete, depth + 1);
      return { stepIndex, type: 'if', branch: 'else', success: ok, results, tool: 'if' };
    }

    // 无分支命中
    return { stepIndex, type: 'if', branch: 'none', skipped: true, success: true, tool: 'if' };
  }

  /**
   * forEach 循环
   * 格式: { type:"forEach", collection:"varName", item:"itemVar", index:"idxVar", steps:[steps] }
   * 或: { type:"forEach", collection:["a","b","c"], item:"itemVar", steps:[steps] }
   */
  async _executeForEach(batchId, step, stepIndex, options, onStepComplete, depth) {
    const maxLoop = options.maxLoopIterations || 50;
    let collection = step.collection;
    
    // 如果 collection 是字符串，从变量取值
    if (typeof collection === 'string') {
      collection = this.stateManager.getVariable(batchId, collection);
    }
    
    // 解析模板
    if (typeof collection === 'string') {
      collection = this.stateManager.resolveTemplate(batchId, collection);
      try { collection = JSON.parse(collection); } catch (e) {}
    }

    if (!Array.isArray(collection)) {
      this.logger.error(`[TaskEngine] forEach: collection 不是数组`);
      return { stepIndex, type: 'forEach', success: false, error: 'collection is not an array', tool: 'forEach' };
    }

    if (collection.length > maxLoop) {
      this.logger.error(`[TaskEngine] forEach: 集合长度 ${collection.length} 超过最大循环数 ${maxLoop}`);
      return { stepIndex, type: 'forEach', success: false, error: `collection size ${collection.length} exceeds max ${maxLoop}`, tool: 'forEach' };
    }

    this.logger.info(`[TaskEngine] forEach: 遍历 ${collection.length} 个元素`);
    const allResults = [];
    let success = true;
    const itemVar = step.item || '_item';
    const indexVar = step.index || '_index';

    for (let i = 0; i < collection.length; i++) {
      this.stateManager.setVariable(batchId, itemVar, collection[i]);
      this.stateManager.setVariable(batchId, indexVar, i);
      this.stateManager.setVariable(batchId, '_total', collection.length);

      const iterResults = [];
      const ok = await this._executeSteps(batchId, step.steps || [], iterResults, options, onStepComplete, depth + 1);
      allResults.push({ iteration: i, item: collection[i], results: iterResults, success: ok });

      if (!ok && options.stopOnError !== false) {
        success = false;
        break;
      }
    }

    // saveAs 支持
    if (step.saveAs) {
      this.stateManager.setVariable(batchId, step.saveAs, allResults);
    }

    return { stepIndex, type: 'forEach', iterations: allResults.length, total: collection.length, success, results: allResults, tool: 'forEach' };
  }

  /**
   * while 循环
   * 格式: { type:"while", condition:"expr", steps:[steps], maxIterations:20 }
   */
  async _executeWhile(batchId, step, stepIndex, options, onStepComplete, depth) {
    const maxLoop = step.maxIterations || options.maxLoopIterations || 50;
    let iteration = 0;
    const allResults = [];
    let success = true;

    this.logger.info(`[TaskEngine] while 循环开始, 最大迭代: ${maxLoop}`);

    while (iteration < maxLoop) {
      if (!this.stateManager.evaluateCondition(batchId, step.condition)) {
        this.logger.info(`[TaskEngine] while 条件不满足, 退出循环 @ iteration ${iteration}`);
        break;
      }

      this.stateManager.setVariable(batchId, '_iteration', iteration);

      const iterResults = [];
      const ok = await this._executeSteps(batchId, step.steps || [], iterResults, options, onStepComplete, depth + 1);
      allResults.push({ iteration, results: iterResults, success: ok });

      if (!ok && options.stopOnError !== false) {
        success = false;
        break;
      }

      iteration++;
    }

    if (iteration >= maxLoop) {
      this.logger.warn(`[TaskEngine] while 循环达到最大迭代数 ${maxLoop}`);
    }

    if (step.saveAs) {
      this.stateManager.setVariable(batchId, step.saveAs, allResults);
    }

    return { stepIndex, type: 'while', iterations: iteration, maxLoop, success, results: allResults, tool: 'while' };
  }

  /**
   * compute: 变量运算
   * 格式: { type:"compute", expr:"files.length", saveAs:"count" }
   * 或: { type:"compute", operations:[{set:"x",value:"{{a}}+{{b}}"}, {set:"y",expr:"x > 10"}] }
   */
  async _executeCompute(batchId, step, stepIndex, onStepComplete) {
    try {
      if (step.operations && Array.isArray(step.operations)) {
        for (const op of step.operations) {
          if (op.set && op.value !== undefined) {
            let value = this.stateManager.resolveTemplate(batchId, String(op.value));
            // 尝试数学运算
            if (/^[\d\s\+\-\*\/\.\(\)]+$/.test(value)) {
              try { value = Function('"use strict"; return (' + value + ')')(); } catch (e) {}
            }
            this.stateManager.setVariable(batchId, op.set, value);
          }
          if (op.set && op.expr !== undefined) {
            const vars = this.stateManager.getAllVariables(batchId);
            const result = this.stateManager.resolver.evaluateExpression(op.expr, vars);
            this.stateManager.setVariable(batchId, op.set, result);
          }
        }
      } else if (step.expr) {
        const vars = this.stateManager.getAllVariables(batchId);
        const result = this.stateManager.resolver.evaluateExpression(step.expr, vars);
        if (step.saveAs) {
          this.stateManager.setVariable(batchId, step.saveAs, result);
        }
      }

      const r = { stepIndex, type: 'compute', success: true, tool: 'compute' };
      if (onStepComplete) onStepComplete(r);
      return r;
    } catch (e) {
      const r = { stepIndex, type: 'compute', success: false, error: e.message, tool: 'compute' };
      if (onStepComplete) onStepComplete(r);
      return r;
    }
  }

  /**
   * setVar: 直接设置变量
   * 格式: { type:"setVar", name:"myVar", value:"hello" }
   * 或模板: { type:"setVar", name:"url", value:"https://api.com/{{id}}" }
   */
  async _executeSetVar(batchId, step, stepIndex, onStepComplete) {
    let value = step.value;
    if (typeof value === 'string') {
      value = this.stateManager.resolveTemplate(batchId, value);
    } else {
      value = this.stateManager.resolveTemplate(batchId, value);
    }
    this.stateManager.setVariable(batchId, step.name, value);
    const r = { stepIndex, type: 'setVar', success: true, tool: 'setVar' };
    if (onStepComplete) onStepComplete(r);
    return r;
  }

  /**
   * log: 打印调试信息
   */
  async _executeLog(batchId, step, stepIndex, onStepComplete) {
    const msg = this.stateManager.resolveTemplate(batchId, step.message || '');
    this.logger.info(`[TaskEngine] LOG: ${msg}`);
    const r = { stepIndex, type: 'log', success: true, message: msg, tool: 'log' };
    if (onStepComplete) onStepComplete(r);
    return r;
  }

  /**
   * checkpoint: 创建检查点
   */
  async _executeCheckpoint(batchId, step, stepIndex, onStepComplete) {
    this.stateManager.createCheckpoint(batchId);
    const r = { stepIndex, type: 'checkpoint', success: true, tool: 'checkpoint' };
    if (onStepComplete) onStepComplete(r);
    return r;
  }

  /**
   * 工具调用步骤（原始逻辑）
   */
  async _executeToolStep(batchId, step, stepIndex, options, onStepComplete) {
    // 解析模板
    const resolvedParams = this.stateManager.resolveTemplate(batchId, step.params);

    // 安全检查
    const safetyCheck = await this.safety.checkOperation(step.tool, resolvedParams);
    if (!safetyCheck.allowed) {
      const r = { stepIndex, tool: step.tool, success: false, error: safetyCheck.reason };
      this.stateManager.recordStepResult(batchId, stepIndex, r);
      if (onStepComplete) onStepComplete(r);
      return r;
    }

    try {
      this.logger.info(`[TaskEngine] 执行步骤 ${stepIndex}: ${step.tool}`);

      const isBrowserTool = TaskEngine.BROWSER_TOOLS.includes(step.tool);
      const resolved = this.resolveAlias(step.tool, resolvedParams);
      let result;
      // NOTE: BATCH 中 eval_js 走 browserCallHandler（60s 超时），不受 content.js 10s 限制
      if (isBrowserTool && this.browserCallHandler) {
        result = await this.browserCallHandler(step.tool, resolvedParams);
      } else {
        // 优先走 Router（内部 driver），fallback 到 hub（MCP）
        if (this.router && this.router.handlers && this.router.handlers.has(resolved.tool)) {
          const driver = this.router.handlers.get(resolved.tool);
          result = await driver.handle(resolved.tool, resolved.params, { trace: { span(){}, error(){}, flush(){}, duration: 0 } });
        } else {
          result = await this.hub.call(resolved.tool, resolved.params);
        }
      }
      // hub.call 返回 browserEval 时，转发给浏览器执行
      if (result && result.browserEval && this.browserCallHandler) {
        result = await this.browserCallHandler('eval_js', { code: result.browserEval });
      }

      let resultStr = result;
      if (result && result.content && Array.isArray(result.content)) {
        resultStr = result.content.map(c => c.text || c).join('\n');
      }

      // run_command/run_process: 分离退出码和实际输出
      if ((step.tool === 'run_command' || resolved.tool === 'run_process') && typeof resultStr === 'string') {
        const firstNL = resultStr.indexOf('\n');
        if (firstNL !== -1) {
          const firstLine = resultStr.substring(0, firstNL).trim();
          if (/^\d+$/.test(firstLine)) {
            resultStr = resultStr.substring(firstNL + 1).trim();
            this.logger.info(`[TaskEngine] run_command exit=${firstLine}, output=${resultStr.length}chars`);
          }
        }
      }

      const stepResult = {
        stepIndex,
        tool: step.tool,
        success: true,
        result: typeof resultStr === 'string' ? resultStr : JSON.stringify(resultStr)
      };

      this.stateManager.recordStepResult(batchId, stepIndex, stepResult);

      // 直接处理 saveAs（不依赖 recordStepResult 从 task.steps 取）
      if (step.saveAs && stepResult.success) {
        let value = stepResult.result;
        if (typeof value === 'string') {
          value = value.trim();
          try { value = JSON.parse(value); } catch (e) {}
        }
        this.stateManager.setVariable(batchId, step.saveAs, value);
        this.logger.info(`[TaskEngine] 工具步骤 saveAs: ${step.saveAs} = ${typeof value === 'object' ? JSON.stringify(value).substring(0,100) : String(value).substring(0,100)}`);
      }

      if (onStepComplete) onStepComplete(stepResult);
      return stepResult;

    } catch (e) {
      const classified = this.errorClassifier.wrapError(e, step.tool);
      const stepResult = {
        stepIndex,
        tool: step.tool,
        success: false,
        error: e.message,
        errorType: classified.errorType,
        recoverable: classified.recoverable,
        suggestion: classified.suggestion
      };

      this.stateManager.recordStepResult(batchId, stepIndex, stepResult);
      if (onStepComplete) onStepComplete(stepResult);
      return stepResult;
    }
  }

  /**
   * 步骤分组: 连续 parallel 合并
   */
  _groupSteps(steps) {
    const groups = [];
    let currentGroup = [];

    for (const step of steps) {
      if (step.parallel && currentGroup.length > 0 && currentGroup[0].parallel) {
        currentGroup.push(step);
      } else {
        if (currentGroup.length > 0) groups.push(currentGroup);
        currentGroup = [step];
      }
    }
    if (currentGroup.length > 0) groups.push(currentGroup);
    return groups;
  }

  // === 保留原有 API ===

  async resumeTask(taskId, onStepComplete = null) {
    const task = this.stateManager.getTask(taskId);
    if (!task) return { success: false, error: '任务不存在' };
    if (task.state === TaskState.SUCCESS) return { success: true, message: '任务已完成' };

    const remainingSteps = task.steps.slice(task.currentStep);
    if (remainingSteps.length === 0) return { success: true, message: '没有剩余步骤' };

    this.logger.info(`[TaskEngine] 继续任务 ${taskId}: 从步骤 ${task.currentStep} 开始`);
    this.stateManager.updateState(taskId, TaskState.RUNNING);

    const results = [...task.results];
    const ok = await this._executeSteps(taskId, remainingSteps, results, task.options, onStepComplete);
    this.stateManager.completeTask(taskId, ok);

    return {
      taskId,
      success: ok,
      stepsCompleted: results.filter(r => r?.success).length,
      totalSteps: task.steps.length,
      results
    };
  }

  getTaskStatus(taskId) {
    return this.stateManager.getTaskSummary(taskId);
  }

  createCheckpoint(taskId) {
    return this.stateManager.createCheckpoint(taskId);
  }

  restoreCheckpoint(taskId, checkpointIndex = -1) {
    return this.stateManager.restoreFromCheckpoint(taskId, checkpointIndex);
  }
}

export default TaskEngine;
