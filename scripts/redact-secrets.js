#!/usr/bin/env node
/**
 * Redact Secrets v1.0 - 敏感信息脱敏模块
 * 
 * 用于上下文压缩流程，确保 API key、密码、token 等不会泄露到压缩总结中。
 * 
 * 用法:
 *   Node.js 模块:
 *     const { redactSecrets } = require('./redact-secrets.js');
 *     const clean = redactSecrets(text);
 * 
 *   CLI 管道:
 *     cat summary.md | node redact-secrets.js
 *     node redact-secrets.js < summary.md
 *     node redact-secrets.js file.md
 */

const fs = require('fs');

// ===== 敏感信息匹配规则 =====
const REDACT_RULES = [
  // API Keys - 各种格式
  { name: 'sk-key', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g, replacement: '[REDACTED_API_KEY]' },
  { name: 'bearer-token', pattern: /Bearer\s+[A-Za-z0-9_\-\.]{20,}/g, replacement: 'Bearer [REDACTED_TOKEN]' },
  // hex key: 41+ chars (skip exactly 40 = git commit hash)
  { name: 'api-key-hex', pattern: /\b[0-9a-f]{41,}\b/g, replacement: '[REDACTED_HEX_KEY]' },
  
  // 环境变量赋值中的值 (KEY=value 格式)
  { name: 'env-api-key', pattern: /((?:API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY|ACCESS_KEY)\s*[=:]\s*)[^\s\n'"]{8,}/gi, replacement: '$1[REDACTED]' },
  
  // Kimi/Moonshot 特定格式
  { name: 'kimi-key', pattern: /\bsk-[A-Za-z0-9]{32,}\b/g, replacement: '[REDACTED_KIMI_KEY]' },
  
  // DeepSeek 特定格式
  { name: 'deepseek-key', pattern: /\bsk-[0-9a-f]{32,}\b/g, replacement: '[REDACTED_DEEPSEEK_KEY]' },
  
  // 1min.ai 长 hex key
  { name: '1min-key', pattern: /\b[0-9a-f]{64}\b/g, replacement: '[REDACTED_1MIN_KEY]' },

  // Generic long base64-ish tokens (40+ chars of alphanumeric)
  { name: 'long-token', pattern: /\b[A-Za-z0-9_-]{40,}={0,2}\b/g, replacement: (match) => {
    // 避免误伤：排除已知安全的长字符串（路径、URL slug、commit hash 等）
    if (/^[0-9a-f]{40}$/.test(match)) return match; // git commit hash (exactly 40 hex)
    if (/^[0-9a-f]{7,8}$/.test(match)) return match; // short commit hash
    if (/^[a-z0-9-]+$/.test(match) && match.includes('-')) return match; // slug/uuid
    if (match.length > 60) return '[REDACTED_LONG_TOKEN]';
    return match;
  }},
  
  // SSH private key content
  { name: 'ssh-key', pattern: /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/g, replacement: '[REDACTED_SSH_PRIVATE_KEY]' },
  
  // password/secret 在 JSON 或配置中
  { name: 'json-password', pattern: /"(password|secret|token|apiKey|api_key|private_key)"\s*:\s*"[^"]{4,}"/gi, replacement: '"$1": "[REDACTED]"' },
  
  // URL 中内嵌的认证信息
  { name: 'url-auth', pattern: /:\/\/([^:@\s]+):([^@\s]{4,})@/g, replacement: '://$1:[REDACTED]@' },
  
  // .env 文件格式的敏感行
  { name: 'dotenv-line', pattern: /^((?:.*(?:KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL).*?)=)(.{8,})$/gm, replacement: '$1[REDACTED]' },
];

// ===== 已知安全白名单（不应被脱敏的模式）=====
const WHITELIST = [
  /^[0-9a-f]{40}$/,           // git commit hash
  /^[0-9a-f]{7,8}$/,          // short commit hash
  /^[0-9a-f-]{36}$/,          // UUID
  /^sha256:[0-9a-f]+$/,       // docker image digest
  /\.(js|ts|py|sh|md|json)$/, // file extensions that look like hex
];

function isWhitelisted(match) {
  return WHITELIST.some(pattern => pattern.test(match));
}

/**
 * 对文本进行敏感信息脱敏
 * @param {string} text - 输入文本
 * @param {Object} options - 选项
 * @param {boolean} options.verbose - 是否输出脱敏日志
 * @param {string[]} options.extraKeys - 额外需要脱敏的具体字符串值
 * @returns {string} 脱敏后的文本
 */
function redactSecrets(text, options = {}) {
  if (!text || typeof text !== 'string') return text;
  
  let result = text;
  let redactCount = 0;
  const redactLog = [];
  
  // 先处理额外指定的具体 key 值
  if (options.extraKeys && options.extraKeys.length > 0) {
    for (const key of options.extraKeys) {
      if (key && key.length >= 8) {
        const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escaped, 'g');
        const count = (result.match(regex) || []).length;
        if (count > 0) {
          result = result.replace(regex, '[REDACTED_KNOWN_KEY]');
          redactCount += count;
          redactLog.push(`extraKey(${key.substring(0, 6)}...): ${count} occurrences`);
        }
      }
    }
  }
  
  // 按规则顺序应用
  for (const rule of REDACT_RULES) {
    const before = result;
    result = result.replace(rule.pattern, rule.replacement);
    if (result !== before) {
      const diff = (before.match(rule.pattern) || []).length;
      redactCount += diff;
      redactLog.push(`${rule.name}: ${diff} matches`);
    }
  }
  
  if (options.verbose && redactLog.length > 0) {
    console.error(`[redact-secrets] Redacted ${redactCount} sensitive items:`);
    redactLog.forEach(l => console.error(`  - ${l}`));
  }
  
  return result;
}

/**
 * 从 .env 文件加载已知的 key 值（用于精确匹配）
 * @param {string} envFilePath - .env 文件路径
 * @returns {string[]} key 值数组
 */
function loadKnownKeys(envFilePath) {
  const keys = [];
  try {
    const content = fs.readFileSync(envFilePath, 'utf8');
    const sensitiveNames = /KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL/i;
    for (const line of content.split('\n')) {
      const match = line.match(/^([^#=]+)=(.+)$/);
      if (match && sensitiveNames.test(match[1])) {
        const val = match[2].trim().replace(/^['"]|['"]$/g, '');
        if (val.length >= 8) {
          keys.push(val);
        }
      }
    }
  } catch (e) {
    // .env 文件不存在或不可读，忽略
  }
  return keys;
}

// ===== CLI 模式 =====
if (require.main === module) {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose') || args.includes('-v');
  const envFile = '/Users/yay/workspace/genspark-agent/server-v2/.env.api';
  const extraKeys = loadKnownKeys(envFile);
  
  let input = '';
  
  const fileArg = args.find(a => !a.startsWith('-'));
  if (fileArg) {
    // 文件模式
    input = fs.readFileSync(fileArg, 'utf8');
  } else if (!process.stdin.isTTY) {
    // 管道模式
    input = fs.readFileSync('/dev/stdin', 'utf8');
  } else {
    console.error('Usage: node redact-secrets.js [--verbose] [file]');
    console.error('       cat text.md | node redact-secrets.js');
    process.exit(1);
  }
  
  const result = redactSecrets(input, { verbose, extraKeys });
  process.stdout.write(result);
}

module.exports = { redactSecrets, loadKnownKeys, REDACT_RULES };