// sse-hook.js — Early stream interceptor (runs at document_start in MAIN world)
// Hooks both EventSource and ReadableStream.getReader to capture raw streaming data
// before DOM rendering. Communicates with content.js via CustomEvent on document.

(function() {
  'use strict';

  if (window.__SSE_HOOK_ACTIVE__) return;
  window.__SSE_HOOK_ACTIVE__ = true;

  // ── Hook 1: EventSource (in case it's used) ──────────────────
  const OrigEventSource = window.EventSource;

  window.EventSource = function(url, config) {
    const instance = new OrigEventSource(url, config);

    const isAgentSSE = url && (
      url.includes('/api/ai_agent/') ||
      url.includes('/api/chat/') ||
      url.includes('message') ||
      url.includes('stream')
    );

    if (isAgentSSE) {
      console.log('[SSE-Hook] Intercepting EventSource:', url);
      document.dispatchEvent(new CustomEvent('__sse_connected__', {
        detail: { url: url, transport: 'eventsource' }
      }));

      const origAddEventListener = instance.addEventListener.bind(instance);
      instance.addEventListener = function(type, listener, ...rest) {
        if (type === 'message') {
          const wrappedListener = function(event) {
            try {
              document.dispatchEvent(new CustomEvent('__sse_data__', {
                detail: { data: event.data, timestamp: Date.now() }
              }));
            } catch (e) {}
            return listener.call(this, event);
          };
          return origAddEventListener(type, wrappedListener, ...rest);
        }
        return origAddEventListener(type, listener, ...rest);
      };

      let _onmessage = null;
      Object.defineProperty(instance, 'onmessage', {
        get() { return _onmessage; },
        set(fn) {
          _onmessage = function(event) {
            try {
              document.dispatchEvent(new CustomEvent('__sse_data__', {
                detail: { data: event.data, timestamp: Date.now() }
              }));
            } catch (e) {}
            return fn.call(this, event);
          };
        }
      });

      const origClose = instance.close.bind(instance);
      instance.close = function() {
        document.dispatchEvent(new CustomEvent('__sse_closed__', {
          detail: { url: url, timestamp: Date.now() }
        }));
        return origClose();
      };
    }

    return instance;
  };

  window.EventSource.prototype = OrigEventSource.prototype;
  window.EventSource.CONNECTING = OrigEventSource.CONNECTING;
  window.EventSource.OPEN = OrigEventSource.OPEN;
  window.EventSource.CLOSED = OrigEventSource.CLOSED;

  // ── Hook 2: ReadableStream.getReader (for fetch-based SSE) ──
  const origGetReader = ReadableStream.prototype.getReader;

  ReadableStream.prototype.getReader = function(...args) {
    const reader = origGetReader.apply(this, args);
    const origRead = reader.read.bind(reader);

    let isAgentStream = null;
    let fullText = '';
    let chunkCount = 0;
    const decoder = new TextDecoder();

    reader.read = function() {
      return origRead().then(result => {
        if (result.done) {
          if (isAgentStream) {
            document.dispatchEvent(new CustomEvent('__sse_closed__', {
              detail: { timestamp: Date.now(), totalLength: fullText.length, transport: 'fetch-stream' }
            }));
          }
          return result;
        }

        let text;
        try {
          text = typeof result.value === 'string' ? result.value : decoder.decode(result.value, { stream: true });
        } catch (e) {
          return result;
        }

        chunkCount++;

        if (isAgentStream === null) {
          if (text.includes('message_field_delta') || text.includes('"delta"') || text.includes('data: {')) {
            isAgentStream = true;
            console.log('[SSE-Hook] Detected fetch-based SSE stream, intercepting...');
            document.dispatchEvent(new CustomEvent('__sse_connected__', {
              detail: { transport: 'fetch-stream', timestamp: Date.now() }
            }));
          } else if (chunkCount > 3) {
            isAgentStream = false;
          }
        }

        if (isAgentStream) {
          fullText += text;

          const lines = text.split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data: ')) {
              const jsonStr = trimmed.substring(6);
              if (jsonStr && jsonStr !== '[DONE]') {
                try {
                  document.dispatchEvent(new CustomEvent('__sse_data__', {
                    detail: { data: jsonStr, timestamp: Date.now() }
                  }));
                } catch (e) {}
              }
            } else if (trimmed.startsWith('{') && trimmed.includes('message_field_delta')) {
              try {
                document.dispatchEvent(new CustomEvent('__sse_data__', {
                  detail: { data: trimmed, timestamp: Date.now() }
                }));
              } catch (e) {}
            }
          }
        }

        return result;
      });
    };

    return reader;
  };

  console.log('[SSE-Hook] EventSource + ReadableStream hooks installed at document_start');
})();
