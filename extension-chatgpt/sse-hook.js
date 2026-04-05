// sse-hook.js — ChatGPT SSE interceptor (runs at document_start in MAIN world)
// Hooks fetch + WebSocket + EventSource to capture raw streaming data
// Uses defineProperty to survive ChatGPT bundle overwriting fetch

(function() {
  'use strict';

  if (window.__SSE_HOOK_ACTIVE__) return;
  window.__SSE_HOOK_ACTIVE__ = true;

  // Per-tab disable check
  var DISABLED_KEY = 'agent_disabled_' + location.href.split('?')[1];
  if (localStorage.getItem(DISABLED_KEY) === 'true') {
    console.log('[SSE-Hook] Disabled on this page');
    return;
  }

  // ── Helper: check if URL is a ChatGPT conversation POST ──
  function isConversationPost(url, method) {
    if (method && method.toUpperCase() !== 'POST') return false;
    return url.indexOf('backend-api') !== -1 &&
           url.indexOf('conversation') !== -1 &&
           url.indexOf('limit') === -1 &&
           url.indexOf('history') === -1 &&
           url.indexOf('prepare') === -1;
  }

  // ── Helper: parse SSE lines from a fetch stream ──
  function interceptStream(resp, url) {
    try {
      if (!resp.body) return;
      var cloned = resp.clone();
      var reader = cloned.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';

      document.dispatchEvent(new CustomEvent('__sse_connected__', {
        detail: { transport: 'chatgpt-fetch', url: url, timestamp: Date.now() }
      }));

      function processLine(line) {
        line = line.trim();
        if (!line) return;
        if (line.startsWith('data: ')) {
          var jsonStr = line.substring(6);
          if (jsonStr === '[DONE]') {
            document.dispatchEvent(new CustomEvent('__sse_message_complete__', {
              detail: { timestamp: Date.now() }
            }));
            return;
          }
          try {
            var parsed = JSON.parse(jsonStr);
            var patches = parsed.v ? (Array.isArray(parsed.v) ? parsed.v : [parsed]) : (parsed.p ? [parsed] : []);
            for (var j = 0; j < patches.length; j++) {
              var patch = patches[j];
              if (patch.p === '/message/content/parts/0' && patch.o === 'append' && patch.v) {
                document.dispatchEvent(new CustomEvent('__sse_data__', {
                  detail: {
                    data: JSON.stringify({ type: 'content_delta', text: patch.v }),
                    timestamp: Date.now()
                  }
                }));
              }
              if (patch.p === '/message/status' && patch.o === 'replace' && patch.v === 'finished_successfully') {
                document.dispatchEvent(new CustomEvent('__sse_data__', {
                  detail: {
                    data: JSON.stringify({ type: 'status_change', status: 'finished_successfully' }),
                    timestamp: Date.now()
                  }
                }));
              }
            }
          } catch(e) {}
        }
      }

      function pump() {
        reader.read().then(function(chunk) {
          if (chunk.done) {
            if (buffer.trim()) processLine(buffer.trim());
            document.dispatchEvent(new CustomEvent('__sse_closed__', {
              detail: { transport: 'chatgpt-fetch', timestamp: Date.now() }
            }));
            return;
          }
          buffer += decoder.decode(chunk.value, { stream: true });
          var lines = buffer.split('\n');
          buffer = lines.pop();
          for (var i = 0; i < lines.length; i++) {
            processLine(lines[i]);
          }
          pump();
        }).catch(function(e) {
          console.error('[SSE-Hook] Stream read error:', e);
        });
      }

      pump();
    } catch(e) {
      console.error('[SSE-Hook] interceptStream error:', e);
    }
  }

  // ── Wrap any fetch function to add our interception ──
  function wrapFetch(originalFetch) {
    return function() {
      var args = arguments;
      var url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
      var opts = args[1] || (typeof args[0] === 'object' && !(args[0] instanceof Request) ? args[0] : {});
      var method = 'GET';
      if (opts.method) method = opts.method;
      else if (args[0] instanceof Request) method = args[0].method || 'GET';

      var result = originalFetch.apply(this, args);

      if (isConversationPost(url, method)) {
        console.log('[SSE-Hook] Intercepting conversation fetch:', url.substring(0, 80));
        result.then(function(resp) {
          interceptStream(resp, url);
        }).catch(function(e) {});
      }
      return result;
    };
  }

  // ── Hook fetch with defineProperty protection ──
  // Ported from Genspark extension's battle-tested approach
  (function hookFetch() {
    var __currentFetch = wrapFetch(window.fetch);

    try {
      Object.defineProperty(window, 'fetch', {
        get: function() { return __currentFetch; },
        set: function(newFetch) {
          // ChatGPT's bundle is overwriting fetch — wrap their version too
          console.log('[SSE-Hook] fetch overwrite detected, re-wrapping');
          __currentFetch = wrapFetch(newFetch);
        },
        configurable: true,
        enumerable: true
      });
    } catch(e) {
      // defineProperty failed — fallback to simple hook + polling
      console.warn('[SSE-Hook] defineProperty failed, using polling fallback:', e.message);
      window.fetch = __currentFetch;
      var _lastFetchRef = window.fetch;
      setInterval(function() {
        if (window.fetch !== _lastFetchRef) {
          console.log('[SSE-Hook] fetch replaced, re-hooking via poll');
          window.fetch = wrapFetch(window.fetch);
          _lastFetchRef = window.fetch;
        }
      }, 500);
    }
  })();

  // ── Hook WebSocket ──
  var OrigWebSocket = window.WebSocket;

  window.WebSocket = function(url, protocols) {
    var ws = protocols ? new OrigWebSocket(url, protocols) : new OrigWebSocket(url);

    var isChatGPT = url && (
      url.includes('chatgpt.com') ||
      url.includes('openai.com') ||
      url.includes('wss://')
    );

    if (isChatGPT) {
      console.log('[SSE-Hook] Intercepting WebSocket:', url);

      ws.addEventListener('message', function(event) {
        try {
          var raw = typeof event.data === 'string' ? event.data : null;
          if (!raw) return;

          var parsed = JSON.parse(raw);
          var patches = [];

          if (parsed.type === 'delta' || (parsed.v && parsed.p)) {
            patches = parsed.v ? (Array.isArray(parsed.v) ? parsed.v : [parsed]) : [parsed];
          } else if (parsed.type === 'message' && parsed.body) {
            var body = typeof parsed.body === 'string' ? JSON.parse(parsed.body) : parsed.body;
            if (body.v && body.p) patches = body.v ? (Array.isArray(body.v) ? body.v : [body]) : [body];
          } else if (Array.isArray(parsed)) {
            for (var i = 0; i < parsed.length; i++) {
              if (parsed[i].v && parsed[i].p) patches.push(parsed[i]);
            }
          }

          for (var j = 0; j < patches.length; j++) {
            var patch = patches[j];
            if (patch.p === '/message/content/parts/0' && patch.o === 'append' && patch.v) {
              document.dispatchEvent(new CustomEvent('__sse_data__', {
                detail: {
                  data: JSON.stringify({ type: 'content_delta', text: patch.v }),
                  timestamp: Date.now()
                }
              }));
            }
            if (patch.p === '/message/status' && patch.o === 'replace' && patch.v === 'finished_successfully') {
              document.dispatchEvent(new CustomEvent('__sse_data__', {
                detail: {
                  data: JSON.stringify({ type: 'status_change', status: 'finished_successfully' }),
                  timestamp: Date.now()
                }
              }));
            }
          }

          if (raw.includes('finished_successfully') || raw.includes('is_complete')) {
            document.dispatchEvent(new CustomEvent('__sse_message_complete__', {
              detail: { timestamp: Date.now() }
            }));
          }
        } catch (e) {}
      });

      ws.addEventListener('close', function() {
        document.dispatchEvent(new CustomEvent('__sse_closed__', {
          detail: { timestamp: Date.now(), transport: 'websocket' }
        }));
      });
    }

    return ws;
  };
  window.WebSocket.prototype = OrigWebSocket.prototype;
  window.WebSocket.CONNECTING = OrigWebSocket.CONNECTING;
  window.WebSocket.OPEN = OrigWebSocket.OPEN;
  window.WebSocket.CLOSED = OrigWebSocket.CLOSED;
  window.WebSocket.CLOSING = OrigWebSocket.CLOSING;

  // ── Hook EventSource (fallback) ──
  var OrigEventSource = window.EventSource;
  if (OrigEventSource) {
    window.EventSource = function(url, config) {
      var instance = new OrigEventSource(url, config);
      var isChat = url && (url.includes('conversation') || url.includes('chat') || url.includes('stream'));

      if (isChat) {
        console.log('[SSE-Hook] Intercepting EventSource:', url);
        document.dispatchEvent(new CustomEvent('__sse_connected__', {
          detail: { url: url, transport: 'eventsource' }
        }));

        var origAddListener = instance.addEventListener.bind(instance);
        instance.addEventListener = function(type, fn, opts) {
          if (type === 'message') {
            var wrappedFn = function(event) {
              try {
                document.dispatchEvent(new CustomEvent('__sse_data__', {
                  detail: { data: event.data, timestamp: Date.now() }
                }));
              } catch (e) {}
              return fn.call(this, event);
            };
            return origAddListener(type, wrappedFn, opts);
          }
          return origAddListener(type, fn, opts);
        };
      }

      return instance;
    };
    window.EventSource.prototype = OrigEventSource.prototype;
  }

  console.log('[SSE-Hook] ChatGPT interceptor active (fetch/defineProperty + WS + ES)');
})();
