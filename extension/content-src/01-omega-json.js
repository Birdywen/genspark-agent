  // Omega payload parser: strict JSON, deterministic repair, and lossless raw blocks.
  function omegaJsonError(error, text) {
    const match = String(error && error.message || error).match(/position ([0-9]+)/i);
    if (!match) return error;
    const pos = Number(match[1]);
    const before = text.slice(0, pos);
    const lf = String.fromCharCode(10);
    const line = before.split(lf).length;
    const last = before.lastIndexOf(lf);
    const column = pos - last;
    const context = text.slice(Math.max(0, pos - 60), Math.min(text.length, pos + 60)).split(lf).join('↵');
    return new SyntaxError(String(error.message) + ' | line ' + line + ', column ' + column + ' | near: ' + context);
  }

  function omegaRepairJsonControlChars(text) {
    let out = '', inString = false, escaped = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const code = ch.charCodeAt(0);
      if (escaped) { out += ch; escaped = false; continue; }
      if (code === 92) { out += ch; escaped = true; continue; }
      if (code === 34) { inString = !inString; out += ch; continue; }
      if (inString && code < 32) {
        const slash = String.fromCharCode(92);
        if (code === 10) out += slash + 'n';
        else if (code === 13) out += slash + 'r';
        else if (code === 9) out += slash + 't';
        else out += slash + 'u' + code.toString(16).padStart(4, '0');
        continue;
      }
      out += ch;
    }
    return out;
  }

  function omegaRepairJsonBrackets(text) {
    const stack = [];
    const extra = [];
    let inString = false;
    let escaped = false;
    let mismatch = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (escaped) { escaped = false; continue; }
      if (inString && ch === String.fromCharCode(92)) { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;

      if (ch === '{' || ch === '[') {
        stack.push({ ch: ch, index: i });
        continue;
      }
      if (ch !== '}' && ch !== ']') continue;

      const expected = ch === '}' ? '{' : '[';
      if (stack.length && stack[stack.length - 1].ch === expected) {
        stack.pop();
      } else if (!stack.length) {
        extra.push(i);
      } else {
        mismatch = true;
        break;
      }
    }

    if (inString || mismatch) return { text: text, actions: [] };

    if (extra.length) {
      const first = extra[0];
      if (!/^[\s}\]]*$/.test(text.slice(first))) return { text: text, actions: [] };
      const remove = new Set(extra);
      let repaired = '';
      for (let i = 0; i < text.length; i++) if (!remove.has(i)) repaired += text[i];
      return {
        text: repaired,
        actions: [{ type: 'remove_trailing_extra_brackets', count: extra.length, positions: extra.slice() }]
      };
    }

    if (stack.length) {
      let suffix = '';
      const missing = [];
      for (let i = stack.length - 1; i >= 0; i--) {
        const close = stack[i].ch === '{' ? '}' : ']';
        suffix += close;
        missing.push(close);
      }
      return {
        text: text + suffix,
        actions: [{ type: 'append_missing_brackets', value: suffix, count: missing.length }]
      };
    }

    return { text: text, actions: [] };
  }

  function omegaRepairJsonTrailingCommas(text) {
    // Remove trailing commas before } or ] outside strings. Deterministic, safe.
    let out = '';
    let inString = false;
    let escaped = false;
    let removed = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (escaped) { out += ch; escaped = false; continue; }
      if (inString && ch === String.fromCharCode(92)) { out += ch; escaped = true; continue; }
      if (ch === '"') { inString = !inString; out += ch; continue; }
      if (!inString && ch === ',') {
        let j = i + 1;
        while (j < text.length && /[ \t\r\n]/.test(text[j])) j++;
        if (j < text.length && (text[j] === '}' || text[j] === ']')) {
          removed++;
          continue; // drop comma
        }
      }
      out += ch;
    }
    if (!removed) return { text: text, actions: [] };
    return {
      text: out,
      actions: [{ type: 'remove_trailing_commas', count: removed }]
    };
  }

  function omegaRepairJsonMissingCommas(text) {
    // Insert missing commas between adjacent JSON values outside strings.
    // Lesson cases: }{  ]{  }[  ][  "a" "b"  1 "k"  true "k"  } "k".
    // Insert immediately after previous non-ws token so we never emit ", ".
    let out = '';
    let inString = false;
    let escaped = false;
    let inserted = 0;
    const isWS = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r';

    function prevNonWsIndex() {
      for (let k = out.length - 1; k >= 0; k--) {
        if (!isWS(out[k])) return k;
      }
      return -1;
    }

    function endsWithLiteral(idx) {
      if (idx < 0) return false;
      const tail = out.slice(Math.max(0, idx - 4), idx + 1);
      return /(?:true|false|null)$/.test(tail);
    }

    function needsCommaBeforeValue(prevIdx) {
      if (prevIdx < 0) return false;
      const pc = out[prevIdx];
      if (pc === '"' || pc === '}' || pc === ']') return true;
      if (/[0-9]/.test(pc)) return true;
      if ((pc === 'e' || pc === 'l') && endsWithLiteral(prevIdx)) return true;
      return false;
    }

    function insertCommaAfter(prevIdx) {
      // keep any whitespace after prev token; place comma right after token
      out = out.slice(0, prevIdx + 1) + ',' + out.slice(prevIdx + 1);
      inserted++;
    }

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (escaped) { out += ch; escaped = false; continue; }
      if (inString && ch === String.fromCharCode(92)) { out += ch; escaped = true; continue; }
      if (ch === '"') {
        if (!inString) {
          const prevIdx = prevNonWsIndex();
          if (needsCommaBeforeValue(prevIdx)) insertCommaAfter(prevIdx);
        }
        inString = !inString;
        out += ch;
        continue;
      }
      if (inString) { out += ch; continue; }

      if (ch === '{' || ch === '[') {
        const prevIdx = prevNonWsIndex();
        if (needsCommaBeforeValue(prevIdx)) insertCommaAfter(prevIdx);
        out += ch;
        continue;
      }

      out += ch;
    }

    if (!inserted) return { text: text, actions: [] };
    return {
      text: out,
      actions: [{ type: 'insert_missing_commas', count: inserted }]
    };
  }

  function omegaAttachRepairMeta(parsed, actions, originalError) {
    if (!parsed || (typeof parsed !== 'object' && !Array.isArray(parsed))) return parsed;
    const meta = {
      repaired: true,
      actions: actions,
      originalError: String(originalError && originalError.message || originalError).slice(0, 300)
    };
    try {
      Object.defineProperty(parsed, '__omegaRepair', {
        value: meta,
        enumerable: false,
        configurable: false,
        writable: false
      });
    } catch (_) {}
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[OmegaJSON] payload repaired:', actions);
    }
    return parsed;
  }

  function omegaHydrateRaw(value, blocks) {
    if (Array.isArray(value)) return value.map(function(item) { return omegaHydrateRaw(item, blocks); });
    if (!value || typeof value !== 'object') return value;
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] === '$raw') {
      const id = value.$raw;
      if (typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(blocks, id)) throw new Error('Omega raw block not found: ' + id);
      return blocks[id];
    }
    const result = {};
    for (const key of keys) result[key] = omegaHydrateRaw(value[key], blocks);
    return result;
  }

  function parseOmegaPayload(raw) {
    const lf = String.fromCharCode(10);
    const lines = String(raw || '').trim().split(lf);
    const payloadLines = [];
    const blocks = Object.create(null);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].endsWith(String.fromCharCode(13)) ? lines[i].slice(0, -1) : lines[i];
      if (!line.startsWith('ΩRAW ')) { payloadLines.push(line); continue; }
      const id = line.slice(5).trim();
      if (!id || !/^[A-Za-z0-9_.-]+$/.test(id)) throw new Error('Invalid Omega raw block id: ' + id);
      if (Object.prototype.hasOwnProperty.call(blocks, id)) throw new Error('Duplicate Omega raw block: ' + id);
      const body = [];
      let closed = false;
      for (i = i + 1; i < lines.length; i++) {
        const rawLine = lines[i].endsWith(String.fromCharCode(13)) ? lines[i].slice(0, -1) : lines[i];
        if (rawLine === 'ΩRAWEND' || rawLine === 'ΩRAWEND ' + id) { closed = true; break; }
        body.push(rawLine);
      }
      if (!closed) throw new Error('Unclosed Omega raw block: ' + id);
      blocks[id] = body.join(lf);
    }

    let payload = payloadLines.join(lf).trim();
    if (payload.startsWith('```')) {
      const firstLf = payload.indexOf(lf);
      if (firstLf !== -1) payload = payload.slice(firstLf + 1);
    }
    if (payload.endsWith('```')) payload = payload.slice(0, -3).trim();

    let parsed;
    try {
      parsed = JSON.parse(payload);
    } catch (firstError) {
      const actions = [];
      let repaired = omegaRepairJsonControlChars(payload);
      if (repaired !== payload) actions.push({ type: 'escape_control_characters' });

      // Deterministic structural repairs before giving up.
      // Order: trailing commas -> missing commas -> brackets (append/remove).
      const applyRepair = (fn, input) => {
        const r = fn(input);
        if (r.text !== input && r.actions && r.actions.length) {
          actions.push.apply(actions, r.actions);
          return r.text;
        }
        return input;
      };

      try {
        parsed = JSON.parse(repaired);
      } catch (controlError) {
        repaired = applyRepair(omegaRepairJsonTrailingCommas, repaired);
        try {
          parsed = JSON.parse(repaired);
        } catch (commaErr1) {
          repaired = applyRepair(omegaRepairJsonMissingCommas, repaired);
          try {
            parsed = JSON.parse(repaired);
          } catch (commaErr2) {
            const beforeBrackets = repaired;
            const bracketRepair = omegaRepairJsonBrackets(repaired);
            if (bracketRepair.text !== repaired) {
              repaired = bracketRepair.text;
              actions.push.apply(actions, bracketRepair.actions);
            }
            try {
              parsed = JSON.parse(repaired);
            } catch (bracketError) {
              // One more pass: commas after bracket fix (rare), then brackets again.
              let again = applyRepair(omegaRepairJsonTrailingCommas, repaired);
              again = applyRepair(omegaRepairJsonMissingCommas, again);
              if (again !== repaired) {
                repaired = again;
                try {
                  parsed = JSON.parse(repaired);
                } catch (e3) {
                  const br2 = omegaRepairJsonBrackets(repaired);
                  if (br2.text !== repaired) {
                    repaired = br2.text;
                    actions.push.apply(actions, br2.actions);
                  }
                  try {
                    parsed = JSON.parse(repaired);
                  } catch (finalErr) {
                    throw omegaJsonError(finalErr, repaired);
                  }
                }
              } else if (bracketRepair.text === beforeBrackets) {
                throw omegaJsonError(commaErr2, repaired);
              } else {
                throw omegaJsonError(bracketError, repaired);
              }
            }
          }
        }
      }
      parsed = omegaAttachRepairMeta(parsed, actions, firstError);
    }

    const hydrated = omegaHydrateRaw(parsed, blocks);
    if (parsed && parsed.__omegaRepair && hydrated && typeof hydrated === 'object') {
      try {
        Object.defineProperty(hydrated, '__omegaRepair', {
          value: parsed.__omegaRepair,
          enumerable: false,
          configurable: false,
          writable: false
        });
      } catch (_) {}
    }
    return hydrated;
  }