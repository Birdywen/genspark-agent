// ws-hook.js — WebSocket interceptor for Vear.com (runs at document_start in MAIN world)
// Hooks WebSocket to capture AI stream messages before DOM rendering
// Communicates with content.js via CustomEvent on document.

(function() {
  'use strict';

  if (window.__VEAR_WS_HOOK_ACTIVE__) return;
  window.__VEAR_WS_HOOK_ACTIVE__ = true;

  console.log('[Vear-WS-Hook] WebSocket interceptor loaded');

  const OrigWebSocket = window.WebSocket;
  window.WebSocket = function(url, protocols) {
    const ws = protocols ? new OrigWebSocket(url, protocols) : new OrigWebSocket(url);
    const isVearSocket = url && url.includes('vear.com/conversation');
    console.log('[Vear-WS-Hook] New WebSocket:', url, '| isVear:', isVearSocket);

    if (isVearSocket) {
      console.log('[Vear-WS-Hook] Intercepting WebSocket:', url);

      // Local buffer — accumulate here, dispatch once on done
      var _buffer = '';
      var _currentCid = null;

      // Dispatch connected event repeatedly until content.js picks it up
      var _connUrl = url;
      var _connInterval = setInterval(function() {
        document.dispatchEvent(new CustomEvent('__vear_ws_connected__', { detail: { url: _connUrl, timestamp: Date.now() } }));
      }, 300);
      // Stop after 5s (content.js should be loaded by then)
      setTimeout(function() { clearInterval(_connInterval); }, 5000);
      document.dispatchEvent(new CustomEvent('__vear_ws_connected__', { detail: { url: _connUrl, timestamp: Date.now() } }));

      ws.addEventListener('message', (event) => {
        const msg = event.data;
        if (typeof msg !== 'string') return;

        try {
          const data = JSON.parse(msg);
          const t = data.t;

          // t:"s" — session start, reset buffer
          if (t === 's') {
            _currentCid = data.cid;
            _buffer = '';
            document.dispatchEvent(new CustomEvent('__vear_ws_start__', {
              detail: { cid: data.cid, sid: data.sid, timestamp: Date.now() }
            }));
          }

          // t:"m" — delta chunk, accumulate into buffer only
          else if (t === 'm') {
            if (data.cid && data.cid !== _currentCid) {
              // cid changed mid-stream, reset
              _currentCid = data.cid;
              _buffer = '';
            }
            _buffer += (data.c || '');
            // no CustomEvent here — buffer only
          }

          // t:"n" — message complete, dispatch full buffered text
          else if (t === 'n') {
            document.dispatchEvent(new CustomEvent('__vear_ws_done__', {
              detail: {
                cid: data.cid || _currentCid,
                sid: data.sid,
                text: _buffer,
                timestamp: Date.now()
              }
            }));
            _buffer = '';
          }

          // t:"e" or "err" — error
          else if (t === 'e' || t === 'err') {
            document.dispatchEvent(new CustomEvent('__vear_ws_error__', {
              detail: {
                cid: data.cid,
                message: data.c || JSON.stringify(data),
                timestamp: Date.now()
              }
            }));
            _buffer = '';
          }
        } catch (e) {
          // non-JSON frame, ignore
        }
      });

      ws.addEventListener('close', () => {
        document.dispatchEvent(new CustomEvent('__vear_ws_closed__', {
          detail: { timestamp: Date.now() }
        }));
      });
    }

    return ws;
  };

  // Copy static properties
  window.WebSocket.prototype = OrigWebSocket.prototype;
  window.WebSocket.CONNECTING = OrigWebSocket.CONNECTING;
  window.WebSocket.OPEN = OrigWebSocket.OPEN;
  window.WebSocket.CLOSING = OrigWebSocket.CLOSING;
  window.WebSocket.CLOSED = OrigWebSocket.CLOSED;

})();
