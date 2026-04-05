  // ============== 工具调用解析 ==============

  function isExampleToolCall(text, matchStart) {
    const beforeText = text.substring(Math.max(0, matchStart - 100), matchStart).toLowerCase();
    const exampleIndicators = ['示例：','示例:','例如：','例如:','example:','e.g.:','格式如下','格式为','比如','such as','like this'];
    for (const ind of exampleIndicators) { if (beforeText.includes(ind)) return true; }
    const textBeforeMatch = text.substring(0, matchStart);
    const lastBacktick = textBeforeMatch.lastIndexOf('`');
    if (lastBacktick !== -1) {
      const between = textBeforeMatch.substring(lastBacktick + 1);
      if (!between.includes('`')) {
        const tripleBacktickBefore = textBeforeMatch.lastIndexOf('```');
        if (tripleBacktickBefore === -1 || tripleBacktickBefore < lastBacktick - 2) return true;
      }
    }
    return false;
  }

  function extractBalancedJson(text, marker, fromEnd = false) {
    const idx = fromEnd ? text.lastIndexOf(marker) : text.indexOf(marker);
    if (idx === -1) return null;
    const jsonStart = text.indexOf('{', idx + marker.length);
    if (jsonStart === -1) return null;
    const between = text.slice(idx + marker.length, jsonStart);
    if (between.trim() !== '') return null;
    let depth = 0, inStr = false, esc = false;
    for (let i = jsonStart; i < text.length; i++) {
      const ch = text[i];
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{') depth++;
      if (ch === '}') { depth--; if (depth === 0) return { json: text.slice(jsonStart, i+1), start: idx, end: i+1 }; }
    }
    return null;
  }

  function parseToolCalls(text) {
    if (!text) return [];

    const ocPrefix = String.fromCharCode(0x03A9) + 'CODE';     // ΩCODE (5 chars)
    const ocEndTag = String.fromCharCode(0x03A9) + 'CODEEND';  // ΩCODEEND (8 chars)

    // ===== Step 1: Strip markdown fenced code blocks to avoid false matches =====
    let cleanText = text;
    const fenceRegex = /```[\s\S]*?```/g;
    let fenceMatch;
    while ((fenceMatch = fenceRegex.exec(text)) !== null) {
      const block = text.substring(fenceMatch.index, fenceMatch.index + fenceMatch[0].length);
      if (block.includes(ocPrefix)) {
        // Replace with same-length spaces to preserve positions
        const replacement = ' '.repeat(fenceMatch[0].length);
        cleanText = cleanText.substring(0, fenceMatch.index) + replacement + cleanText.substring(fenceMatch.index + fenceMatch[0].length);
      }
    }

    // ===== Step 2: Find real ΩCODE blocks =====
    let searchFrom = 0;
    while (searchFrom < cleanText.length) {
      let codeStart = cleanText.indexOf(ocPrefix, searchFrom);
      if (codeStart === -1) break;

      // Skip if this is actually ΩCODEEND (contains ΩCODE as substring)
      if (cleanText.substring(codeStart, codeStart + 8) === ocEndTag) {
        searchFrom = codeStart + 8;
        continue;
      }

      // Skip if inside markdown code block (odd number of ``` before)
      const textBefore = cleanText.substring(0, codeStart);
      const fenceCount = (textBefore.match(/```/g) || []).length;
      if (fenceCount % 2 === 1) {
        searchFrom = codeStart + 5;
        continue;
      }

      // Skip example context
      const beforeOC = text.substring(Math.max(0, codeStart - 100), codeStart);
      if (/Example:|e\.g\.|示例|格式/.test(beforeOC)) {
        searchFrom = codeStart + 5;
        continue;
      }

      // Find matching ΩCODEEND
      let codeEnd = -1;
      let endSearch = codeStart + 5;
      while (endSearch < cleanText.length) {
        const idx = cleanText.indexOf(ocEndTag, endSearch);
        if (idx === -1) break;
        const charBefore = idx > 0 ? cleanText[idx - 1] : '\n';
        if (charBefore === "'" || charBefore === '"' || charBefore === '\\') {
          endSearch = idx + 8;
          continue;
        }
        codeEnd = idx;
        break;
      }
      if (codeEnd === -1) break; // Incomplete block, wait for more

      searchFrom = codeEnd + 8;

      // Extract and parse the block body from ORIGINAL text
      const hdrEnd = text.indexOf('\n', codeStart);
      let ocBody = (hdrEnd !== -1 && hdrEnd < codeEnd)
        ? text.substring(hdrEnd + 1, codeEnd).trim()
        : text.substring(codeStart + 5, codeEnd).trim();
      ocBody = ocBody.replace(/^`+[\w]*\n?/, '').replace(/\n?`+$/, '').trim();

      const ocObj = safeJsonParse(ocBody);
      if (ocObj && (ocObj.tool || ocObj.steps)) {
        if (ocObj.steps && Array.isArray(ocObj.steps)) {
          log('parseToolCalls: BATCH steps=' + ocObj.steps.length);
          return [{ name: '__BATCH__', params: ocObj, raw: text.substring(codeStart, codeEnd + 8), start: codeStart, end: codeEnd + 8, isBatch: true }];
        } else {
          log('parseToolCalls: SINGLE tool=' + ocObj.tool);
          return [{ name: ocObj.tool, params: ocObj.params || {}, raw: text.substring(codeStart, codeEnd + 8), start: codeStart, end: codeEnd + 8 }];
        }
      } else {
        log('parseToolCalls: ΩCODE found but JSON parse failed, body[0:120]:', ocBody.substring(0, 120));
      }
    }

    // ===== Fallback: ```tool code blocks =====
    const toolRe = /```tool\s*\n([\s\S]*?)\n```/g;
    let m;
    const toolCalls = [];
    while ((m = toolRe.exec(text)) !== null) {
      try {
        const json = m[1].trim().replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'");
        const p = safeJsonParse(json);
        if (p && p.tool) toolCalls.push({ name: p.tool, params: p.params || {}, raw: m[0], start: m.index, end: m.index + m[0].length });
      } catch(e) {}
    }
    if (toolCalls.length > 0) return toolCalls;

    return [];
  }
