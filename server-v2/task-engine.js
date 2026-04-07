// Task Engine v3 - 增强版执行引擎
// v2: if/else/elseIf 分支, forEach/while 循环, compute 变量运算, sub-batch 子任务
// v3: 步骤级 retry + onError + fallback, 引擎层自动错误恢复

import StateManager, { TaskState } from './state-manager.js';
import { sshFix } from './core/pipeline.js';

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
  static CONTROL_TYPES = ['if', 'forEach', 'while', 'compute', 'log', 'checkpoint', 'setVar', 'switch', 'delay', 'timeout'];

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
        // 并行执行 (v3: 支持 maxConcurrency)
        const maxC = group[0].maxConcurrency || options.maxConcurrency || 0;
        let groupResults;
        if (maxC > 0 && group.length > maxC) {
          groupResults = await this._runWithConcurrency(group, maxC, (step, idx) =>
            this._dispatchStep(batchId, step, results.length + idx, options, onStepComplete, depth)
          );
        } else {
          groupResults = await Promise.all(
            group.map((step, idx) => this._dispatchStep(batchId, step, results.length + idx, options, onStepComplete, depth))
          );
        }
        results.push(...groupResults);
        if (groupResults.some(r => !r.skipped && !r.success)) {
          success = false;
        }
      } else {
        // 顺序执行 (v3: 支持 pipe)
        let prevResult = null;
        for (const step of group) {
          if (!success && options.stopOnError !== false) break;

          // v3: pipe - 前步 result 注入当前步 params
          if (step.pipe && prevResult && step.params) {
            step.params._prevResult = prevResult;
          }

          const result = await this._dispatchStep(batchId, step, results.length, options, onStepComplete, depth);
          results.push(result);
          prevResult = result.result;

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
    if (step.type === 'switch') return this._executeSwitch(batchId, step, stepIndex, options, onStepComplete, depth);
    if (step.type === 'delay') return this._executeDelay(batchId, step, stepIndex, onStepComplete);
    if (step.type === 'timeout') return this._executeTimeout(batchId, step, stepIndex, options, onStepComplete, depth);

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
    
    // 解析模板变量
    this.logger.info(`[TaskEngine] forEach raw collection: type=${typeof collection}, val=${JSON.stringify(collection).substring(0,300)}`);
    if (typeof collection === 'string') {
      // 先尝试直接取变量
      let resolved = this.stateManager.getVariable(batchId, collection);
      // 如果没取到且包含模板语法，解析模板
      if (resolved === undefined && collection.includes('{{')) {
        resolved = this.stateManager.resolveTemplate(batchId, collection);
      }
      if (resolved !== undefined) collection = resolved;
      // 如果是 JSON 字符串，解析
      if (typeof collection === 'string') {
        try { collection = JSON.parse(collection); } catch (e) {}
      }
    }
    this.logger.info(`[TaskEngine] forEach after resolve: type=${typeof collection}, isArray=${Array.isArray(collection)}, val=${JSON.stringify(collection).substring(0,300)}`);
    // 如果是对象（tool result wrapper），递归提取内部 result 直到找到数组或字符串
    let unwrapAttempts = 0;
    while (collection && typeof collection === 'object' && !Array.isArray(collection) && unwrapAttempts < 5) {
      if (collection.result !== undefined) {
        this.logger.info(`[TaskEngine] forEach unwrap level ${unwrapAttempts}: type=${typeof collection.result}`);
        collection = collection.result;
        unwrapAttempts++;
      } else break;
    }
    // JSON 字符串 → 数组
    if (typeof collection === 'string') {
      try { const parsed = JSON.parse(collection); if (Array.isArray(parsed)) collection = parsed; } catch(e) {
        this.logger.error(`[TaskEngine] forEach JSON.parse failed: ${e.message}, str=${collection.substring(0,200)}`);
      }
    }

    if (!Array.isArray(collection)) {
      this.logger.error(`[TaskEngine] forEach: collection 不是数组, type=${typeof collection}, val=${JSON.stringify(collection).substring(0,200)}`);
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
      this.logger.info(`[TaskEngine] ⚠️ while 循环达到最大迭代数 ${maxLoop}`);
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
      const opsArray = step.operations || step.ops;
      if (opsArray && Array.isArray(opsArray)) {
        for (const op of opsArray) {
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
   * v3: switch/case 多路分发
   * 格式: { type:"switch", value:"{{s1.errorType}}", cases:{"TIMEOUT":[steps], "NOT_FOUND":[steps]}, default:[steps] }
   */
  async _executeSwitch(batchId, step, stepIndex, options, onStepComplete, depth) {
    this.logger.info(`[TaskEngine] SWITCH @ step ${stepIndex}`);
    const results = [];

    // 解析 value（支持模板变量）
    let value = step.value;
    if (typeof value === 'string') {
      value = this.stateManager.resolveTemplate(batchId, value);
    }
    // 如果 value 是对象，尝试转成字符串
    if (value && typeof value === 'object') {
      value = JSON.stringify(value);
    }
    const strValue = String(value);

    // 匹配 cases
    const cases = step.cases || {};
    let matched = false;
    for (const [key, branchSteps] of Object.entries(cases)) {
      if (strValue === key || strValue.includes(key)) {
        this.logger.info(`[TaskEngine] SWITCH 命中 case: ${key}`);
        matched = true;
        const ok = await this._executeSteps(batchId, branchSteps || [], results, options, onStepComplete, depth + 1);
        return { stepIndex, type: 'switch', branch: key, success: ok, results, tool: 'switch' };
      }
    }

    // default 分支
    if (!matched && step.default && Array.isArray(step.default)) {
      this.logger.info('[TaskEngine] SWITCH 走 default 分支');
      const ok = await this._executeSteps(batchId, step.default, results, options, onStepComplete, depth + 1);
      return { stepIndex, type: 'switch', branch: 'default', success: ok, results, tool: 'switch' };
    }

    // 无匹配
    return { stepIndex, type: 'switch', branch: 'none', skipped: true, success: true, tool: 'switch' };
  }

  /**
   * v3: delay 延迟等待
   * 格式: { type:"delay", ms:2000 }
   * 或随机: { type:"delay", min:1000, max:3000 }
   */
  async _executeDelay(batchId, step, stepIndex, onStepComplete) {
    let ms = step.ms || 0;
    if (step.min !== undefined && step.max !== undefined) {
      ms = step.min + Math.floor(Math.random() * (step.max - step.min));
    }
    this.logger.info(`[TaskEngine] DELAY ${ms}ms @ step ${stepIndex}`);
    await new Promise(r => setTimeout(r, ms));
    const r = { stepIndex, type: 'delay', success: true, result: `waited ${ms}ms`, tool: 'delay' };
    if (onStepComplete) onStepComplete(r);
    return r;
  }

  /**
   * v3: timeout 包装器 - 给一组子步骤设置总超时
   * 格式: { type:"timeout", ms:10000, steps:[steps], onTimeout:[fallbackSteps] }
   */
  async _executeTimeout(batchId, step, stepIndex, options, onStepComplete, depth) {
    const ms = step.ms || 30000;
    this.logger.info(`[TaskEngine] TIMEOUT wrapper ${ms}ms @ step ${stepIndex}, ${(step.steps || []).length} 子步骤`);
    const results = [];

    try {
      const execPromise = this._executeSteps(batchId, step.steps || [], results, options, onStepComplete, depth + 1);
      const ok = await Promise.race([
        execPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout wrapper: ${ms}ms exceeded`)), ms))
      ]);
      return { stepIndex, type: 'timeout', success: ok, results, tool: 'timeout' };
    } catch (e) {
      this.logger.info(`[TaskEngine] TIMEOUT wrapper 超时: ${e.message}`);
      // 执行 onTimeout fallback
      if (step.onTimeout && Array.isArray(step.onTimeout)) {
        const fbResults = [];
        const fbOk = await this._executeSteps(batchId, step.onTimeout, fbResults, options, onStepComplete, depth + 1);
        return { stepIndex, type: 'timeout', success: fbOk, timedOut: true, results: fbResults, tool: 'timeout' };
      }
      return { stepIndex, type: 'timeout', success: false, timedOut: true, error: e.message, results, tool: 'timeout' };
    }
  }

  /**
   * v3: 工具调用步骤（带重试+onError编排）
   * 新增步骤属性:
   *   retry: {max:3, delay:2000, backoff:'exponential|linear|fixed'}
   *   onError: {match:{'TIMEOUT':'retry','NOT_FOUND':'skip'}, default:'abort', fallback:[steps]}
   *   timeout: 30000  // 步骤级超时(ms)
   */
  async _executeToolStep(batchId, step, stepIndex, options, onStepComplete) {
    const retryConfig = step.retry || {};
    const maxRetries = retryConfig.max || 0;
    const baseDelay = retryConfig.delay || 1000;
    const backoff = retryConfig.backoff || 'fixed';
    const onErrorConfig = step.onError || {};
    const stepTimeout = step.timeout || null;

    let lastResult = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = this._calcDelay(baseDelay, attempt, backoff);
        this.logger.info(`[TaskEngine] 步骤 ${stepIndex} 重试 ${attempt}/${maxRetries}, 等待 ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
      }

      lastResult = await this._callToolOnce(batchId, step, stepIndex, options, stepTimeout);

      // 成功 → 直接返回
      if (lastResult.success) {
        this._finalizeStep(batchId, step, stepIndex, lastResult, onStepComplete);
        return lastResult;
      }

      // 失败 → 分类错误并决定策略
      const errorType = lastResult.errorType || this.errorClassifier.classify(lastResult.error || '').type || 'UNKNOWN';
      lastResult.errorType = errorType;
      const action = (onErrorConfig.match && onErrorConfig.match[errorType]) || onErrorConfig.default || (attempt < maxRetries ? 'retry' : 'abort');

      this.logger.info(`[TaskEngine] 步骤 ${stepIndex} 失败: ${errorType}, 策略: ${action}, attempt: ${attempt}/${maxRetries}`);

      if (action === 'skip') {
        lastResult.skipped = true;
        lastResult.success = true;
        this._finalizeStep(batchId, step, stepIndex, lastResult, onStepComplete);
        return lastResult;
      }

      if (action === 'abort') {
        break;
      }

      if (action === 'retry') {
        continue;
      }

      if (action === 'fallback' && onErrorConfig.fallback && Array.isArray(onErrorConfig.fallback)) {
        this.logger.info(`[TaskEngine] 步骤 ${stepIndex} 执行 fallback (${onErrorConfig.fallback.length} 步)`);
        const fallbackResults = [];
        const fbOk = await this._executeSteps(batchId, onErrorConfig.fallback, fallbackResults, options, onStepComplete, 0);
        const fbResult = {
          stepIndex, tool: step.tool, success: fbOk,
          result: fallbackResults, fallback: true, originalError: lastResult.error
        };
        this._finalizeStep(batchId, step, stepIndex, fbResult, onStepComplete);
        return fbResult;
      }

      // 未知action → abort
      break;
    }

    // 所有重试耗尽
    this._finalizeStep(batchId, step, stepIndex, lastResult, onStepComplete);
    return lastResult;
  }

  /**
   * v3: 计算重试延迟
   */
  _calcDelay(base, attempt, backoff) {
    switch (backoff) {
      case 'exponential': return base * Math.pow(2, attempt - 1);
      case 'linear': return base * attempt;
      default: return base;
    }
  }

  /**
   * v3: 步骤结果收尾 (saveAs + record + callback)
   */
  _finalizeStep(batchId, step, stepIndex, stepResult, onStepComplete) {
    this.stateManager.recordStepResult(batchId, stepIndex, stepResult);

    if (step.saveAs) {
      const binding = this._buildSavedBinding(stepResult);
      this.stateManager.setVariable(batchId, step.saveAs, binding);
    }

    if (onStepComplete) onStepComplete(stepResult);
  }

  /**
   * v4: saveAs 标准化 — 统一为 { meta, output, raw } 三层结构
   * meta: 状态元信息 (success, handled, skipped, error 等)
   * output: 解析后的可用值 (JSON parsed if possible)
   * raw: 原始 stepResult
   * 向后兼容: success/result/error 仍可直接访问
   */
  _buildSavedBinding(stepResult) {
    const parsed = this._parseMaybeJson(stepResult?.result);
    return {
      // 向后兼容的顶层字段
      success: stepResult?.success === true,
      result: parsed,
      error: stepResult?.error,
      errorType: stepResult?.errorType,
      // v4 标准化字段
      meta: {
        success: stepResult?.success === true,
        handled: stepResult?.handled === true,
        skipped: stepResult?.skipped === true,
        continued: stepResult?.continued === true,
        fallback: stepResult?.fallback === true,
        error: stepResult?.error,
        errorType: stepResult?.errorType,
        originalError: stepResult?.originalError,
        attempt: stepResult?.attempt,
        tool: stepResult?.tool
      },
      output: parsed,
      raw: stepResult
    };
  }

  _parseMaybeJson(val) {
    if (val === undefined || val === null) return val;
    if (typeof val !== 'string') return val;
    const trimmed = val.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try { return JSON.parse(trimmed); } catch (e) { /* not json */ }
    }
    return trimmed;
  }

  /**
   * v3: 单次工具调用（纯执行，无重试逻辑）
   */
  async _callToolOnce(batchId, step, stepIndex, options, stepTimeout) {
    let resolvedParams = this.stateManager.resolveTemplate(batchId, step.params);
    if (step.tool === "run_process" || step.tool === "run_command") { resolvedParams = sshFix(step.tool, resolvedParams, this.logger); }

    const safetyCheck = await this.safety.checkOperation(step.tool, resolvedParams);
    if (!safetyCheck.allowed) {
      return { stepIndex, tool: step.tool, success: false, error: safetyCheck.reason, errorType: 'SAFETY_BLOCKED' };
    }

    try {
      this.logger.info(`[TaskEngine] 执行步骤 ${stepIndex}: ${step.tool}`);

      const isBrowserTool = TaskEngine.BROWSER_TOOLS.includes(step.tool);
      const resolved = this.resolveAlias(step.tool, resolvedParams);

      let toolPromise;
      if (isBrowserTool && this.browserCallHandler) {
        toolPromise = this.browserCallHandler(step.tool, resolvedParams);
      } else {
        const { isSysTool, getSysHandler } = await import('./sys-tools.js');
        if (isSysTool(resolved.tool)) {
          const handler = getSysHandler(resolved.tool);
          const evalInBrowser = this.browserCallHandler ? (code, timeout) => this.browserCallHandler('eval_js', { code }, timeout) : null;
          toolPromise = handler(resolved.params, { evalInBrowser });
        } else if (this.router && this.router.handlers && this.router.handlers.has(resolved.tool)) {
          const driver = this.router.handlers.get(resolved.tool);
          toolPromise = driver.handle(resolved.tool, resolved.params, { trace: { span(){}, error(){}, flush(){}, duration: 0 } });
        } else {
          toolPromise = this.hub.callTool(resolved.tool, resolved.params);
        }
      }

      // v3: 步骤级超时
      let result;
      if (stepTimeout) {
        result = await Promise.race([
          toolPromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error(`Step timeout after ${stepTimeout}ms`)), stepTimeout))
        ]);
      } else {
        result = await toolPromise;
      }

      // 提取结果文本
      let resultStr = result;
      if (result && result.content) {
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

      // 从工具返回值中检测真实的 success 状态
      let toolSuccess = true;
      if (result && typeof result === 'object') {
        if ('success' in result && result.success === false) toolSuccess = false;
        if ('exitCode' in result && result.exitCode !== 0) toolSuccess = false;
      }
      const stepError = toolSuccess ? undefined : (result?.error || result?.stderr || (typeof resultStr === 'string' && resultStr.length > 0 ? resultStr.slice(0, 500) : '执行失败(无详情)'));

      return {
        stepIndex, tool: step.tool, success: toolSuccess,
        result: typeof resultStr === 'string' ? resultStr : JSON.stringify(resultStr),
        ...(stepError ? { error: stepError } : {})
      };

    } catch (e) {
      const classified = this.errorClassifier.wrapError(e, step.tool);
      return {
        stepIndex, tool: step.tool, success: false,
        error: e.message, errorType: classified.errorType,
        recoverable: classified.recoverable, suggestion: classified.suggestion
      };
    }
  }

  /**
   * v3: 并发限制执行器
   */
  async _runWithConcurrency(items, maxC, fn) {
    const results = new Array(items.length);
    let nextIdx = 0;

    async function worker() {
      while (nextIdx < items.length) {
        const idx = nextIdx++;
        results[idx] = await fn(items[idx], idx);
      }
    }

    const workers = Array.from({ length: Math.min(maxC, items.length) }, () => worker());
    await Promise.all(workers);
    return results;
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
