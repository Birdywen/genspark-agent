  // ============== Conversation Cache v1 (read-only shadow cache) ==============

  (function initConversationCache() {
    if (window.conversationCache) return;

    var currentId = null;
    var lastCaptureAt = 0;
    var capturePending = null;
    var AUTO_CAPTURE_MS = 60000;

    function conversationIdFromUrl() {
      try {
        var url = new URL(window.location.href);
        return url.searchParams.get('id') || '';
      } catch (error) {
        return '';
      }
    }

    function send(message) {
      return new Promise(function(resolve, reject) {
        try {
          chrome.runtime.sendMessage(message, function(response) {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            if (!response) {
              reject(new Error('Empty response from conversation cache'));
              return;
            }
            if (response.ok === false) {
              reject(new Error(response.error || 'Conversation cache request failed'));
              return;
            }
            resolve(response);
          });
        } catch (error) {
          reject(error);
        }
      });
    }

    async function readConversation(conversationId) {
      conversationId = conversationId || conversationIdFromUrl();
      if (!conversationId) throw new Error('No conversation id in current URL');
      var response = await fetch('/api/project/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          id: conversationId,
          request_not_update_permission: true
        })
      });
      if (!response.ok) throw new Error('Conversation API returned HTTP ' + response.status);
      var payload = await response.json();
      if (!payload || !payload.data) throw new Error('Conversation API returned no data');
      return payload.data;
    }

    async function capture(reason, options) {
      options = options || {};
      var conversationId = options.conversationId || conversationIdFromUrl();
      if (!conversationId) return { ok: false, skipped: true, reason: 'no_conversation_id' };
      var now = Date.now();
      if (!options.force && capturePending) return capturePending;
      if (!options.force && now - lastCaptureAt < 3000) {
        return { ok: true, skipped: true, reason: 'debounced' };
      }

      capturePending = (async function() {
        var data = await readConversation(conversationId);
        var response = await send({
          type: 'CONV_CACHE_SAVE',
          conversationId: conversationId,
          data: data,
          options: {
            reason: reason || 'manual',
            savedAt: new Date().toISOString()
          }
        });
        lastCaptureAt = Date.now();
        return response;
      })();

      try {
        return await capturePending;
      } finally {
        capturePending = null;
      }
    }

    async function list(options) {
      var response = await send({
        type: 'CONV_CACHE_LIST',
        options: options || {}
      });
      return response.result || [];
    }

    async function latest(conversationId) {
      var response = await send({
        type: 'CONV_CACHE_LATEST',
        conversationId: conversationId || conversationIdFromUrl()
      });
      return response.result || null;
    }

    async function get(snapshotId) {
      var response = await send({
        type: 'CONV_CACHE_GET',
        snapshotId: snapshotId
      });
      return response.result || null;
    }

    async function diff(options) {
      options = options || {};
      if (!options.conversationId && !options.olderSnapshotId) {
        options.conversationId = conversationIdFromUrl();
      }
      var response = await send({
        type: 'CONV_CACHE_DIFF',
        options: options
      });
      return response.result;
    }

    async function search(query, options) {
      if (!String(query || '').trim()) return [];
      var response = await send({
        type: 'CONV_CACHE_SEARCH',
        query: String(query),
        options: options || {}
      });
      return response.result || [];
    }

    async function handoff(options) {
      options = options || {};
      if (!options.snapshotId && !options.conversationId) {
        options.conversationId = conversationIdFromUrl();
      }
      var response = await send({
        type: 'CONV_CACHE_HANDOFF',
        options: options
      });
      return response.result;
    }

    async function stats() {
      var response = await send({ type: 'CONV_CACHE_STATS' });
      return response.result;
    }

    async function copyHandoff(options) {
      var result = await handoff(options || {});
      await navigator.clipboard.writeText(result.text);
      return result;
    }

    async function captureAndDiff(reason) {
      var conversationId = conversationIdFromUrl();
      var before = await list({ conversationId: conversationId, limit: 1 });
      var saved = await capture(reason || 'manual', { force: true });
      var after = await list({ conversationId: conversationId, limit: 1 });
      if (!before.length || !after.length || before[0].snapshotId === after[0].snapshotId) {
        return { saved: saved, diff: null };
      }
      return {
        saved: saved,
        diff: await diff({
          olderSnapshotId: before[0].snapshotId,
          newerSnapshotId: after[0].snapshotId
        })
      };
    }

    async function recordArchaeologyRef(payload) {
      payload = payload || {};
      try {
        var conversationId = payload.conversation_id || payload.conversationId || conversationIdFromUrl();
        if (!conversationId || !payload.ref_type) return { ok: false, skipped: true, reason: 'missing_ids' };
        var body = {
          conversation_id: conversationId,
          snapshot_id: payload.snapshot_id || payload.snapshotId || null,
          message_id: payload.message_id || payload.messageId || null,
          command_id: payload.command_id || payload.commandId || null,
          ref_type: payload.ref_type,
          source: payload.source || 'ui',
          meta: payload.meta || null,
          title: payload.title || null,
          message_count: payload.message_count || payload.messageCount || null,
          force: !!payload.force,
          messages: payload.messages || null,
          head_json: payload.head_json || null
        };
        var response = await fetch('http://127.0.0.1:8766/conversation-ref', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        if (!response.ok) {
          var errText = await response.text();
          throw new Error('conversation-ref HTTP ' + response.status + ' ' + String(errText).slice(0, 200));
        }
        return await response.json();
      } catch (error) {
        console.warn('[ConversationCache] recordArchaeologyRef failed:', error);
        return { ok: false, error: error && error.message ? error.message : String(error) };
      }
    }

    window.conversationCache = {
      version: 1,
      currentId: conversationIdFromUrl,
      readConversation: readConversation,
      capture: capture,
      captureAndDiff: captureAndDiff,
      list: list,
      latest: latest,
      get: get,
      diff: diff,
      search: search,
      handoff: handoff,
      copyHandoff: copyHandoff,
      stats: stats,
      recordRef: recordArchaeologyRef
    };

    function safeAutoCapture(reason) {
      capture(reason).then(function(result) {
        if (result && !result.skipped && typeof addLog === 'function') {
          var suffix = result.deduplicated ? '（无变化）' : '（新快照）';
          addLog('🧠 对话缓存已保存 ' + suffix, 'success');
        }
      }).catch(function(error) {
        console.warn('[ConversationCache] auto capture failed:', error);
      });
    }

    function detectConversationChange() {
      var id = conversationIdFromUrl();
      if (!id || id === currentId) return;
      currentId = id;
      setTimeout(function() { safeAutoCapture('conversation-open'); }, 1500);
    }

    currentId = conversationIdFromUrl();
    if (currentId) setTimeout(function() { safeAutoCapture('extension-load'); }, 2500);

    setInterval(function() {
      detectConversationChange();
      if (conversationIdFromUrl()) safeAutoCapture('interval');
    }, AUTO_CAPTURE_MS);

    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'hidden' && conversationIdFromUrl()) {
        safeAutoCapture('visibility-hidden');
      } else if (document.visibilityState === 'visible') {
        detectConversationChange();
      }
    });

    console.log('[ConversationCache] v1 client ready');
  })();