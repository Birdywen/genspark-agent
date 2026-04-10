// ===== compress: 压缩当前对话 + 知识注入 =====
handlers.set('compress', async (params, context) => {
  const { evalInBrowser } = context;
  if (!evalInBrowser) return { success: false, error: 'evalInBrowser not available' };
  const headN = params.headN || 3;
  const tailN = params.tailN || 30;
  const dryRun = params.dryRun || false;
  const code = `return window.__shortcuts ? window.__shortcuts.compress({headN:${headN},tailN:${tailN},dryRun:${dryRun}}) : 'error: __shortcuts not loaded'`;
  try {
    const result = await evalInBrowser(code, 120000);
    if (dryRun || !result || result.error) return { success: true, result };

    // === 压缩成功，注入知识 ===
    const Database = require('better-sqlite3');
    const path = require('path');
    const db = new Database(path.join(__dirname, 'data', 'agent.db'));

    // 1. 读 restore prompt 模板
    const tplRow = db.prepare("SELECT content FROM local_store WHERE key='compress-restore-prompt'").get();
    let restorePrompt = tplRow ? tplRow.content : 'Context restored. Compressed.';
    const midCount = result.compressed || 0;
    restorePrompt = restorePrompt.replace('{{midCount}}', midCount).replace('{{tailKeep}}', tailN);

    // 2. 读最近经验教训 (最新10条)
    const lessons = db.prepare(
      "SELECT key, substr(content,1,150) as summary FROM memory WHERE slot='forged' AND key LIKE 'lesson-%' ORDER BY key DESC LIMIT 10"
    ).all();

    // 3. 读最近7天高频错误
    const errors = db.prepare(
      "SELECT tool, substr(error,1,60) as err, COUNT(*) as cnt FROM commands WHERE success=0 AND timestamp>=date('now','-7 day') GROUP BY tool, substr(error,1,60) ORDER BY cnt DESC LIMIT 5"
    ).all();

    // 4. 读当前活跃的 memory 条目 (最近更新的 forged 计划/上下文)
    const recentContext = db.prepare(
      "SELECT key, substr(content,1,200) as preview FROM memory WHERE slot='forged' AND key LIKE 'plan-%' ORDER BY rowid DESC LIMIT 3"
    ).all();

    // 5. 读可用脚本索引
    const scripts = db.prepare(
      "SELECT key FROM local_store WHERE key LIKE 'script/%' ORDER BY key LIMIT 15"
    ).all();

    // 6. 读 forged 核心规则摘要 (schema-rules 的 daily 字段)
    const rulesRow = db.prepare("SELECT content FROM memory WHERE slot='forged' AND key='schema-rules'").get();
    let dailyRules = [];
    if (rulesRow) {
      try { dailyRules = JSON.parse(rulesRow.content).daily || []; } catch(e) {}
    }

    db.close();

    // 7. 拼装知识注入内容
    const knowledgeLines = ['\n---\n## 知识补充 (compress自动注入)'];

    if (dailyRules.length > 0) {
      knowledgeLines.push('\n### 核心规则');
      dailyRules.forEach(r => knowledgeLines.push('- ' + r));
    }

    if (recentContext.length > 0) {
      knowledgeLines.push('\n### 当前项目上下文');
      recentContext.forEach(c => knowledgeLines.push('- **' + c.key + '**: ' + c.preview));
    }

    if (errors.length > 0) {
      knowledgeLines.push('\n### 近7天高频错误');
      errors.forEach(e => knowledgeLines.push('- ' + e.tool + '(' + e.cnt + '次): ' + e.err));
    }

    if (lessons.length > 0) {
      knowledgeLines.push('\n### 最近经验教训');
      lessons.forEach(l => knowledgeLines.push('- ' + l.key + ': ' + l.summary));
    }

    if (scripts.length > 0) {
      knowledgeLines.push('\n### 可用脚本');
      knowledgeLines.push(scripts.map(s => s.key.replace('script/','')).join(', '));
    }

    restorePrompt += knowledgeLines.join('\n');

    // 8. 追加为 user message 到对话末尾
    const injectCode = `
      var pid = new URLSearchParams(window.location.search).get('id');
      if (!pid) return {error:'no pid'};
      return fetch('/api/project/update', {
        method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include',
        body: JSON.stringify({id:pid, request_not_update_permission:true})
      }).then(r=>r.json()).then(d=>{
        var ss = d.data.session_state;
        ss.messages.push({
          id: 'compress-inject-' + Date.now(),
          role: 'user',
          content: ${JSON.stringify(restorePrompt)}
        });
        return fetch('/api/project/update', {
          method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include',
          body: JSON.stringify({id:pid, session_state:ss, request_not_update_permission:true})
        }).then(r2=>r2.json()).then(d2=>({injected:true, totalMsgs:d2.data.session_state.messages.length}));
      });
    `;
    const injectResult = await evalInBrowser(injectCode, 30000);
    result.knowledgeInjected = injectResult;

    return { success: true, result };
  } catch (e) {
    return { success: false, error: e.message };
  }
});
