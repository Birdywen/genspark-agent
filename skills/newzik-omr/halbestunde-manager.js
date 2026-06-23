#!/usr/bin/env node
/**
 * halbestunde-manager.js — Halbestunde OMR 全流程管理器
 *
 * 与 newzik-manager.js 对称: newzik 走 token 鉴权出残缺源+指法+坐标,
 * halbestunde 仅用 api-key (免登录) 出完整音符骨架 xml + midi/mscz/pdf。
 *
 * 用法:
 *   node halbestunde-manager.js fetch <input.pdf> [outDir] [--title NAME]
 *     一键: 上传 -> 提交OCR -> 轮询completed -> 下载全套产物 (.hbs.*)
 *   node halbestunde-manager.js download <inference_id> [outDir] [--title NAME]
 *     捷径: 已有 inference_id, 跳过上传, 直接轮询+下载
 *
 * 全链路实测打通 2026-06-03 (见 newzik-toolkit/docs/ROADMAP_dual_source.md)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const API_KEY = 'QUzVl_woTtn-uK17jUO9XlUuqeHVWZqxLImp_dy6Pak';
const BASE = 'https://app.halbestunde.com/omr-external/service-omr/v2';
const COMMON_HEADERS = {
  'accept': 'application/json',
  'api-key': API_KEY,
  'referer': 'https://app.halbestunde.com/',
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function jget(url, extra = {}) {
  const res = await fetch(url, { headers: { ...COMMON_HEADERS, ...extra } });
  if (!res.ok) throw new Error(`GET ${res.status} ${url.slice(0, 80)}`);
  return res.json();
}

// Step 1: 要 presigned PUT 位
async function getUploadSlot(pdfName) {
  const url = `${BASE}/recognize/presigned-upload?filename=${encodeURIComponent(pdfName)}`;
  const j = await jget(url);
  // -> { url (S3 PUT), filename (UUID.pdf = fileId), url_storage }
  return j;
}

// Step 2: PUT 上传 PDF 到 S3
async function putPdf(putUrl, pdfPath) {
  const buf = fs.readFileSync(pdfPath);
  const res = await fetch(putUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/pdf' },
    body: buf,
  });
  if (!res.ok) throw new Error(`PUT upload failed ${res.status}`);
  return true;
}

// Step 3: POST 提交触发 OCR -> inference_id
async function submitOcr(fileId) {
  const res = await fetch(`${BASE}/recognize/presigned-upload`, {
    method: 'POST',
    headers: { ...COMMON_HEADERS, 'content-type': 'application/json',
               'origin': 'https://app.halbestunde.com' },
    body: JSON.stringify({
      filename: fileId,
      device_hash: crypto.randomBytes(16).toString('hex'),
      uid: crypto.randomUUID(),
      pdf_image: true,
    }),
  });
  if (!res.ok) throw new Error(`submit failed ${res.status}`);
  const j = await res.json();
  return j.inference_id;
}

// Step 4: 轮询直到 completed
async function pollUntilDone(inferenceId, { timeoutSec = 300, intervalMs = 4000 } = {}) {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    const j = await jget(`${BASE}/recognize/${inferenceId}`);
    const st = j.job_status;
    process.stdout.write(`\r  OCR ${st} ${j.progress ?? ''}%   `);
    if (st === 'completed') { process.stdout.write('\n'); return j.body; }
    if (st === 'failed' || st === 'error') throw new Error(`OCR ${st}`);
    await sleep(intervalMs);
  }
  throw new Error('OCR poll timeout');
}

// Step 5+6: presigned-download -> 拿真实 url -> 下载文件
async function presignWithRetry(storageUrl, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(`${BASE}/presigned-download/?url_storage=${encodeURIComponent(storageUrl)}`,
      { headers: COMMON_HEADERS });
    const ct = res.headers.get('content-type') || '';
    if (res.ok && ct.includes('json')) return res.json();
    // 限流/错误页(返回HTML): 退避重试
    await sleep(800 * (i + 1));
  }
  throw new Error('presigned-download kept returning non-JSON (rate limit?)');
}

async function downloadResult(storageUrl, outPath) {
  if (!storageUrl) return null;
  const j = await presignWithRetry(storageUrl);
  if (!j.url) return null;
  const res = await fetch(j.url);
  if (!res.ok) throw new Error(`download failed ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outPath, buf);
  return buf.length;
}

// 下载全套产物, 按 .hbs.* 规范命名
async function downloadAll(body, outDir, title) {
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const map = {
    result_xml:         `${title}.hbs.xml`,
    result_midi:        `${title}.hbs.midi`,
    result_mscz:        `${title}.hbs.mscz`,
    result_pdf:         `${title}.hbs.pdf`,
    result_preview_pdf: `${title}.hbs.preview.pdf`,
  };
  const saved = {};
  for (const [field, fname] of Object.entries(map)) {
    try {
      const out = path.join(outDir, fname);
      const size = await downloadResult(body[field], out);
      if (size != null) { saved[field] = out; console.log(`  ✓ ${fname} (${size.toLocaleString()} bytes)`); }
      else console.log(`  - ${fname} (no source)`);
    } catch (e) { console.log(`  ⚠ ${fname}: ${e.message}`); }
    await sleep(500); // throttle between products
  }
  return saved;
}

async function cmdFetch(pdfPath, outDir, title) {
  if (!fs.existsSync(pdfPath)) throw new Error(`PDF not found: ${pdfPath}`);
  title = title || path.basename(pdfPath).replace(/\.[^.]*$/, '');
  outDir = outDir || path.dirname(pdfPath);
  const pdfName = path.basename(pdfPath);
  console.log(`[hbs] fetch: ${pdfName} -> ${outDir} (title=${title})`);
  console.log('[1] requesting upload slot...');
  const slot = await getUploadSlot(pdfName);
  console.log(`    fileId=${slot.filename}`);
  console.log('[2] uploading PDF...');
  await putPdf(slot.url, pdfPath);
  console.log('[3] submitting OCR...');
  const inferenceId = await submitOcr(slot.filename);
  console.log(`    inference_id=${inferenceId}`);
  console.log('[4] polling...');
  const body = await pollUntilDone(inferenceId);
  console.log(`[5] downloading products (page_count=${body.page_count})...`);
  const saved = await downloadAll(body, outDir, title);
  console.log('[done] hbs.xml =', saved.result_xml || 'MISSING');
  return { inferenceId, saved };
}

async function cmdDownload(inferenceId, outDir, title) {
  title = title || inferenceId.slice(0, 8);
  outDir = outDir || '.';
  console.log(`[hbs] download from inference_id=${inferenceId}`);
  const body = await pollUntilDone(inferenceId);
  return { saved: await downloadAll(body, outDir, title) };
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--title') out.title = argv[++i];
    else out._.push(argv[i]);
  }
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const a = parseArgs(argv.slice(1));
  try {
    if (cmd === 'fetch')        await cmdFetch(a._[0], a._[1], a.title);
    else if (cmd === 'download') await cmdDownload(a._[0], a._[1], a.title);
    else {
      console.log('Usage:');
      console.log('  node halbestunde-manager.js fetch <input.pdf> [outDir] [--title NAME]');
      console.log('  node halbestunde-manager.js download <inference_id> [outDir] [--title NAME]');
    }
  } catch (e) { console.error('ERROR:', e.message); process.exit(1); }
}

if (require.main === module) main();
module.exports = { cmdFetch, cmdDownload, getUploadSlot, putPdf, submitOcr, pollUntilDone, downloadResult };
