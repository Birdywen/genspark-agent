// core/artifact-store.js — Omega v4.4 lossless tool output storage
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, chmodSync } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const BASE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'artifacts');
const DEFAULT_INLINE = Number(process.env.OMEGA_OUTPUT_INLINE_LIMIT || 20000);
const HARD_INLINE = Number(process.env.OMEGA_OUTPUT_HARD_LIMIT || 200000);

function ensureDir() {
  mkdirSync(BASE_DIR, { recursive: true, mode: 0o700 });
  try { chmodSync(BASE_DIR, 0o700); } catch (_) {}
}

function normalizePolicy(raw = {}) {
  if (typeof raw === 'string') raw = { mode: raw };
  const mode = ['auto', 'full', 'preview', 'artifact'].includes(raw?.mode) ? raw.mode : 'auto';
  return {
    mode,
    inlineLimit: Math.max(1000, Number(raw?.inlineLimit || DEFAULT_INLINE)),
    hardLimit: Math.max(10000, Number(raw?.hardLimit || HARD_INLINE)),
    headLines: Math.max(1, Number(raw?.headLines || 40)),
    tailLines: Math.max(1, Number(raw?.tailLines || 80)),
    persist: raw?.persist === true
  };
}

function previewText(text, policy) {
  if (!text) return '';
  const lines = text.split('\n');
  const head = lines.slice(0, policy.headLines).join('\n');
  const tail = lines.slice(-policy.tailLines).join('\n');
  const omitted = Math.max(0, lines.length - policy.headLines - policy.tailLines);
  let preview = head + `\n\n[... ${omitted} lines omitted; full output preserved ...]\n\n` + tail;
  if (preview.length > policy.inlineLimit) {
    const half = Math.max(400, Math.floor((policy.inlineLimit - 160) / 2));
    preview = text.slice(0, half) + `\n\n[... ${text.length - half * 2} chars omitted; full output preserved ...]\n\n` + text.slice(-half);
  }
  return preview;
}

function buildId(combined) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const hash = crypto.createHash('sha256').update(combined).digest('hex');
  return { id: `${stamp}-${hash.slice(0, 16)}`, hash };
}

function createArtifact({ stdout = '', stderr = '', metadata = {} }) {
  ensureDir();
  const combined = (stdout + stderr).trim();
  const { id, hash } = buildId(combined);
  const files = { stdout: `${id}.stdout.txt`, stderr: `${id}.stderr.txt`, combined: `${id}.combined.txt` };
  for (const [stream, file] of Object.entries(files)) {
    const value = stream === 'stdout' ? stdout : stream === 'stderr' ? stderr : combined;
    const target = path.join(BASE_DIR, file);
    if (!existsSync(target)) writeFileSync(target, value, { encoding: 'utf8', mode: 0o600 });
    try { chmodSync(target, 0o600); } catch (_) {}
  }
  const meta = {
    version: 1, id, createdAt: new Date().toISOString(), sha256: hash,
    bytes: Buffer.byteLength(combined), chars: combined.length,
    lines: combined ? combined.split('\n').length : 0,
    streams: {
      stdout: { bytes: Buffer.byteLength(stdout), chars: stdout.length, ref: `artifact://${id}/stdout` },
      stderr: { bytes: Buffer.byteLength(stderr), chars: stderr.length, ref: `artifact://${id}/stderr` },
      combined: { bytes: Buffer.byteLength(combined), chars: combined.length, ref: `artifact://${id}/combined` }
    },
    metadata
  };
  writeFileSync(path.join(BASE_DIR, `${id}.json`), JSON.stringify(meta, null, 2), { encoding: 'utf8', mode: 0o600 });
  return meta;
}

function parseRef(ref) {
  const m = String(ref || '').match(/^artifact:\/\/([0-9A-Za-z-]+)\/(stdout|stderr|combined)$/);
  if (!m) throw new Error('Invalid artifact ref');
  return { id: m[1], stream: m[2] };
}

function pathsFor(ref) {
  ensureDir();
  const { id, stream } = parseRef(ref);
  return { id, stream, file: path.join(BASE_DIR, `${id}.${stream}.txt`), meta: path.join(BASE_DIR, `${id}.json`) };
}

function info(ref) {
  const p = pathsFor(ref);
  if (!existsSync(p.meta) || !existsSync(p.file)) throw new Error('Artifact not found');
  return JSON.parse(readFileSync(p.meta, 'utf8'));
}

function read(ref, options = {}) {
  const p = pathsFor(ref);
  if (!existsSync(p.file)) throw new Error('Artifact not found');
  const text = readFileSync(p.file, 'utf8');
  if (options.startLine !== undefined) {
    const start = Math.max(0, Number(options.startLine) || 0);
    const count = Math.min(10000, Math.max(1, Number(options.lineCount) || 200));
    const lines = text.split('\n');
    return { content: lines.slice(start, start + count).join('\n'), startLine: start, lineCount: Math.min(count, Math.max(0, lines.length - start)), totalLines: lines.length, complete: start + count >= lines.length };
  }
  const offset = Math.max(0, Number(options.offset) || 0);
  const requested = options.full === true ? text.length : Number(options.limit) || 20000;
  const limit = Math.min(200000, Math.max(1, requested));
  return { content: text.slice(offset, offset + limit), offset, chars: Math.min(limit, Math.max(0, text.length - offset)), totalChars: text.length, complete: offset + limit >= text.length, nextOffset: offset + limit < text.length ? offset + limit : null };
}

function search(ref, options = {}) {
  const p = pathsFor(ref);
  if (!existsSync(p.file)) throw new Error('Artifact not found');
  const text = readFileSync(p.file, 'utf8');
  const pattern = String(options.regex || options.query || '');
  if (!pattern) throw new Error('artifact_search requires regex or query');
  const flags = String(options.flags || 'gi').replace(/[^gimsuy]/g, '');
  const re = new RegExp(pattern, flags.includes('g') ? flags : flags + 'g');
  const context = Math.min(2000, Math.max(0, Number(options.contextChars) || 200));
  const maxMatches = Math.min(200, Math.max(1, Number(options.maxMatches) || 50));
  const matches = [];
  let m;
  while ((m = re.exec(text)) && matches.length < maxMatches) {
    matches.push({ index: m.index, match: m[0], context: text.slice(Math.max(0, m.index - context), Math.min(text.length, m.index + m[0].length + context)) });
    if (m[0] === '') re.lastIndex++;
  }
  return { ref, pattern, matches, count: matches.length, limited: matches.length >= maxMatches };
}

function formatOutput(stdout, stderr, rawPolicy) {
  const policy = normalizePolicy(rawPolicy);
  const combined = (stdout + stderr).trim();
  const chars = combined.length;
  const shouldPersist = policy.persist || policy.mode === 'artifact' || policy.mode === 'preview' || chars > policy.inlineLimit;
  const artifact = shouldPersist ? createArtifact({ stdout, stderr, metadata: { outputMode: policy.mode } }) : null;
  let display = combined;
  let truncated = false;
  if (policy.mode === 'artifact') {
    display = `[full output preserved: ${artifact.streams.combined.ref}; ${artifact.chars} chars, ${artifact.lines} lines, sha256=${artifact.sha256}]`;
    truncated = chars > 0;
  } else if (policy.mode === 'preview' || (policy.mode === 'auto' && chars > policy.inlineLimit) || (policy.mode === 'full' && chars > policy.hardLimit)) {
    display = previewText(combined, policy);
    truncated = display !== combined;
  }
  return {
    policy, display, truncated, artifact,
    fullOutputRef: artifact?.streams?.combined?.ref || null,
    stats: { chars, bytes: Buffer.byteLength(combined), lines: combined ? combined.split('\n').length : 0 }
  };
}

export { BASE_DIR, normalizePolicy, previewText, createArtifact, formatOutput, read, search, info };
export default { normalizePolicy, previewText, createArtifact, formatOutput, read, search, info };
