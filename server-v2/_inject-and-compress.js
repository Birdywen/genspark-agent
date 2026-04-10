// ===== compress: 压缩当前对话 =====
handlers.set('compress', async (params, context) => {
  const { evalInBrowser } = context;
  if (!evalInBrowser) return { success: false, error: 'evalInBrowser not available' };
  const headN = params.headN || 3;
  const tailN = params.tailN || 30;
  const dryRun = params.dryRun || false;
  const code = `return window.__shortcuts ? window.__shortcuts.compress({headN:${headN},tailN:${tailN},dryRun:${dryRun}}) : 'error: __shortcuts not loaded'`;
  try {
    const result = await evalInBrowser(code, 120000);
    return { success: true, result };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ===== inject: 向当前对话注入知识 =====
handlers.set('inject', async (params, context) => {
  const { evalInBrowser } = context;
  if (!evalInBrowser) return { success: false, error: 'evalInBrowser not available' };

  const action = params.action || 'inject'; // inject | update | clear | preview
  const dbPath = path.join(__dirname, 'data', 'agent.db');
  const db = new Database(dbPath);

  try {
    if (action === 'clear') {
      db.close();
      // 删除所有 injected- 开头的 messages
      const clearCode = `
        var pid = new URLSearchParams(window.location.search).get('id');
        if (!pid) return {error:'no pid'};
        return window.readSlotFull(pid).then(function(data) {
          var ss = data.session_state || {messages:[]};
          var before = ss.messages.length;
          ss.messages = ss.messages.filter(function(m) { return !m.id || !m.id.startsWith('injected-'); });
          var after = ss.messages.length;
          return fetch('/api/project/update', {
            method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include',
            body: JSON.stringify({id:pid, session_state:ss, request_not_update_permission:true})
          }).then(function(r){return r.json()}).then(function(d){
            return {cleared: before - after, remaining: after};
          });
        });
      `;
      const result = await evalInBrowser(clearCode, 30000);
      return { success: true, action: 'clear', result };
    }

    // 构建注入内容
    const sections = [];

    // 1. 核心规则
    const rulesRow = db.prepare("SELECT content FROM memory WHERE slot='forged' AND key='schema-rules'").get();
    if (rulesRow) {
      try {
        const rules = JSON.parse(rulesRow.content);
        if (rules.daily && rules.daily.length > 0) {
          sections.push('### 核心规则\n' + rules.daily.map(r => '- ' + r).join('\n'));
        }
      } catch(e) {}
    }

    // 2. 当前项目上下文
    const plans = db.prepare(
      "SELECT key, substr(content,1,200) as preview FROM memory WHERE slot='forged' AND key LIKE 'plan-%' ORDER BY rowid DESC LIMIT 3"
    ).all();
    if (plans.length > 0) {
      sections.push('### 当前项目上下文\n' + plans.map(p => '- **' + p.key + '**: ' + p.preview).join('\n'));
    }

    // 3. 近7天高频错误
    const errors = db.prepare(
      "SELECT tool, substr(error,1,60) as err, COUNT(*) as cnt FROM commands WHERE success=0 AND timestamp>=date('now','-7 day') GROUP BY tool, substr(error,1,60) ORDER BY cnt DESC LIMIT 5"
    ).all();
    if (errors.length > 0) {
      sections.push('### 近7天高频错误\n' + errors.map(e => '- ' + e.tool + '(' + e.cnt + '次): ' + e.err).join('\n'));
    }

    // 4. 最近经验教训
    const lessons = db.prepare(
      "SELECT key, substr(content,1,150) as summary FROM memory WHERE slot='forged' AND key LIKE 'lesson-%' ORDER BY key DESC LIMIT 10"
    ).all();
    if (lessons.length > 0) {
      sections.push('### 最近经验教训\n' + lessons.map(l => '- ' + l.summary).join('\n'));
    }

    // 5. 可用脚本
    const scripts = db.prepare(
      "SELECT key FROM local_store WHERE key LIKE 'script/%' ORDER BY key LIMIT 15"
    ).all();
    if (scripts.length > 0) {
      sections.push('### 可用脚本\n' + scripts.map(s => s.key.replace('script/','')).join(', '));
    }

    // 6. 自定义内容
    if (params.extra) {
      sections.push('### 补充\n' + params.extra);
    }

    db.close();

    const content = '## VFS Context (知识注入)\n' + sections.join('\n\n');

    if (action === 'preview') {
      return { success: true, action: 'preview', content, chars: content.length };
    }

    // inject or update: 先清旧的再注入新的
    const injectCode = `
      var pid = new URLSearchParams(window.location.search).get('id');
      if (!pid) return {error:'no pid'};
      return window.readSlotFull(pid).then(function(data) {
        var ss = data.session_state || {messages:[]};
        // 清除旧的注入
        ss.messages = ss.messages.filter(function(m) { return !m.id || !m.id.startsWith('injected-'); });
        // 注入新的到前面(forged后面)
        ss.messages.unshift({
          id: 'injected-knowledge-' + Date.now(),
          role: 'user',
          content: ${JSON.stringify(content)}
        });
        return fetch('/api/project/update', {
          method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include',
          body: JSON.stringify({id:pid, session_state:ss, request_not_update_permission:true})
        }).then(function(r){return r.json()}).then(function(d){
          var cnt = d.data && d.data.session_state ? d.data.session_state.messages.length : -1;
          return {injected:true, totalMsgs:cnt};
        });
      });
    `;
    const result = await evalInBrowser(injectCode, 30000);
    return { success: true, action, result, chars: content.length };
  } catch (e) {
    db.close();
    return { success: false, error: e.message };
  }
});
