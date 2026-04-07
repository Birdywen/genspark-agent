#!/usr/bin/env node
/**
 * Learn-from-Failures Agent
 * Scans commands table for fail→success pairs,
 * uses ask_ai to summarize lessons,
 * writes to memory forged/* slots automatically.
 * 
 * Usage: node learn-from-failures.js [--since 2026-03-30] [--dry-run] [--limit 20]
 */

const Database = require('better-sqlite3');
const path = require('path');
const { execSync } = require('child_process');

const DB_PATH = path.join(__dirname, '..', 'data', 'agent.db');
const db = new Database(DB_PATH);

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const sinceIdx = args.indexOf('--since');
const since = sinceIdx >= 0 ? args[sinceIdx + 1] : new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 30;

console.log(`🔍 Scanning failures since ${since} (dry-run: ${dryRun})\n`);

// Step 1: Find fail→success pairs
const pairs = db.prepare(`
  SELECT 
    a.id as fail_id,
    b.id as fix_id,
    a.tool,
    a.timestamp as fail_time,
    substr(a.params, 1, 500) as fail_params,
    substr(a.result_preview, 1, 300) as fail_result,
    substr(a.error, 1, 300) as fail_error,
    substr(b.params, 1, 500) as fix_params,
    substr(b.result_preview, 1, 300) as fix_result
  FROM commands a
  JOIN commands b ON b.id > a.id AND b.id <= a.id + 8
    AND b.tool = a.tool AND b.success = 1
  WHERE a.success = 0 
    AND a.timestamp >= ?
    AND a.tool IN ('run_process', 'edit_file', 'eval_js', 'ask_ai', 'wechat', 'write_file')
  ORDER BY a.id DESC
  LIMIT ?
`).all(since, limit);

console.log(`Found ${pairs.length} fail→success pairs\n`);

if (pairs.length === 0) {
  console.log('No failures to learn from. Good job!');
  process.exit(0);
}

// Step 2: Deduplicate by fail_id (keep closest fix)
const seen = new Set();
const unique = [];
for (const p of pairs) {
  if (!seen.has(p.fail_id)) {
    seen.add(p.fail_id);
    unique.push(p);
  }
}
console.log(`${unique.length} unique failures after dedup\n`);

// Step 3: Group by error pattern
function errorKey(p) {
  const err = p.fail_result || p.fail_error || '';
  // Extract key error pattern
  const patterns = [
    /ModuleNotFoundError: No module named '([^']+)'/,
    /NameError: name '([^']+)'/,
    /no such column: (\w+)/,
    /ENOENT.*'([^']+)'/,
    /Permission denied/,
    /timeout/i,
    /not enough values to unpack/,
    /SyntaxError/,
    /ValueError/,
    /TypeError/,
  ];
  for (const re of patterns) {
    const m = err.match(re);
    if (m) return m[0];
  }
  return err.slice(0, 60);
}

const grouped = {};
for (const p of unique) {
  const key = errorKey(p);
  if (!grouped[key]) grouped[key] = [];
  grouped[key].push(p);
}

console.log(`${Object.keys(grouped).length} error patterns:\n`);
for (const [key, items] of Object.entries(grouped)) {
  console.log(`  [${items.length}x] ${key}`);
}
console.log();

// Step 4: Generate lessons via ask_ai
async function askAI(prompt) {
  // Use the sys-tool ask_ai via HTTP
  const resp = await fetch('http://localhost:8766/api/tool', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tool: 'ask_ai',
      params: {
        prompt,
        model: 'gemini-3-flash-preview'
      }
    })
  });
  const data = await resp.json();
  return data.result || data.error || 'no response';
}

async function generateLessons() {
  const lessons = [];
  
  for (const [errorPattern, items] of Object.entries(grouped)) {
    const example = items[0];
    const prompt = `You are an AI agent experience summarizer. Analyze this failure→fix pair and extract a concise lesson.

Tool: ${example.tool}
Failed command: ${example.fail_params}
Error: ${example.fail_result || example.fail_error}
Fix command: ${example.fix_params}
Fix result: ${example.fix_result}
Occurrences: ${items.length}x

Respond in this EXACT format (Chinese, max 2 lines):
WRONG: [what was wrong]
CORRECT: [what fixed it]

Be specific and actionable. No fluff.`;

    console.log(`🤖 Analyzing: ${errorPattern.slice(0, 60)}...`);
    
    if (dryRun) {
      console.log(`  [DRY RUN] Would call ask_ai\n`);
      lessons.push({ pattern: errorPattern, lesson: '[dry-run]', count: items.length });
      continue;
    }
    
    try {
      const lesson = await askAI(prompt);
      console.log(`  → ${lesson.slice(0, 150)}\n`);
      lessons.push({ pattern: errorPattern, lesson, count: items.length });
    } catch (e) {
      console.log(`  ✗ Error: ${e.message}\n`);
    }
  }
  
  return lessons;
}

async function writeLessons(lessons) {
  if (dryRun) {
    console.log('\n📝 [DRY RUN] Would write these lessons to memory forged/* slots');
    return;
  }
  
  // Combine all lessons into one entry
  const today = new Date().toISOString().slice(0, 10);
  const content = lessons
    .filter(l => l.lesson !== '[dry-run]')
    .map(l => `[${l.count}x] ${l.pattern}\n${l.lesson}`)
    .join('\n\n');
  
  if (!content) {
    console.log('No lessons to write.');
    return;
  }
  
  // Write to memory
  const slot = 'forged';
  const key = `auto-lesson-${today}`;
  
  // Check if today's entry exists
  const existing = db.prepare(
    "SELECT content FROM memory WHERE slot = ? AND key = ?"
  ).get(slot, key);
  
  const finalContent = existing 
    ? existing.content + '\n\n' + content 
    : `=== Auto-learned lessons ${today} ===\n\n${content}`;
  
  db.prepare(
    "INSERT OR REPLACE INTO memory (slot, key, content, updated_at) VALUES (?, ?, ?, datetime('now'))"
  ).run(slot, key, finalContent);
  
  console.log(`\n✅ Written ${lessons.length} lessons to memory/${slot}/${key}`);
  console.log(`Content (${finalContent.length} chars):`);
  console.log(finalContent.slice(0, 500));
}

// Main
(async () => {
  const lessons = await generateLessons();
  await writeLessons(lessons);
  console.log('\n🏁 Done.');
  db.close();
})();
