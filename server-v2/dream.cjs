// dream.cjs — Memory Consolidation Engine v1.1
// 两步模式：
//   Step 1: node dream.cjs prepare [--force]  → 生成 prompt 到 data/dream-prompt.txt
//   Step 2: (外部 ask_ai 执行后) node dream.cjs apply <result.json>  → 写入DB
//   node dream.cjs status  → 查看三门控状态
//   node dream.cjs history → 查看历史
//
// 三门控触发：时间门(24h) + 会话门(5次compress) + 锁门(无并发)

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data/agent.db');
const db = new Database(DB_PATH);
const PROMPT_FILE = path.join(__dirname, 'data/dream-prompt.txt');
const RESULT_FILE = path.join(__dirname, 'data/dream-result.json');

const args = process.argv.slice(2);
const cmd = args[0] || 'status';
const FORCE = args.includes('--force');

// ═══════════════════════════════════════════════
// 三门控
// ═══════════════════════════════════════════════

function getGateStatus() {
  const lastRun = db.prepare("SELECT content FROM local_store WHERE slot='dream' AND key='last-run'").get();
  const lastTime = lastRun ? new Date(JSON.parse(lastRun.content).timestamp).getTime() : 0;
  const hoursSince = (Date.now() - lastTime) / (1000 * 60 * 60);

  const sessionData = db.prepare("SELECT content FROM local_store WHERE slot='dream' AND key='session-count'").get();
  const sessionCount = sessionData ? parseInt(JSON.parse(sessionData.content).count) : 999;

  const lockData = db.prepare("SELECT content FROM local_store WHERE slot='dream' AND key='lock'").get();
  let lockActive = false;
  if (lockData) {
    const lock = JSON.parse(lockData.content);
    const lockAge = (Date.now() - new Date(lock.timestamp).getTime()) / (1000 * 60 * 60);
    lockActive = lockAge < 1;
  }

  return {
    timeGate: { passed: hoursSince >= 24, hours: hoursSince.toFixed(1) },
    sessionGate: { passed: sessionCount >= 5, count: sessionCount },
    lockGate: { passed: !lockActive },
    allPassed: (hoursSince >= 24 && sessionCount >= 5 && !lockActive) || FORCE
  };
}

// ═══════════════════════════════════════════════
// status — 查看状态
// ═══════════════════════════════════════════════

if (cmd === 'status') {
  const g = getGateStatus();
  console.log('💤 Dream Engine v1.1 — Status');
  console.log(`  ⏰ 时间门: ${g.timeGate.passed ? '✅' : '❌'} (${g.timeGate.hours}h since last dream, need 24h)`);
  console.log(`  📋 会话门: ${g.sessionGate.passed ? '✅' : '❌'} (${g.sessionGate.count} sessions, need 5)`);
  console.log(`  🔒 锁门:   ${g.lockGate.passed ? '✅' : '❌'}`);
  console.log(`  → ${g.allPassed ? '✅ 可以 dream' : '⏳ 条件未满足'}`);
  db.close();
  process.exit(0);
}

// ═══════════════════════════════════════════════
// history — 查看历史
// ═══════════════════════════════════════════════

if (cmd === 'history') {
  const row = db.prepare("SELECT content FROM local_store WHERE slot='dream' AND key='history'").get();
  if (row) {
    const history = JSON.parse(row.content);
    for (const h of history) {
      console.log(`[${h.timestamp}] +${h.lessons_added} lessons, -${h.stale_removed} stale, ${h.merges_done} merges (${h.duration_ms}ms)`);
      console.log(`  ${h.summary}`);
    }
  } else {
    console.log('No dream history yet.');
  }
  db.close();
  process.exit(0);
}

// ═══════════════════════════════════════════════
// prepare — 生成 prompt
// ═══════════════════════════════════════════════

if (cmd === 'prepare') {
  const gates = getGateStatus();
  if (!gates.allPassed) {
    console.log('⏳ 三门控未通过，用 --force 强制。');
    db.close();
    process.exit(1);
  }

  // Phase 1 — Orient
  const memoryIndex = db.prepare(
    "SELECT slot, key, length(content) as size, updated_at FROM memory ORDER BY slot, key"
  ).all();
  const storeIndex = db.prepare(
    "SELECT slot, key, length(content) as size, updated_at FROM local_store ORDER BY slot, key"
  ).all();
  const memStats = db.prepare("SELECT COUNT(*) as total, SUM(length(content)) as bytes FROM memory").get();
  const storeStats = db.prepare("SELECT COUNT(*) as total, SUM(length(content)) as bytes FROM local_store").get();

  // Phase 2 — Gather Signal
  const failures = db.prepare(
    "SELECT tool, substr(params,1,200) as params, substr(error,1,200) as error, timestamp FROM commands WHERE success=0 AND timestamp > datetime('now','-1 day') ORDER BY timestamp DESC LIMIT 30"
  ).all();
  const failPatterns = db.prepare(
    "SELECT tool, COUNT(*) as cnt FROM commands WHERE success=0 AND timestamp > datetime('now','-1 day') GROUP BY tool ORDER BY cnt DESC"
  ).all();
  const hotOps = db.prepare(
    "SELECT tool, COUNT(*) as cnt FROM commands WHERE timestamp > datetime('now','-1 day') GROUP BY tool ORDER BY cnt DESC LIMIT 10"
  ).all();
  const recentForged = db.prepare(
    "SELECT key, content FROM memory WHERE slot='forged' AND key LIKE 'lesson-%' ORDER BY updated_at DESC LIMIT 20"
  ).all();

  const omegaLessons = db.prepare(
    "SELECT key, content FROM memory WHERE slot='omega-lessons' ORDER BY updated_at DESC"
  ).all();

  // Build prompt
  const memOverview = memoryIndex.map(m => `${m.slot}/${m.key} (${m.size}B, ${m.updated_at})`).join('\n');
  const storeOverview = storeIndex.map(s => `${s.slot}/${s.key} (${s.size}B, ${s.updated_at})`).join('\n');
  const existingLessons = recentForged.map(r => `- ${r.key}: ${r.content.substring(0, 120)}`).join('\n');
  const failureDetails = failures.slice(0, 15).map(f =>
    `[${f.tool}] ${f.params.substring(0, 120)} → ${(f.error || 'exit non-zero').substring(0, 100)}`
  ).join('\n');
  const omegaLessonsStr = omegaLessons.map(function(l){ try{var o=JSON.parse(l.content);return '- '+l.key+': '+o.lesson+' ['+o.status+']'}catch(e){return '- '+l.key+': '+l.content.substring(0,120)} }).join('\n');
    const failPatternStr = failPatterns.map(p => `${p.tool}: ${p.cnt} fails`).join(', ');
  const hotOpsStr = hotOps.map(h => `${h.tool}: ${h.cnt}`).join(', ');

  const prompt = `# Dream: Memory Consolidation for AI Agent System

You are performing a dream — a reflective pass over an AI agent's memory stores.
Your job: analyze recent activity, extract new lessons, identify stale/duplicate data, and produce actionable updates.

## Current Memory State
memory table: ${memStats.total} entries, ${(memStats.bytes/1024).toFixed(1)}KB
local_store table: ${storeStats.total} entries, ${(storeStats.bytes/1024).toFixed(1)}KB

### memory entries:
${memOverview}

### local_store entries:
${storeOverview}

## Recent Failures (last 24h)
Failure patterns: ${failPatternStr}
Details:
${failureDetails}

## Hot Operations (last 24h)
${hotOpsStr}

## Existing Lessons (forged slot in memory table)
${existingLessons}

## Omega Platform Lessons (from omega-lessons slot)
${omegaLessonsStr}

---

Respond with ONLY valid JSON (no markdown fences):
{
  "new_lessons": [
    {"key": "lesson-xxx", "content": "WRONG: ... → CORRECT: ...\\nCONTEXT: ..."}
  ],
  "stale_entries": [
    {"table": "memory|local_store", "slot": "...", "key": "...", "reason": "..."}
  ],
  "duplicate_merges": [
    {"keep": {"table":"...","slot":"...","key":"..."}, "remove": {"table":"...","slot":"...","key":"..."}, "reason": "..."}
  ],
  "summary": "One paragraph summary of this dream cycle's findings"
}

Rules:
1. Only create new_lessons for REAL failure patterns visible in the data above
2. Mark entries stale only if clearly outdated (old session states, superseded versions)
3. Merge duplicates only when two entries serve the exact same purpose
4. Be conservative — when in doubt, keep it
5. key names for new_lessons must start with "lesson-"
6. Respond with ONLY the JSON object, nothing else`;

  fs.writeFileSync(PROMPT_FILE, prompt);
  console.log(`✅ Prompt written to ${PROMPT_FILE} (${prompt.length} chars)`);
  console.log(`  memory: ${memStats.total} entries, ${(memStats.bytes/1024).toFixed(1)}KB`);
  console.log(`  local_store: ${storeStats.total} entries, ${(storeStats.bytes/1024).toFixed(1)}KB`);
  console.log(`  failures analyzed: ${failures.length}`);
  console.log(`  existing lessons: ${recentForged.length}`);
  console.log(`  omega lessons: ${omegaLessons.length}`);
  console.log('\nNext: use ask_ai with this prompt, then run: node dream.cjs apply');
  db.close();
  process.exit(0);
}

// ═══════════════════════════════════════════════
// apply — 应用 AI 分析结果
// ═══════════════════════════════════════════════

if (cmd === 'apply') {
  const startTime = Date.now();
  let resultData;

  // 从参数或文件读取
  const inputFile = args[1] || RESULT_FILE;
  if (fs.existsSync(inputFile)) {
    const raw = fs.readFileSync(inputFile, 'utf-8');
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    resultData = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
  } else {
    console.error('No result file found: ' + inputFile);
    db.close();
    process.exit(1);
  }

  let lessonsAdded = 0, staleRemoved = 0, mergesDone = 0;

  // 写入新教训
  if (resultData.new_lessons) {
    const upsert = db.prepare(
      "INSERT OR REPLACE INTO memory (slot, key, content, updated_at) VALUES ('forged', ?, ?, datetime('now'))"
    );
    for (const lesson of resultData.new_lessons) {
      if (lesson.key && lesson.content) {
        upsert.run(lesson.key, lesson.content);
        console.log(`  ✅ 写入 forged/${lesson.key}`);
        lessonsAdded++;
      }
    }
  }

  // 标记过时条目
  if (resultData.stale_entries) {
    for (const entry of resultData.stale_entries) {
      const table = entry.table === 'memory' ? 'memory' : 'local_store';
      const row = db.prepare(`SELECT content FROM ${table} WHERE slot=? AND key=?`).get(entry.slot, entry.key);
      if (row) {
        db.prepare(`UPDATE ${table} SET key=?, updated_at=datetime('now') WHERE slot=? AND key=?`)
          .run('_stale:' + entry.key, entry.slot, entry.key);
        console.log(`  📦 标记过时: ${entry.slot}/${entry.key} → ${entry.reason}`);
        staleRemoved++;
      }
    }
  }

  // 执行合并
  if (resultData.duplicate_merges) {
    for (const merge of resultData.duplicate_merges) {
      const rmTable = merge.remove.table === 'memory' ? 'memory' : 'local_store';
      db.prepare(`DELETE FROM ${rmTable} WHERE slot=? AND key=?`)
        .run(merge.remove.slot, merge.remove.key);
      console.log(`  🔀 合并: 删除 ${merge.remove.slot}/${merge.remove.key}`);
      mergesDone++;
    }
  }

  // 记录结果
  const record = {
    timestamp: new Date().toISOString(),
    duration_ms: Date.now() - startTime,
    lessons_added: lessonsAdded,
    stale_removed: staleRemoved,
    merges_done: mergesDone,
    summary: resultData.summary || ''
  };

  db.prepare(
    "INSERT OR REPLACE INTO local_store (slot, key, content, updated_at) VALUES ('dream', 'last-run', ?, datetime('now'))"
  ).run(JSON.stringify(record));
  db.prepare(
    "INSERT OR REPLACE INTO local_store (slot, key, content, updated_at) VALUES ('dream', 'session-count', ?, datetime('now'))"
  ).run(JSON.stringify({ count: 0 }));

  const historyRow = db.prepare("SELECT content FROM local_store WHERE slot='dream' AND key='history'").get();
  let history = historyRow ? JSON.parse(historyRow.content) : [];
  history.push(record);
  if (history.length > 30) history = history.slice(-30);
  db.prepare(
    "INSERT OR REPLACE INTO local_store (slot, key, content, updated_at) VALUES ('dream', 'history', ?, datetime('now'))"
  ).run(JSON.stringify(history));

  console.log('\n═══════════════════════════════════════');
  console.log(`💤 Dream Applied: +${lessonsAdded} lessons, -${staleRemoved} stale, ${mergesDone} merges`);
  console.log(`  ${record.summary}`);
  console.log('═══════════════════════════════════════');
  db.close();
  process.exit(0);
}

// ═══════════════════════════════════════════════
// bump — compress 后调用，session count +1
// ═══════════════════════════════════════════════

if (cmd === 'bump') {
  const row = db.prepare("SELECT content FROM local_store WHERE slot='dream' AND key='session-count'").get();
  let count = row ? JSON.parse(row.content).count : 0;
  count++;
  db.prepare(
    "INSERT OR REPLACE INTO local_store (slot, key, content, updated_at) VALUES ('dream', 'session-count', ?, datetime('now'))"
  ).run(JSON.stringify({ count }));
  console.log(`Session count bumped to ${count}`);
  db.close();
  process.exit(0);
}


// ═══════════════════════════════════════════════
// sync-forged — 把散装 lessons 合并进 forged experience dialogue
// ═══════════════════════════════════════════════

if (cmd === 'sync-forged') {
  // 1. 读所有 forged/lesson-*
  const lessons = db.prepare("SELECT key, content FROM memory WHERE slot='forged' AND key LIKE 'lesson-%' ORDER BY key").all();
  if (!lessons.length) { console.log('No forged lessons to sync'); db.close(); process.exit(0); }

  // 2. 读 forged experience dialogue
  const row = db.prepare("SELECT content FROM memory WHERE slot='toolkit' AND key='_forged:experience-dialogues'").get();
  if (!row) { console.log('Forged dialogue not found'); db.close(); process.exit(1); }
  const dialogue = JSON.parse(row.content);
  const msg1 = dialogue[1].content;

  // 3. 提取现有 LESSONS LEARNED
  const marker = '=== LESSONS LEARNED ===';
  const idx = msg1.indexOf(marker);
  if (idx === -1) { console.log('LESSONS LEARNED section not found'); db.close(); process.exit(1); }
  const existingSection = msg1.substring(idx);
  const existingLines = existingSection.split('\n').filter(l => l.startsWith('WRONG:'));

  // 4. 找出新的（不重复的）
  let added = 0;
  let newSection = existingSection;
  for (const l of lessons) {
    const content = l.content;
    // 检查是否已存在（用前30字符匹配）
    const snippet = content.substring(0, 30);
    if (!existingSection.includes(snippet)) {
      newSection += '\n' + content;
      console.log('  + ' + l.key + ': ' + content.substring(0, 80));
      added++;
    } else {
      console.log('  = ' + l.key + ': already exists');
    }
  }

  if (added === 0) { console.log('All lessons already in forged dialogue'); db.close(); process.exit(0); }

  // 5. 写回
  dialogue[1].content = msg1.substring(0, idx) + newSection;
  db.prepare("UPDATE memory SET content=?, updated_at=datetime('now') WHERE slot='toolkit' AND key='_forged:experience-dialogues'")
    .run(JSON.stringify(dialogue));
  console.log('\nSynced: ' + added + ' new lessons into forged dialogue (' + dialogue[1].content.length + ' chars)');
  db.close();
  process.exit(0);
}

console.log('Usage: node dream.cjs <prepare|apply|status|history|bump> [--force]');
db.close();
