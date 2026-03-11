// Filesystem Driver - 文件操作 + 写保护 + 编辑保护
// Tools: read_file, write_file, edit_file, list_dir, find_text, get_symbols

import { readFileSync } from 'fs';
import path from 'path';

let _hub = null;
let _logger = null;

async function init(deps) {
  _hub = deps.hub;
  _logger = deps.logger;
  _logger.info('[FS Driver] initialized');
}

async function handle(tool, params, context) {
  const { trace, callOptions } = context;

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

  // ── edit_file 保护: oldText 过短警告 ──
  if (tool === 'edit_file' && params.edits && Array.isArray(params.edits)) {
    for (let ei = 0; ei < params.edits.length; ei++) {
      const edit = params.edits[ei];
      if (edit.oldText && edit.oldText.length < 5) {
        _logger.warning('[EditProtect] edit_file edits[' + ei + '].oldText too short (' + edit.oldText.length + ' chars)');
      }
    }
  }

  trace.span('filesystem', { tool, path: params.path || params.file });

  const result = await _hub.call(tool, params, callOptions);

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
  tools: ['read_file', 'write_file', 'edit_file', 'list_dir', 'find_text', 'get_symbols'],
  init,
  handle
};
