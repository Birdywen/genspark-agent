  // ============== 工具函数 ==============

  function isAIGenerating() {
    for (const sel of CONFIG.SELECTORS.STOP_BTN.split(',')) {
      try { const btn = document.querySelector(sel.trim()); if (btn && btn.offsetParent !== null) return true; } catch(e) {}
    }
    const msgs = document.querySelectorAll(CONFIG.SELECTORS.AI_MESSAGE);
    if (msgs.length > 0) {
      const last = msgs[msgs.length - 1];
      const cl = last.className.toLowerCase();
      if (cl.includes('loading') || cl.includes('streaming') || cl.includes('typing') || cl.includes('generating')) return true;
      if (last.querySelector('[class*="loading"], [class*="typing"], [class*="streaming"]')) return true;
    }
    if (state.wsState && Date.now() - state.wsState.lastMessageTime < 800) return true;
    return false;
  }

  function waitForGenerationComplete(callback, maxWait = 30000) {
    const startTime = Date.now();
    const check = () => {
      if (Date.now() - startTime > maxWait) { callback(); return; }
      if (isAIGenerating()) { setTimeout(check, 200); }
      else { setTimeout(() => { if (!isAIGenerating()) callback(); else setTimeout(check, 200); }, 500); }
    };
    check();
  }

  function safeJsonParse(str) {
    // Level 1: raw parse
    try { return JSON.parse(str); } catch(e) {}
    // Level 2: fix smart quotes + trailing commas
    try {
      const fixed = str.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'").replace(/,\s*([}\]])/g, '$1');
      return JSON.parse(fixed);
    } catch(e2) {}
    // Level 3: eval as JS object literal (handles unquoted keys like {tool: "x"})
    try {
      return (new Function('return (' + str + ')'))();
    } catch(e3) { return null; }
  }

  function truncateResult(result) {
    if (typeof result !== 'string') result = JSON.stringify(result);
    if (result.length > CONFIG.MAX_RESULT_LENGTH) return result.substring(0, CONFIG.MAX_RESULT_LENGTH) + '\n...[truncated]';
    return result;
  }
