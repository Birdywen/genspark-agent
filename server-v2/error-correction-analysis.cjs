const Database = require('better-sqlite3');
const db = new Database('data/agent.db');

const rows = db.prepare(`
SELECT id, timestamp, tool, success, 
  substr(params,1,300) as params,
  substr(CASE WHEN success=0 THEN error ELSE result_preview END, 1,200) as detail
FROM commands 
WHERE timestamp >= date('now','-30 days')
  AND tool IN ('run_process','edit_file','vfs_local_write','write_file','ssh-oracle:exec')
ORDER BY id
`).all();

console.log(`分析 ${rows.length} 条记录...\n`);

// 找纠错序列：连续失败后成功
const sequences = [];
let i = 0;
while (i < rows.length) {
  if (rows[i].success === 0) {
    const tool = rows[i].tool;
    const fails = [];
    while (i < rows.length && rows[i].success === 0 && rows[i].tool === tool) {
      fails.push(rows[i]);
      i++;
    }
    let success = null;
    for (let j = i; j < Math.min(i + 5, rows.length); j++) {
      if (rows[j].tool === tool && rows[j].success === 1) {
        success = rows[j];
        break;
      }
    }
    if (success && fails.length >= 2) {
      sequences.push({ fails, success, attempts: fails.length });
    }
  } else {
    i++;
  }
}

console.log(`=== 找到 ${sequences.length} 个纠错序列 (2次+失败后成功) ===\n`);

// 按尝试次数排序
sequences.sort((a, b) => b.attempts - a.attempts);

// 归类
const patterns = {};
for (const seq of sequences.slice(0, 50)) {
  const err = seq.fails[0].detail || '';
  let cat = 'OTHER';
  if (err.includes('ENOENT')) cat = 'PATH_FIX(路径修复)';
  else if (err.includes('Cannot find module')) cat = 'MODULE_FIX(模块路径)';
  else if (err.includes('exact match')) cat = 'EDIT_RETRY(编辑重试)';
  else if (err.toLowerCase().includes('permission') || err.includes('EACCES')) cat = 'PERMISSION_FIX';
  else if (err.toLowerCase().includes('syntax')) cat = 'SYNTAX_FIX(语法修复)';
  else if (err.includes('参数损坏')) cat = 'PARAM_FIX(参数修复)';
  else if (err.toLowerCase().includes('timeout')) cat = 'TIMEOUT_RETRY';
  if (!patterns[cat]) patterns[cat] = [];
  patterns[cat].push(seq);
}

console.log('=== 纠错模式分类 ===\n');
const sorted = Object.entries(patterns).sort((a, b) => b[1].length - a[1].length);
for (const [cat, seqs] of sorted) {
  const worst = seqs.reduce((a, b) => a.attempts > b.attempts ? a : b);
  console.log(`[${cat}] ${seqs.length}次`);
  console.log(`  最艰难: ${worst.attempts}次失败后成功`);
  console.log(`  首错: ${(worst.fails[0].detail || '').slice(0, 100)}`);
  console.log(`  末错: ${(worst.fails[worst.fails.length - 1].detail || '').slice(0, 100)}`);
  console.log(`  修复: ${(worst.success.params || '').slice(0, 130)}`);
  console.log();
}

console.log('=== 最艰难 Top 10 ===\n');
for (let k = 0; k < Math.min(10, sequences.length); k++) {
  const seq = sequences[k];
  console.log(`#${k + 1} [${seq.attempts}次失败] ${seq.fails[0].tool}`);
  console.log(`  时间: ${seq.fails[0].timestamp}`);
  console.log(`  首错: ${(seq.fails[0].detail || '').slice(0, 100)}`);
  console.log(`  末错: ${(seq.fails[seq.fails.length - 1].detail || '').slice(0, 100)}`);
  console.log(`  修复: ${(seq.success.params || '').slice(0, 150)}`);
  console.log();
}

db.close();