const fs = require('fs');
const path = require('path');
const db = require('better-sqlite3')('/Users/yay/workspace/genspark-agent/project.db');

const baseDir = '/Users/yay/workspace/genspark-agent/server-v2';

// 运行时核心文件
const files = [
  // 入口 + 核心基础
  'index.js', 'watchdog.js', 'logger.js', 'safety.js', 'notify.js',
  // 核心模块
  'core/db.js', 'core/history.js', 'core/router.js', 'core/alias.js',
  'core/agents.js', 'core/mcp-hub.js', 'core/metrics.js', 'core/pipeline.js',
  'core/trace.js', 'core/ws-handlers.js',
  // drivers
  'drivers/shell.js', 'drivers/browser.js', 'drivers/vfs.js',
  'drivers/filesystem.js', 'drivers/ssh.js', 'drivers/utility.js',
  'drivers/agent.js', 'drivers/bg.js', 'drivers/mcp.js',
  'drivers/supabase-memory.js', 'drivers/_template.js',
  // 功能模块
  'task-engine.js', 'async-executor.js', 'batch-runner.cjs',
  'process-manager.js', 'health-checker.js', 'error-classifier.js',
  'retry-manager.js', 'checkpoint-manager.js', 'context-compressor.js',
  'goal-manager.js', 'recorder.js', 'result-cache.js',
  'skills.js', 'state-manager.js', 'task-planner.js',
  'variable-resolver.js', 'workflow-template.js',
  'save-agent.js', 'teams-agent.js', 'self-validator.js',
  // 工具
  'dbfile.cjs', 'lib/db.cjs', 'lib/dbfile.cjs',
  // 配置
  'config.json', '.mcp.json',
  // extension 其他关键文件
];

const insert = db.prepare("INSERT OR REPLACE INTO project (project, path, content, updated_at) VALUES (?, ?, ?, datetime('now'))");

let count = 0;
let total = 0;
for (const f of files) {
  const fullPath = path.join(baseDir, f);
  if (!fs.existsSync(fullPath)) { console.log('  SKIP', f, '(not found)'); continue; }
  const content = fs.readFileSync(fullPath, 'utf8');
  insert.run('server-v2', f, content);
  console.log('  +', f, content.length, 'chars');
  count++;
  total += content.length;
}
console.log('imported', count, 'files,', total, 'chars total');
db.close();
