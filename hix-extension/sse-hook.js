// sse-hook.js — Hix.ai SSE interceptor (document_start, MAIN world)
// Hix stream: `data: {"content":"chunk"}` lines + `data: [DONE]` terminator.
// We re-emit deltas as `__sse_data__` events in content_delta format so the
// existing content.js listener picks them up unchanged.

(function () {
  'use strict';

  if (window.__SSE_HOOK_ACTIVE__) return;
  window.__SSE_HOOK_ACTIVE__ = true;

  var DISABLED_KEY = 'agent_disabled_' + location.href.split('?')[1];
  if (localStorage.getItem(DISABLED_KEY) === 'true') {
    console.log('[SSE-Hook] Disabled on this page');
    return;
  }

  function isConversationPost(url, method) {
    if (method && method.toUpperCase() !== 'POST') return false;
    if (!url) return false;
    return url.indexOf('/api/hix/chat/aiChat') !== -1 ||
           url.indexOf('/api/hix/chat/') !== -1;
  }

  function emitDelta(text) {
    document.dispatchEvent(new CustomEvent('__sse_data__', {
      detail: { data: JSON.stringify({ type: 'content_delta', text: text }) }
    }));
  }

  function emitFinish() {
    document.dispatchEvent(new CustomEvent('__sse_data__', {
      detail: { data: JSON.stringify({ type: 'status_change', status: 'finished_successfully' }) }
    }));
  }

  function interceptStream(resp, url) {
    try {
      if (!resp.body) return;
      var cloned = resp.clone();
      var reader = cloned.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';
      var accumulated = '';

      document.dispatchEvent(new CustomEvent('__sse_connected__', {
        detail: { transport: 'hix-fetch', url: url, timestamp: Date.now() }
      }));

      function processLine(line) {
        line = line.trim();
        if (!line) return;
        if (line.indexOf('event:') === 0) return;
        if (line.indexOf('data:') !== 0) return;
        var payload = line.substring(5).trim();
        if (!payload) return;

        if (payload === '[DONE]') {
          emitFinish();
          document.dispatchEvent(new CustomEvent('__sse_message_complete__', {
            detail: { timestamp: Date.now(), fullText: accumulated }
          }));
          return;
        }

        if (/^\d+$/.test(payload)) return; // numeric event IDs

        try {
          var parsed = JSON.parse(payload);
          if (typeof parsed.content === 'string' && parsed.content.length > 0) {
            accumulated += parsed.content;
            emitDelta(parsed.content);
          }
        } catch (e) {}
      }

      function pump() {
        reader.read().then(function (chunk) {
          if (chunk.done) {
            if (buffer.trim()) processLine(buffer.trim());
            document.dispatchEvent(new CustomEvent('__sse_closed__', {
              detail: { transport: 'hix-fetch', timestamp: Date.now(), fullText: accumulated }
            }));
            return;
          }
          buffer += decoder.decode(chunk.value, { stream: true });
          var lines = buffer.split('\n');
          buffer = lines.pop();
          for (var i = 0; i < lines.length; i++) processLine(lines[i]);
          pump();
        }).catch(function (err) {
          console.warn('[SSE-Hook] pump error:', err);
        });
      }
      pump();
    } catch (e) {
      console.warn('[SSE-Hook] interceptStream failed:', e);
    }
  }

  var origFetch = window.fetch;
  function hookedFetch() {
    var args = arguments;
    var url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
    var opts = args[1] || (typeof args[0] === 'object' ? args[0] : {});
    var method = (opts.method || 'GET').toUpperCase();
    var result = origFetch.apply(this, args);

    if (isConversationPost(url, method)) {
      console.log('[SSE-Hook] Intercepting hix fetch:', url);
      result.then(function (resp) { interceptStream(resp, url); }).catch(function () {});
    }
    return result;
  }

  try {
    Object.defineProperty(window, 'fetch', {
      configurable: true,
      enumerable: true,
      get: function () { return hookedFetch; },
      set: function (v) { origFetch = v; }
    });
  } catch (e) {
    window.fetch = hookedFetch;
  }

  console.log('[SSE-Hook] Hix hook installed (content_delta protocol)');
})();
