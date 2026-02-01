// Task Planner - 智能任务规划器
// 任务分解 → 依赖分析 → 并行优化 → 调度执行

import { writeFileSync, readFileSync, existsSync } from 'fs';
import path from 'path';

/**
 * 任务节点类型
 */
const NodeType = {
  ATOMIC: 'atomic',      // 原子操作
  COMPOSITE: 'composite', // 复合任务
  CONDITION: 'condition', // 条件分支
  PARALLEL: 'parallel',   // 并行组
  SEQUENCE: 'sequence'    // 顺序组
};

/**
 * 任务模式库 - 常见任务的分解模式
 */
const TaskPatterns = {
  // 文件操作模式
  'file:copy': {
    pattern: /复制.*文件|copy.*file/i,
    decompose: (params) => [
      { tool: 'read_file', params: { path: params.source } },
      { tool: 'write_file', params: { path: params.target, content: '${step0.result}' } }
    ]
  },
  
  // 部署模式
  'deploy:basic': {
    pattern: /部署|deploy/i,
    decompose: (params) => [
      { tool: 'run_command', params: { command: 'git pull' }, saveAs: 'pull' },
      { tool: 'run_command', params: { command: 'npm install' }, saveAs: 'install', dependsOn: ['pull'] },
      { tool: 'run_command', params: { command: 'npm run build' }, saveAs: 'build', dependsOn: ['install'] },
      { tool: 'run_command', params: { command: 'pm2 restart all' }, dependsOn: ['build'] }
    ]
  },
  
  // 备份模式
  'backup:database': {
    pattern: /备份.*数据库|backup.*db/i,
    decompose: (params) => [
      { tool: 'run_command', params: { command: `mysqldump ${params.database} > backup_$(date +%Y%m%d).sql` } },
      { tool: 'run_command', params: { command: 'gzip backup_*.sql' } }
    ]
  },
  
  // 批量文件处理
  'batch:files': {
    pattern: /批量.*文件|batch.*files/i,
    decompose: (params) => {
      const files = params.files || [];
      return files.map((f, i) => ({
        tool: params.operation || 'read_file',
        params: { path: f },
        saveAs: `file${i}`,
        parallel: true  // 标记可并行
      }));
    }
  }
};

/**
 * 智能任务规划器
 */
class TaskPlanner {
  constructor(logger, stateManager) {
    this.logger = logger;
    this.stateManager = stateManager;
    this.patterns = { ...TaskPatterns };
    this.planCache = new Map();
  }
  
  /**
   * 注册自定义任务模式
   */
  registerPattern(name, pattern) {
    this.patterns[name] = pattern;
    this.logger.info(`[TaskPlanner] 注册模式: ${name}`);
  }
  
  /**
   * 分析任务并生成执行计划
   * @param {string} taskDescription - 任务描述或结构化任务
   * @param {object} context - 上下文信息
   * @returns {object} 执行计划
   */
  analyze(taskDescription, context = {}) {
    this.logger.info(`[TaskPlanner] 分析任务: ${typeof taskDescription === 'string' ? taskDescription : JSON.stringify(taskDescription)}`);
    
    // 如果已经是结构化的步骤数组，直接优化
    if (Array.isArray(taskDescription)) {
      return this._optimizePlan(taskDescription, context);
    }
    
    // 如果是对象格式的任务定义
    if (typeof taskDescription === 'object' && taskDescription.steps) {
      return this._optimizePlan(taskDescription.steps, context);
    }
    
    // 文本描述 - 尝试匹配模式
    if (typeof taskDescription === 'string') {
      const matched = this._matchPattern(taskDescription);
      if (matched) {
        const steps = matched.decompose(context);
        return this._optimizePlan(steps, context);
      }
      
      // 无法识别的描述
      return {
        success: false,
        error: '无法识别的任务描述，请提供结构化的步骤或使用已知模式',
        suggestions: Object.keys(this.patterns)
      };
    }
    
    return { success: false, error: '无效的任务格式' };
  }
  
  /**
   * 匹配任务模式
   */
  _matchPattern(description) {
    for (const [name, pattern] of Object.entries(this.patterns)) {
      if (pattern.pattern && pattern.pattern.test(description)) {
        this.logger.info(`[TaskPlanner] 匹配模式: ${name}`);
        return pattern;
      }
    }
    return null;
  }
  
  /**
   * 优化执行计划
   * - 构建依赖图
   * - 识别并行机会
   * - 生成最优执行顺序
   */
  _optimizePlan(steps, context) {
    // 1. 构建依赖图
    const graph = this._buildDependencyGraph(steps);
    
    // 2. 拓扑排序
    const sorted = this._topologicalSort(graph);
    if (!sorted.success) {
      return sorted; // 返回循环依赖错误
    }
    
    // 3. 计算并行层级
    const levels = this._computeParallelLevels(steps, graph);
    
    // 4. 生成优化后的计划
    const plan = {
      success: true,
      id: `plan_${Date.now()}`,
      originalSteps: steps.length,
      optimizedLevels: levels.length,
      parallelizable: levels.some(l => l.length > 1),
      levels: levels,
      executionOrder: sorted.order,
      graph: graph,
      estimatedTime: this._estimateTime(levels),
      metadata: {
        createdAt: new Date().toISOString(),
        context
      }
    };
    
    this.planCache.set(plan.id, plan);
    this.logger.info(`[TaskPlanner] 生成计划: ${plan.id}, ${levels.length} 层, 可并行: ${plan.parallelizable}`);
    
    return plan;
  }
  
  /**
   * 构建依赖图
   */
  _buildDependencyGraph(steps) {
    const graph = {
      nodes: [],
      edges: [],
      adjacency: {},
      inDegree: {}
    };
    
    // 建立 saveAs -> nodeId 的映射
    const saveAsMap = {};
    steps.forEach((step, index) => {
      const nodeId = step.id || `step${index}`;
      if (step.saveAs) {
        saveAsMap[step.saveAs] = nodeId;
      }
    });
    
    // 创建节点
    steps.forEach((step, index) => {
      const nodeId = step.id || `step${index}`;
      graph.nodes.push({
        id: nodeId,
        index,
        step,
        parallel: step.parallel || false
      });
      graph.adjacency[nodeId] = [];
      graph.inDegree[nodeId] = 0;
    });
    
    // 创建边 (依赖关系)
    steps.forEach((step, index) => {
      const nodeId = step.id || `step${index}`;
      const deps = step.dependsOn || [];
      
      deps.forEach(depId => {
        // 支持: 数字索引、stepN 格式、saveAs 名称
        let resolvedDep = depId;
        if (typeof depId === 'number') {
          resolvedDep = `step${depId}`;
        } else if (saveAsMap[depId]) {
          // 通过 saveAs 名称解析
          resolvedDep = saveAsMap[depId];
        }
        
        if (graph.adjacency[resolvedDep]) {
          graph.edges.push({ from: resolvedDep, to: nodeId });
          graph.adjacency[resolvedDep].push(nodeId);
          graph.inDegree[nodeId]++;
        }
      });
      
      // 如果没有显式依赖且不是并行任务，默认依赖前一个
      if (deps.length === 0 && !step.parallel && index > 0) {
        const prevId = steps[index - 1].id || `step${index - 1}`;
        // 只有当前一个也不是并行任务时才添加默认依赖
        if (!steps[index - 1].parallel) {
          graph.edges.push({ from: prevId, to: nodeId, implicit: true });
          graph.adjacency[prevId].push(nodeId);
          graph.inDegree[nodeId]++;
        }
      }
    });
    
    return graph;
  }
  
  /**
   * 拓扑排序 (Kahn 算法)
   */
  _topologicalSort(graph) {
    const inDegree = { ...graph.inDegree };
    const queue = [];
    const order = [];
    
    // 找出所有入度为 0 的节点
    for (const nodeId of Object.keys(inDegree)) {
      if (inDegree[nodeId] === 0) {
        queue.push(nodeId);
      }
    }
    
    while (queue.length > 0) {
      const current = queue.shift();
      order.push(current);
      
      for (const neighbor of graph.adjacency[current]) {
        inDegree[neighbor]--;
        if (inDegree[neighbor] === 0) {
          queue.push(neighbor);
        }
      }
    }
    
    // 检查是否有循环依赖
    if (order.length !== graph.nodes.length) {
      return {
        success: false,
        error: '检测到循环依赖',
        processedNodes: order,
        remainingNodes: graph.nodes.filter(n => !order.includes(n.id)).map(n => n.id)
      };
    }
    
    return { success: true, order };
  }
  
  /**
   * 计算并行层级
   * 同一层级的任务可以并行执行
   */
  _computeParallelLevels(steps, graph) {
    const levels = [];
    const nodeLevel = {};
    const inDegree = { ...graph.inDegree };
    const processed = new Set();
    
    while (processed.size < graph.nodes.length) {
      const currentLevel = [];
      
      // 找出当前可执行的节点 (入度为 0)
      for (const node of graph.nodes) {
        if (!processed.has(node.id) && inDegree[node.id] === 0) {
          currentLevel.push(node);
          nodeLevel[node.id] = levels.length;
        }
      }
      
      if (currentLevel.length === 0) break; // 防止无限循环
      
      // 标记已处理并更新入度
      for (const node of currentLevel) {
        processed.add(node.id);
        for (const neighbor of graph.adjacency[node.id]) {
          inDegree[neighbor]--;
        }
      }
      
      levels.push(currentLevel.map(n => ({
        id: n.id,
        index: n.index,
        tool: n.step.tool,
        params: n.step.params,
        saveAs: n.step.saveAs
      })));
    }
    
    return levels;
  }
  
  /**
   * 估算执行时间
   */
  _estimateTime(levels) {
    const toolTimes = {
      'run_command': 5000,
      'read_file': 500,
      'write_file': 500,
      'browser_navigate': 3000,
      'browser_click': 1000,
      'default': 2000
    };
    
    let total = 0;
    for (const level of levels) {
      // 并行层级取最长时间
      const maxTime = Math.max(...level.map(step => 
        toolTimes[step.tool] || toolTimes.default
      ));
      total += maxTime;
    }
    
    return total;
  }
  
  /**
   * 获取缓存的计划
   */
  getPlan(planId) {
    return this.planCache.get(planId);
  }
  
  /**
   * 生成计划的可视化描述
   */
  visualize(plan) {
    if (!plan.success) {
      return `❌ 计划生成失败: ${plan.error}`;
    }
    
    let output = `📋 执行计划 ${plan.id}\n`;
    output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    output += `原始步骤: ${plan.originalSteps} | 优化层级: ${plan.optimizedLevels} | 可并行: ${plan.parallelizable ? '是' : '否'}\n`;
    output += `预估时间: ${(plan.estimatedTime / 1000).toFixed(1)}s\n\n`;
    
    plan.levels.forEach((level, i) => {
      const parallel = level.length > 1 ? ' ⚡并行' : '';
      output += `【层级 ${i + 1}】${parallel}\n`;
      level.forEach(step => {
        output += `  └─ ${step.tool}${step.saveAs ? ` → $${step.saveAs}` : ''}\n`;
      });
    });
    
    return output;
  }
}

export default TaskPlanner;
export { NodeType, TaskPatterns };
