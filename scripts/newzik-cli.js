#!/usr/bin/env node
/**
 * Newzik CLI - 全自动乐谱处理工具
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SECRETS_FILE = path.join(process.env.HOME, '.agent_secrets');
const API_BASE = 'https://prod.newzik.com';

function generateUUID() {
  return crypto.randomUUID().toUpperCase();
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

async function api(endpoint, options = {}) {
  const secrets = loadSecrets();
  const token = secrets.NEWZIK_ACCESS_TOKEN;
  
  if (!token) {
    console.error('No token. Run: node newzik-auth.js');
    process.exit(1);
  }
  
  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'x-nz-product': 'com.syncsing.Newzik4',
      'Accept': 'application/json',
      'Origin': 'https://web.newzik.com',
      ...options.headers
    }
  });
  
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text.substring(0, 200)}`);
  }
  
  return res;
}

// 上传文件
async function uploadFile(filePath) {
  const secrets = loadSecrets();
  const token = secrets.NEWZIK_ACCESS_TOKEN;
  
  const fileName = path.basename(filePath);
  const title = path.basename(filePath, path.extname(filePath));
  const fileBuffer = fs.readFileSync(filePath);
  
  const fileUuid = generateUUID();
  const pieceUuid = generateUUID();
  const partUuid = generateUUID();
  const pageUuid = generateUUID();
  
  console.log(`Uploading: ${fileName}`);
  
  // 1. 上传文件数据
  console.log('  [1/3] Uploading file data...');
  const formData = new FormData();
  formData.append('data', new Blob([fileBuffer]), fileName);
  
  const uploadRes = await fetch(`${API_BASE}/ws3/file/data/${fileUuid}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'x-nz-product': 'com.syncsing.Newzik4',
      'Origin': 'https://web.newzik.com'
    },
    body: formData
  });
  
  if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.status}`);
  console.log('  ✓ File uploaded');
  
  // 2. 创建乐谱元数据
  console.log('  [2/3] Creating piece metadata...');
  const now = new Date().toISOString();
  const pdfName = fileName.endsWith('.pdf') ? fileName : `${title}.pdf`;
  
  const metadata = {
    uuid: pieceUuid,
    title: title,
    composer: '',
    cdate: now,
    mdate: now,
    favorite: false,
    files: [{
      uuid: fileUuid,
      song: pieceUuid,
      data: fileUuid,
      name: pdfName,
      cdate: now,
      mdate: now,
      display: true,
      sound: false
    }],
    versions: [{
      uuid: partUuid,
      song: pieceUuid,
      name: title,
      displayFile: fileUuid,
      instrument: '',
      instrumentVariant: '',
      customInstrument: '',
      customInstrumentVariant: '',
      tonality: 0,
      volume: 1.0,
      sortOrder: 0,
      cdate: now,
      mdate: now,
      pageSettings: [{
        uuid: pageUuid,
        part: partUuid,
        pageId: 0,
        pageNbr: 1,
        displayIndex: 0,
        cropScale: 1.0,
        cropOffsetX: 0.0,
        cropOffsetY: 0.0,
        rotation: 0.0,
        uncount: false
      }],
      annotationLayers: [],
      bookmarks: []
    }],
    versionFiles: [{
      version: partUuid,
      file: fileUuid,
      cdate: now,
      mdate: now
    }]
  };
  
  const metaRes = await fetch(`${API_BASE}/ws3/song/${pieceUuid}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'x-nz-product': 'com.syncsing.Newzik4',
      'Content-Type': 'application/json; charset=UTF-8',
      'Accept': 'application/json',
      'Origin': 'https://web.newzik.com'
    },
    body: JSON.stringify(metadata)
  });
  
  if (!metaRes.ok) {
    const errText = await metaRes.text();
    throw new Error(`Metadata failed: ${metaRes.status} - ${errText.substring(0, 200)}`);
  }
  console.log('  ✓ Piece created');
  
  // 3. 设置当前版本
  console.log('  [3/3] Setting current version...');
  await fetch(`${API_BASE}/ws2/version/current?song=${pieceUuid}&version=${partUuid}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'x-nz-product': 'com.syncsing.Newzik4',
      'Origin': 'https://web.newzik.com'
    }
  });
  console.log('  ✓ Version set');
  
  console.log(`\n✓ Uploaded: ${title}`);
  console.log(`  Piece: ${pieceUuid}`);
  console.log(`  Part: ${partUuid}`);
  
  return { pieceUuid, partUuid, fileUuid, title };
}

async function uploadDir(dirPath) {
  const files = fs.readdirSync(dirPath)
    .filter(f => f.toLowerCase().endsWith('.pdf'))
    .map(f => path.join(dirPath, f));
  
  if (files.length === 0) { console.log('No PDF files'); return []; }
  
  console.log(`Found ${files.length} PDFs\n`);
  const results = [];
  
  for (const file of files) {
    try {
      results.push(await uploadFile(file));
    } catch (e) {
      console.error(`Failed: ${path.basename(file)} - ${e.message}`);
    }
    console.log();
  }
  
  console.log(`Uploaded ${results.length}/${files.length}`);
  return results;
}

async function listPieces() {
  const secrets = loadSecrets();
  const userUuid = secrets.NEWZIK_USER_UUID;
  if (!userUuid) { console.error('No user UUID'); process.exit(1); }
  
  console.log('Fetching pieces...\n');
  const res = await api(`/ws4/musicians/${userUuid}/pieces`);
  const data = await res.json();
  
  const pieces = Object.values(data.pieces || {});
  console.log(`Found ${pieces.length} pieces:\n`);
  
  pieces.forEach((p, i) => {
    console.log(`${i + 1}. ${p.title}`);
    console.log(`   Piece: ${p.uuid}`);
    if (p.parts) p.parts.forEach(pt => console.log(`   Part: ${pt}`));
    console.log();
  });
  
  return pieces;
}

async function getPieceDetails(pieceUuid) {
  const res = await api(`/ws4/pieces/${pieceUuid}/flattened?livescore-configs=true&media-configs=true&user-parts=true`);
  return res.json();
}

async function submitOmrAndWait(partUuid) {
  console.log(`  Submitting OMR...`);
  
  const submitRes = await api(`/ws4/omr/part/${partUuid}/submit`, {
    method: 'POST',
    headers: { 'Content-Length': '0' }
  });
  
  let status = 'processing';
  let attempts = 0;
  
  while (status !== 'completed' && status !== 'failed' && attempts < 120) {
    await new Promise(r => setTimeout(r, 5000));
    attempts++;
    
    try {
      const res = await api(`/ws4/omr/part/${partUuid}/jobs/latest`);
      const data = await res.json();
      status = data.status;
      const progress = data.progress || 0;
      process.stdout.write(`\r  OMR: ${status} ${progress.toFixed(0)}% (${attempts * 5}s)    `);
    } catch (e) {}
  }
  
  console.log();
  
  if (status === 'completed') {
    console.log('  ✓ OMR completed');
    return true;
  }
  console.log(`  ✗ OMR failed: ${status}`);
  return false;
}

// 下载 MusicXML - 修复: API 返回 JSON with URL
async function downloadMusicXml(partUuid, outputPath) {
  console.log('  Downloading MusicXML...');
  
  // 获取下载 URL
  const res = await api(`/ws4/omr/part/${partUuid}/jobs/latest/output/xml`, {
    headers: { 'Accept': 'application/xml, application/json, */*' }
  });
  
  const data = await res.json();
  
  if (!data.url) {
    throw new Error('No download URL in response');
  }
  
  // 从 S3 下载实际文件
  const xmlRes = await fetch(data.url);
  if (!xmlRes.ok) throw new Error(`Download failed: ${xmlRes.status}`);
  
  const xml = await xmlRes.text();
  
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  
  fs.writeFileSync(outputPath, xml);
  console.log(`  ✓ Saved: ${outputPath}`);
  return outputPath;
}

async function downloadPiece(pieceUuid, outputDir = '.') {
  console.log(`Fetching: ${pieceUuid}`);
  
  const res = await api(`/ws3/song/full/full-subentities/${pieceUuid}`);
  const data = await res.json();
  
  const title = data.title || 'Untitled';
  const safeTitle = title.replace(/[/\\?%*:|"<>]/g, '_');
  
  const displayFile = data.files?.find(f => f.display);
  if (!displayFile) { console.log('  No file'); return null; }
  
  const urlRes = await api(`/ws3/file/data/download-url/${displayFile.data}`);
  const urlData = await urlRes.json();
  
  if (!urlData.downloadUrl) { console.log('  No URL'); return null; }
  
  const fileRes = await fetch(urlData.downloadUrl);
  const buffer = await fileRes.arrayBuffer();
  
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  
  const filePath = path.join(outputDir, `${safeTitle}.pdf`);
  fs.writeFileSync(filePath, Buffer.from(buffer));
  console.log(`  ✓ Saved: ${filePath}`);
  return filePath;
}

async function downloadAll(outputDir = './newzik-scores') {
  const pieces = await listPieces();
  console.log(`\nDownloading to ${outputDir}...\n`);
  
  let ok = 0;
  for (const p of pieces) {
    try { await downloadPiece(p.uuid, outputDir); ok++; }
    catch (e) { console.log(`  ✗ ${p.title}: ${e.message}`); }
  }
  console.log(`\n✓ Downloaded: ${ok}/${pieces.length}`);
}

async function omrPart(partUuid, outputDir = '.') {
  if (await submitOmrAndWait(partUuid)) {
    await downloadMusicXml(partUuid, path.join(outputDir, `${partUuid}.musicxml`));
  }
}

async function omrAll(outputDir = './newzik-musicxml') {
  const pieces = await listPieces();
  console.log(`\nProcessing OMR...\n`);
  
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  
  let ok = 0, fail = 0;
  
  for (const p of pieces) {
    const title = (p.title || 'Untitled').replace(/[/\\?%*:|"<>]/g, '_');
    if (!p.parts?.length) { console.log(`Skip ${title}: no parts`); continue; }
    
    console.log(`\nProcessing: ${title}`);
    
    try {
      if (await submitOmrAndWait(p.parts[0])) {
        await downloadMusicXml(p.parts[0], path.join(outputDir, `${title}.musicxml`));
        ok++;
      } else fail++;
    } catch (e) {
      console.log(`  ✗ ${e.message}`);
      fail++;
    }
  }
  
  console.log(`\n✓ Done: ${ok} ok, ${fail} failed`);
}

// 全流程: PDF → 上传 → OMR → MusicXML
async function convertPdf(pdfPath, outputDir = '.') {
  console.log(`\n=== Converting: ${path.basename(pdfPath)} ===\n`);
  
  const { pieceUuid, partUuid, title } = await uploadFile(pdfPath);
  
  console.log('\nWaiting for server...');
  await new Promise(r => setTimeout(r, 3000));
  
  console.log('\nStarting OMR...');
  if (!await submitOmrAndWait(partUuid)) {
    console.log('OMR failed');
    return null;
  }
  
  const safeTitle = title.replace(/[/\\?%*:|"<>]/g, '_');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  
  const outputPath = path.join(outputDir, `${safeTitle}.musicxml`);
  await downloadMusicXml(partUuid, outputPath);
  
  console.log(`\n✓ Done: ${outputPath}`);
  return outputPath;
}

async function convertDir(dirPath, outputDir = './musicxml-output') {
  const files = fs.readdirSync(dirPath)
    .filter(f => f.toLowerCase().endsWith('.pdf'))
    .map(f => path.join(dirPath, f));
  
  if (!files.length) { console.log('No PDFs'); return; }
  
  console.log(`\n=== Batch: ${files.length} files ===\n`);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  
  let ok = 0, fail = 0;
  
  for (const f of files) {
    try {
      if (await convertPdf(f, outputDir)) ok++;
      else fail++;
    } catch (e) {
      console.error(`\n✗ ${path.basename(f)}: ${e.message}`);
      fail++;
    }
    console.log('\n' + '='.repeat(40));
  }
  
  console.log(`\n✓ Batch: ${ok} ok, ${fail} failed`);
}

function showHelp() {
  console.log(`
Newzik CLI - PDF to MusicXML 全自动转换

命令:
  list                      列出乐谱
  upload <pdf>              上传 PDF
  upload-dir <dir>          批量上传
  download <piece_uuid>     下载 PDF
  download-all [dir]        下载全部 PDF
  omr <part_uuid>           OMR 转换
  omr-all [dir]             批量 OMR
  convert <pdf> [out]       全流程转换
  convert-dir <dir> [out]   批量全流程

示例:
  node newzik-cli.js convert score.pdf ./output
  node newzik-cli.js convert-dir ./pdfs ./musicxml
`);
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  
  if (!cmd || cmd === 'help') { showHelp(); return; }
  
  try {
    switch (cmd) {
      case 'list': await listPieces(); break;
      case 'upload': await uploadFile(args[1]); break;
      case 'upload-dir': await uploadDir(args[1]); break;
      case 'download': await downloadPiece(args[1], args[2] || '.'); break;
      case 'download-all': await downloadAll(args[1]); break;
      case 'omr': await omrPart(args[1], args[2] || '.'); break;
      case 'omr-all': await omrAll(args[1]); break;
      case 'convert': await convertPdf(args[1], args[2] || '.'); break;
      case 'convert-dir': await convertDir(args[1], args[2]); break;
      default: console.error(`Unknown: ${cmd}`); showHelp();
    }
  } catch (e) {
    console.error('\nError:', e.message);
    process.exit(1);
  }
}

main();
