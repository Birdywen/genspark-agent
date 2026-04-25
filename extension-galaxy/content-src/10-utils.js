function log(...args) {
    if (CONFIG.DEBUG) console.log('[Agent]', ...args);
  }

  // ============== AI 生成状态检测 ==============
  
  // isAIGenerating: moved to 30-dom-galaxy.js catch (e) {}
  function waitForGenerationComplete(callback, maxWait = 30000) {
    const startTime = Date.now();
    const check = () => {
      if (Date.now() - startTime > maxWait) { callback(); return; }
      if (isAIGenerating()) { setTimeout(check, 200); }
      else { setTimeout(() => { if (!isAIGenerating()) callback(); else setTimeout(check, 200); }, 500); }
    };
    check();
  }

