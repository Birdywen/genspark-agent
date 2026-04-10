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

    // 2. 读最近的 lessons (最新10条)
    const lessons = db.prepare(
      "SELECT key, substr(content,1,150) as summary FROM memory WHERE slot='forged' AND key LIKE 'lesson-%' ORDER BY key DESC LIMIT 10"
    ).all();

    // 3. 读最近7天高频错误
    const errors = db.prepare(
      "SELECT tool, substr(error,1,60) as err, COUNT(*) as cnt FROM commands WHERE success=0 AND timestamp>=date('now','-7 day') GROUP BY tool, substr(error,1,60) ORDER BY cnt DESC LIMIT 5"
    ).all();

    // 4. 读当前活跃 skills
    const skills = db.prepare(
      "SELECT key, substr(content,1,100) as preview FROM memory WHERE slot='forged' AND key LIKE 'schema-%' ORDER BY key"
    ).all();

    // 5. 读最近操作摘要 (今天的命令统计)
    const todayStats = db.prepare(
      "SELECT tool, COUNT(*) as cnt, SUM(CASE WHEN success=1 THEN 1 ELSE 0 END) as ok FROM commands WHERE timestamp>=date('now') GROUP BY tool ORDER BY cnt DESC LIMIT 10"
    ).all();

    db.close();

    // 6. 拼装知识注入内容
    const knowledgeLines = ['\n---\n## 知识补充 (compress自动注入)'];

    if (todayStats.length > 0) {
      knowledgeLines.push('\n### 今日操作统计');
      knowledgeLines.push(todayStats.map(s => `${s.tool}: ${s.ok}/${s.cnt}`).join(' | '));
    }

    if (errors.length > 0) {
      knowledgeLines.push('\n### 近7天高频错误');
      errors.forEach(e => knowledgeLines.push(`- ${e.tool}(${e.cnt}次): ${e.err}`));
    }

    if (lessons.length > 0) {
      knowledgeLines.push('\n### 最近经验教训');
      lessons.forEach(l => knowledgeLines.push(`- ${l.key}: ${l.summary}`));
    }

    restorePrompt += knowledgeLines.join('\n');

    // 7. 追加为 user message 到对话末尾
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
