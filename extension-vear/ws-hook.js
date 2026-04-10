// ws-hook.js — WebSocket interceptor for Vear.com (DEBUG VERSION)
// runs at document_start in MAIN world

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
      window.__VEAR_WS__ = ws;

      var _buffer = '';
      var _currentCid = null;
      var _msgCount = 0;

      var _connUrl = url;
      var _connInterval = setInterval(function() {
        document.dispatchEvent(new CustomEvent('__vear_ws_connected__', { detail: { url: _connUrl, timestamp: Date.now() } }));
      }, 300);
      setTimeout(function() { clearInterval(_connInterval); }, 5000);
      document.dispatchEvent(new CustomEvent('__vear_ws_connected__', { detail: { url: _connUrl, timestamp: Date.now() } }));

      ws.addEventListener('message', function(event) {
        _msgCount++;
        var msg = event.data;

        console.log('[Vear-WS-Hook] MSG #' + _msgCount + ' type=' + typeof msg + ' len=' + (msg && msg.length) + ' raw:', typeof msg === 'string' ? msg.slice(0, 300) : '[binary]');

        if (typeof msg !== 'string') {
          console.warn('[Vear-WS-Hook] Non-string message, skipping');
          return;
        }

        try {
          var data = JSON.parse(msg);
          var t = data.t;
          console.log('[Vear-WS-Hook] Parsed OK | t=' + t + ' cid=' + data.cid + ' keys=' + Object.keys(data).join(','));

          if (t === 's') {

            _currentCid = data.cid;
            window.__VEAR_CURRENT_CID__ = data.cid;
            // 如果第一条无cid消息已注入，标记这个cid为已注入，避免重复
            if (_firstMsgInjected && data.cid && !_injectedCids[data.cid]) {
              _injectedCids[data.cid] = true;
            }
            _buffer = '';
            console.log('[Vear-WS-Hook] >>> STREAM START cid=' + data.cid);
            document.dispatchEvent(new CustomEvent('__vear_ws_start__', {
              detail: { cid: data.cid, sid: data.sid, timestamp: Date.now() }
            }));
          }

          else if (t === 'm') {

            if (data.cid && data.cid !== _currentCid) {
              console.log('[Vear-WS-Hook] CID changed: ' + _currentCid + ' -> ' + data.cid);
              _currentCid = data.cid;
              _buffer = '';
            }
            var chunk = data.c || '';
            _buffer += chunk;
            console.log('[Vear-WS-Hook] +chunk(' + chunk.length + ') buffer=' + _buffer.length + 'chars');
          }

          else if (t === 'n') {

            console.log('[Vear-WS-Hook] >>> STREAM DONE cid=' + (data.cid || _currentCid) + ' buffer=' + _buffer.length + 'chars');
            console.log('[Vear-WS-Hook] Final text preview:', _buffer.slice(0, 200));
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

          else if (t === 'e' || t === 'err') {
            console.error('[Vear-WS-Hook] >>> ERROR:', data.c || JSON.stringify(data));
            document.dispatchEvent(new CustomEvent('__vear_ws_error__', {
              detail: {
                cid: data.cid,
                message: data.c || JSON.stringify(data),
                timestamp: Date.now()
              }
            }));
            _buffer = '';
          }

          else {
            console.log('[Vear-WS-Hook] Unknown t=' + t + ' | full:', JSON.stringify(data).slice(0, 300));
          }

        } catch (e) {
          console.warn('[Vear-WS-Hook] JSON parse failed:', e.message, '| raw:', msg.slice(0, 200));
        }
      });

      ws.addEventListener('open', function() {
        console.log('[Vear-WS-Hook] WebSocket OPEN');
      });

      ws.addEventListener('close', function(event) {
        console.log('[Vear-WS-Hook] WebSocket CLOSED | code=' + event.code + ' reason=' + event.reason + ' total msgs=' + _msgCount);
        document.dispatchEvent(new CustomEvent('__vear_ws_closed__', {
          detail: { timestamp: Date.now() }
        }));
      });

      ws.addEventListener('error', function(event) {
        console.error('[Vear-WS-Hook] WebSocket ERROR event:', event);
      });
    }

    return ws;
  };

  window.WebSocket.prototype = OrigWebSocket.prototype;
  window.WebSocket.CONNECTING = OrigWebSocket.CONNECTING;
  window.WebSocket.OPEN = OrigWebSocket.OPEN;
  window.WebSocket.CLOSING = OrigWebSocket.CLOSING;
  window.WebSocket.CLOSED = OrigWebSocket.CLOSED;

  // === Bridge: content.js can send messages via CustomEvent ===
  document.addEventListener('__vear_ws_send__', function(e) {
    var text = e.detail && e.detail.text;
    if (!text || !window.__VEAR_WS__ || window.__VEAR_WS__.readyState !== 1) {
      console.log('[Vear-WS-Hook] Cannot send: ws=' + (window.__VEAR_WS__ ? window.__VEAR_WS__.readyState : 'null'));
      return;
    }
    var cid = window.__VEAR_CURRENT_CID__ || undefined;
    var msg = { t: 'm', q: text, m: 11, ms: 11 };
    if (cid) msg.cid = cid;
    console.log('[Vear-WS-Hook] Sending via WS bridge, cid=' + cid + ' len=' + text.length);
    window.__VEAR_WS__.send(JSON.stringify(msg));
  });

  // === Prototype-level send 拦截：注入工具提示（改 OrigWebSocket.prototype 因为实例是 new OrigWebSocket）===
  var _injectedCids = {};
  var _firstMsgInjected = false;
  var _origProtoSend = OrigWebSocket.prototype.send;
  OrigWebSocket.prototype.send = function(data) {
    if (typeof data === 'string') {
      try {
        var parsed = JSON.parse(data);
        console.log('[Vear-WS-Hook] SEND t=' + parsed.t + ' cid=' + parsed.cid + ' hasQ=' + !!parsed.q + ' qLen=' + (parsed.q||'').length + ' keys=' + Object.keys(parsed).join(','));
        if (parsed.t === 'm') {
          // If q is empty but DOM input has content (set by agent), use DOM content
          if (!parsed.q || parsed.q.trim() === '') {
            var domInput = document.querySelector('div.chatq-holder[contenteditable]');
            if (domInput && domInput.textContent && domInput.textContent.trim()) {
              parsed.q = domInput.textContent;
              data = JSON.stringify(parsed);
              console.log('[Vear-WS-Hook] Replaced empty q with DOM content (' + parsed.q.length + ' chars)');
            }
          }
        }
        if (parsed.t === 'm' && parsed.q) {
          // 判断是否需要注入: 第一条消息(无cid)或新cid的第一条
          var needInject = false;
          if (!parsed.cid && !_firstMsgInjected) {
            _firstMsgInjected = true;
            needInject = true;
          } else if (parsed.cid && !_injectedCids[parsed.cid]) {
            _injectedCids[parsed.cid] = true;
            needInject = true;
          }
          if (needInject) {
            var toolDoc = '[SYSTEM] You are an AI agent with tool execution capability.\n\n## Tool Format\nSingle tool:\nΩCODE\n{"tool":"TOOL_NAME","params":{...}}\nΩCODEEND\n\nBatch (2+ ops):\nΩCODE\n{"steps":[{"tool":"...","params":{...},"saveAs":"s1"},{"tool":"...","params":{...}}]}\nΩCODEEND\n\n## Available Tools\n\n### MCP Tools (file system)\n- read_file(path) - read file content\n- write_file(path, content) - write file\n- edit_file(path, edits:[{oldText,newText}]) - edit file (read_file first!)\n- list_directory(path) - list directory\n\n### System Tools\n- run_process(command_line) - execute shell command\n- db_query(sql) - query agent.db (SQLite)\n- memory(action:get/set/list/delete, slot, key, value) - persistent memory\n- local_store(action:get/set/list/delete, slot, key, value) - local storage\n- web_search(q) - web search\n- crawler(url) - fetch webpage content\n- ask_ai(model, messages) - call AI model\n- gen_image(prompt) - generate image\n- git_commit(message) - git commit\n- wechat(action:send/search, to, content) - WeChat\n- oracle_run(command) - Oracle server SSH\n- server_status() - check server status\n- server_restart() - restart server\n- datawrapper(action) - create charts\n- odin(action:search/translate/code) - Odin AI (free)\n- eval_js(code, tabId) - execute JS in browser tab\n\n## Rules\n- ΩCODE must be at line start, one per response\n- 2+ operations ALWAYS use batch steps\n- Wait for [执行结果] before claiming done\n- Output ΩCODE directly in text, NOT inside markdown code blocks\n';
            parsed.q = toolDoc + parsed.q;
            data = JSON.stringify(parsed);
            console.log('[Vear-WS-Hook] Injected tool docs for cid:', parsed.cid);
          }
        }
      } catch(e) {}
    }
    return _origProtoSend.call(this, data);
  };

})();
