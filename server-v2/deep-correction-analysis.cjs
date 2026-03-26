const Database = require('better-sqlite3');
const db = new Database('data/agent.db');

// 取所有失败命令，以及紧跟的同工具成功命令
const rows = db.prepare(`
WITH fail_groups AS (
  SELECT id, timestamp, tool, params, error,
    LEAD(id) OVER (PARTITION BY tool ORDER BY id) as next_id
  FROM commands
  WHERE timestamp >= date('now','-30 days')
    AND tool IN ('run_process','edit_file','write_file','vfs_local_write')
)
SELECT 
  f.id as fail_id, f.timestamp, f.tool, 
  substr(f.params,1,500) as fail_params,
  substr(f.error,1,300) as error,
  s.id as success_id,
  substr(s.params,1,500) as success_params
FROM fail_groups f
JOIN commands s ON s.id = f.next_id AND s.tool = f.tool AND s.success = 1
WHERE f.error != '' 
  AND f.id IN (SELECT id FROM commands WHERE success = 0)
ORDER BY f.id DESC
LIMIT 50
`).all();

console.log('=== 失败→成功 命令对比 (Top 50) ===\n');

// 分析变化模式
const patterns = {};

for (const row of rows) {
  let fp, sp;
  try { fp = JSON.parse(row.fail_params); } catch(e) { fp = {}; }
  try { sp = JSON.parse(row.success_params); } catch(e) { sp = {}; }
  
  const fcmd = fp.command_line || fp.command || '';
  const scmd = sp.command_line || sp.command || '';
  const err = row.error || '';
  
  // 识别纠错模式
  let pattern = 'UNKNOWN';
  
  if (err.includes('timeout') || err.includes('Timeout')) {
    if (scmd.includes('nohup') || scmd.includes('bg_run')) pattern = 'TIMEOUT→后台执行(正确)';
    else if (scmd.includes('ssh') && fcmd.includes('ssh')) pattern = 'TIMEOUT→换SSH参数(治标)';
    else if (scmd.length < fcmd.length) pattern = 'TIMEOUT→简化命令(治标)';
    else pattern = 'TIMEOUT→盲目重试(无效)';
  }
  else if (err.includes('ENOENT')) {
    if (scmd !== fcmd) pattern = 'ENOENT→改路径';
    else pattern = 'ENOENT→重试同命令(无效)';
  }
  else if (err.includes('Cannot find module')) {
    if (scmd.includes('cd ') && !fcmd.includes('cd ')) pattern = 'MODULE→加cd切目录(正确)';
    else if (scmd.includes('cd ')) pattern = 'MODULE→换目录';
    else pattern = 'MODULE→其他修复';
  }
  else if (err.includes('exact match')) {
    pattern = 'EDIT→重新读文件后编辑';
  }
  else if (err.includes('参数损坏')) {
    if (scmd.includes('/tmp/') || scmd.includes('bash ')) pattern = 'PARAM→改写脚本文件(正确)';
    else pattern = 'PARAM→调整参数格式';
  }
  else if (err.includes('EADDRINUSE')) {
    pattern = 'PORT→先kill再启动';
  }
  else if (err.includes('syntax') || err.includes('SyntaxError')) {
    pattern = 'SYNTAX→修正语法';
  }
  
  if (!patterns[pattern]) patterns[pattern] = { count: 0, examples: [] };
  patterns[pattern].count++;
  if (patterns[pattern].examples.length < 2) {
    patterns[pattern].examples.push({
      error: err.substring(0, 100),
      fail_cmd: fcmd.substring(0, 120),
      success_cmd: scmd.substring(0, 120)
    });
  }
}

console.log('=== 纠错行为模式 ===\n');
const sorted = Object.entries(patterns).sort((a,b) => b[1].count - a[1].count);
for (const [pat, data] of sorted) {
  const isGood = pat.includes('正确');
  const isBad = pat.includes('无效') || pat.includes('治标') || pat.includes('盲目');
  const mark = isGood ? '✓' : isBad ? '✗' : '?';
  console.log(`[${mark}] ${pat}: ${data.count}次`);
  for (const ex of data.examples) {
    console.log(`    错误: ${ex.error}`);
    console.log(`    失败: ${ex.fail_cmd}`);
    console.log(`    成功: ${ex.success_cmd}`);
    console.log();
  }
}

console.log('\n=== 总结 ===');
let good = 0, bad = 0, unknown = 0;
for (const [pat, data] of sorted) {
  if (pat.includes('正确')) good += data.count;
  else if (pat.includes('无效') || pat.includes('治标') || pat.includes('盲目')) bad += data.count;
  else unknown += data.count;
}
console.log(`正确纠错: ${good}  低效纠错: ${bad}  待分类: ${unknown}`);
console.log(`纠错效率: ${Math.round(100*good/(good+bad+unknown))}%`);

db.close();