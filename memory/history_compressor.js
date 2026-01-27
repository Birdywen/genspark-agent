#!/usr/bin/env node
/**
 * History Compressor v2 - 智能历史压缩器
 * 
 * 核心理念：提取"做了什么"而不是"执行了什么命令"
 */

const fs = require('fs');
const path = require('path');

// ===== 配置 =====
const CONFIG = {
  noisePatterns: [
    /^echo\s+['"]?(test|hello|ok|done)/i,
    /^sleep\s/,
    /^pwd$/,
    /^which\s/,
    /^cat.*\.log.*\|\s*head/,
    /^ls\s+-la?\s*$/,
  ],
};

// ===== 工具函数 =====

function loadHistory(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error('文件不存在:', filePath);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function isNoise(cmd) {
  const command = cmd.params?.command || '';
  for (const pattern of CONFIG.noisePatterns) {
    if (pattern.test(command)) return true;
  }
  return false;
}

// ===== 智能分类 =====

function classifyCommand(cmd) {
  const command = cmd.params?.command || '';
  const tool = cmd.tool;
  const filePath = cmd.params?.path || '';
  const preview = cmd.resultPreview || '';
  
  // Git 操作
  if (/git\s+commit/.test(command)) {
    const msg = command.match(/-m\s+['"]([^'"]+)['"]/);
    return { category: 'git', action: 'commit', detail: msg ? msg[1] : '' };
  }
  if (/git\s+push/.test(command)) return { category: 'git', action: 'push', detail: '' };
  if (/git\s+clone\s+(\S+)/.test(command)) {
    const repo = command.match(/clone\s+(\S+)/);
    return { category: 'git', action: 'clone', detail: repo ? repo[1].split('/').pop() : '' };
  }
  if (/git\s+add/.test(command)) return { category: 'git', action: 'add', detail: '' };
  
  // SSH 远程操作
  if (/ssh.*@([\d\.]+)/.test(command) || /\|\s*ssh/.test(command)) {
    const host = command.match(/@([\d\.]+)/);
    // 分析远程做了什么
    if (/node.*index\.js/.test(command) || /nohup/.test(command)) {
      return { category: 'deploy', action: 'start_server', detail: host ? host[1] : '' };
    }
    if (/pkill|kill/.test(command)) {
      return { category: 'deploy', action: 'stop_server', detail: host ? host[1] : '' };
    }
    if (/git\s+clone/.test(command)) {
      return { category: 'deploy', action: 'clone_repo', detail: host ? host[1] : '' };
    }
    if (/npm\s+install/.test(command)) {
      return { category: 'deploy', action: 'install_deps', detail: host ? host[1] : '' };
    }
    if (/apt-get|apt\s+install/.test(command)) {
      return { category: 'deploy', action: 'install_package', detail: host ? host[1] : '' };
    }
    if (/cat.*config/.test(command) || /EOF/.test(command)) {
      return { category: 'deploy', action: 'configure', detail: host ? host[1] : '' };
    }
    if (/iptables/.test(command)) {
      return { category: 'deploy', action: 'firewall', detail: host ? host[1] : '' };
    }
    return { category: 'ssh', action: 'remote_cmd', detail: host ? host[1] : '' };
  }
  
  // 文件操作
  if (tool === 'write_file') {
    return { category: 'file', action: 'create', detail: path.basename(filePath) };
  }
  if (tool === 'edit_file') {
    return { category: 'file', action: 'edit', detail: path.basename(filePath) };
  }
  if (tool === 'read_file') {
    // 读取配置或重要文件
    if (/config|session|TODO|LESSON/.test(filePath)) {
      return { category: 'context', action: 'read', detail: path.basename(filePath) };
    }
    return { category: 'file', action: 'read', detail: path.basename(filePath) };
  }
  
  // NPM 操作
  if (/npm\s+install/.test(command)) return { category: 'npm', action: 'install', detail: '' };
  if (/npm\s+run/.test(command)) return { category: 'npm', action: 'run', detail: '' };
  
  // 进程管理
  if (/nohup.*node/.test(command)) return { category: 'service', action: 'start', detail: '' };
  if (/pkill|kill/.test(command)) return { category: 'service', action: 'stop', detail: '' };
  if (/ps\s+aux/.test(command)) return { category: 'service', action: 'check', detail: '' };
  
  // Memory Manager 操作
  if (/memory_manager.*switch/.test(command)) {
    const proj = command.match(/switch\s+(\S+)/);
    return { category: 'memory', action: 'switch_project', detail: proj ? proj[1] : '' };
  }
  if (/memory_manager.*milestone/.test(command)) {
    return { category: 'memory', action: 'add_milestone', detail: '' };
  }
  if (/memory_manager.*task/.test(command)) {
    return { category: 'memory', action: 'set_task', detail: '' };
  }
  if (/memory_manager/.test(command)) {
    return { category: 'memory', action: 'manage', detail: '' };
  }
  
  // WebSocket 测试
  if (/new.*WebSocket|ws:\/\//.test(command)) {
    return { category: 'test', action: 'websocket', detail: '' };
  }
  
  // curl 请求
  if (/curl/.test(command)) {
    return { category: 'test', action: 'http', detail: '' };
  }
  
  // 查看文件内容
  if (/^(cat|head|tail|grep|sed)\s/.test(command)) {
    return { category: 'inspect', action: 'view', detail: '' };
  }
  
  return { category: 'other', action: 'command', detail: '' };
}

// ===== 聚合操作 =====

function aggregateOperations(history) {
  const validCmds = history.filter(cmd => !isNoise(cmd) && cmd.success !== false);
  
  // 按类别聚合
  const byCategory = {};
  const timeline = [];
  let lastCategory = null;
  
  for (const cmd of validCmds) {
    const cls = classifyCommand(cmd);
    const key = `${cls.category}:${cls.action}`;
    
    if (!byCategory[cls.category]) {
      byCategory[cls.category] = { actions: {}, details: new Set() };
    }
    byCategory[cls.category].actions[cls.action] = 
      (byCategory[cls.category].actions[cls.action] || 0) + 1;
    if (cls.detail) {
      byCategory[cls.category].details.add(cls.detail);
    }
    
    // 时间线（合并连续相同类别）
    if (lastCategory !== cls.category) {
      timeline.push({ category: cls.category, actions: [cls.action], details: cls.detail ? [cls.detail] : [] });
      lastCategory = cls.category;
    } else {
      const last = timeline[timeline.length - 1];
      if (!last.actions.includes(cls.action)) last.actions.push(cls.action);
      if (cls.detail && !last.details.includes(cls.detail)) last.details.push(cls.detail);
    }
  }
  
  return { byCategory, timeline };
}

// ===== 生成人类可读摘要 =====

function generateReadableSummary(aggregated) {
  const { byCategory, timeline } = aggregated;
  const lines = [];
  
  // 按类别生成摘要
  const categoryDescriptions = {
    'deploy': (cat) => {
      const actions = Object.keys(cat.actions);
      const hosts = Array.from(cat.details).join(', ');
      const parts = [];
      if (actions.includes('clone_repo')) parts.push('克隆代码');
      if (actions.includes('install_deps')) parts.push('安装依赖');
      if (actions.includes('configure')) parts.push('配置服务');
      if (actions.includes('firewall')) parts.push('开放端口');
      if (actions.includes('start_server')) parts.push('启动服务');
      if (actions.includes('stop_server')) parts.push('停止服务');
      return `部署到 ${hosts}: ${parts.join(' → ')}`;
    },
    'git': (cat) => {
      const actions = Object.keys(cat.actions);
      const commits = Array.from(cat.details).filter(d => d.length > 0);
      if (actions.includes('commit') && actions.includes('push')) {
        return `提交并推送代码` + (commits.length ? `: "${commits[0]}"` : '');
      }
      if (actions.includes('commit')) {
        return `提交代码` + (commits.length ? `: "${commits[0]}"` : '');
      }
      if (actions.includes('clone')) {
        return `克隆仓库: ${Array.from(cat.details).join(', ')}`;
      }
      return `Git 操作: ${actions.join(', ')}`;
    },
    'file': (cat) => {
      const files = Array.from(cat.details);
      const actions = Object.keys(cat.actions);
      if (actions.includes('create')) {
        const created = files.filter(f => f);
        return `创建文件: ${created.join(', ')}`;
      }
      if (actions.includes('edit')) {
        return `编辑文件: ${files.join(', ')}`;
      }
      return `文件操作: ${files.join(', ')}`;
    },
    'memory': (cat) => {
      const actions = Object.keys(cat.actions);
      const projects = Array.from(cat.details).filter(d => d);
      if (actions.includes('switch_project')) {
        return `切换项目: ${projects.join(' → ')}`;
      }
      if (actions.includes('add_milestone')) {
        return `记录里程碑`;
      }
      return `更新项目记忆`;
    },
    'test': (cat) => {
      const actions = Object.keys(cat.actions);
      if (actions.includes('websocket')) return `测试 WebSocket 连接`;
      if (actions.includes('http')) return `测试 HTTP 请求`;
      return `运行测试`;
    },
    'service': (cat) => {
      const actions = Object.keys(cat.actions);
      if (actions.includes('start')) return `启动本地服务`;
      if (actions.includes('stop')) return `停止服务`;
      return `管理服务`;
    },
    'npm': (cat) => `安装 npm 依赖`,
    'ssh': (cat) => `远程服务器操作: ${Array.from(cat.details).join(', ')}`,
    'context': (cat) => `读取上下文: ${Array.from(cat.details).join(', ')}`,
    'inspect': () => null,  // 忽略查看操作
    'other': () => null,    // 忽略其他
  };
  
  for (const [category, cat] of Object.entries(byCategory)) {
    const descFn = categoryDescriptions[category];
    if (descFn) {
      const desc = descFn(cat);
      if (desc) lines.push(`- ${desc}`);
    }
  }
  
  return lines.join('\n');
}

// ===== 生成下次对话的上下文 =====

function generateContext(history) {
  const aggregated = aggregateOperations(history);
  const summary = generateReadableSummary(aggregated);
  
  // 提取关键事实
  const facts = [];
  const { byCategory } = aggregated;
  
  if (byCategory.deploy) {
    const hosts = Array.from(byCategory.deploy.details);
    if (hosts.length) facts.push(`服务器: ${hosts.join(', ')}`);
    if (byCategory.deploy.actions.start_server) facts.push('服务已启动');
  }
  
  if (byCategory.git?.actions.push) {
    facts.push('代码已推送到远程');
  }
  
  if (byCategory.memory) {
    const projects = Array.from(byCategory.memory.details).filter(d => d);
    if (projects.length) facts.push(`活跃项目: ${projects[projects.length - 1]}`);
  }
  
  if (byCategory.file) {
    const files = Array.from(byCategory.file.details).slice(-5);
    if (files.length) facts.push(`修改的文件: ${files.join(', ')}`);
  }
  
  return { summary, facts };
}

// ===== 分析统计 =====

function analyzeHistory(data) {
  const history = data.history || [];
  const stats = {
    total: history.length,
    success: history.filter(c => c.success).length,
    failed: history.filter(c => !c.success).length,
    noise: history.filter(c => isNoise(c)).length,
    byTool: {},
    timeRange: { start: null, end: null },
  };
  
  for (const cmd of history) {
    const tool = cmd.tool || 'unknown';
    stats.byTool[tool] = (stats.byTool[tool] || 0) + 1;
    
    if (cmd.timestamp) {
      if (!stats.timeRange.start || cmd.timestamp < stats.timeRange.start) {
        stats.timeRange.start = cmd.timestamp;
      }
      if (!stats.timeRange.end || cmd.timestamp > stats.timeRange.end) {
        stats.timeRange.end = cmd.timestamp;
      }
    }
  }
  
  return stats;
}

// ===== CLI =====

const [,, cmd, arg1] = process.argv;

switch (cmd) {
  case 'analyze': {
    if (!arg1) { console.log('用法: analyze <history.json>'); break; }
    const data = loadHistory(arg1);
    const stats = analyzeHistory(data);
    console.log('\n📊 历史分析\n');
    console.log(`总命令: ${stats.total} | 成功: ${stats.success} | 失败: ${stats.failed} | 噪音: ${stats.noise}`);
    console.log(`时间: ${stats.timeRange.start?.substring(0,16)} ~ ${stats.timeRange.end?.substring(11,16)}`);
    console.log('\n工具使用:');
    for (const [tool, count] of Object.entries(stats.byTool).sort((a,b) => b[1]-a[1])) {
      console.log(`  ${tool}: ${count}`);
    }
    break;
  }
  
  case 'summary':
  case 'compress': {
    if (!arg1) { console.log('用法: summary <history.json>'); break; }
    const data = loadHistory(arg1);
    const aggregated = aggregateOperations(data.history || []);
    const summary = generateReadableSummary(aggregated);
    console.log('\n📋 操作摘要\n');
    console.log(summary || '(无重要操作)');
    break;
  }
  
  case 'context': {
    if (!arg1) { console.log('用法: context <history.json>'); break; }
    const data = loadHistory(arg1);
    const ctx = generateContext(data.history || []);
    console.log('\n# 上次对话上下文\n');
    console.log('## 完成的工作\n');
    console.log(ctx.summary || '(无记录)');
    if (ctx.facts.length) {
      console.log('\n## 关键信息\n');
      ctx.facts.forEach(f => console.log(`- ${f}`));
    }
    break;
  }
  
  case 'essential': {
    // 生成精华版历史（可保存）
    if (!arg1) { console.log('用法: essential <history.json>'); break; }
    const data = loadHistory(arg1);
    const ctx = generateContext(data.history || []);
    const output = {
      generatedAt: new Date().toISOString(),
      originalCount: (data.history || []).length,
      summary: ctx.summary,
      facts: ctx.facts,
    };
    console.log(JSON.stringify(output, null, 2));
    break;
  }
  
  default:
    console.log(`
History Compressor v2 - 智能历史压缩器

命令:
  analyze <history.json>   分析统计
  summary <history.json>   生成操作摘要
  context <history.json>   生成下次对话上下文
  essential <history.json> 输出精华 JSON

示例:
  node history_compressor.js context command-history.json
`);
}
