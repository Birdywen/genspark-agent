#!/usr/bin/env node
/**
 * batch-runner.js — 独立 BATCH 执行器
 * 从 agent.db 取出 BATCH JSON 或直接接收，通过 HTTP 逐步执行
 * 
 * 用法:
 *   node batch-runner.js <script-name>          # 从 DB 取出执行
 *   node batch-runner.js --json '<batch-json>'   # 直接执行 JSON
 *   echo '<batch-json>' | node batch-runner.js   # stdin 输入
 */

const http = require('http');
const path = require('path');
const fs = require('fs');

const SERVER = 'http://localhost:8766';
const DB_PATH = path.join(__dirname, 'data/agent.db');

// ── HTTP 工具调用 ──
function callTool(tool, params, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ tool, params });
    const url = new URL(SERVER + '/tool');
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch(e) { reject(new Error('Invalid JSON: ' + body)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(data);
    req.end();
  });
}

// ── 变量替换 ──
function resolveVars(obj, vars) {
  if (typeof obj === 'string') {
    return obj.replace(/\{\{(\w+)\.(\w+)\}\}/g, (_, name, prop) => {
      const v = vars[name];
      return v && v[prop] !== undefined ? v[prop] : _;
    });
  }
  if (Array.isArray(obj)) return obj.map(x => resolveVars(x, vars));
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = resolveVars(v, vars);
    return out;
  }
  return obj;
}

// ── 条件检查 ──
function checkWhen(when, vars) {
  if (!when) return true;
  const m = when.match(/^(\w+)\.(success|failure|result)$/);
  if (!m) return true;
  const [, name, prop] = m;
  const v = vars[name];
  if (!v) return false;
  if (prop === 'success') return v.success === true;
  if (prop === 'failure') return v.success === false;
  if (prop === 'result') return !!v.result;
  return true;
}

// ── forEach 展开 ──
function expandForEach(step, vars) {
  if (!step.forEach) return [step];
  const { forEach, ...rest } = step;
  const items = typeof forEach.in === 'string' ? 
    (vars[forEach.in]?.result || '').split('\n').filter(Boolean) :
    forEach.in;
  return items.map(item => {
    const expanded = JSON.parse(JSON.stringify(rest).replace(/\{\{item\}\}/g, item));
    return expanded;
  });
}

// ── 主执行器 ──
async function runBatch(batchJson) {
  const batch = typeof batchJson === 'string' ? JSON.parse(batchJson) : batchJson;
  const steps = batch.steps || [];
  const vars = {};
  const results = [];
  
  console.log(`\n═══ BATCH RUNNER ═══  ${steps.length} steps`);
  console.log(`═══ ${new Date().toISOString()} ═══\n`);

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    
    // forEach 展开
    const expanded = expandForEach(step, vars);
    
    for (const s of expanded) {
      // when 条件检查
      if (!checkWhen(s.when, vars)) {
        console.log(`[${i}] SKIP (when: ${s.when})`);
        results.push({ step: i, skipped: true, when: s.when });
        continue;
      }

      // 变量替换
      const params = resolveVars(s.params || {}, vars);
      const tool = s.tool;
      const label = s.label || `${tool}`;
      
      console.log(`[${i}] ${label} ...`);
      const start = Date.now();
      
      try {
        const result = await callTool(tool, params, s.timeout || 30000);
        const ms = Date.now() - start;
        const ok = result.success !== false;
        
        // saveAs
        if (s.saveAs) {
          vars[s.saveAs] = {
            success: ok,
            result: result.result || '',
            error: result.error || '',
            raw: result
          };
        }
        
        const preview = typeof result.result === 'string' ? 
          result.result.substring(0, 120) : JSON.stringify(result.result || '').substring(0, 120);
        console.log(`    ${ok ? '✓' : '✗'} (${ms}ms) ${preview}`);
        results.push({ step: i, tool, success: ok, ms, preview });
        
      } catch(e) {
        const ms = Date.now() - start;
        console.log(`    ✗ ERROR (${ms}ms) ${e.message}`);
        if (s.saveAs) {
          vars[s.saveAs] = { success: false, result: '', error: e.message };
        }
        results.push({ step: i, tool, success: false, ms, error: e.message });
      }
    }
  }

  // 汇总
  const ok = results.filter(r => r.success).length;
  const fail = results.filter(r => r.success === false).length;
  const skip = results.filter(r => r.skipped).length;
  console.log(`\n═══ DONE: ${ok}✓ ${fail}✗ ${skip}⊘ ═══\n`);
  
  return { results, vars };
}

// ── 从 DB 加载 ──
function loadFromDB(scriptName) {
  const Database = require('better-sqlite3');
  const db = new Database(DB_PATH, { readonly: true });
  const row = db.prepare("SELECT content FROM local_store WHERE slot='script' AND key=?").get(scriptName);
  db.close();
  if (!row) throw new Error(`Script "${scriptName}" not found in DB`);
  return row.content;
}

// ── 入口 ──
async function main() {
  const args = process.argv.slice(2);
  let batchJson;

  if (args[0] === '--json') {
    batchJson = args.slice(1).join(' ');
  } else if (args[0] === '--file') {
    batchJson = fs.readFileSync(args[1], 'utf8');
  } else if (args[0]) {
    // 从 DB 加载 script
    const content = loadFromDB(args[0]);
    // 如果内容是 BATCH JSON 格式，直接用；否则报错
    if (content.trim().startsWith('{')) {
      batchJson = content;
    } else {
      console.error('Script is not BATCH JSON format. Use bash for shell scripts.');
      process.exit(1);
    }
  } else if (!process.stdin.isTTY) {
    // stdin
    batchJson = '';
    for await (const chunk of process.stdin) batchJson += chunk;
  } else {
    console.log('Usage:');
    console.log('  node batch-runner.js <script-name>        # from DB');
    console.log('  node batch-runner.js --json \'{"steps":[...]}\'');
    console.log('  node batch-runner.js --file batch.json');
    console.log('  echo \'{"steps":[...]}\' | node batch-runner.js');
    process.exit(0);
  }

  try {
    await runBatch(batchJson);
  } catch(e) {
    console.error('BATCH ERROR:', e.message);
    process.exit(1);
  }
}

main();