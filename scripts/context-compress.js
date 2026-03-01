/**
 * Context Compress v2 - 上下文压缩浏览器端脚本
 * 
 * 用法：通过 eval_js 执行，分两步：
 *   Step 1: eval_js 设置 window.__COMPRESS_SUMMARY = '总结文本'
 *   Step 2: eval_js 执行本脚本（会延迟 6 秒后操作，避免被结果消息顶走）
 * 
 * 参数（全局变量）：
 *   window.__COMPRESS_TARGET_INDEX = 用户消息索引（默认 3，即第4条）
 *   window.__COMPRESS_SUMMARY = 压缩总结文本
 * 
 * 关键设计：
 *   - eval_js 立即返回，不阻塞
 *   - 6 秒后才开始操作（等新消息插入完毕、页面稳定）
 *   - 打开编辑器后自动 scrollIntoView 到目标消息
 *   - 不自动点 Save，等用户手动确认
 *   - 编辑器上方显示醒目提示条
 */

(function() {
  var targetIndex = window.__COMPRESS_TARGET_INDEX || 3;
  var summary = window.__COMPRESS_SUMMARY || '';
  
  if (!summary) {
    return JSON.stringify({error: 'No summary provided. Set window.__COMPRESS_SUMMARY first.'});
  }
  
  var summaryLen = summary.length;
  
  // 核心操作延迟执行，避免被 eval_js 结果消息顶走
  var DELAY_MS = 6000;
  
  setTimeout(function() {
    console.log('[context-compress] Starting delayed compression...');
    
    // Step 1: Find target user message
    var userStatements = document.querySelectorAll('.conversation-statement.user');
    if (targetIndex >= userStatements.length) {
      console.error('[context-compress] Target index ' + targetIndex + ' out of range. Only ' + userStatements.length + ' user messages.');
      return;
    }
    
    var stmt = userStatements[targetIndex];
    
    // Step 2: Scroll to target message first
    stmt.scrollIntoView({ behavior: 'smooth', block: 'center' });
    
    // Step 3: Force show edit button and click it (after scroll settles)
    setTimeout(function() {
      var actions = stmt.querySelectorAll('.message-action');
      for (var i = 0; i < actions.length; i++) {
        actions[i].style.visibility = 'visible';
        actions[i].style.opacity = '1';
      }
      
      var editIcon = stmt.querySelectorAll('.message-action-icon')[1];
      if (!editIcon) {
        console.error('[context-compress] Edit icon not found on target message');
        return;
      }
      editIcon.click();
      
      // Step 4: Wait for editor to appear
      var checkEditor = function(attempts) {
        var editor = stmt.querySelector('.message-editor [contenteditable="true"]');
        if (!editor && attempts < 30) {
          setTimeout(function() { checkEditor(attempts + 1); }, 200);
          return;
        }
        if (!editor) {
          console.error('[context-compress] Editor did not appear after 6 seconds');
          return;
        }
        
        // Step 5: Fill the summary
        var escaped = summary.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        editor.innerHTML = '<pre class="p-0 m-0"><code>' + escaped + '</code></pre>';
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        
        // Step 6: Scroll to editor again (in case page shifted)
        stmt.scrollIntoView({ behavior: 'smooth', block: 'center' });
        
        // Step 7: Add a visible banner so user knows to click Save
        var banner = document.createElement('div');
        banner.id = 'compress-banner';
        banner.innerHTML = '⚠️ <b>压缩总结已填入</b> — 请检查内容后点击下方的 <b>Save</b> 按钮（60秒内有效）';
        banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#f59e0b;color:#000;padding:12px 20px;font-size:15px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.3);';
        document.body.appendChild(banner);
        
        // Auto-remove banner after 60s
        setTimeout(function() {
          var b = document.getElementById('compress-banner');
          if (b) b.remove();
        }, 60000);
        
        console.log('[context-compress] ✅ Summary filled. Please click Save.');
      };
      
      // Start checking for editor
      setTimeout(function() { checkEditor(0); }, 300);
      
    }, 800); // wait 800ms for scroll to settle
    
  }, DELAY_MS);
  
  // Immediate return - don't block
  return JSON.stringify({
    status: 'timer_set',
    message: 'Compression will start in ' + (DELAY_MS/1000) + 's. Do not scroll away.',
    targetIndex: targetIndex,
    summaryLength: summaryLen
  });
})();