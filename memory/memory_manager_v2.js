#!/usr/bin/env node
// Memory Manager v2 - 支持多项目上下文

const fs = require('fs');
const path = require('path');

const MEMORY_DIR = path.dirname(__filename);
const PROJECTS_DIR = path.join(MEMORY_DIR, 'projects');
const ACTIVE_FILE = path.join(MEMORY_DIR, 'active_project.txt');

// 确保目录存在
if (!fs.existsSync(PROJECTS_DIR)) fs.mkdirSync(PROJECTS_DIR, { recursive: true });

// 获取当前活跃项目
function getActiveProject() {
  if (fs.existsSync(ACTIVE_FILE)) {
    return fs.readFileSync(ACTIVE_FILE, 'utf8').trim();
  }
  return null;
}

// 设置活跃项目
function setActiveProject(name) {
  const projectDir = path.join(PROJECTS_DIR, name);
  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true });
  }
  fs.writeFileSync(ACTIVE_FILE, name);
  return name;
}

// 获取项目目录
function getProjectDir(name) {
  const proj = name || getActiveProject();
  if (!proj) return null;
  return path.join(PROJECTS_DIR, proj);
}

// 获取项目的会话文件路径
function getSessionFile(projectName) {
  const dir = getProjectDir(projectName);
  return dir ? path.join(dir, 'session.json') : null;
}

// 加载项目会话
function loadSession(projectName) {
  const file = getSessionFile(projectName);
  if (file && fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  return { task: '', milestones: [], commands: [], lastUpdate: null };
}

// 保存项目会话
function saveSession(projectName, session) {
  const dir = getProjectDir(projectName);
  if (!dir) return;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  session.lastUpdate = new Date().toISOString();
  fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify(session, null, 2));
}

// 记录命令
function recordCommand(projectName, id, tool, params, success, preview) {
  const session = loadSession(projectName);
  const cmd = {
    id,
    time: new Date().toISOString(),
    tool,
    params: summarizeParams(tool, params),
    success,
    preview: (preview || '').substring(0, 100)
  };
  session.commands.push(cmd);
  if (session.commands.length > 50) {
    session.commands = session.commands.slice(-50);
  }
  saveSession(projectName, session);
  return cmd;
}

// 精简参数
function summarizeParams(tool, params) {
  if (typeof params === 'string') {
    try { params = JSON.parse(params); } catch(e) { return params.substring(0, 100); }
  }
  if (tool === 'run_command') return { cmd: (params.command || '').substring(0, 80) };
  if (tool === 'read_file' || tool === 'write_file') return { path: params.path };
  if (tool === 'edit_file') return { path: params.path, edits: params.edits?.length || 0 };
  return params;
}

// 添加里程碑
function addMilestone(projectName, text) {
  const session = loadSession(projectName);
  session.milestones.push({ time: new Date().toISOString(), text });
  saveSession(projectName, session);
}

// 设置任务
function setTask(projectName, task) {
  const session = loadSession(projectName);
  session.task = task;
  saveSession(projectName, session);
}

// 生成摘要
function generateSummary(projectName) {
  const session = loadSession(projectName);
  let md = `# ${projectName} 项目上下文\n\n`;
  if (session.task) md += `## 当前任务\n${session.task}\n\n`;
  if (session.notes) md += `## 备注\n${session.notes}\n\n`;
  if (session.paths) {
    md += `## 关键路径\n`;
    for (const [k, v] of Object.entries(session.paths)) {
      md += `- ${k}: ${v}\n`;
    }
    md += '\n';
  }
  if (session.server) {
    md += `## 服务器信息\n`;
    for (const [k, v] of Object.entries(session.server)) {
      md += `- ${k}: ${v}\n`;
    }
    md += '\n';
  }
  if (session.milestones.length > 0) {
    md += `## 已完成里程碑\n`;
    session.milestones.forEach(m => { md += `- ${m.text}\n`; });
    md += '\n';
  }
  if (session.commands.length > 0) {
    md += `## 最近命令 (最新10条)\n`;
    session.commands.slice(-10).forEach(c => {
      md += `- [#${c.id}] ${c.tool} ${c.success ? '✓' : '✗'}\n`;
    });
  }
  if (session.lastUpdate) {
    md += `\n---\n最后更新: ${session.lastUpdate}\n`;
  }
  
  // 保存摘要文件
  const dir = getProjectDir(projectName);
  if (dir) fs.writeFileSync(path.join(dir, 'summary.md'), md);
  
  return md;
}

// 列出所有项目
function listProjects() {
  if (!fs.existsSync(PROJECTS_DIR)) return [];
  const active = getActiveProject();
  return fs.readdirSync(PROJECTS_DIR)
    .filter(f => fs.statSync(path.join(PROJECTS_DIR, f)).isDirectory())
    .map(name => {
      const session = loadSession(name);
      return {
        name,
        active: name === active,
        task: session.task || '(无任务)',
        milestones: session.milestones.length,
        commands: session.commands.length
      };
    });
}

// 引入历史压缩器（如果存在）
let historyCompressor = null;
const compressorPath = path.join(MEMORY_DIR, 'history_compressor.js');

// 生成完整上下文（项目信息 + 命令历史精华）
function generateDigest(projectName, historyPath) {
  const session = loadSession(projectName);
  let md = `# 🧠 上下文恢复 - ${projectName}\n\n`;
  md += `> 生成时间: ${new Date().toISOString().substring(0, 16)}\n\n`;
  
  // 当前任务
  if (session.task) {
    md += `## 📋 当前任务\n${session.task}\n\n`;
  }
  
  // 关键路径
  if (session.paths && Object.keys(session.paths).length > 0) {
    md += `## 📁 关键路径\n`;
    for (const [k, v] of Object.entries(session.paths)) {
      md += `- **${k}**: \`${v}\`\n`;
    }
    md += '\n';
  }
  
  // 服务器信息
  if (session.server && Object.keys(session.server).length > 0) {
    md += `## 🖥️ 服务器\n`;
    for (const [k, v] of Object.entries(session.server)) {
      md += `- **${k}**: ${v}\n`;
    }
    md += '\n';
  }
  
  // 里程碑（最近5个）
  if (session.milestones && session.milestones.length > 0) {
    md += `## ✅ 最近里程碑\n`;
    session.milestones.slice(-5).forEach(m => {
      md += `- ${m.text}\n`;
    });
    md += '\n';
  }
  
  // 备注
  if (session.notes) {
    md += `## 📝 备注\n${session.notes}\n\n`;
  }
  
  // 命令历史精华（如果提供了历史文件）
  if (historyPath && fs.existsSync(historyPath)) {
    try {
      // 动态加载压缩器的逻辑
      const historyData = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
      const compressed = compressHistoryInline(historyData.history || []);
      if (compressed.summary) {
        md += `## 🔧 上次完成的工作\n${compressed.summary}\n\n`;
      }
      if (compressed.facts && compressed.facts.length > 0) {
        md += `## 💡 关键信息\n`;
        compressed.facts.forEach(f => { md += `- ${f}\n`; });
        md += '\n';
      }
    } catch (e) {
      md += `## ⚠️ 历史解析失败\n${e.message}\n\n`;
    }
  }
  
  // 保存 digest 文件
  const dir = getProjectDir(projectName);
  if (dir) {
    fs.writeFileSync(path.join(dir, 'DIGEST.md'), md);
  }
  
  return md;
}

// 内联的历史压缩逻辑（简化版）
function compressHistoryInline(history) {
  const noisePatterns = [
    /^echo\s+['"]?(test|hello|ok|done)/i,
    /^sleep\s/,
    /^pwd$/,
  ];
  
  function isNoise(cmd) {
    const command = cmd.params?.command || '';
    return noisePatterns.some(p => p.test(command));
  }
  
  function classify(cmd) {
    const command = cmd.params?.command || '';
    const tool = cmd.tool;
    const filePath = cmd.params?.path || '';
    
    if (/git\s+commit/.test(command)) {
      const msg = command.match(/-m\s+['"]([^'"]+)['"]/);
      return { cat: 'git', act: 'commit', detail: msg ? msg[1] : '' };
    }
    if (/git\s+push/.test(command)) return { cat: 'git', act: 'push', detail: '' };
    if (/ssh.*@([\d\.]+)/.test(command) || /\|\s*ssh/.test(command)) {
      const host = command.match(/@([\d\.]+)/);
      if (/nohup|node.*index/.test(command)) return { cat: 'deploy', act: 'start', detail: host?.[1] || '' };
      if (/pkill|kill/.test(command)) return { cat: 'deploy', act: 'stop', detail: host?.[1] || '' };
      if (/npm\s+install/.test(command)) return { cat: 'deploy', act: 'install', detail: host?.[1] || '' };
      if (/git\s+clone/.test(command)) return { cat: 'deploy', act: 'clone', detail: host?.[1] || '' };
      if (/iptables/.test(command)) return { cat: 'deploy', act: 'firewall', detail: host?.[1] || '' };
      return { cat: 'ssh', act: 'remote', detail: host?.[1] || '' };
    }
    if (tool === 'write_file') return { cat: 'file', act: 'create', detail: path.basename(filePath) };
    if (tool === 'edit_file') return { cat: 'file', act: 'edit', detail: path.basename(filePath) };
    if (/memory_manager.*switch\s+(\S+)/.test(command)) {
      const proj = command.match(/switch\s+(\S+)/);
      return { cat: 'memory', act: 'switch', detail: proj?.[1] || '' };
    }
    return { cat: 'other', act: '', detail: '' };
  }
  
  const valid = history.filter(c => !isNoise(c) && c.success !== false);
  const byCategory = {};
  
  for (const cmd of valid) {
    const cls = classify(cmd);
    if (!byCategory[cls.cat]) byCategory[cls.cat] = { actions: new Set(), details: new Set() };
    if (cls.act) byCategory[cls.cat].actions.add(cls.act);
    if (cls.detail) byCategory[cls.cat].details.add(cls.detail);
  }
  
  // 生成摘要
  const lines = [];
  const facts = [];
  
  if (byCategory.deploy) {
    const hosts = Array.from(byCategory.deploy.details);
    const acts = Array.from(byCategory.deploy.actions);
    if (hosts.length) {
      lines.push(`部署到 ${hosts.join(', ')}: ${acts.join(' → ')}`);
      facts.push(`服务器: ${hosts.join(', ')}`);
      if (acts.includes('start')) facts.push('服务已启动');
    }
  }
  
  if (byCategory.git) {
    const acts = Array.from(byCategory.git.actions);
    const msgs = Array.from(byCategory.git.details).filter(d => d);
    if (acts.includes('push')) {
      lines.push(`提交并推送代码` + (msgs.length ? `: "${msgs[0]}"` : ''));
      facts.push('代码已推送');
    } else if (acts.includes('commit')) {
      lines.push(`提交代码` + (msgs.length ? `: "${msgs[0]}"` : ''));
    }
  }
  
  if (byCategory.file) {
    const files = Array.from(byCategory.file.details);
    const acts = Array.from(byCategory.file.actions);
    if (acts.includes('create')) lines.push(`创建文件: ${files.join(', ')}`);
    else if (acts.includes('edit')) lines.push(`编辑文件: ${files.join(', ')}`);
    facts.push(`修改的文件: ${files.slice(-5).join(', ')}`);
  }
  
  if (byCategory.memory) {
    const projects = Array.from(byCategory.memory.details);
    if (projects.length) {
      facts.push(`切换项目: ${projects.join(' → ')}`);
    }
  }
  
  if (byCategory.ssh) {
    const hosts = Array.from(byCategory.ssh.details);
    if (hosts.length) lines.push(`远程操作: ${hosts.join(', ')}`);
  }
  
  return {
    summary: lines.map(l => `- ${l}`).join('\n'),
    facts
  };
}

// CLI
const [,, cmd, arg1, arg2, arg3, arg4, arg5] = process.argv;
const active = getActiveProject();

switch (cmd) {
  case 'switch':
    if (!arg1) { console.log('用法: switch <project_name>'); break; }
    setActiveProject(arg1);
    console.log(`✅ 已切换到项目: ${arg1}`);
    break;
    
  case 'projects':
  case 'list':
    const projects = listProjects();
    if (projects.length === 0) {
      console.log('暂无项目，使用 switch <name> 创建');
    } else {
      console.log('项目列表:');
      projects.forEach(p => {
        const mark = p.active ? '→ ' : '  ';
        console.log(`${mark}${p.name} | 任务: ${p.task} | 里程碑: ${p.milestones} | 命令: ${p.commands}`);
      });
    }
    break;
    
  case 'task':
    if (!active) { console.log('请先 switch 到一个项目'); break; }
    setTask(active, arg1 || '');
    console.log(`任务已设置: ${arg1}`);
    break;
    
  case 'milestone':
    if (!active) { console.log('请先 switch 到一个项目'); break; }
    addMilestone(active, arg1 || '');
    console.log(`里程碑已添加: ${arg1}`);
    break;
    
  case 'record':
    if (!active) { console.log('请先 switch 到一个项目'); break; }
    const rec = recordCommand(active, arg1, arg2, arg3, arg4 === 'true', arg5);
    console.log(JSON.stringify(rec));
    break;
    
  case 'summary':
  case 'load':
    const proj = arg1 || active;
    if (!proj) { console.log('请指定项目或先 switch'); break; }
    console.log(generateSummary(proj));
    break;
    
  case 'status':
    console.log(`当前项目: ${active || '(未设置)'}`);
    if (active) {
      const s = loadSession(active);
      console.log(`任务: ${s.task || '(无)'}`);
      console.log(`里程碑: ${s.milestones.length}`);
      console.log(`命令记录: ${s.commands.length}`);
    }
    break;
    
  case 'digest': {
    // 生成完整上下文摘要
    const projName = arg1 || active;
    if (!projName) { console.log('请指定项目或先 switch'); break; }
    const historyFile = arg2 || null;  // 可选的命令历史文件
    console.log(generateDigest(projName, historyFile));
    break;
  }
    
  case 'set': {
    // 设置任意字段: set <field> <value>
    if (!active) { console.log('请先 switch 到一个项目'); break; }
    if (!arg1 || !arg2) { console.log('用法: set <field> <value>'); break; }
    const sess = loadSession(active);
    // 支持点号路径，如 server.ip
    if (arg1.includes('.')) {
      const [obj, key] = arg1.split('.');
      if (!sess[obj]) sess[obj] = {};
      sess[obj][key] = arg2;
    } else {
      sess[arg1] = arg2;
    }
    saveSession(active, sess);
    console.log(`✅ 已设置 ${arg1} = ${arg2}`);
    break;
  }
    
  default:
    console.log(`
Memory Manager v2 - 多项目上下文管理

命令:
  switch <project>      切换/创建项目
  projects              列出所有项目
  task <desc>           设置当前任务
  milestone <text>      添加里程碑
  set <field> <value>   设置任意字段 (如 notes, server.ip)
  summary [proj]        生成项目摘要
  digest [proj] [hist]  生成完整上下文(含命令历史精华)
  status                查看当前状态

当前项目: ${active || '(未设置)'}`);
}
