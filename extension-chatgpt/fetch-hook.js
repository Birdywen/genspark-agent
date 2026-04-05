// fetch-hook.js — injected at document_idle in MAIN world
// Hooks fetch AFTER ChatGPT's bundle has loaded, so it won't be overwritten
(function() {
  'use strict';
  if (window.__fetchHooked) return;
  window.__fetchHooked = true;
  var origFetch = window.fetch;

  window.fetch = function() {
    var args = arguments;
    var url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
    var opts = args[1] || (typeof args[0] === 'object' ? args[0] : {});
    var method = (opts.method || 'GET').toUpperCase();
    var result = origFetch.apply(this, args);

    var isConv = method === 'POST' && url.indexOf('backend-api') !== -1 && url.indexOf('conversation') !== -1
      && url.indexOf('limit') === -1 && url.indexOf('history') === -1 && url.indexOf('prepare') === -1;

    if (isConv) {
      console.log('[SSE-Hook] Intercepting fetch:', url.substring(0, 80));
      result.then(function(resp) {
        try {
          if (!resp.body) return;
          var cloned = resp.clone();
          var reader = cloned.body.getReader();
          var dec = new TextDecoder();
          var lineBuf = '';

          document.dispatchEvent(new CustomEvent('__sse_connected__', {
            detail: { transport: 'fetch-stream', url: url, timestamp: Date.now() }
          }));

          function pump() {
            reader.read().then(function(chunk) {
              if (chunk.done) {
                if (lineBuf.trim()) processLine(lineBuf.trim());
                document.dispatchEvent(new CustomEvent('__sse_closed__', {
                  detail: { timestamp: Date.now(), transport: 'fetch-stream' }
                }));
                return;
              }
              lineBuf += dec.decode(chunk.value, { stream: true });
              var lines = lineBuf.split('\n');
              lineBuf = lines.pop();
              for (var i = 0; i < lines.length; i++) {
                var l = lines[i].trim();
                if (l) processLine(l);
              }
              pump();
            }).catch(function() {});
          }

          function processLine(line) {
            if (line.indexOf('data: ') !== 0) return;
            var js = line.substring(6);
            if (js === '[DONE]') {
              document.dispatchEvent(new CustomEvent('__sse_message_complete__', {
                detail: { timestamp: Date.now() }
              }));
              return;
            }
            document.dispatchEvent(new CustomEvent('__sse_raw__', {
              detail: { data: js, timestamp: Date.now() }
            }));
            try {
              var p = JSON.parse(js);
              // JSON Patch format: {v: [{p, o, v}]}
              if (p.v && Array.isArray(p.v)) {
                for (var j = 0; j < p.v.length; j++) {
                  var patch = p.v[j];
                  if (patch.p === '/message/content/parts/0' && patch.o === 'append' && patch.v) {
                    document.dispatchEvent(new CustomEvent('__sse_data__', {
                      detail: { data: JSON.stringify({ type: 'content_delta', text: patch.v, timestamp: Date.now() }), timestamp: Date.now() }
                    }));
                  }
                  if (patch.p === '/message/status' && patch.o === 'replace') {
                    document.dispatchEvent(new CustomEvent('__sse_data__', {
                      detail: { data: JSON.stringify({ type: 'status_change', status: patch.v, timestamp: Date.now() }), timestamp: Date.now() }
                    }));
                  }
                }
              }
              // Finished status
              if (p.message && p.message.status === 'finished_successfully') {
                document.dispatchEvent(new CustomEvent('__sse_data__', {
                  detail: { data: JSON.stringify({ type: 'status_change', status: 'finished_successfully', timestamp: Date.now() }), timestamp: Date.now() }
                }));
              }
            } catch (e) {}
          }

          pump();
        } catch (e) {}
      }).catch(function() {});
    }
    return result;
  };

  console.log('[SSE-Hook] Fetch hook active (document_idle, MAIN world)');
})();
