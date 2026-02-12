// sse-hook.js — Early EventSource interceptor (runs at document_start in MAIN world)
// Hooks EventSource to capture raw SSE deltas before DOM rendering
// Communicates with content.js via CustomEvent on document

(function() {
  'use strict';

  if (window.__SSE_HOOK_ACTIVE__) return;
  window.__SSE_HOOK_ACTIVE__ = true;

  const OrigEventSource = window.EventSource;

  window.EventSource = function(url, config) {
    const instance = new OrigEventSource(url, config);

    // Only intercept agent/chat API SSE connections
    const isAgentSSE = url && (
      url.includes('/api/ai_agent/') ||
      url.includes('/api/chat/') ||
      url.includes('message') ||
      url.includes('stream')
    );

    if (isAgentSSE) {
      console.log('[SSE-Hook] Intercepting EventSource:', url);

      // Notify content script that SSE connection is established
      document.dispatchEvent(new CustomEvent('__sse_connected__', {
        detail: { url: url }
      }));

      const origAddEventListener = instance.addEventListener.bind(instance);

      // Hook addEventListener to intercept 'message' events
      instance.addEventListener = function(type, listener, ...rest) {
        if (type === 'message') {
          const wrappedListener = function(event) {
            // Forward raw SSE data to content script
            try {
              document.dispatchEvent(new CustomEvent('__sse_data__', {
                detail: { data: event.data, timestamp: Date.now() }
              }));
            } catch (e) {
              // Don't let our hook break the original flow
            }
            // Always call original listener
            return listener.call(this, event);
          };
          return origAddEventListener(type, wrappedListener, ...rest);
        }
        return origAddEventListener(type, listener, ...rest);
      };

      // Also hook onmessage property
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

      // Hook close to notify content script
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

  // Preserve prototype chain and static properties
  window.EventSource.prototype = OrigEventSource.prototype;
  window.EventSource.CONNECTING = OrigEventSource.CONNECTING;
  window.EventSource.OPEN = OrigEventSource.OPEN;
  window.EventSource.CLOSED = OrigEventSource.CLOSED;

  console.log('[SSE-Hook] EventSource hook installed at document_start');
})();
