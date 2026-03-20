  // ============== 工具调用解析 ==============

  function isExampleToolCall(text, matchStart) {
    // 检查工具调用前 100 个字符
    const beforeText = text.substring(Math.max(0, matchStart - 20), matchStart).toLowerCase();
    // 检查工具调用后 50 个字符
    const afterText = text.substring(matchStart, Math.min(text.length, matchStart + 100)).toLowerCase();
    
    // 1. 示例关键词检测
    const exampleIndicators = [
      '示例：', '示例:', '例如：', '例如:',
      'example:', 'e.g.:', 'e.g.：',
      '格式如下', '格式为：', '格式为:',
      '比如', '譬如', 'such as', 'like this'
    ];
    
    for (const indicator of exampleIndicators) {
      if (beforeText.includes(indicator)) {
        return true;
      }
    }
    
    // 2. 检查是否在行内代码块中（被反引号包裹）
    // 查找匹配位置前最近的反引号情况
    const textBeforeMatch = text.substring(0, matchStart);
    const lastBacktick = textBeforeMatch.lastIndexOf('`');
    if (lastBacktick !== -1) {
      // 检查这个反引号后面到 matchStart 之间是否有配对的反引号
      const betweenText = textBeforeMatch.substring(lastBacktick + 1);
      // 如果没有配对的反引号，说明我们在代码块内
      if (!betweenText.includes('`')) {
        // 但要排除 ``` 代码块的情况（那是真正要执行的）
        const tripleBacktickBefore = textBeforeMatch.lastIndexOf('```');
        if (tripleBacktickBefore === -1 || tripleBacktickBefore < lastBacktick - 2) {
          return true;  // 在单反引号内，是示例
        }
      }
    }
    
    // 3. 检查是否是占位符格式（如 xxx, agent_id, 目标agent 等）
    const placeholderPatterns = [
      /:xxx:/i, /:agent_id:/i, /:目标/i, /:your/i,
      /\[.*agent.*\]/i, /<.*agent.*>/i
    ];
    for (const pattern of placeholderPatterns) {
      if (pattern.test(afterText)) {
        return true;
      }
    }
    
    // 4. 检查前文是否有解释性文字（通常示例前有冒号或解释）
    if (beforeText.match(/[：:。.]/)) {
      // 检查是否像是在解释格式
      if (beforeText.includes('格式') || beforeText.includes('写法') || 
          beforeText.includes('语法') || beforeText.includes('format')) {
        return true;
      }
    }
    
    return false;
  }

  function isRealToolCall(text, matchStart, matchEnd) {
    if (isExampleToolCall(text, matchStart)) {
      log('跳过示例工具调用');
      return false;
    }
    
    const afterText = text.substring(matchEnd, matchEnd + 150);
    if (afterText.includes('[执行结果]') || afterText.includes('执行结果')) {
      log('跳过已执行的工具调用');
      return false;
    }
    
    return true;
  }

  function extractJsonFromText(text, startIndex) {
    let depth = 0, inString = false, escapeNext = false, start = -1;
    for (let i = startIndex; i < text.length; i++) {
      const c = text[i];
      if (escapeNext) { escapeNext = false; continue; }
      if (c === "\\" && inString) { escapeNext = true; continue; }
      if (c === '"' && !escapeNext) { inString = !inString; continue; }
      if (inString) continue;
      if (c === '{') { if (depth === 0) start = i; depth++; }
      else if (c === '}') { depth--; if (depth === 0 && start !== -1) return { json: text.substring(start, i + 1), end: i + 1 }; }
    }
    return null;
  }

  // HEREDOC 格式解析器
  function parseHeredocFormat(text) {
    var calls = [];
    var OMEGA = String.fromCharCode(0x03A9);
    var MARKER = OMEGA + "HERE";
    var END_STR = OMEGA + "END";
    var NL = String.fromCharCode(10);
    var searchFrom = 0;
    while (true) {
      var si = text.indexOf(MARKER, searchFrom);
      if (si === -1) break;
      // 先找 header 行获取工具名和可选的自定义结束标记
      var he = text.indexOf(NL, si);
      if (he === -1) break;
      var hdr = text.substring(si + MARKER.length, he).trim();
      var hdrParts = hdr.split(/\s+/);
      if (!hdrParts[0] || !hdrParts[0].match(/^[a-zA-Z_][a-zA-Z0-9_:-]*$/)) { searchFrom = si + 1; continue; }
      var toolName = hdrParts[0];
      var customEnd = hdrParts.length > 1 ? hdrParts[1] : null;
      // 用自定义结束标记或默认 omega END
      var actualEnd = customEnd || END_STR;
      var endNL = text.indexOf(NL + actualEnd, he);
      var ei = (endNL !== -1) ? endNL : text.indexOf(actualEnd, he);
      if (ei === -1) { searchFrom = he; break; }
      var bStart = Math.max(0, si - 50);
      var before = text.substring(bStart, si).toLowerCase();
      var skip = before.indexOf("example") !== -1;
      if (skip) { searchFrom = ei + actualEnd.length + 1; continue; }
      var body = text.substring(he + 1, ei);
      var params = {};
      var blines = body.split(NL);
      var idx = 0;
      while (idx < blines.length) {
        var line = blines[idx];
        var hdm = line.match(/^@(\w+)<<(\S+)\s*$/);
        if (hdm) {
          var hkey = hdm[1], delim = hdm[2], buf = [];
          idx++;
          while (idx < blines.length && blines[idx] !== delim) {
            buf.push(blines[idx]); idx++;
          }
          params[hkey] = buf.join(NL);
          idx++;
          continue;
        }
        var spm = line.match(/^@(\w+)=(.*)$/);
        if (spm) {
          var skey = spm[1], sval = spm[2];
          // Multi-line value: collect subsequent lines that don't start with @param
          var multiLineKeys = ['content', 'code', 'stdin', 'command_line', 'text', 'message', 'body', 'sql'];
          if (multiLineKeys.indexOf(skey) !== -1) {
            var extraLines = [];
            while (idx + 1 < blines.length) {
              var nextLine = blines[idx + 1];
              if (nextLine.match(/^@\w+=/) || nextLine.match(/^@\w+<</)) break;
              extraLines.push(nextLine);
              idx++;
            }
            if (extraLines.length > 0) {
              sval = sval + NL + extraLines.join(NL);
            }
          } else {
            if (/^\d+$/.test(sval)) sval = parseInt(sval);
            else if (sval === "true") sval = true;
            else if (sval === "false") sval = false;
          }
          params[skey] = sval;
          idx++;
          continue;
        }
        if (line.trim() === "@edits" || line.indexOf("@oldText<<") === 0) {
          if (!params.edits) params.edits = [];
          if (line.trim() === "@edits") { idx++; } // skip @edits marker line
          while (idx < blines.length) {
            var eline = blines[idx];
            if (eline.indexOf("@oldText<<") === 0) {
              var odm = eline.match(/^@oldText<<(\S+)/);
              if (!odm) break;
              var odelim = odm[1], obuf = [];
              idx++;
              while (idx < blines.length && blines[idx] !== odelim) {
                obuf.push(blines[idx]); idx++;
              }
              idx++;
              if (idx < blines.length && blines[idx].indexOf("@newText<<") === 0) {
                var ndm = blines[idx].match(/^@newText<<(\S+)/);
                if (!ndm) break;
                var ndelim = ndm[1], nbuf = [];
                idx++;
                while (idx < blines.length && blines[idx] !== ndelim) {
                  nbuf.push(blines[idx]); idx++;
                }
                idx++;
                params.edits.push({ oldText: obuf.join(NL), newText: nbuf.join(NL) });
              }
            } else { break; }
          }
          continue;
        }
        idx++;
      }
      // Collect unmatched lines as freeText (used as 'code' for eval_js/async_task)
      var freeLines = blines.filter(function(l) { return l.trim() !== '' && !l.match(/^@\w+=/) && !l.match(/^@\w+<</) && l.trim() !== '@edits'; });
      if (freeLines.length > 0 && !params.code) {
        params.code = freeLines.join('\n');
      }
      var noParamTools = ['list_tabs', 'health_check', 'reload_tools', 'vfs_list', 'vfs_backup'];
      if (Object.keys(params).length > 0 || noParamTools.indexOf(toolName) !== -1) {
        calls.push({
          name: toolName,
          params: params,
          start: si,
          end: ei + END_STR.length + 1,
          isHeredoc: true
        });
      }
      searchFrom = ei + actualEnd.length + 1;
    }
    return calls;
  }

  // HEREBATCH 格式解析器 - 多个 HEREDOC 工具调用的批量执行
  function parseHereBatchFormat(text) {
    var MARKER_START = 'ΩHEREBATCH';
    var MARKER_END = 'ΩHEREBATCHEND';
    var HERE = 'ΩHERE';
    var NL = String.fromCharCode(10);
    
    var si = text.indexOf(MARKER_START);
    if (si === -1) return null;
    var ei = text.indexOf(MARKER_END, si);
    if (ei === -1) return null;
    
    // Skip examples
    var before = text.substring(Math.max(0, si - 30), si).toLowerCase();
    if (before.indexOf('example') !== -1) return null;
    
    var body = text.substring(si + MARKER_START.length, ei).trim();
    
    // Split into individual HERE blocks
    var blocks = [];
    var searchPos = 0;
    while (true) {
      var hereIdx = body.indexOf(HERE, searchPos);
      if (hereIdx === -1) break;
      // Find the end of this HERE block (next HERE or end of body)
      var nextHere = body.indexOf(HERE, hereIdx + HERE.length + 1);
      var blockEnd = nextHere !== -1 ? nextHere : body.length;
      blocks.push(body.substring(hereIdx, blockEnd).trim());
      searchPos = hereIdx + HERE.length + 1;
    }
    
    if (blocks.length === 0) return null;
    
    var steps = [];
    for (var b = 0; b < blocks.length; b++) {
      var block = blocks[b];
      // Parse each block as a mini heredoc
      var headerEnd = block.indexOf(NL);
      if (headerEnd === -1) continue;
      var header = block.substring(HERE.length, headerEnd).trim();
      var hdrParts = header.split(/\s+/);
      if (!hdrParts[0] || !hdrParts[0].match(/^[a-zA-Z_][a-zA-Z0-9_:-]*$/)) continue;
      var toolName = hdrParts[0];
      
      var blockBody = block.substring(headerEnd + 1);
      var lines = blockBody.split(NL);
      var params = {};
      var saveAs = undefined;
      var when = undefined;
      var idx = 0;
      
      while (idx < lines.length) {
        var line = lines[idx];
        // Extract saveAs
        var saveMatch = line.match(/^@saveAs=(\S+)/);
        if (saveMatch) { saveAs = saveMatch[1]; idx++; continue; }
        // Extract when
        var whenMatch = line.match(/^@when=(.*)/);
        if (whenMatch) { when = whenMatch[1]; idx++; continue; }
        // Heredoc param
        var hdm = line.match(/^@(\w+)<<(\S+)\s*$/);
        if (hdm) {
          var hkey = hdm[1], delim = hdm[2], buf = [];
          idx++;
          while (idx < lines.length && lines[idx] !== delim) {
            buf.push(lines[idx]); idx++;
          }
          params[hkey] = buf.join(NL);
          idx++; continue;
        }
        // Simple param
        var spm = line.match(/^@(\w+)=(.*)/);
        if (spm) {
          var skey = spm[1], sval = spm[2];
          if (/^\d+$/.test(sval)) sval = parseInt(sval);
          else if (sval === 'true') sval = true;
          else if (sval === 'false') sval = false;
          params[skey] = sval;
          idx++; continue;
        }
        idx++;
      }
      
      var step = { tool: toolName, params: params };
      if (saveAs) step.saveAs = saveAs;
      if (when) step.when = when;
      steps.push(step);
    }
    
    if (steps.length === 0) return null;
    return { steps: steps, start: si };
  }




  // 解析新的代码块格式: Ωname ... ΩEND
  function parseCodeBlockFormat(text) {
    const toolCalls = [];
    const regex = /Ω(\w+)\s*\n([\s\S]*?)ΩEND/g;
    let match;
    
    while ((match = regex.exec(text)) !== null) {
      if (!isRealToolCall(text, match.index, match.index + match[0].length)) {
        continue;
      }
      
      const toolName = match[1];
      const body = match[2];
      const params = {};
      
      const pathMatch = body.match(/@PATH:\s*(.+)/);
      if (pathMatch) params.path = pathMatch[1].trim();
      
      const cmdMatch = body.match(/@COMMAND:\s*(.+)/);
      if (cmdMatch) params.command = cmdMatch[1].trim();
      
      const urlMatch = body.match(/@URL:\s*(.+)/);
      if (urlMatch) params.url = urlMatch[1].trim();
      
      const contentMatch = body.match(/@CONTENT:\s*\n```[\w]*\n([\s\S]*?)\n```/);
      if (contentMatch) {
        params.content = contentMatch[1];
      }
      
      if (Object.keys(params).length > 0) {
        toolCalls.push({
          name: toolName,
          params,
          raw: match[0],
          start: match.index,
          end: match.index + match[0].length
        });
      }
    }
    
    return toolCalls;
  }

  
  // 方案3: 解析 ```tool 代码块
  function parseToolCodeBlock(text) {
    console.log('[Agent] parseToolCodeBlock called, text length:', text.length);
    console.log('[Agent] looking for tool blocks...');
    const calls = [];
    const re = /```tool\s*\n([\s\S]*?)\n```/g;
    console.log('[Agent] regex test:', re.test(text));
    let m;
    while ((m = re.exec(text)) !== null) {
      try {
        const json = m[1].trim().replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
        const p = safeJsonParse(json);
        if (p.tool) calls.push({ name: p.tool, params: p.params || {}, raw: m[0], start: m.index, end: m.index + m[0].length });
      } catch (e) { console.error('[Agent] tool block error:', e.message); }
    }
    return calls;
  }

  // 辅助函数: 提取平衡的 JSON 对象 (支持任意嵌套)
  function extractBalancedJson(text, marker, fromEnd = false) {
    const idx = fromEnd ? text.lastIndexOf(marker) : text.indexOf(marker);
    if (idx === -1) return null;
    const jsonStart = text.indexOf('{', idx + marker.length);
    if (jsonStart === -1) return null;
    // 严格检查: marker 和 { 之间只能有空白字符
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
    // 最优先：检查 ΩHERE heredoc 格式（零转义，解决 SSE 传输损坏问题）
    const hereIdx = text.indexOf('\u03A9HERE');
    if (hereIdx !== -1) {
      const hereCalls = parseHeredocFormat(text);
      if (hereCalls.length > 0) {
        return hereCalls;
      }
    }

    // 最优先：检查 ΩHEREBATCH 格式（HEREDOC 批量执行）
    var hereBatchMarker = String.fromCharCode(0x03A9) + 'HEREBATCH';
    if (text.indexOf(hereBatchMarker) !== -1) {
      var hereBatch = parseHereBatchFormat(text);
      if (hereBatch && !state.executedCalls.has('herebatch:' + hereBatch.start)) {
        return [{ name: '__BATCH__', params: hereBatch.steps, isBatch: true, start: hereBatch.start }];
      }
    }

    // 优先检查 ΩBATCH 批量格式（支持 ΩBATCH{...}ΩEND 或 ΩBATCH{...} 格式）
    const batchStartIdx = text.indexOf('ΩBATCH');
    if (batchStartIdx !== -1 && !state.executedCalls.has('batch:' + batchStartIdx)) {
      // 跳过示例中的 ΩBATCH
      const beforeBatch = text.substring(Math.max(0, batchStartIdx - 100), batchStartIdx);
      const isExample = /Example:/.test(beforeBatch);
      if (!isExample) {
        try {
          // 尝试找 ΩEND 结束标记
          const jsonStart = text.indexOf('{', batchStartIdx);
          let jsonEnd = text.indexOf('ΩEND', jsonStart);
          let batchJson;
          if (jsonEnd !== -1) {
            // 有 ΩEND 标记，直接截取
            batchJson = text.substring(jsonStart, jsonEnd).trim();
          } else {
            // 没有 ΩEND，使用平衡括号匹配
            const batchData = extractBalancedJson(text, 'ΩBATCH');
            if (batchData) batchJson = batchData.json;
          }
          if (batchJson) {
            batchJson = batchJson.replace(/[""]/g, '"').replace(/['']/g, "'");
            const batch = safeJsonParse(batchJson);
            if (batch.steps && Array.isArray(batch.steps)) {
              const endPos = jsonEnd !== -1 ? jsonEnd + 4 : batchStartIdx + 6 + batchJson.length;
              return [{
                name: '__BATCH__',
                params: batch,
                raw: text.substring(batchStartIdx, endPos),
                start: batchStartIdx,
                end: endPos,
                isBatch: true
              }];
            }
          }
        } catch (e) {
          if (CONFIG.DEBUG) console.log('[Agent] ΩBATCH parse skip:', e.message);
        }
      }
    }

    // ========== ΩPLAN ==========
    const planData = extractBalancedJson(text, 'ΩPLAN', true);
    if (planData && !state.executedCalls.has('plan:' + planData.start)) {
      const beforePlan = text.substring(Math.max(0, planData.start - 30), planData.start);
      // 只检查紧邻的前文是否包含文档关键词
      if (!beforePlan.includes('格式') && !beforePlan.includes('示例') && !beforePlan.includes('例如')) {
        try {
          const plan = safeJsonParse(planData.json);
          if (plan) return [{ name: '__PLAN__', params: plan, raw: 'ΩPLAN' + planData.json, start: planData.start, end: planData.end, isPlan: true }];
        } catch (e) {}
      }
    }

    // ========== ΩFLOW ==========
    const flowData = extractBalancedJson(text, 'ΩFLOW', true);
    if (flowData && !state.executedCalls.has('flow:' + flowData.start)) {
      const beforeFlow = text.substring(Math.max(0, flowData.start - 30), flowData.start);
      if (!beforeFlow.includes('格式') && !beforeFlow.includes('示例') && !beforeFlow.includes('例如')) {
        try {
          const flow = safeJsonParse(flowData.json);
          if (flow) return [{ name: '__FLOW__', params: flow, raw: 'ΩFLOW' + flowData.json, start: flowData.start, end: flowData.end, isFlow: true }];
        } catch (e) {}
      }
    }

    // ========== ΩRESUME ==========
    const resumeData = extractBalancedJson(text, 'ΩRESUME', true);
    if (resumeData && !state.executedCalls.has('resume:' + resumeData.start)) {
      const beforeResume = text.substring(Math.max(0, resumeData.start - 30), resumeData.start);
      if (!beforeResume.includes('格式') && !beforeResume.includes('示例') && !beforeResume.includes('例如')) {
        try {
          const resume = safeJsonParse(resumeData.json);
          if (resume) return [{ name: '__RESUME__', params: resume, raw: 'ΩRESUME' + resumeData.json, start: resumeData.start, end: resumeData.end, isResume: true }];
        } catch (e) {}
      }
    }

    // 方案3: 优先解析 ```tool 代码块
    const toolBlockCalls = parseToolCodeBlock(text);
    if (toolBlockCalls.length > 0) return toolBlockCalls;

    // 兼容旧格式: Ωname ... ΩEND
    const codeBlockCalls = parseCodeBlockFormat(text);
    if (codeBlockCalls.length > 0) return codeBlockCalls;

    const toolCalls = [];
    let searchStart = 0;
    while (true) {
      const marker = 'Ω';
      const idx = text.indexOf(marker, searchStart);
      if (idx === -1) break;
      
      // 检查前面100字符是否包含示例关键词
      const beforeMarker = text.substring(Math.max(0, idx - 100), idx);
      const isExample = /格式[：:]|示例：|例如：|Example:|e.g./.test(beforeMarker);
      if (isExample) {
        searchStart = idx + marker.length;
        continue;
      }
      
      // 检查是否紧跟 {"tool":
      const afterMarker = text.substring(idx + marker.length, idx + marker.length + 10);
      if (!afterMarker.match(/^\s*\{\s*"tool"/)) {
        searchStart = idx + marker.length;
        continue;
      }
      const extracted = extractJsonFromText(text, idx + marker.length);
      if (extracted) {
        // Skip if extracted JSON is too short or looks invalid
        if (!extracted.json || extracted.json.length < 5 || !extracted.json.startsWith('{')) {
          searchStart = idx + marker.length;
          continue;
        }
        try {
          // Fix Chinese quotes that break JSON parsing
          let jsonStr = extracted.json
            .replace(/[“”]/g, '"')  // Chinese double quotes to ASCII
            .replace(/[‘’]/g, "'"); // Chinese single quotes to ASCII
          const parsed = safeJsonParse(jsonStr);
          if (parsed.tool) {
            // 检查是否有 ΩSTOP 结束标记
            const afterJson = text.substring(idx + marker.length + extracted.json.length, idx + marker.length + extracted.json.length + 10);
            const hasStop = afterJson.trim().startsWith('ΩSTOP');
            if (!hasStop) {
              // 强制要求 ΩSTOP 结束标记，没有则跳过
              searchStart = idx + marker.length + extracted.json.length;
              continue;
            }
            const endPos = idx + marker.length + extracted.json.length + afterJson.indexOf('ΩSTOP') + 5;
            toolCalls.push({ name: parsed.tool, params: parsed.params || {}, raw: text.substring(idx, endPos), start: idx, end: endPos, hasStopMarker: true });
          }
        } catch (e) {
          if (CONFIG.DEBUG) console.log('[Agent] JSON parse skip:', e.message);
          console.error('[Agent] Raw JSON:', extracted.json.slice(0, 300));
          addLog('JSON parse error: ' + e.message, 'error');
        }
        searchStart = extracted.end;
      } else { searchStart = idx + marker.length; }
    }
    if (toolCalls.length > 0) return toolCalls;

    const inlineRegex = /\[\[TOOL:(\w+)((?:\s+\w+="[^"]*")+)\s*\]\]/g;
    let match;
    
    while ((match = inlineRegex.exec(text)) !== null) {
      if (!isRealToolCall(text, match.index, match.index + match[0].length)) {
        continue;
      }
      
      const params = {};
      const paramRegex = /(\w+)="([^"]*)"/g;
      let paramMatch;
      while ((paramMatch = paramRegex.exec(match[2])) !== null) {
        params[paramMatch[1]] = paramMatch[2];
      }
      
      if (Object.keys(params).length > 0) {
        toolCalls.push({ 
          name: match[1], 
          params, 
          raw: match[0],
          start: match.index,
          end: match.index + match[0].length
        });
      }
    }
    
    if (toolCalls.length > 0) return toolCalls;
    
    const blockRegex = /\[\[TOOL:(\w+)\]\]([\s\S]*?)\[\[\/TOOL\]\]/g;
    
    while ((match = blockRegex.exec(text)) !== null) {
      if (!isRealToolCall(text, match.index, match.index + match[0].length)) {
        continue;
      }
      
      const toolName = match[1];
      const body = match[2].trim();
      const params = parseParams(body);
      
      if (Object.keys(params).length > 0) {
        toolCalls.push({ 
          name: toolName, 
          params, 
          raw: match[0],
          start: match.index,
          end: match.index + match[0].length
        });
      }
    }
    
    return toolCalls;
  }

  function parseParams(body) {
    const params = {};
    body = body.trim();
    
    const bracketRegex = /(\w+):\s*<<<([\s\S]*?)>>>/g;
    let bm;
    while ((bm = bracketRegex.exec(body)) !== null) {
      params[bm[1]] = bm[2].trim();
    }
    if (Object.keys(params).length > 0) {
      const cleanBody = body.replace(/\w+:\s*<<<[\s\S]*?>>>/g, '');
      const lines = cleanBody.split(/\n/).map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        const m = line.match(/^(\w+):\s*(.+)$/);
        if (m && !params[m[1]]) params[m[1]] = m[2].trim();
      }
      return params;
    }
    
    let lines = body.split(/\n/).map(l => l.trim()).filter(Boolean);
    
    if (lines.length >= 2) {
      let currentKey = null;
      let currentValue = [];
      for (const line of lines) {
        const match = line.match(/^(\w+):\s*(.*)$/);
        if (match) {
          if (currentKey) { params[currentKey] = currentValue.join('\n').trim(); }
          currentKey = match[1];
          currentValue = match[2] ? [match[2]] : [];
        } else if (currentKey) { currentValue.push(line); }
      }
      if (currentKey) { params[currentKey] = currentValue.join('\n').trim(); }
    } else {
      const text = lines[0] || '';
      const knownKeys = ['path', 'content', 'command', 'url', 'directory', 'pattern', 'body', 'headers'];
      const keyPositions = [];
      for (const key of knownKeys) {
        const regex = new RegExp('\\b' + key + ':\\s*');
        const match = regex.exec(text);
        if (match) { keyPositions.push({ key, start: match.index, valueStart: match.index + match[0].length }); }
      }
      keyPositions.sort((a, b) => a.start - b.start);
      for (let i = 0; i < keyPositions.length; i++) {
        const curr = keyPositions[i];
        const next = keyPositions[i + 1];
        const valueEnd = next ? next.start : text.length;
        params[curr.key] = text.substring(curr.valueStart, valueEnd).trim();
      }
    }
    return params;
  }

