#!/usr/bin/env node
/**
 * Newzik 智能管理器 - 整合上传、OMR、下载、删除功能
 * 
 * 用法:
 *   node newzik-manager.js status           - 查看状态
 *   node newzik-manager.js upload <dir>     - 上传目录中的 PDF
 *   node newzik-manager.js submit [n]       - 提交 n 个 OMR 任务
 *   node newzik-manager.js download         - 下载已完成的 MusicXML
 *   node newzik-manager.js delete <pattern> - 删除匹配的曲目
 *   node newzik-manager.js cleanup          - 删除重复曲目
 *   node newzik-manager.js trash            - 查看回收站
 *   node newzik-manager.js purge            - 清空回收站
 *   node newzik-manager.js auto [dir]       - 自动完成全流程
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const SECRETS_FILE = path.join(process.env.HOME, '.agent_secrets');
const API_BASE = 'https://prod.newzik.com';
const OUTPUT_DIR = path.join(__dirname, 'converted');
const STATE_FILE = path.join(__dirname, 'state.json');

// ============ 工具函数 ============

function generateUUID() { return crypto.randomUUID().toUpperCase(); }

function getPdfPageCount(filePath) {
  try {
    const output = execSync(`magick identify "${filePath}" 2>/dev/null | wc -l`, { encoding: 'utf-8' });
    return parseInt(output.trim()) || 1;
  } catch {
    return 1;
  }
}

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
const USER_UUID = secrets.NEWZIK_USER_UUID;

const sleep = ms => new Promise(r => setTimeout(r, ms));

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
      'Content-Type': 'application/json; charset=UTF-8',
      'Accept': 'application/json',
      'Origin': 'https://web.newzik.com',
      ...options.headers
    }
  });
  return res;
}

// ============ API 操作 ============

async function getServerPieces() {
  const res = await api(`/ws4/musicians/${USER_UUID}/pieces`);
  if (!res.ok) return [];
  const data = await res.json();
  return Object.values(data.pieces || {});
}

async function getPieceDetail(pieceUuid) {
  const res = await api(`/ws3/song/full/full-subentities/${pieceUuid}`);
  if (!res.ok) return null;
  return res.json();
}

async function deletePieces(pieceUuids) {
  const res = await api(`/ws4/musicians/${USER_UUID}/pieces`, {
    method: 'DELETE',
    body: JSON.stringify({ pieceUuids })
  });
  return res.ok;
}

async function getRecentlyDeleted() {
  const res = await api('/ws4/recently-deleted');
  if (!res.ok) return [];
  return res.json();
}

async function purgePiece(entityUuid) {
  const res = await api(`/ws4/recently-deleted/${entityUuid}/purge`, { method: 'DELETE' });
  return res.ok;
}

async function uploadFile(filePath) {
  const fileName = path.basename(filePath);
  const title = path.basename(filePath, '.pdf');
  const fileBuffer = fs.readFileSync(filePath);
  const pageCount = getPdfPageCount(filePath);
  
  const fileUuid = generateUUID();
  const pieceUuid = generateUUID();
  const partUuid = generateUUID();
  
  // 1. 上传文件数据
  const formData = new FormData();
  formData.append('data', new Blob([fileBuffer]), fileName);
  
  const uploadRes = await fetch(`${API_BASE}/ws3/file/data/${fileUuid}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'x-nz-product': 'com.syncsing.Newzik4',
      'Origin': 'https://web.newzik.com'
    },
    body: formData
  });
  
  if (!uploadRes.ok) throw new Error('Upload failed');
  
  // 2. 创建元数据
  const now = new Date().toISOString();
  const metadata = {
    uuid: pieceUuid,
    title: title,
    composer: '',
    cdate: now, mdate: now,
    favorite: false,
    files: [{ uuid: fileUuid, song: pieceUuid, data: fileUuid, name: fileName, cdate: now, mdate: now, display: true, sound: false }],
    versions: [{
      uuid: partUuid, song: pieceUuid, name: title, displayFile: fileUuid,
      instrument: '', instrumentVariant: '', customInstrument: '', customInstrumentVariant: '',
      tonality: 0, volume: 1.0, sortOrder: 0, cdate: now, mdate: now,
      pageSettings: Array.from({ length: pageCount }, (_, i) => ({ uuid: generateUUID(), part: partUuid, pageId: i, pageNbr: i + 1, displayIndex: i, cropScale: 1.0, cropOffsetX: 0.0, cropOffsetY: 0.0, rotation: 0.0, uncount: false })),
      annotationLayers: [], bookmarks: []
    }],
    versionFiles: [{ version: partUuid, file: fileUuid, cdate: now, mdate: now }]
  };
  
  const metaRes = await fetch(`${API_BASE}/ws3/song/${pieceUuid}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'x-nz-product': 'com.syncsing.Newzik4',
      'Content-Type': 'application/json; charset=UTF-8',
      'Accept': 'application/json',
      'Origin': 'https://web.newzik.com'
    },
    body: JSON.stringify(metadata)
  });
  
  if (!metaRes.ok) throw new Error('Metadata failed');
  
  // 3. 设置版本
  await fetch(`${API_BASE}/ws2/version/current?song=${pieceUuid}&version=${partUuid}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${TOKEN}`, 'x-nz-product': 'com.syncsing.Newzik4', 'Origin': 'https://web.newzik.com' }
  });
  
  return { pieceUuid, partUuid, title };
}

async function submitOmr(partUuid) {
  const res = await api(`/ws4/omr/part/${partUuid}/submit`, { method: 'POST', headers: { 'Content-Length': '0' } });
  if (res.status === 429) return 'rate_limited';
  return res.ok ? 'submitted' : 'failed';
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

// ============ 命令实现 ============

async function cmdStatus() {
  console.log('\n获取服务器数据...');
  const pieces = await getServerPieces();
  const state = loadState();
  
  // 按标题分组找重复
  const byTitle = new Map();
  for (const p of pieces) {
    if (!byTitle.has(p.title)) byTitle.set(p.title, []);
    byTitle.get(p.title).push(p);
  }
  
  const duplicates = [...byTitle.entries()].filter(([_, v]) => v.length > 1);
  
  console.log(`\n服务器: ${pieces.length} 首曲目`);
  if (duplicates.length > 0) {
    console.log(`重复: ${duplicates.length} 个标题有重复`);
    duplicates.forEach(([title, items]) => console.log(`  - ${title} (${items.length}份)`));
  }
  
  // 检查回收站
  const trash = await getRecentlyDeleted();
  if (trash.length > 0) {
    console.log(`回收站: ${trash.length} 个待清理`);
  }
  
  console.log(`\n本地状态:`);
  console.log(`  已完成: ${state.completed.length}`);
  console.log(`  处理中: ${Object.keys(state.processing).length}`);
  
  // 检查 OMR 状态
  const processing = Object.entries(state.processing);
  if (processing.length > 0) {
    console.log('\nOMR 状态:');
    let completed = 0, inProgress = 0, notStarted = 0, failed = 0;
    
    for (const [title, partUuid] of processing) {
      const status = await checkOmrStatus(partUuid);
      const s = status.status || 'unknown';
      const progress = status.progress ? ` (${status.progress.toFixed(0)}%)` : '';
      
      let icon = '?';
      if (s === 'completed') { icon = '✓'; completed++; }
      else if (s === 'processing') { icon = '⏳'; inProgress++; }
      else if (s === 'not_started') { icon = '○'; notStarted++; }
      else if (s === 'failed') { icon = '✗'; failed++; }
      else notStarted++;
      
      console.log(`  ${icon} ${title}: ${s}${progress}`);
      await sleep(50);
    }
    
    console.log(`\n统计: 完成=${completed}, 处理中=${inProgress}, 未开始=${notStarted}, 失败=${failed}`);
  }
}

async function cmdUpload(dirPath) {
  const files = fs.readdirSync(dirPath)
    .filter(f => f.toLowerCase().endsWith('.pdf'))
    .sort();
  
  console.log(`\n找到 ${files.length} 个 PDF`);
  
  // 获取服务器已有的
  const pieces = await getServerPieces();
  const existingTitles = new Set(pieces.map(p => p.title));
  console.log(`服务器已有 ${existingTitles.size} 首`);
  
  const state = loadState();
  let uploaded = 0;
  
  for (const f of files) {
    const title = path.basename(f, '.pdf');
    
    if (existingTitles.has(title)) {
      console.log(`跳过 ${title} (已存在)`);
      continue;
    }
    
    if (state.completed.includes(title)) {
      console.log(`跳过 ${title} (已完成)`);
      continue;
    }
    
    console.log(`上传: ${title}`);
    try {
      const result = await uploadFile(path.join(dirPath, f));
      state.processing[title] = result.partUuid;
      saveState(state);
      console.log(`  ✓ Part: ${result.partUuid}`);
      uploaded++;
      await sleep(500);
    } catch (e) {
      console.log(`  ✗ ${e.message}`);
    }
  }
  
  console.log(`\n上传完成: ${uploaded}/${files.length}`);
}

async function cmdSubmit(count = 5) {
  const state = loadState();
  const items = Object.entries(state.processing);
  
  console.log(`\n尝试提交 ${count} 个 OMR 任务...\n`);
  
  let submitted = 0;
  for (const [title, partUuid] of items) {
    if (submitted >= count) break;
    
    const status = await checkOmrStatus(partUuid);
    if (status.status === 'completed' || status.status === 'processing') continue;
    
    console.log(`提交: ${title}`);
    const result = await submitOmr(partUuid);
    
    if (result === 'rate_limited') {
      console.log('  ⚠ 达到速率限制');
      break;
    } else if (result === 'submitted') {
      console.log('  ✓ 已提交');
      submitted++;
    } else {
      console.log('  ✗ 失败');
    }
    
    await sleep(1500);
  }
  
  console.log(`\n提交了 ${submitted} 个任务`);
}

async function cmdDownload() {
  const state = loadState();
  const items = Object.entries(state.processing);
  
  console.log('\n检查并下载已完成的 OMR...\n');
  
  let downloaded = 0;
  for (const [title, partUuid] of items) {
    const status = await checkOmrStatus(partUuid);
    
    if (status.status === 'completed') {
      console.log(`下载: ${title}`);
      const outPath = await downloadMusicXml(partUuid, title);
      if (outPath) {
        console.log(`  ✓ ${path.basename(outPath)}`);
        state.completed.push(title);
        delete state.processing[title];
        downloaded++;
      } else {
        console.log('  ✗ 下载失败');
      }
    }
    await sleep(100);
  }
  
  saveState(state);
  console.log(`\n下载了 ${downloaded} 个文件`);
  console.log(`剩余: ${Object.keys(state.processing).length}`);
}

async function cmdDelete(titlePattern) {
  const pieces = await getServerPieces();
  const toDelete = pieces.filter(p => p.title && p.title.includes(titlePattern));
  
  if (toDelete.length === 0) {
    console.log('未找到匹配的曲目');
    return;
  }
  
  console.log(`\n将删除 ${toDelete.length} 首:`);
  toDelete.forEach(p => console.log(`  - ${p.title}`));
  
  const ok = await deletePieces(toDelete.map(p => p.uuid));
  console.log(ok ? '\n✓ 删除成功' : '\n✗ 删除失败');
}

async function cmdCleanup() {
  const pieces = await getServerPieces();
  
  // 按标题分组
  const byTitle = new Map();
  for (const p of pieces) {
    if (!byTitle.has(p.title)) byTitle.set(p.title, []);
    byTitle.get(p.title).push(p);
  }
  
  // 找出重复的，保留最新的一个
  const toDelete = [];
  for (const [title, items] of byTitle) {
    if (items.length > 1) {
      items.sort((a, b) => new Date(b.mdate || 0) - new Date(a.mdate || 0));
      toDelete.push(...items.slice(1).map(p => p.uuid));
      console.log(`${title}: 保留1份，删除${items.length - 1}份`);
    }
  }
  
  if (toDelete.length === 0) {
    console.log('没有重复项');
    return;
  }
  
  console.log(`\n共删除 ${toDelete.length} 个重复项...`);
  const ok = await deletePieces(toDelete);
  console.log(ok ? '✓ 清理完成' : '✗ 清理失败');
}

async function cmdTrash() {
  const trash = await getRecentlyDeleted();
  
  if (trash.length === 0) {
    console.log('\n回收站为空');
    return;
  }
  
  console.log(`\n回收站: ${trash.length} 个项目\n`);
  trash.forEach(item => {
    const purgeDate = new Date(item.purgeDate).toLocaleDateString();
    console.log(`  - ${item.title || item.entityUuid} (${purgeDate} 自动清理)`);
  });
}

async function cmdPurge() {
  const trash = await getRecentlyDeleted();
  
  if (trash.length === 0) {
    console.log('\n回收站为空');
    return;
  }
  
  console.log(`\n清空回收站: ${trash.length} 个项目...\n`);
  
  let purged = 0;
  for (const item of trash) {
    const ok = await purgePiece(item.entityUuid);
    if (ok) {
      console.log(`  ✓ ${item.title || item.entityUuid}`);
      purged++;
    } else {
      console.log(`  ✗ ${item.title || item.entityUuid}`);
    }
  }
  
  console.log(`\n彻底删除: ${purged}/${trash.length}`);
}

async function cmdAuto(dirPath = './songs') {
  console.log('\n===== 自动处理流程 =====\n');
  
  // 1. 清理重复和回收站
  console.log('--- 步骤 1: 清理 ---');
  await cmdCleanup();
  await cmdPurge();
  
  // 2. 上传新文件
  console.log('\n--- 步骤 2: 上传 ---');
  await cmdUpload(dirPath);
  
  // 3. 循环: 提交 OMR -> 等待 -> 下载
  console.log('\n--- 步骤 3: OMR 转换 ---');
  for (let round = 1; round <= 30; round++) {
    console.log(`\n[第 ${round} 轮]`);
    
    // 提交任务
    await cmdSubmit(5);
    
    // 等待
    console.log('等待 30 秒...');
    await sleep(30000);
    
    // 下载
    await cmdDownload();
    
    // 检查是否完成
    const state = loadState();
    if (Object.keys(state.processing).length === 0) {
      console.log('\n✓ 全部完成！');
      break;
    }
  }
  
  console.log('\n===== 处理结束 =====');
  await cmdStatus();
}

// ============ 主程序 ============

function showHelp() {
  console.log(`
Newzik 智能管理器 - PDF 转 MusicXML 工具

用法:
  node newzik-manager.js <命令> [参数]

命令:
  status           查看服务器和本地状态
  upload <dir>     上传目录中的 PDF (默认 ./songs)
  submit [n]       提交 n 个 OMR 任务 (默认 5)
  download         下载已完成的 MusicXML
  delete <pattern> 删除标题匹配的曲目
  cleanup          删除重复曲目
  trash            查看回收站
  purge            清空回收站 (彻底删除)
  auto [dir]       自动完成全流程

示例:
  node newzik-manager.js upload ./my-scores
  node newzik-manager.js submit 10
  node newzik-manager.js auto
`);
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  
  if (!cmd || cmd === 'help' || cmd === '-h' || cmd === '--help') {
    showHelp();
    return;
  }
  
  try {
    switch (cmd) {
      case 'status': await cmdStatus(); break;
      case 'upload': await cmdUpload(args[1] || './songs'); break;
      case 'submit': await cmdSubmit(parseInt(args[1]) || 5); break;
      case 'download': await cmdDownload(); break;
      case 'delete': 
        if (!args[1]) { console.log('请指定要删除的曲目名称'); return; }
        await cmdDelete(args[1]); 
        break;
      case 'cleanup': await cmdCleanup(); break;
      case 'trash': await cmdTrash(); break;
      case 'purge': await cmdPurge(); break;
      case 'auto': await cmdAuto(args[1] || './songs'); break;
      default:
        console.log(`未知命令: ${cmd}`);
        showHelp();
    }
  } catch (e) {
    console.error('\n错误:', e.message);
    process.exit(1);
  }
}

main();
