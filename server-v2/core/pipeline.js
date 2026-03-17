// Pipeline — 工具调用前后的共享基础设施
// 从 index.js handleToolCall 提取，所有工具共享
import { readFileSync, unlinkSync, writeFileSync } from 'fs';

// ── 预处理：PayloadFile 还原 ──
export function resolvePayloadFiles(params, logger) {
  const fileRefFields = [['contentFile', 'content'], ['stdinFile', 'stdin'], ['codeFile', 'code']];
  for (const [fileField, targetField] of fileRefFields) {
    if (params[fileField] && typeof params[fileField] === 'string') {
      try {
        const fileContent = readFileSync(params[fileField], 'utf-8');
        params[targetField] = fileContent;
        const tmpFile = params[fileField];
        delete params[fileField];
        logger.info(`[PayloadFile] ${targetField}: ${fileContent.length} chars <- ${tmpFile}`);
        try { unlinkSync(tmpFile); } catch(e) {}
      } catch (e) {
        logger.warn(`[PayloadFile] 读取失败 ${fileField}: ${e.message}`);
      }
    }
  }
  return params;
}

// ── 预处理：Base64 解码 ──
export function decodeBase64Fields(params, logger) {
  const PREFIX = 'base64:';
  for (const field of ['content', 'stdin', 'code']) {
    if (params[field] && typeof params[field] === 'string' && params[field].startsWith(PREFIX)) {
      try {
        params[field] = Buffer.from(params[field].slice(PREFIX.length), 'base64').toString('utf-8');
        logger.info(`[Base64] 解码 ${field}: ${params[field].length} chars`);
      } catch (e) {
        logger.warn(`[Base64] 解码失败 ${field}: ${e.message}`);
      }
    }
  }
  if (params.edits && Array.isArray(params.edits)) {
    for (const edit of params.edits) {
      for (const ef of ['oldText', 'newText']) {
        if (edit[ef] && typeof edit[ef] === 'string' && edit[ef].startsWith(PREFIX)) {
          try {
            edit[ef] = Buffer.from(edit[ef].slice(PREFIX.length), 'base64').toString('utf-8');
          } catch (e) {
            logger.warn(`[Base64] edits.${ef} 解码失败: ${e.message}`);
          }
        }
      }
    }
  }
  return params;
}

// ── 预处理：参数类型修正 ──
export function parseParams(params, logger) {
  if (params.edits && typeof params.edits === 'string') {
    try {
      params.edits = JSON.parse(params.edits);
      logger.info(`[ParamsParse] edits: string → array (${params.edits.length} edits)`);
    } catch(e) {
      logger.warn(`[ParamsParse] edits JSON.parse 失败: ${e.message}`);
    }
  }
  return params;
}

// ── 预处理：复杂命令自动脚本化 ──
export function autoScript(tool, params, logger) {
  if (tool !== 'run_process' && tool !== 'run_command') return params;
  const cmd = params.command_line || params.command || '';
  if (!cmd || params._noAutoScript) return params;

  const hasHighRiskChars = /['"`$\\|&;(){}\[\]]/.test(cmd);
  const isLong = cmd.length > 200;
  const hasNestedQuotes = (cmd.match(/'/g) || []).length >= 2 && (cmd.match(/"/g) || []).length >= 2;
  const hasPipe = cmd.includes(' | ');

  if ((isLong && hasHighRiskChars) || hasNestedQuotes || (isLong && hasPipe)) {
    try {
      const scriptPath = `/private/tmp/cmd_${Date.now()}.sh`;
      writeFileSync(scriptPath, `#!/bin/bash\n${cmd}\n`, { mode: 0o755 });
      logger.info(`[AutoScript] ${scriptPath} (${cmd.length} chars)`);
      const cmdKey = params.command_line ? 'command_line' : 'command';
      return { ...params, [cmdKey]: `bash ${scriptPath}`, _noAutoScript: true };
    } catch (e) {
      logger.warn(`[AutoScript] 失败: ${e.message}`);
    }
  }
  return params;
}

// ── 超时策略 ──
export function resolveTimeout(tool, params, message) {
  let timeout = message.params?.timeout ? parseInt(message.params.timeout) : undefined;
  if (timeout && timeout < 10000) timeout = timeout * 1000; // <10000 视为秒，自动转毫秒
  if (!timeout && tool.startsWith('ssh-')) {
    const cmd = (params.command || '').toLowerCase();
    const isLong = /nohup|pipeline|--test|npm\s+install|pip3?\s+install|git\s+clone|docker\s+(build|pull)|demucs|whisper|ffmpeg/.test(cmd);
    timeout = isLong ? 600000 : 120000;
  }
  if (!timeout && (tool === 'run_process' || tool === 'run_command')) {
    const cmd = (params.command_line || params.command || '') + ' ' + (params.stdin || '');
    if (/vfs-exec\.sh|vx\.sh/.test(cmd)) {
      const match = cmd.match(/vfs-exec\.sh\s+\S+\s+(\d+)/);
      const scriptTimeout = match ? parseInt(match[1]) : 90000;
      timeout = scriptTimeout + 30000;
    }
  }
  if (!timeout && (tool === 'agent_pipeline')) {
    timeout = 600000;
  }
  if (!timeout && (tool === 'agent_run')) {
    timeout = 300000;
  }
  return timeout ? { timeout } : {};
}

// ── 结果解析：MCP hub.call 返回值 → 字符串 ──
export function parseResult(r) {
  if (r && r.content && Array.isArray(r.content)) {
    const textParts = [];
    const imageParts = [];
    for (const c of r.content) {
      if (c.type === 'text') textParts.push(c.text);
      else if (c.type === 'image') imageParts.push({ type: 'image', data: c.data, mimeType: c.mimeType || 'image/png' });
      else if (typeof c === 'string') textParts.push(c);
      else textParts.push(JSON.stringify(c));
    }
    const result = textParts.join('\n');
    return { result, images: imageParts.length > 0 ? imageParts : null };
  }
  return { result: typeof r === 'string' ? r : JSON.stringify(r), images: null };
}

// ── 发送成功结果 ──
export function sendSuccess(ws, opts) {
  const { id, historyId, tool, result, images } = opts;
  const response = {
    type: 'tool_result', id, historyId, tool,
    success: true,
    result: `[#${historyId}] ${result}`
  };
  if (images) response._images = images;
  ws.send(JSON.stringify(response));
}

// ── 发送失败结果 ──
export function sendError(ws, opts) {
  const { id, historyId, tool, error, errorType, recoverable, suggestion } = opts;
  ws.send(JSON.stringify({
    type: 'tool_result', id, historyId, tool,
    success: false, errorType, recoverable, suggestion,
    error: `[#${historyId}] 错误: ${error}`
  }));
}