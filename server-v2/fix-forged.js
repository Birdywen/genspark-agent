const fs = require('fs');
const db = require('better-sqlite3')('data/agent.db');

let d = JSON.parse(fs.readFileSync('/private/tmp/forged-exp.json','utf8'));
let c = d[1].content;
console.log('BEFORE:', (c.match(/BATCH/g)||[]).length, 'BATCH occurrences');

// === ΩCODE CHANNEL section ===
c = c.replace(
  'SSE raw stream substring, zero parse zero escape zero corrupt.\nPriority: 1.ΩCODE 3.ΩBATCH-JSON\nSee: node dbfile.cjs get memory forged skill-omega-channel',
  'ΩCODE 统一命令通道。单步 {"tool":...} 多步 {"steps":[...]}。\nSSE 行缓冲保护，零字符丢失。ΩBATCH 已退役(2026-03-27)。\nSee: node dbfile.cjs get memory forged skill-omega-channel'
);

// === BATCH-FIRST -> ΩCODE-FIRST ===
c = c.replace('=== BATCH-FIRST EXECUTION（核心亮点）===', '=== ΩCODE-FIRST EXECUTION（核心亮点）===');
c = c.replace('2+ 命令必须 batch，没有例外。', '2+ 命令必须用 ΩCODE {"steps":[...]}，没有例外。');
c = c.replace('ΩCODE batch, saveAs, all parallel, one response.', 'ΩCODE {"steps":[...]}, saveAs, all parallel, one response.');

// === 两种格式 -> 统一格式 ===
c = c.replace(
  '两种格式，按需选择:\n\nBATCH JSON（文件写入 + 复杂内容 + 高级控制流）:\n  ΩBATCH{"steps":[',
  '统一格式 ΩCODE:\n\nΩCODE\n{"steps":['
);
c = c.replace('  ]}END', ']}\nΩCODEEND');
c = c.replace('BATCH JSON 高级能力:', 'ΩCODE steps 高级能力:');

// === 关键规则 ===
c = c.replace('1. Ω = Greek letter Omega. 每个 BATCH 标记都需要 Omega 前缀。\n2. 都放在代码块里。BATCH JSON 必须在代码块内。\n3. @saveAs=var 保存结果，@when=var.success 条件执行，@when=var.failure 错误处理。',
  '1. ΩCODE...ΩCODEEND 包裹所有命令。\n2. saveAs/when 控制流: {"saveAs":"s1"}, {"when":"s1.success"}。');
c = c.replace('5. eval_js 不能放 BATCH（死锁）。write_file 超50行用 BATCH JSON。', '5. eval_js 不能放 ΩCODE steps（死锁）。');

// === 反截断策略 ===
c = c.replace('复杂文件内容 -> dbfile.cjs 桥接', '复杂文件内容 -> dbfile.cjs 桥接或 ΩCODE 写文件');

// === PARAM_CORRUPT ===
c = c.replace('用 ΩCODE 通道（零截断）或 BATCH JSON（JSON.parse 免疫）', '用 ΩCODE 通道（零截断，JSON.parse 免疫）');

// === BATCH-RUNNER ===
c = c.replace('=== BATCH-RUNNER（后台执行，无需AI）===', '=== BATCH-RUNNER（后台执行，无需AI，使用 ΩCODE steps 格式）===');

// === BATCH 控制流 ===
c = c.replace('=== BATCH 控制流（2026-03-23 全面测试通过）===\nΩBATCH JSON 支持完整控制流:', '=== ΩCODE 控制流（2026-03-23 全面测试通过）===\nΩCODE {"steps":[...]} 支持完整控制流:');

d[1].content = c;
console.log('AFTER:', (c.match(/BATCH/g)||[]).length, 'BATCH occurrences');

// Write back
fs.writeFileSync('/private/tmp/forged-exp-new.json', JSON.stringify(d));
db.prepare("UPDATE memory SET content=? WHERE slot='toolkit' AND key='_forged:experience-dialogues'").run(JSON.stringify(d));
console.log('DB updated, new length:', JSON.stringify(d).length);
