#!/usr/bin/env node
/**
 * script-manager.cjs — 可复用脚本管理器
 * 
 * 用法:
 *   node script-manager.cjs save <name> <json>       # 保存脚本
 *   node script-manager.cjs save <name> --from <id>   # 从commands表导入
 *   node script-manager.cjs run <name>                # 执行脚本
 *   node script-manager.cjs list [category]            # 列出脚本
 *   node script-manager.cjs get <name>                 # 查看脚本内容
 *   node script-manager.cjs delete <name>              # 删除脚本
 *   node script-manager.cjs tag <name> <tags>          # 设置标签
 *   node script-manager.cjs search <keyword>           # 搜索脚本
 *   node script-manager.cjs mark <command_id>          # 标记commands为可复用
 *   node script-manager.cjs candidates [limit]         # 找可能可复用的batch
 */

const Database = require('better-sqlite3');
const path = require('path');
const http = require('http');

const DB_PATH = path.join(__dirname, 'data/agent.db');
const SERVER = 'http://localhost:8766';
const db = new Database(DB_PATH);

const [,, action, ...rest] = process.argv;

function callTool(tool, params, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ tool, params });
    const url = new URL(SERVER + '/tool');
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname,
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { reject(new Error('Invalid JSON: ' + body)); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(data); req.end();
  });
}

async function run() {
  switch (action) {
    case 'save': {
      const name = rest[0];
      if (!name) { console.error('Usage: save <name> <json|--from id>'); process.exit(1); }
      let batchJson, sourceId = null;
      if (rest[1] === '--from') {
        sourceId = parseInt(rest[2]);
        const row = db.prepare('SELECT params FROM commands WHERE id=?').get(sourceId);
        if (!row) { console.error('Command not found: ' + sourceId); process.exit(1); }
        batchJson = row.params;
        // 标记源命令为可复用
        db.prepare('UPDATE commands SET reusable=1 WHERE id=?').run(sourceId);
      } else {
        batchJson = rest.slice(1).join(' ');
      }
      // 验证JSON
      try { JSON.parse(batchJson); } catch(e) { console.error('Invalid JSON: ' + e.message); process.exit(1); }
      const desc = rest.find(r => r.startsWith('--desc='));
      const cat = rest.find(r => r.startsWith('--cat='));
      db.prepare(`INSERT OR REPLACE INTO scripts (name, batch_json, source_command_id, description, category, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))`)
        .run(name, batchJson, sourceId, desc ? desc.slice(7) : null, cat ? cat.slice(6) : 'general');
      console.log('OK: script saved as "' + name + '" (' + batchJson.length + ' chars)');
      break;
    }

    case 'run': {
      const name = rest[0];
      const row = db.prepare('SELECT * FROM scripts WHERE name=?').get(name);
      if (!row) { console.error('Script not found: ' + name); process.exit(1); }
      const batch = JSON.parse(row.batch_json);
      console.log('Running script: ' + name + ' (' + (batch.steps || []).length + ' steps)');
      
      const steps = batch.steps || [batch]; // 支持单步和多步
      let success = 0, failed = 0;
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        try {
          const result = await callTool(step.tool, step.params || {}, step.timeout || 30000);
          console.log(`  [${i}] ${step.tool}: ${result.success !== false ? '✓' : '✗'} ${JSON.stringify(result).substring(0, 200)}`);
          result.success !== false ? success++ : failed++;
        } catch(e) {
          console.log(`  [${i}] ${step.tool}: ✗ ${e.message}`);
          failed++;
          if (batch.options?.stopOnError !== false) break;
        }
      }
      
      // 更新统计
      const total = row.run_count + 1;
      const rate = ((row.success_rate * row.run_count) + (failed === 0 ? 1 : 0)) / total;
      db.prepare("UPDATE scripts SET run_count=?, last_run=datetime('now'), success_rate=?, updated_at=datetime('now') WHERE name=?")
        .run(total, rate, name);
      console.log(`\nResult: ${success}/${steps.length} success, run #${total}, rate: ${(rate*100).toFixed(0)}%`);
      break;
    }

    case 'list': {
      const cat = rest[0];
      const rows = cat
        ? db.prepare('SELECT name, category, description, run_count, success_rate, last_run FROM scripts WHERE category=? ORDER BY run_count DESC').all(cat)
        : db.prepare('SELECT name, category, description, run_count, success_rate, last_run FROM scripts ORDER BY category, run_count DESC').all();
      if (rows.length === 0) { console.log('No scripts found.'); break; }
      console.log(`Scripts (${rows.length}):`);
      for (const r of rows) {
        console.log(`  [${r.category}] ${r.name} — runs:${r.run_count} rate:${(r.success_rate*100).toFixed(0)}% ${r.description || ''} ${r.last_run ? '(last: '+r.last_run+')' : ''}`);
      }
      break;
    }

    case 'get': {
      const name = rest[0];
      const row = db.prepare('SELECT * FROM scripts WHERE name=?').get(name);
      if (!row) { console.error('Not found: ' + name); process.exit(1); }
      console.log(JSON.stringify(row, null, 2));
      break;
    }

    case 'delete': {
      const name = rest[0];
      const r = db.prepare('DELETE FROM scripts WHERE name=?').run(name);
      console.log(r.changes ? 'Deleted: ' + name : 'Not found: ' + name);
      break;
    }

    case 'tag': {
      const [name, ...tags] = rest;
      db.prepare("UPDATE scripts SET tags=?, updated_at=datetime('now') WHERE name=?").run(tags.join(','), name);
      console.log('Tagged: ' + name + ' → ' + tags.join(','));
      break;
    }

    case 'search': {
      const kw = rest[0] || '';
      const rows = db.prepare('SELECT name, category, description, tags FROM scripts WHERE name LIKE ? OR description LIKE ? OR tags LIKE ? OR batch_json LIKE ?')
        .all(`%${kw}%`, `%${kw}%`, `%${kw}%`, `%${kw}%`);
      console.log(`Found ${rows.length} scripts:`);
      for (const r of rows) {
        console.log(`  [${r.category}] ${r.name} — ${r.description || ''} ${r.tags ? '{'+r.tags+'}' : ''}`);
      }
      break;
    }

    case 'mark': {
      const id = parseInt(rest[0]);
      db.prepare('UPDATE commands SET reusable=1 WHERE id=?').run(id);
      console.log('Marked command #' + id + ' as reusable');
      break;
    }

    case 'candidates': {
      const limit = parseInt(rest[0]) || 20;
      // 找成功的batch类命令，params包含steps，按执行频率排序
      const rows = db.prepare(`
        SELECT id, timestamp, tool, substr(params,1,200) as preview, duration_ms
        FROM commands 
        WHERE success=1 AND params LIKE '%"steps"%' AND params LIKE '%"tool"%'
        AND reusable=0
        ORDER BY id DESC LIMIT ?
      `).all(limit);
      console.log(`Candidates (${rows.length}):`);
      for (const r of rows) {
        console.log(`  #${r.id} [${r.timestamp}] ${r.duration_ms||'?'}ms — ${r.preview}`);
      }
      break;
    }

    default:
      console.log('Usage: node script-manager.cjs <save|run|list|get|delete|tag|search|mark|candidates> [args]');
  }
}

run().catch(e => { console.error(e.message); process.exit(1); }).finally(() => db.close());
