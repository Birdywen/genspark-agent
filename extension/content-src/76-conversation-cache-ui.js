  // ============== Conversation Cache v1 UI ==============

  (function initConversationCacheUI() {
    if (window.conversationCacheUI) return;

    var overlayId = 'conversation-cache-overlay';

    async function recordUiRef(payload) {
      try {
        if (!window.conversationCache || !window.conversationCache.recordRef) return null;
        return await window.conversationCache.recordRef(payload || {});
      } catch (error) {
        console.warn('[ConversationCacheUI] recordUiRef failed:', error);
        return null;
      }
    }

    function escapeHtml(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function formatTime(value) {
      if (!value) return 'unknown';
      try { return new Date(value).toLocaleString(); }
      catch (error) { return String(value); }
    }

    function getElements() {
      return {
        overlay: document.getElementById(overlayId),
        status: document.getElementById('conversation-cache-status'),
        results: document.getElementById('conversation-cache-results'),
        query: document.getElementById('conversation-cache-query')
      };
    }

    function setStatus(message, kind) {
      var element = getElements().status;
      if (!element) return;
      element.textContent = message;
      element.dataset.kind = kind || 'info';
    }

    function renderEmpty(message) {
      var results = getElements().results;
      if (!results) return;
      results.innerHTML = '<div class="cc-empty">' + escapeHtml(message) + '</div>';
    }

    function renderSnapshots(rows) {
      var results = getElements().results;
      if (!results) return;
      if (!rows.length) {
        renderEmpty('当前对话还没有缓存快照。');
        return;
      }
      results.innerHTML = rows.map(function(row) {
        return '<div class="cc-card">' +
          '<div class="cc-card-title">' + escapeHtml(row.title || row.conversationId) + '</div>' +
          '<div class="cc-meta">' + escapeHtml(formatTime(row.savedAt)) +
          ' · ' + escapeHtml(row.reason) +
          ' · ' + row.messageCount + ' 条消息</div>' +
          '<div class="cc-hash">' + escapeHtml(row.snapshotHash) + '</div>' +
          '</div>';
      }).join('');
    }

    function renderSearch(rows) {
      var results = getElements().results;
      if (!results) return;
      if (!rows.length) {
        renderEmpty('没有找到匹配的历史内容。');
        return;
      }
      results.innerHTML = rows.map(function(row) {
        return '<div class="cc-card">' +
          '<div class="cc-card-title">' + escapeHtml(row.title || row.conversationId) + '</div>' +
          '<div class="cc-meta">' + escapeHtml(formatTime(row.savedAt)) +
          ' · ' + escapeHtml(row.role) +
          ' · message ' + escapeHtml(row.messageId) + '</div>' +
          '<div class="cc-preview">' + escapeHtml(row.preview) + '</div>' +
          '</div>';
      }).join('');
    }

    function renderDiff(diff) {
      var results = getElements().results;
      if (!results) return;
      if (!diff) {
        renderEmpty('只有一个快照，暂时无法比较。');
        return;
      }
      var sections = [
        { name: '新增', rows: diff.added || [], color: '#34d399' },
        { name: '删除', rows: diff.removed || [], color: '#f87171' },
        { name: '修改', rows: diff.changed || [], color: '#fbbf24' }
      ];
      var html = '<div class="cc-summary">消息数 ' + diff.oldCount + ' → ' + diff.newCount +
        '；新增 ' + diff.added.length +
        '，删除 ' + diff.removed.length +
        '，修改 ' + diff.changed.length + '</div>';
      sections.forEach(function(section) {
        if (!section.rows.length) return;
        html += '<div class="cc-section-title" style="color:' + section.color + '">' +
          section.name + '（' + section.rows.length + '）</div>';
        section.rows.slice(0, 20).forEach(function(row) {
          var body = row.after || row.preview || '';
          html += '<div class="cc-card"><div class="cc-meta">' +
            escapeHtml(row.role || '') + ' · ' + escapeHtml(row.id) +
            '</div><div class="cc-preview">' + escapeHtml(body) + '</div></div>';
        });
      });
      if (diff.identical) html += '<div class="cc-empty">两个快照内容完全一致。</div>';
      results.innerHTML = html;
    }

    async function loadCurrentSnapshots() {
      var cache = window.conversationCache;
      var conversationId = cache.currentId();
      if (!conversationId) {
        renderEmpty('当前 URL 没有 conversation id。');
        return;
      }
      setStatus('正在读取最近快照…');
      var rows = await cache.list({ conversationId: conversationId, limit: 20 });
      renderSnapshots(rows);
      setStatus('当前对话共有 ' + rows.length + ' 个保留快照', 'success');
    }

    async function captureNow() {
      setStatus('正在从网页 API 读取完整会话并保存…');
      var result = await window.conversationCache.capture('manual-ui', { force: true });
      try {
        var snapId = result && (result.snapshotId || (result.saved && result.saved.snapshotId) || result.snapshot_id);
        if (!snapId && result && result.result && result.result.snapshotId) snapId = result.result.snapshotId;
        if (snapId) {
          await recordUiRef({
            ref_type: 'manual',
            source: 'ui',
            snapshot_id: snapId,
            force: true,
            title: result.title || (result.saved && result.saved.title) || null,
            message_count: result.messageCount || (result.saved && result.saved.messageCount) || null,
            meta: { reason: 'manual-capture' }
          });
        }
      } catch (e) { console.warn('[ConversationCacheUI] capture ref failed', e); }
      var note = result.deduplicated ? '内容无变化，已去重' : '已创建新快照';
      setStatus(note + ' · ' + result.messageCount + ' 条消息', 'success');
      await loadCurrentSnapshots();
    }

    async function searchNow() {
      var query = getElements().query.value.trim();
      if (!query) {
        setStatus('请输入关键词', 'error');
        return;
      }
      setStatus('正在搜索最多 200 个历史快照…');
      var rows = await window.conversationCache.search(query, {
        maxSnapshots: 200,
        limit: 30
      });
      renderSearch(rows);
      try {
        var top = rows && rows[0];
        await recordUiRef({
          ref_type: 'search',
          source: 'ui',
          snapshot_id: top && top.snapshotId || null,
          message_id: top && top.messageId || null,
          meta: { query: query, hits: rows.length }
        });
      } catch (e) {}
      setStatus('找到 ' + rows.length + ' 条候选结果', 'success');
    }

    async function diffLatest() {
      var conversationId = window.conversationCache.currentId();
      setStatus('正在比较最近两个快照…');
      var rows = await window.conversationCache.list({
        conversationId: conversationId,
        limit: 2
      });
      if (rows.length < 2) {
        renderDiff(null);
        setStatus('至少需要两个不同快照', 'error');
        return;
      }
      var diff = await window.conversationCache.diff({
        olderSnapshotId: rows[1].snapshotId,
        newerSnapshotId: rows[0].snapshotId
      });
      try { await recordUiRef({ ref_type: 'diff', source: 'ui', snapshot_id: (rows[0] && rows[0].snapshotId) || null, meta: { action: 'diff-latest' } }); } catch (e) {}
      renderDiff(diff);
      setStatus(diff.identical ? '两个快照完全一致' : '差异计算完成', 'success');
    }

    async function copyHandoff() {
      setStatus('正在筛选有价值内容并生成接力包…');
      var result = await window.conversationCache.copyHandoff({ maxMessages: 18 });
      try { await recordUiRef({ ref_type: 'handoff', source: 'ui', force: true, meta: { action: 'handoff' } }); } catch (e) {}
      setStatus('接力包已复制：筛选 ' + result.selectedCount + ' 条消息', 'success');
      var results = getElements().results;
      results.innerHTML = '<pre class="cc-handoff">' + escapeHtml(result.text) + '</pre>';
    }

    async function loadStats() {
      var stats = await window.conversationCache.stats();
      setStatus('IndexedDB：' + stats.conversations + ' 个对话，' +
        stats.snapshots + ' 个快照；每对话最多保留 ' +
        stats.retentionPerConversation + ' 个', 'success');
    }

    function close() {
      var overlay = document.getElementById(overlayId);
      if (overlay) overlay.remove();
    }

    function open() {
      close();
      var overlay = document.createElement('div');
      overlay.id = overlayId;
      overlay.innerHTML =
        '<div id="conversation-cache-modal">' +
          '<div class="cc-header">' +
            '<div><strong>🧠 Omega Conversation Cache</strong>' +
            '<div class="cc-subtitle">只读影子缓存 · 不回写网页对话</div></div>' +
            '<button id="conversation-cache-close">×</button>' +
          '</div>' +
          '<div class="cc-toolbar">' +
            '<button id="cc-capture">保存快照</button>' +
            '<button id="cc-list">最近快照</button>' +
            '<button id="cc-diff">比较最近两版</button>' +
            '<button id="cc-handoff">复制接力包</button>' +
            '<button id="cc-stats">统计</button>' +
          '</div>' +
          '<div class="cc-search">' +
            '<input id="conversation-cache-query" placeholder="搜索一周前的结论、路径、错误或关键词">' +
            '<button id="cc-search">搜索全部历史</button>' +
          '</div>' +
          '<div id="conversation-cache-status">准备就绪</div>' +
          '<div id="conversation-cache-results"></div>' +
        '</div>';
      document.body.appendChild(overlay);

      document.getElementById('conversation-cache-close').onclick = close;
      overlay.addEventListener('click', function(event) {
        if (event.target === overlay) close();
      });
      document.getElementById('cc-capture').onclick = function() {
        captureNow().catch(showError);
      };
      document.getElementById('cc-list').onclick = function() {
        loadCurrentSnapshots().catch(showError);
      };
      document.getElementById('cc-diff').onclick = function() {
        diffLatest().catch(showError);
      };
      document.getElementById('cc-handoff').onclick = function() {
        copyHandoff().catch(showError);
      };
      document.getElementById('cc-stats').onclick = function() {
        loadStats().catch(showError);
      };
      document.getElementById('cc-search').onclick = function() {
        searchNow().catch(showError);
      };
      document.getElementById('conversation-cache-query').addEventListener('keydown', function(event) {
        if (event.key === 'Enter') searchNow().catch(showError);
      });

      loadCurrentSnapshots().catch(showError);
    }

    function showError(error) {
      console.error('[ConversationCacheUI]', error);
      setStatus(error.message || String(error), 'error');
    }

    function installButton() {
      var actions = document.getElementById('agent-actions');
      if (!actions || document.getElementById('agent-conversation-cache')) return false;
      var button = document.createElement('button');
      button.id = 'agent-conversation-cache';
      button.textContent = '🧠 缓存';
      button.title = '对话快照、历史搜索、差异比较与接力包';
      button.style.background = '#065f46';
      button.onclick = open;
      var minimize = document.getElementById('agent-minimize');
      actions.insertBefore(button, minimize || null);
      return true;
    }

    function installStyles() {
      if (document.getElementById('conversation-cache-styles')) return;
      var style = document.createElement('style');
      style.id = 'conversation-cache-styles';
      style.textContent =
        '#' + overlayId + '{position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:2147483647;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif}' +
        '#conversation-cache-modal{width:min(900px,92vw);height:min(720px,88vh);background:#111827;color:#e5e7eb;border:1px solid #374151;border-radius:14px;box-shadow:0 24px 80px rgba(0,0,0,.6);display:flex;flex-direction:column;overflow:hidden}' +
        '.cc-header{display:flex;justify-content:space-between;align-items:center;padding:16px 18px;border-bottom:1px solid #374151;background:#0f172a}.cc-subtitle{font-size:11px;color:#9ca3af;margin-top:3px}' +
        '#conversation-cache-close{background:none;border:0;color:#9ca3af;font-size:28px;cursor:pointer}' +
        '.cc-toolbar,.cc-search{display:flex;gap:8px;padding:10px 14px;border-bottom:1px solid #253047;flex-wrap:wrap}' +
        '.cc-toolbar button,.cc-search button{background:#374151;color:#e5e7eb;border:0;border-radius:6px;padding:7px 10px;cursor:pointer}.cc-toolbar button:hover,.cc-search button:hover{background:#4b5563}' +
        '.cc-search input{flex:1;min-width:260px;background:#0b1220;color:#e5e7eb;border:1px solid #374151;border-radius:6px;padding:8px 10px}' +
        '#conversation-cache-status{padding:9px 14px;color:#93c5fd;background:#101827;border-bottom:1px solid #253047;font-size:12px}' +
        '#conversation-cache-status[data-kind=\"success\"]{color:#6ee7b7}#conversation-cache-status[data-kind=\"error\"]{color:#fca5a5}' +
        '#conversation-cache-results{padding:14px;overflow:auto;flex:1}.cc-card{background:#182235;border:1px solid #2d3a50;border-radius:8px;padding:10px 12px;margin-bottom:8px}' +
        '.cc-card-title{font-weight:600;color:#bfdbfe}.cc-meta,.cc-hash{font-size:11px;color:#94a3b8;margin-top:4px}.cc-hash{font-family:monospace}.cc-preview{margin-top:7px;line-height:1.5;white-space:pre-wrap;word-break:break-word}' +
        '.cc-empty{padding:28px;text-align:center;color:#94a3b8}.cc-summary{padding:10px;background:#1e293b;border-radius:8px;margin-bottom:12px}.cc-section-title{font-weight:700;margin:14px 0 7px}' +
        '.cc-handoff{white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.5;margin:0}';
      document.head.appendChild(style);
    }

    installStyles();
    var attempts = 0;
    var timer = setInterval(function() {
      attempts++;
      if (installButton() || attempts > 60) clearInterval(timer);
    }, 500);

    window.conversationCacheUI = {
      open: open,
      close: close,
      capture: captureNow,
      search: searchNow,
      diffLatest: diffLatest,
      copyHandoff: copyHandoff
    };
  })();