// Workflow Template Engine - 工作流模板引擎
// 支持 YAML/JSON 模板、变量插值、条件分支、循环

import { writeFileSync, readFileSync, existsSync, readdirSync } from 'fs';
import path from 'path';

/**
 * 内置工作流模板库
 */
const BuiltinTemplates = {
  // 项目部署模板
  'deploy-nodejs': {
    name: '部署 Node.js 项目',
    description: '拉取代码、安装依赖、构建、重启服务',
    variables: {
      projectPath: { type: 'string', required: true, description: '项目路径' },
      branch: { type: 'string', default: 'main', description: 'Git 分支' },
      pm2Name: { type: 'string', default: 'app', description: 'PM2 进程名' }
    },
    steps: [
      { id: 'pull', tool: 'run_command', params: { command: 'cd {{projectPath}} && git fetch && git checkout {{branch}} && git pull' } },
      { id: 'install', tool: 'run_command', params: { command: 'cd {{projectPath}} && npm install' }, dependsOn: ['pull'] },
      { id: 'build', tool: 'run_command', params: { command: 'cd {{projectPath}} && npm run build' }, dependsOn: ['install'], condition: '{{hasBuildScript}}' },
      { id: 'restart', tool: 'run_command', params: { command: 'pm2 restart {{pm2Name}}' }, dependsOn: ['install'] }
    ]
  },
  
  // 数据库备份模板
  'backup-mysql': {
    name: 'MySQL 数据库备份',
    description: '导出数据库、压缩、上传到云存储',
    variables: {
      database: { type: 'string', required: true },
      host: { type: 'string', default: 'localhost' },
      user: { type: 'string', default: 'root' },
      backupDir: { type: 'string', default: '/tmp/backups' },
      uploadTo: { type: 'string', description: '云存储路径 (可选)' }
    },
    steps: [
      { id: 'mkdir', tool: 'run_command', params: { command: 'mkdir -p {{backupDir}}' } },
      { id: 'dump', tool: 'run_command', params: { command: 'mysqldump -h {{host}} -u {{user}} {{database}} > {{backupDir}}/{{database}}_$(date +%Y%m%d_%H%M%S).sql' }, dependsOn: ['mkdir'], saveAs: 'dumpFile' },
      { id: 'compress', tool: 'run_command', params: { command: 'gzip {{backupDir}}/{{database}}_*.sql' }, dependsOn: ['dump'] },
      { id: 'upload', tool: 'run_command', params: { command: 'mega-put {{backupDir}}/*.gz {{uploadTo}}' }, dependsOn: ['compress'], condition: '{{uploadTo}}' }
    ]
  },
  
  // 批量文件处理模板
  'batch-process': {
    name: '批量文件处理',
    description: '对多个文件执行相同操作',
    variables: {
      files: { type: 'array', required: true, description: '文件列表' },
      operation: { type: 'string', default: 'read_file', description: '操作类型' }
    },
    steps: [
      { id: 'process', tool: '{{operation}}', foreach: '{{files}}', itemVar: 'file', params: { path: '{{file}}' }, parallel: true }
    ]
  },
  
  // 健康检查模板
  'health-check': {
    name: '服务健康检查',
    description: '检查多个服务的运行状态',
    variables: {
      services: { type: 'array', default: ['nginx', 'mysql', 'redis'], description: '服务列表' }
    },
    steps: [
      { id: 'check', tool: 'run_command', foreach: '{{services}}', itemVar: 'svc', params: { command: 'systemctl is-active {{svc}} || echo "{{svc}} is down"' }, parallel: true }
    ]
  },
  
  // 日志分析模板
  'log-analysis': {
    name: '日志分析',
    description: '收集、过滤、统计日志',
    variables: {
      logPath: { type: 'string', required: true },
      pattern: { type: 'string', default: 'ERROR' },
      lines: { type: 'number', default: 100 }
    },
    steps: [
      { id: 'tail', tool: 'run_command', params: { command: 'tail -n {{lines}} {{logPath}}' }, saveAs: 'rawLogs' },
      { id: 'filter', tool: 'run_command', params: { command: 'echo "$rawLogs" | grep -i "{{pattern}}" || true' }, dependsOn: ['tail'], saveAs: 'filtered' },
      { id: 'count', tool: 'run_command', params: { command: 'echo "$rawLogs" | grep -ci "{{pattern}}" || echo 0' }, dependsOn: ['tail'], saveAs: 'errorCount' }
    ]
  },
  
  // Git 操作模板
  'git-release': {
    name: 'Git 发布流程',
    description: '创建 tag、生成 changelog、推送',
    variables: {
      version: { type: 'string', required: true },
      projectPath: { type: 'string', default: '.' }
    },
    steps: [
      { id: 'changelog', tool: 'run_command', params: { command: 'cd {{projectPath}} && git log --oneline $(git describe --tags --abbrev=0 2>/dev/null || echo HEAD~10)..HEAD' }, saveAs: 'changes' },
      { id: 'tag', tool: 'run_command', params: { command: 'cd {{projectPath}} && git tag -a v{{version}} -m "Release v{{version}}"' }, dependsOn: ['changelog'] },
      { id: 'push', tool: 'run_command', params: { command: 'cd {{projectPath}} && git push origin v{{version}}' }, dependsOn: ['tag'] }
    ]
  }
};

/**
 * 工作流模板引擎
 */
class WorkflowTemplate {
  constructor(logger, taskPlanner) {
    this.logger = logger;
    this.taskPlanner = taskPlanner;
    this.templates = { ...BuiltinTemplates };
    this.templateDir = path.join(process.cwd(), 'workflows');
    this._loadCustomTemplates();
  }
  
  /**
   * 加载自定义模板
   */
  _loadCustomTemplates() {
    try {
      if (!existsSync(this.templateDir)) return;
      
      const files = readdirSync(this.templateDir).filter(f => 
        f.endsWith('.json') || f.endsWith('.yaml') || f.endsWith('.yml')
      );
      
      for (const file of files) {
        try {
          const content = readFileSync(path.join(this.templateDir, file), 'utf-8');
          const template = JSON.parse(content); // TODO: 添加 YAML 支持
          const name = file.replace(/\.(json|ya?ml)$/, '');
          this.templates[name] = template;
          this.logger.info(`[WorkflowTemplate] 加载模板: ${name}`);
        } catch (e) {
          this.logger.warn(`[WorkflowTemplate] 加载模板失败: ${file}`, e.message);
        }
      }
    } catch (e) {
      // 目录不存在，忽略
    }
  }
  
  /**
   * 列出所有可用模板
   */
  listTemplates() {
    return Object.entries(this.templates).map(([id, tpl]) => ({
      id,
      name: tpl.name,
      description: tpl.description,
      variables: Object.keys(tpl.variables || {})
    }));
  }
  
  /**
   * 获取模板详情
   */
  getTemplate(templateId) {
    return this.templates[templateId] || null;
  }
  
  /**
   * 注册新模板
   */
  registerTemplate(templateId, template) {
    this.templates[templateId] = template;
    this.logger.info(`[WorkflowTemplate] 注册模板: ${templateId}`);
    return true;
  }
  
  /**
   * 保存模板到文件
   */
  saveTemplate(templateId, template) {
    if (!existsSync(this.templateDir)) {
      require('fs').mkdirSync(this.templateDir, { recursive: true });
    }
    
    const filePath = path.join(this.templateDir, `${templateId}.json`);
    writeFileSync(filePath, JSON.stringify(template, null, 2));
    this.templates[templateId] = template;
    this.logger.info(`[WorkflowTemplate] 保存模板: ${filePath}`);
    return filePath;
  }
  
  /**
   * 实例化模板 - 用变量填充模板生成可执行计划
   */
  instantiate(templateId, variables = {}) {
    const template = this.templates[templateId];
    if (!template) {
      return { success: false, error: `模板不存在: ${templateId}` };
    }
    
    // 1. 验证必填变量
    const validation = this._validateVariables(template, variables);
    if (!validation.valid) {
      return { success: false, error: validation.error, missing: validation.missing };
    }
    
    // 2. 合并默认值
    const resolvedVars = this._resolveVariables(template, variables);
    
    // 3. 展开步骤 (处理 foreach)
    const expandedSteps = this._expandSteps(template.steps, resolvedVars);
    
    // 4. 插值替换
    const interpolatedSteps = expandedSteps.map(step => 
      this._interpolate(step, resolvedVars)
    );
    
    // 5. 过滤条件不满足的步骤
    const filteredSteps = interpolatedSteps.filter(step => {
      if (step._condition !== undefined) {
        return this._evaluateCondition(step._condition, resolvedVars);
      }
      return true;
    });
    
    // 6. 清理临时字段
    const cleanSteps = filteredSteps.map(({ _condition, ...step }) => step);
    
    // 7. 使用 TaskPlanner 优化
    const plan = this.taskPlanner.analyze(cleanSteps, { template: templateId, variables: resolvedVars });
    
    const workflowId = `wf_${templateId}_${Date.now()}`; return { workflowId,
      success: true,
      templateId,
      templateName: template.name,
      variables: resolvedVars,
      steps: cleanSteps,
      plan
    };
  }
  
  /**
   * 验证变量
   */
  _validateVariables(template, variables) {
    const missing = [];
    const varDefs = template.variables || {};
    
    for (const [name, def] of Object.entries(varDefs)) {
      if (def.required && variables[name] === undefined) {
        missing.push(name);
      }
    }
    
    if (missing.length > 0) {
      const workflowId = `wf_${templateId}_${Date.now()}`; return { workflowId,
        valid: false,
        error: `缺少必填变量: ${missing.join(', ')}`,
        missing
      };
    }
    
    return { valid: true };
  }
  
  /**
   * 解析变量 (合并默认值)
   */
  _resolveVariables(template, variables) {
    const resolved = {};
    const varDefs = template.variables || {};
    
    for (const [name, def] of Object.entries(varDefs)) {
      resolved[name] = variables[name] !== undefined ? variables[name] : def.default;
    }
    
    // 添加用户提供的额外变量
    for (const [name, value] of Object.entries(variables)) {
      if (resolved[name] === undefined) {
        resolved[name] = value;
      }
    }
    
    return resolved;
  }
  
  /**
   * 展开 foreach 步骤
   */
  _expandSteps(steps, variables) {
    const expanded = [];
    
    for (const step of steps) {
      if (step.foreach) {
        // 解析 foreach 数组
        const arrayRef = step.foreach.replace(/\{\{|\}\}/g, '');
        const array = variables[arrayRef] || [];
        const itemVar = step.itemVar || 'item';
        const indexVar = step.indexVar || 'index';
        
        array.forEach((item, index) => {
          const expandedStep = JSON.parse(JSON.stringify(step));
          delete expandedStep.foreach;
          delete expandedStep.itemVar;
          delete expandedStep.indexVar;
          
          // 在 params 中替换 item 变量
          expandedStep.id = `${step.id}_${index}`;
          expandedStep._loopVars = { [itemVar]: item, [indexVar]: index };
          expanded.push(expandedStep);
        });
      } else {
        expanded.push({ ...step });
      }
    }
    
    return expanded;
  }
  
  /**
   * 变量插值
   */
  _interpolate(obj, variables) {
    if (typeof obj === 'string') {
      return obj.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
        if (variables[varName] !== undefined) {
          return variables[varName];
        }
        return match; // 保留未知变量
      });
    }
    
    if (Array.isArray(obj)) {
      return obj.map(item => this._interpolate(item, variables));
    }
    
    if (typeof obj === 'object' && obj !== null) {
      const result = {};
      
      // 合并循环变量
      const mergedVars = obj._loopVars ? { ...variables, ...obj._loopVars } : variables;
      
      for (const [key, value] of Object.entries(obj)) {
        if (key === '_loopVars') continue;
        if (key === 'condition') {
          result._condition = this._interpolate(value, mergedVars);
        } else {
          result[key] = this._interpolate(value, mergedVars);
        }
      }
      return result;
    }
    
    return obj;
  }
  
  /**
   * 评估条件表达式
   */
  _evaluateCondition(condition, variables) {
    if (!condition) return true;
    
    // 简单的真值检查
    const value = variables[condition] || condition;
    
    // 空字符串、null、undefined、false、0 都视为 false
    if (!value || value === 'false' || value === '0' || value === 'null' || value === 'undefined') {
      return false;
    }
    
    // 检查是否仍有未替换的变量
    if (typeof value === 'string' && value.includes('{{')) {
      return false;
    }
    
    return true;
  }
  
  /**
   * 生成模板文档
   */
  generateDocs(templateId) {
    const template = this.templates[templateId];
    if (!template) return null;
    
    let doc = `# ${template.name}\n\n`;
    doc += `${template.description}\n\n`;
    doc += `## 变量\n\n`;
    doc += `| 名称 | 类型 | 必填 | 默认值 | 说明 |\n`;
    doc += `|------|------|------|--------|------|\n`;
    
    for (const [name, def] of Object.entries(template.variables || {})) {
      doc += `| ${name} | ${def.type || 'string'} | ${def.required ? '是' : '否'} | ${def.default || '-'} | ${def.description || '-'} |\n`;
    }
    
    doc += `\n## 步骤\n\n`;
    template.steps.forEach((step, i) => {
      doc += `${i + 1}. **${step.id || 'step' + i}**: \`${step.tool}\`\n`;
      if (step.dependsOn) doc += `   - 依赖: ${step.dependsOn.join(', ')}\n`;
      if (step.condition) doc += `   - 条件: ${step.condition}\n`;
      if (step.foreach) doc += `   - 循环: ${step.foreach}\n`;
    });
    
    return doc;
  }
}

export default WorkflowTemplate;
export { BuiltinTemplates };
