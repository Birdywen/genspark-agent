// Filesystem Driver - 文件操作 + 写保护 + 编辑保护
// Tools: read_file, write_file, edit_file, list_dir, find_text, get_symbols

import { readFileSync, existsSync } from 'fs';
import path from 'path';

const MIME_MAP = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml', '.pdf': 'application/pdf',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.ico': 'image/x-icon', '.tiff': 'image/tiff', '.tif': 'image/tiff'
};
const MAX_MEDIA_BYTES = 50 * 1024 * 1024; // 50MB limit

let _hub = null;
let _logger = null;

async function init(deps) {
  _hub = deps.hub;
  _logger = deps.logger;
  _logger.info('[FS Driver] initialized');
}

async function handle(tool, params, context) {
  const { trace, callOptions } = context;

  // ── read_media_file ──
  if (tool === 'read_media_file') {
    const fp = params.path;
    if (!fp) return { ok: false, error: 'path is required' };
    const absPath = fp.startsWith('/') ? fp : path.resolve(fp);
    if (!existsSync(absPath)) return { ok: false, error: 'File not found: ' + absPath };
    try {
      const buf = readFileSync(absPath);
      if (buf.length > MAX_MEDIA_BYTES) return { ok: false, error: `File too large: ${buf.length} bytes (max ${MAX_MEDIA_BYTES})` };
      const ext = path.extname(absPath).toLowerCase();
      const mimeType = MIME_MAP[ext] || 'application/octet-stream';
      const base64 = buf.toString('base64');
      return { ok: true, mimeType, base64, size: buf.length };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ── write_file 保护: 检测内容截断 ──
  if (tool === 'write_file' && params.content !== undefined) {
    const contentLines = (params.content.match(/\n/g) || []).length + 1;
    const contentLen = params.content.length;
    if (contentLines <= 1 && contentLen < 50) {
      _logger.warning('[WriteProtect] write_file content may be truncated: ' + contentLen + ' chars, ' + contentLines + ' lines -> ' + params.path);
    }
  }

  const writeProtectInfo = (tool === 'write_file' && params.content !== undefined)
    ? { expectedLen: params.content.length, expectedLines: (params.content.match(/\n/g) || []).length + 1, path: params.path }
    : null;

  // ── edit_file 保护: oldText 过短警告 + v4.6 命中数校验 ──
  // 实测 2026-07-25: 底层遇 3 处相同锚点只改第一处,不报错且 success 为真(静默错位)。
  // 这里在调用前数清命中数,歧义即拒绝; 要改多处必须显式声明 expectedMatches。
  if (tool === 'edit_file' && params.edits && Array.isArray(params.edits)) {
    for (let ei = 0; ei < params.edits.length; ei++) {
      const edit = params.edits[ei];
      if (edit.oldText && edit.oldText.length < 5) {
        _logger.warning('[EditProtect] edit_file edits[' + ei + '].oldText too short (' + edit.oldText.length + ' chars)');
      }
    }
    if (process.env.OMEGA_EDIT_GUARD !== '0') {
      const guardPath = params.path || params.file || '';
      const guardAbs = guardPath.startsWith('/') ? guardPath : path.resolve(guardPath);
      if (existsSync(guardAbs)) {
        let source;
        try { source = readFileSync(guardAbs, 'utf-8'); } catch (e) { source = null; }
        if (source !== null) {
          const problems = [];
          for (let ei = 0; ei < params.edits.length; ei++) {
            const edit = params.edits[ei];
            if (typeof edit.oldText !== 'string' || edit.oldText.length === 0) continue;
            let hits = 0, from = 0;
            while (true) {
              const at = source.indexOf(edit.oldText, from);
              if (at === -1) break;
              hits++; from = at + edit.oldText.length;
            }
            const wanted = edit.expectedMatches;
            if (wanted !== undefined) {
              if (hits !== wanted) problems.push('edits[' + ei + ']: expectedMatches=' + wanted + ' but found ' + hits);
            } else if (hits === 0) {
              problems.push('edits[' + ei + ']: anchor not found (0 matches)');
            } else if (hits > 1) {
              problems.push('edits[' + ei + ']: ambiguous anchor, ' + hits + ' matches; only the first would be edited silently. Widen oldText or set expectedMatches:' + hits);
            }
          }
          if (problems.length > 0) {
            _logger.error('[EditGuard] refused: ' + problems.join(' | '));
            trace.span('edit_guard', { status: 'REFUSED', path: guardAbs, problems: problems.length });
            return { success: false, ok: false, error: '[EditGuard] refused before write: ' + problems.join(' | '), guard: 'match_count' };
          }
          trace.span('edit_guard', { status: 'OK', path: guardAbs, edits: params.edits.length });
        }
      }
    }
  }

  trace.span('filesystem', { tool, path: params.path || params.file });

  const result = await _hub.call(tool, params, callOptions);
  // v4.6: 底层把拒绝写进返回文本而不是 success:false,语义失败必须转成布尔失败,
  // 否则 when 链路会带着假成功继续跑(实测 Access denied 曾被判为 ✓ 成功)。
  if (result && typeof result === 'object' && result.success !== false) {
    const flat = Array.isArray(result.content)
      ? result.content.map(c => (c && c.text) ? c.text : String(c)).join('')
      : (typeof result.content === 'string' ? result.content : '');
    const denial = ['Access denied', 'not in /Users', 'exact match not found', 'File not found'].find(sig => flat.includes(sig));
    if (denial) {
      _logger.error('[FS Driver] semantic failure surfaced as boolean: ' + denial);
      trace.span('filesystem', { status: 'SEMANTIC_FAILURE', tool, signal: denial });
      result.success = false;
      result.ok = false;
      result.error = flat.slice(0, 500);
    }
  }
  // edit_file fail: attach file content
  if (tool === "edit_file" && result && result.content) {
    var txt = Array.isArray(result.content) ? result.content.map(function(c){return c.text||c;}).join("") : String(result.content);
    if (txt.indexOf("exact match") !== -1) {
      try {
        var fp = params.path || params.file || "";
        var validP = fp.startsWith("/") ? fp : require("path").resolve(fp);
        var fc = require("fs").readFileSync(validP, "utf-8");
        var ls = fc.split(NL);
        var snip = ls.slice(0, 80).join(NL);
        var hint = NL + "[AUTO-HINT] " + ls.length + " lines. First 80:" + NL + snip;
        if (Array.isArray(result.content)) { result.content.push({type:"text",text:hint}); }
      } catch(e) {}
    }
  }


  // ── write_file 写入后验证 ──
  if (writeProtectInfo) {
    try {
      const wp = writeProtectInfo;
      const validPath = wp.path.startsWith('/') ? wp.path : path.resolve(wp.path);
      const actualContent = readFileSync(validPath, 'utf-8');
      const actualLen = actualContent.length;
      const actualLines = (actualContent.match(/\n/g) || []).length + 1;
      if (actualLen !== wp.expectedLen) {
        _logger.error('[WriteProtect] MISMATCH! expected ' + wp.expectedLen + ' chars, actual ' + actualLen + ' chars -> ' + wp.path);
        trace.span('write_protect', { status: 'MISMATCH', expected: wp.expectedLen, actual: actualLen });
      } else {
        _logger.info('[WriteProtect] OK: ' + actualLen + ' chars, ' + actualLines + ' lines -> ' + wp.path);
        trace.span('write_protect', { status: 'OK', len: actualLen, lines: actualLines });
      }
    } catch (wpErr) {
      _logger.warning('[WriteProtect] skip: ' + wpErr.message);
    }
  }

  return result;
}

export default {
  name: 'filesystem',
  tools: ['read_file', 'write_file', 'edit_file', 'list_dir', 'find_text', 'get_symbols', 'read_media_file'],
  init,
  handle
};
