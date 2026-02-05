#!/usr/bin/env node
/**
 * Newzik OMR 实时监控
 * 用法: node watch.js [间隔秒数]
 */

const fs = require('fs');
const path = require('path');

const SECRETS_FILE = path.join(process.env.HOME, '.agent_secrets');
const API_BASE = 'https://prod.newzik.com';
const STATE_FILE = path.join(__dirname, 'state.json');
const OUTPUT_DIR = path.join(__dirname, 'converted');

function loadSecrets() {
  const content = fs.readFileSync(SECRETS_FILE, 'utf-8');
  const secrets = {};
  content.split('\n').forEach(line => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match) secrets[match[1]] = match[2];
  });
  return secrets;
}

const secrets = loadSecrets();
const TOKEN = secrets.NEWZIK_ACCESS_TOKEN;

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')); }
  catch { return { completed: [], processing: {} }; }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function api(endpoint, options = {}) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'x-nz-product': 'com.syncsing.Newzik4',
      'Accept': 'application/json',
      'Origin': 'https://web.newzik.com',
      ...options.headers
    }
  });
  return res;
}

async function checkOmrStatus(partUuid) {
  try {
    const res = await api(`/ws4/omr/part/${partUuid}/jobs/latest`);
    if (!res.ok) return { status: 'not_started' };
    return res.json();
  } catch { return { status: 'error' }; }
}

async function downloadMusicXml(partUuid, title) {
  const res = await api(`/ws4/omr/part/${partUuid}/jobs/latest/output/xml`);
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.url) return null;
  
  const xmlRes = await fetch(data.url);
  const xml = await xmlRes.text();
  
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const safeTitle = title.replace(/[/\\?%*:|"<>]/g, '_');
  const outPath = path.join(OUTPUT_DIR, `${safeTitle}.musicxml`);
  fs.writeFileSync(outPath, xml);
  return outPath;
}

async function submitOmr(partUuid) {
  const res = await api(`/ws4/omr/part/${partUuid}/submit`, { method: 'POST', headers: { 'Content-Length': '0' } });
  return res.ok ? 'ok' : (res.status === 429 ? 'rate_limited' : 'failed');
}

function clearScreen() {
  process.stdout.write('\x1B[2J\x1B[0f');
}

function formatTime() {
  return new Date().toLocaleTimeString();
}

async function monitor(interval = 10) {
  console.log('Newzik OMR 实时监控 (Ctrl+C 退出)\n');
  
  let lastCompleted = 0;
  
  while (true) {
    const state = loadState();
    const items = Object.entries(state.processing).sort((a, b) => a[0].localeCompare(b[0]));
    
    clearScreen();
    console.log(`\x1B[1m=== Newzik OMR 监控 === ${formatTime()}\x1B[0m\n`);
    console.log(`已完成: \x1B[32m${state.completed.length}\x1B[0m  处理中: \x1B[33m${items.length}\x1B[0m\n`);
    
    if (items.length === 0) {
      console.log('\x1B[32m全部完成！\x1B[0m');
      console.log(`\nMusicXML 文件在: ${OUTPUT_DIR}`);
      break;
    }
    
    let completed = 0, processing = 0, notStarted = 0, failed = 0;
    let newlyCompleted = [];
    
    for (const [title, partUuid] of items) {
      const status = await checkOmrStatus(partUuid);
      const s = status.status || 'unknown';
      const progress = status.progress || 0;
      
      let icon, color;
      if (s === 'completed') {
        icon = '✓'; color = '\x1B[32m'; completed++;
        
        // 自动下载
        console.log(`${color}${icon} ${title}: 下载中...\x1B[0m`);
        const outPath = await downloadMusicXml(partUuid, title);
        if (outPath) {
          state.completed.push(title);
          delete state.processing[title];
          newlyCompleted.push(title);
        }
      } else if (s === 'processing') {
        icon = '⏳'; color = '\x1B[33m'; processing++;
        const bar = '█'.repeat(Math.floor(progress / 5)) + '░'.repeat(20 - Math.floor(progress / 5));
        console.log(`${color}${icon} ${title}: ${bar} ${progress.toFixed(0)}%\x1B[0m`);
      } else if (s === 'failed') {
        icon = '✗'; color = '\x1B[31m'; failed++;
        console.log(`${color}${icon} ${title}: 失败\x1B[0m`);
      } else {
        icon = '○'; color = '\x1B[90m'; notStarted++;
        console.log(`${color}${icon} ${title}: 等待中\x1B[0m`);
      }
    }
    
    // 保存状态
    if (newlyCompleted.length > 0) {
      saveState(state);
    }
    
    console.log(`\n统计: \x1B[32m完成=${completed}\x1B[0m \x1B[33m处理中=${processing}\x1B[0m \x1B[90m等待=${notStarted}\x1B[0m \x1B[31m失败=${failed}\x1B[0m`);
    
    // 如果有未开始的且处理中少于 8 个，尝试提交
    if (notStarted > 0 && processing < 8) {
      const toSubmit = items.filter(([_, uuid]) => {
        // 这里简化处理，实际需要检查状态
        return true;
      }).slice(0, 3);
      
      console.log(`\n尝试提交更多任务...`);
      for (const [title, partUuid] of items) {
        const st = await checkOmrStatus(partUuid);
        if (st.status === 'not_started' || !st.status) {
          const result = await submitOmr(partUuid);
          if (result === 'ok') {
            console.log(`  ✓ 已提交: ${title}`);
          } else if (result === 'rate_limited') {
            console.log(`  ⚠ 速率限制`);
            break;
          }
        }
      }
    }
    
    console.log(`\n下次刷新: ${interval}秒后...`);
    await new Promise(r => setTimeout(r, interval * 1000));
  }
}

const interval = parseInt(process.argv[2]) || 10;
monitor(interval).catch(console.error);
