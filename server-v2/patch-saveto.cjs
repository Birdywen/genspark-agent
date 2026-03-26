const fs = require('fs');
const path = 'drivers/agent.js';
let content = fs.readFileSync(path, 'utf8');

// Find the saveTo block by line matching
const lines = content.split('\n');
let startIdx = -1, endIdx = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('saveTo: 从结果中提取 HTML')) startIdx = i;
  if (startIdx > 0 && i > startIdx && lines[i].trim() === '}') {
    endIdx = i;
    break;
  }
}

if (startIdx < 0) { console.log('ERROR: block not found'); process.exit(1); }
console.log(`Found block: lines ${startIdx+1}-${endIdx+1}`);

const newBlock = [
  '      // saveTo: 从结果中提取代码块并保存到文件（支持 cjs/js/html/任意语言）',
  '      if (params.saveTo && result && result.ok !== false) {',
  '        var rawContent = typeof result === "string" ? result : (result.result || result.data || "");',
  '        var extracted = null;',
  '        // 1. 提取最后一个代码块（agent 可能输出多段自言自语+多个代码块）',
  '        var allCodeBlocks = [];',
  '        var codeRe = /```(?:cjs|js|javascript|python|html|swift|sh|bash|json)?\\s*\\n([\\s\\S]*?)\\n```/g;',
  '        var m;',
  '        while ((m = codeRe.exec(rawContent)) !== null) allCodeBlocks.push(m[1].trim());',
  '        if (allCodeBlocks.length > 0) {',
  '          // 取最长的代码块（通常是最完整的那个）',
  '          extracted = allCodeBlocks.sort((a,b) => b.length - a.length)[0];',
  '        }',
  '        // 2. 如果没有代码块，尝试 HTML',
  '        if (!extracted) {',
  '          var dtMatch = rawContent.match(/<!DOCTYPE[\\s\\S]*<\\/html>/i);',
  '          if (dtMatch) extracted = dtMatch[0].trim();',
  '        }',
  '        // 3. 如果还没有，找第一行代码开头',
  '        if (!extracted) {',
  '          var rLines = rawContent.split("\\n");',
  '          var codeStart = rLines.findIndex(function(l) { return /^(const |var |let |import |require|#!|\'use strict\')/.test(l.trim()); });',
  '          if (codeStart >= 0) extracted = rLines.slice(codeStart).join("\\n");',
  '          else extracted = rawContent;',
  '        }',
  '        if (extracted) {',
  '          const { writeFileSync } = require("fs");',
  '          var savePath = params.saveTo;',
  '          if (!savePath.startsWith("/")) savePath = "/Users/yay/workspace/" + savePath;',
  '          // 不强制加 .html，保留用户指定的扩展名',
  '          writeFileSync(savePath, extracted, "utf8");',
  '          result = { ok: true, savedTo: savePath, savedBytes: extracted.length };',
  '        }',
  '      }',
];

lines.splice(startIdx, endIdx - startIdx + 1, ...newBlock);
fs.writeFileSync(path, lines.join('\n'), 'utf8');
console.log(`Patched! New file: ${lines.length} lines. New saveTo block: ${newBlock.length} lines`);
