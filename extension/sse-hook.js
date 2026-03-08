// sse-hook.js — Early stream interceptor (runs at document_start in MAIN world)
// Hooks both EventSource and ReadableStream.getReader to capture raw streaming data
// before DOM rendering. Communicates with content.js via CustomEvent on document.

(function() {
  'use strict';

  if (window.__SSE_HOOK_ACTIVE__) return;
  window.__SSE_HOOK_ACTIVE__ = true;

  // Per-tab disable check
  const DISABLED_KEY = 'agent_disabled_' + location.href.split('?')[1];
  if (localStorage.getItem(DISABLED_KEY) === 'true') {
    console.log('[SSE-Hook] Disabled on this page');
    return;
  }

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

// ── 跨压缩记忆存储 (MAIN world) ──
(function() {
  window.__CONTEXT_STORAGE_ID = '59cdb9cb-b175-4cdd-af44-e8927d7b006a';
  window.__CODE_STORAGE_ID = '731a7c05-a990-4dc2-9b42-25f58b9e454e';

  window.writeContextStorage = function(text) {
    return fetch('/api/project/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ id: window.__CONTEXT_STORAGE_ID, name: text, request_not_update_permission: true })
    }).then(function(r) { return r.json(); })
      .then(function(d) {
        var savedLen = d.data && d.data.name ? d.data.name.length : 0;
        if (savedLen > 0) {
          // 写后读回验证
          return window.readContextStorage().then(function(readBack) {
            var expectedPrefix = text.substring(0, 100);
            var actualPrefix = readBack.substring(0, 100);
            if (actualPrefix !== expectedPrefix) {
              console.warn('writeContextStorage: verify mismatch! retrying...');
              return fetch('/api/project/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ id: window.__CONTEXT_STORAGE_ID, name: text, request_not_update_permission: true })
              }).then(function(r2) { return r2.json(); })
                .then(function(d2) { return d2.data && d2.data.name ? d2.data.name.length : 0; });
            }
            return savedLen;
          });
        }
        return savedLen;
      })
      .catch(function(e) { console.error('writeContextStorage failed:', e); return 0; });
  };

  window.readContextStorage = function() {
    return fetch('/api/project/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ id: window.__CONTEXT_STORAGE_ID, request_not_update_permission: true })
    }).then(function(r) { return r.json(); })
      .then(function(d) { return d.data ? (d.data.name || '') : ''; })
      .catch(function(e) { console.error('readContextStorage failed:', e); return ''; });
  };

  // ── 代码存储 (独立对话) ──
  window.writeCodeStorage = function(text) {
    return fetch('/api/project/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ id: window.__CODE_STORAGE_ID, name: text, request_not_update_permission: true })
    }).then(function(r) { return r.json(); })
      .then(function(d) {
        var savedLen = d.data && d.data.name ? d.data.name.length : 0;
        return savedLen;
      })
      .catch(function(e) { console.error('writeCodeStorage failed:', e); return 0; });
  };

  window.readCodeStorage = function() {
    return fetch('/api/project/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ id: window.__CODE_STORAGE_ID, request_not_update_permission: true })
    }).then(function(r) { return r.json(); })
      .then(function(d) { return d.data ? (d.data.name || '') : ''; })
      .catch(function(e) { console.error('readCodeStorage failed:', e); return ''; });
  };

  // ── 通用槽位读写 (MAIN world) ──
  window.writeSlot = function(slotId, text) {
    return fetch('/api/project/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ id: slotId, name: text, request_not_update_permission: true })
    }).then(function(r) { return r.json(); })
      .then(function(d) { return d.data && d.data.name ? d.data.name.length : 0; })
      .catch(function(e) { console.error('writeSlot failed:', e); return 0; });
  };

  window.readSlot = function(slotId) {
    return fetch('/api/project/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ id: slotId, request_not_update_permission: true })
    }).then(function(r) { return r.json(); })
      .then(function(d) { return d.data ? (d.data.name || '') : ''; })
      .catch(function(e) { console.error('readSlot failed:', e); return ''; });
  };

  window.createSlot = function(name) {
    return fetch('/api/project/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ session_state: {steps: [], messages: []}, name: name || '', type: 'ai_chat' })
    }).then(function(r) { return r.json(); })
      .then(function(d) { return d.data ? d.data.id : null; })
      .catch(function(e) { console.error('createSlot failed:', e); return null; });
  };

  // ── Messages Channel (VFS 2.0) ──
  window.readSlotFull = function(slotId) {
    return fetch('/api/project/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ id: slotId, request_not_update_permission: true })
    }).then(function(r) { return r.json(); })
      .then(function(d) { return d.data || null; })
      .catch(function(e) { console.error('readSlotFull failed:', e); return null; });
  };

  window.writeSlotMessages = function(slotId, messages) {
    return fetch('/api/project/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ id: slotId, session_state: { steps: [], messages: messages }, request_not_update_permission: true })
    }).then(function(r) { return r.json(); })
      .then(function(d) {
        var msgs = d.data && d.data.session_state ? d.data.session_state.messages : [];
        return msgs.length;
      })
      .catch(function(e) { console.error('writeSlotMessages failed:', e); return 0; });
  };

  window.readSlotMessages = function(slotId) {
    return window.readSlotFull(slotId).then(function(data) {
      return data && data.session_state ? (data.session_state.messages || []) : [];
    }).catch(function(e) { console.error('readSlotMessages failed:', e); return []; });
  };

  window.autoCompress = function() {
    var btn = document.getElementById('agent-compress');
    if (btn) { btn.click(); return 'triggered'; }
    return 'no button';
  };

  // ── VFS (Virtual File System) ──
  var VFS_REGISTRY_ID = '9045a811-9a4c-4d33-ad79-31c12cebd911';
  window.__VFS_REGISTRY_ID = VFS_REGISTRY_ID;

  function vfsReadRegistry() {
    return window.readSlot(VFS_REGISTRY_ID).then(function(data) {
      if (data) {
        try { return JSON.parse(data); } catch(e) { /* fall through */ }
      }
      // Notify content.js to attempt recovery
      window.dispatchEvent(new CustomEvent('__vfs_recovery_needed__'));
      return { __meta: { version: 1 }, slots: {} };
    });
  }

  function vfsSaveRegistry(reg) {
    var json = JSON.stringify(reg);
    return window.writeSlot(VFS_REGISTRY_ID, json).then(function(len) {
      // Notify content.js to backup registry to chrome.storage.local
      window.dispatchEvent(new CustomEvent('__vfs_registry_saved__', { detail: json }));
      return len;
    });
  }

  window.vfs = {
    resolve: function(name) {
      return vfsReadRegistry().then(function(reg) {
        var s = reg.slots[name];
        return s ? s.id : null;
      });
    },

    ls: function() {
      return vfsReadRegistry().then(function(reg) {
        return Object.keys(reg.slots).map(function(k) {
          var s = reg.slots[k];
          return { name: k, id: s.id, desc: s.desc || '', created: s.created || '' };
        });
      });
    },

    mount: function(name, desc) {
      return vfsReadRegistry().then(function(reg) {
        if (reg.slots[name]) return { error: 'exists', id: reg.slots[name].id };
        return window.createSlot(name).then(function(id) {
          if (!id) return { error: 'create_failed' };
          reg.slots[name] = { id: id, created: new Date().toISOString(), desc: desc || '' };
          return vfsSaveRegistry(reg).then(function() {
            return { ok: true, name: name, id: id };
          });
        });
      });
    },

    unmount: function(name, opts) {
      return vfsReadRegistry().then(function(reg) {
        if (!reg.slots[name]) return { error: 'not_found' };
        if (name === 'registry') return { error: 'cannot_unmount_registry' };
        var id = reg.slots[name].id;
        delete reg.slots[name];
        return vfsSaveRegistry(reg).then(function() {
          return window.writeSlot(id, '').then(function() {
            // Permanently delete the underlying Genspark project
            if (!opts || opts.keep !== true) {
              fetch('/api/project/delete?project_id=' + id, { credentials: 'include' }).catch(function() {});
            }
            return { ok: true, name: name, freed: id, deleted: !opts || opts.keep !== true };
          });
        });
      });
    },

    read: function(name) {
      return window.vfs.resolve(name).then(function(id) {
        if (!id) return { error: 'not_found: ' + name };
        return window.readSlot(id);
      });
    },

    write: function(name, content) {
      return window.vfs.resolve(name).then(function(id) {
        if (!id) return { error: 'not_found: ' + name };
        return window.writeSlot(id, content).then(function(len) {
          return { ok: true, name: name, length: len };
        });
      });
    },

    append: function(name, content) {
      return window.vfs.resolve(name).then(function(id) {
        if (!id) return { error: 'not_found: ' + name };
        return window.readSlot(id).then(function(existing) {
          return window.writeSlot(id, existing + content).then(function(len) {
            return { ok: true, name: name, length: len, appended: content.length };
          });
        });
      });
    },

    snapshot: function(name) {
      var prevName = name + '._prev';
      return window.vfs.resolve(name).then(function(id) {
        if (!id) return { error: 'not_found: ' + name };
        return window.readSlot(id).then(function(content) {
          if (!content) return { ok: true, skipped: 'empty' };
          return vfsReadRegistry().then(function(reg) {
            var saveTo;
            if (reg.slots[prevName]) {
              saveTo = Promise.resolve(reg.slots[prevName].id);
            } else {
              saveTo = window.createSlot(prevName).then(function(newId) {
                reg.slots[prevName] = { id: newId, created: new Date().toISOString(), desc: 'auto-backup of ' + name };
                return vfsSaveRegistry(reg).then(function() { return newId; });
              });
            }
            return saveTo.then(function(prevId) {
              return window.writeSlot(prevId, content).then(function(len) {
                return { ok: true, name: prevName, length: len };
              });
            });
          });
        });
      });
    },

    safeWrite: function(name, content) {
      return window.vfs.snapshot(name).then(function() {
        return window.vfs.write(name, content);
      });
    },

    backup: function(options) {
      var opts = options || {};
      var includeMessages = opts.messages !== false;
      return window.vfs.ls().then(function(list) {
        var chain = Promise.resolve();
        var slotResults = [];
        list.forEach(function(s) {
          chain = chain.then(function() {
            return window.readSlot(s.id).then(function(nameContent) {
              var slotData = { name: s.name, id: s.id, desc: s.desc, created: s.created, content: nameContent };
              if (includeMessages) {
                return window.readSlotMessages(s.id).then(function(msgs) {
                  slotData.messages = msgs;
                  slotResults.push(slotData);
                }).catch(function() { slotData.messages = []; slotResults.push(slotData); });
              } else {
                slotResults.push(slotData);
                return Promise.resolve();
              }
            });
          });
        });
        return chain.then(function() {
          var snap = {
            meta: { version: 2, timestamp: new Date().toISOString(), slot_count: slotResults.length, includesMessages: includeMessages },
            slots: {}
          };
          slotResults.forEach(function(s) { snap.slots[s.name] = s; });
          var json = JSON.stringify(snap);
          window.__vfs_snapshot = json;
          fetch('http://localhost:8766/upload-payload', {
            method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: json
          }).catch(function() {});
          return { ok: true, size: json.length, slot_count: slotResults.length, version: 2, includesMessages: includeMessages };
        });
      });
    },

    exec: function(name, args) {
      return window.vfs.read(name).then(function(code) {
        if (!code || code.error) return { error: 'slot_empty_or_not_found: ' + name };
        try {
          var fn = new Function('args', code);
          var result = fn(args);
          // Handle async results
          if (result && typeof result.then === 'function') {
            return result.then(function(r) { return { ok: true, result: r }; });
          }
          return { ok: true, result: result };
        } catch(e) {
          return { error: e.message, stack: e.stack };
        }
      });
    },

    restoreFrom: function(snapshotJson, options) {
      var opts = options || {};
      var snap = typeof snapshotJson === 'string' ? JSON.parse(snapshotJson) : snapshotJson;
      var version = snap.meta && snap.meta.version || 1;
      var names = Object.keys(snap.slots);
      var chain = Promise.resolve();
      var results = [];
      names.forEach(function(name) {
        chain = chain.then(function() {
          var s = snap.slots[name];
          return window.writeSlot(s.id, s.content || '').then(function(len) {
            var entry = name + ':name=' + len;
            if (version >= 2 && s.messages && s.messages.length > 0 && opts.skipMessages !== true) {
              return window.writeSlotMessages(s.id, s.messages).then(function(msgCount) {
                results.push(entry + ',msgs=' + msgCount);
              }).catch(function() { results.push(entry + ',msgs=-1'); });
            } else {
              results.push(entry + ',msgs=0');
              return Promise.resolve();
            }
          });
        });
      });
      return chain.then(function() {
        return { ok: true, version: version, restored: results };
      });
    },

    // ── Messages Channel (VFS 2.0) ──
    readMsg: function(name, key) {
      return window.vfs.resolve(name).then(function(id) {
        if (!id) return { error: 'not_found: ' + name };
        return window.readSlotMessages(id).then(function(msgs) {
          if (key) {
            for (var i = 0; i < msgs.length; i++) {
              if (msgs[i].id === key) return msgs[i].content;
            }
            return null;
          }
          return msgs.map(function(m) { return { key: m.id, size: (m.content || '').length }; });
        });
      });
    },

    writeMsg: function(name, key, value) {
      return window.vfs.resolve(name).then(function(id) {
        if (!id) return { error: 'not_found: ' + name };
        return window.readSlotMessages(id).then(function(msgs) {
          var found = false;
          for (var i = 0; i < msgs.length; i++) {
            if (msgs[i].id === key) { msgs[i].content = value; found = true; break; }
          }
          if (!found) msgs.push({ id: key, role: 'user', content: value });
          return window.writeSlotMessages(id, msgs).then(function(count) {
            return { ok: true, name: name, key: key, totalMessages: count };
          });
        });
      });
    },

    deleteMsg: function(name, key) {
      return window.vfs.resolve(name).then(function(id) {
        if (!id) return { error: 'not_found: ' + name };
        return window.readSlotMessages(id).then(function(msgs) {
          var filtered = msgs.filter(function(m) { return m.id !== key; });
          if (filtered.length === msgs.length) return { error: 'key_not_found: ' + key };
          return window.writeSlotMessages(id, filtered).then(function(count) {
            return { ok: true, name: name, deleted: key, totalMessages: count };
          });
        });
      });
    },

    listMsg: function(name) {
      return window.vfs.resolve(name).then(function(id) {
        if (!id) return { error: 'not_found: ' + name };
        return window.readSlotMessages(id).then(function(msgs) {
          return msgs.map(function(m) { return { key: m.id, role: m.role, size: (m.content || '').length }; });
        });
      });
    },

    full: function(name) {
      return window.vfs.resolve(name).then(function(id) {
        if (!id) return { error: 'not_found: ' + name };
        return window.readSlotFull(id).then(function(data) {
          if (!data) return { error: 'read_failed' };
          var msgsArr = data.session_state && data.session_state.messages ? data.session_state.messages : [];
          return { nameLen: data.name ? data.name.length : 0, messages: msgsArr.length, keys: Object.keys(data) };
        });
      });
    },

    // ── Phase 3: Conversation History Management ──

    cleanup: function(name, filterFn) {
      return window.vfs.resolve(name).then(function(id) {
        if (!id) return { error: 'not_found: ' + name };
        return window.readSlotMessages(id).then(function(msgs) {
          var before = msgs.length;
          var kept;
          if (filterFn) {
            kept = msgs.filter(filterFn);
          } else {
            kept = msgs.filter(function(m) { return m.content && m.content.trim().length > 0; });
          }
          var removed = before - kept.length;
          if (removed === 0) return { ok: true, name: name, removed: 0, remaining: before };
          return window.writeSlotMessages(id, kept).then(function(count) {
            return { ok: true, name: name, removed: removed, remaining: count };
          });
        });
      });
    },

    inject: function(conversationId, messages) {
      if (!conversationId) return Promise.resolve({ error: 'no_conversation_id' });
      if (!messages || !messages.length) return Promise.resolve({ error: 'no_messages' });
      return window.readSlotFull(conversationId).then(function(data) {
        if (!data) return { error: 'read_failed' };
        var ss = data.session_state || { messages: [] };
        if (!ss.messages) ss.messages = [];
        var injected = 0;
        for (var i = 0; i < messages.length; i++) {
          var m = messages[i];
          ss.messages.unshift({
            id: m.id || ('injected-' + Date.now() + '-' + i),
            role: m.role || 'user',
            content: m.content || ''
          });
          injected++;
        }
        return fetch('/api/project/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ id: conversationId, session_state: ss, request_not_update_permission: true })
        }).then(function(r) { return r.json(); }).then(function(result) {
          var finalCount = result.data && result.data.session_state && result.data.session_state.messages ? result.data.session_state.messages.length : -1;
          return { ok: true, injected: injected, totalMessages: finalCount };
        });
      });
    },

    export: function(conversationId) {
      if (!conversationId) return Promise.resolve({ error: 'no_conversation_id' });
      return window.readSlotFull(conversationId).then(function(data) {
        if (!data) return { error: 'read_failed' };
        return {
          ok: true,
          id: data.id,
          name: data.name,
          type: data.type,
          ctime: data.ctime,
          mtime: data.mtime,
          messages: data.session_state && data.session_state.messages ? data.session_state.messages.map(function(m) {
            return { id: m.id, role: m.role, content: m.content, ctime: m.ctime };
          }) : [],
          session_state_keys: data.session_state ? Object.keys(data.session_state) : []
        };
      });
    },

    clone: function(fromId, toId) {
      if (!fromId || !toId) return Promise.resolve({ error: 'need_both_fromId_and_toId' });
      return window.readSlotFull(fromId).then(function(srcData) {
        if (!srcData) return { error: 'source_read_failed' };
        var srcMsgs = srcData.session_state && srcData.session_state.messages ? srcData.session_state.messages : [];
        if (srcMsgs.length === 0) return { error: 'source_empty' };
        return window.readSlotFull(toId).then(function(dstData) {
          if (!dstData) return { error: 'dest_read_failed' };
          var dstSs = { messages: srcMsgs.map(function(m) { return { id: m.id, role: m.role, content: m.content }; }) };
          return fetch('/api/project/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ id: toId, session_state: dstSs, request_not_update_permission: true })
          }).then(function(r) { return r.json(); }).then(function(result) {
            var finalCount = result.data && result.data.session_state && result.data.session_state.messages ? result.data.session_state.messages.length : -1;
            return { ok: true, from: fromId, to: toId, cloned: srcMsgs.length, totalMessages: finalCount };
          });
        });
      });
    },

    // ── Phase 5: Executable Command Library ──
    execMsg: function(slot, key, args) {
      return window.vfs.readMsg(slot, key).then(function(code) {
        if (!code) return { error: 'not_found: ' + slot + '/' + key };
        try {
          var fn = new Function('args', code);
          var result = fn(args);
          if (result && typeof result.then === 'function') {
            return result.then(function(r) { return { ok: true, key: key, result: r }; });
          }
          return { ok: true, key: key, result: result };
        } catch(e) {
          return { error: e.message, key: key, stack: e.stack };
        }
      });
    }
  };

  console.log('[SSE-Hook] VFS + Context + Code storage functions registered in MAIN world');
})();


// ── Hook 3: Fetch interceptor for dynamic prompt injection ──
// Supports two modes:
// 1. Full injection: messages[0] has no system prompt → load from VFS and prepend
// 2. Append injection: messages[0] already has system prompt → append dynamic content
(function() {
  var __nativeFetch = window.fetch;
  var __DYNAMIC_PROMPT_MARKER = '\n\n---\n\n# \uD83E\uDDE0 VFS Dynamic Injection';
  var __SYSTEM_PROMPT_MARKER = '\u6838\u5FC3\u884C\u4E3A\u51C6\u5219'; // 核心行为准则
  var __promptCache = { content: null, ts: 0, ttl: 30000 };
  var __systemPromptCache = { content: null, ts: 0, ttl: 120000 }; // 2min TTL for system prompt
  var __thirdPartyFetch = null;

  // Listen for skillsPrompt updates from content.js (isolated world → MAIN world bridge)
  document.addEventListener('__agent_skills_update__', function(e) {
    if (e.detail && e.detail.skillsPrompt) {
      window.__agentSkillsPrompt = e.detail.skillsPrompt;
      // Invalidate system cache so next request picks up new skills
      __systemPromptCache.content = null;
      __systemPromptCache.ts = 0;
      console.log('[SSE-Hook] Skills prompt updated: ' + e.detail.skillsPrompt.length + ' chars');
    }
  });

  function buildDynamicContent() {
    if (typeof window.vfs !== 'object' || typeof window.vfs.ls !== 'function') {
      return Promise.resolve(null);
    }
    var now = Date.now();
    if (__promptCache.content && (now - __promptCache.ts) < __promptCache.ttl) {
      return Promise.resolve(__promptCache.content);
    }
    return window.vfs.ls().then(function(list) {
      var slotNames = list.map(function(s) { return s.name; });
      var lines = [];
      lines.push(__DYNAMIC_PROMPT_MARKER);
      lines.push('');
      lines.push('VFS \u5DF2\u6CE8\u518C\u69FD\u4F4D (' + list.length + '): ' + slotNames.join(', '));
      lines.push('');
      lines.push('\u52A8\u6001\u63D0\u793A\u8BCD\u6CE8\u5165\u65F6\u95F4: ' + new Date().toISOString());
      return window.vfs.read('boot-prompt').then(function(bpContent) {
        if (bpContent && !bpContent.error && bpContent.length > 0) {
          try {
            var fn = new Function('vfs', 'slotNames', bpContent);
            var result = fn(window.vfs, slotNames);
            if (result && typeof result.then === 'function') {
              return result.then(function(r) {
                if (typeof r === 'string' && r.length > 0) lines.push(r);
                return lines.join('\n');
              });
            }
            if (typeof result === 'string' && result.length > 0) lines.push(result);
          } catch(e) {
            lines.push('(boot-prompt exec error: ' + e.message + ')');
          }
        }
        return lines.join('\n');
      }).catch(function() {
        return lines.join('\n');
      });
    }).then(function(content) {
      __promptCache.content = content;
      __promptCache.ts = Date.now();
      return content;
    }).catch(function() {
      return null;
    });
  }

  function loadSystemPrompt() {
    if (typeof window.vfs !== 'object') return Promise.resolve(null);
    var now = Date.now();
    if (__systemPromptCache.content && (now - __systemPromptCache.ts) < __systemPromptCache.ttl) {
      return Promise.resolve(__systemPromptCache.content);
    }
    return window.vfs.read('system-prompt').then(function(template) {
      if (!template || template.error || template.length < 100) return null;
      // Replace placeholders with actual values
      var toolSummary = '';
      if (typeof window.__agentToolSummary === 'string') {
        toolSummary = window.__agentToolSummary;
      }
      var skillsPrompt = '';
      if (typeof window.__agentSkillsPrompt === 'string') {
        skillsPrompt = window.__agentSkillsPrompt;
      }
      var prompt = template.replace('{{toolSummary}}', toolSummary).replace('{{skillsPrompt}}', skillsPrompt);
      __systemPromptCache.content = prompt;
      __systemPromptCache.ts = Date.now();
      return prompt;
    }).catch(function(e) {
      console.error('[SSE-Hook] Failed to load system-prompt from VFS:', e);
      return null;
    });
  }

  function hookFetch(targetFetch) {
    return function() {
      var args = Array.prototype.slice.call(arguments);
      var url = args[0];
      var opts = args[1];

      if (typeof url !== 'string' || url.indexOf('/api/agent/ask_proxy') === -1 || !opts || !opts.body) {
        return targetFetch.apply(this, args);
      }

      var body;
      try { body = JSON.parse(opts.body); } catch(e) {
        return targetFetch.apply(this, args);
      }

      if (!body.messages || body.messages.length === 0) {
        return targetFetch.apply(this, args);
      }

      var firstMsg = body.messages[0];
      var hasSystemPrompt = firstMsg.content && firstMsg.content.indexOf(__SYSTEM_PROMPT_MARKER) !== -1;
      var hasVFSMarker = firstMsg.content && firstMsg.content.indexOf(__DYNAMIC_PROMPT_MARKER) !== -1;
      var autoInjectEnabled = localStorage.getItem('agent_auto_prompt') !== 'false';

      if (hasVFSMarker) {
        // Already fully injected, skip
        return targetFetch.apply(this, args);
      }

      var self = this;

      if (hasSystemPrompt) {
        // Mode 1: System prompt already present (manual paste), just append dynamic content
        return buildDynamicContent().then(function(dynamicContent) {
          if (dynamicContent) {
            body.messages[0].content = firstMsg.content + dynamicContent;
            window.__injectedPromptSize = dynamicContent.length;
            console.log('[SSE-Hook] Dynamic content appended: +' + dynamicContent.length + ' chars');
          }
          var newOpts = {};
          for (var k in opts) { if (opts.hasOwnProperty(k)) newOpts[k] = opts[k]; }
          newOpts.body = JSON.stringify(body);
          return targetFetch.call(self, url, newOpts);
        }).catch(function(e) {
          console.error('[SSE-Hook] Append injection failed:', e);
          return targetFetch.apply(self, args);
        });
      }

      // Mode 2: No system prompt detected → auto-inject full prompt as prefix
      if (!autoInjectEnabled) {
        return targetFetch.apply(self, args);
      }
      return Promise.all([loadSystemPrompt(), buildDynamicContent()]).then(function(results) {
        var sysPrompt = results[0];
        var dynamicContent = results[1];

        if (sysPrompt) {
          var fullPrompt = sysPrompt;
          if (dynamicContent) fullPrompt += dynamicContent;
          // Prefix system prompt to first message content
          body.messages[0].content = fullPrompt + '\n\n---\n\n# User Message\n\n' + firstMsg.content;
          window.__injectedPromptSize = fullPrompt.length;
          console.log('[SSE-Hook] Full system prompt auto-injected as prefix: ' + fullPrompt.length + ' chars');
        } else if (dynamicContent) {
          // Fallback: no system prompt in VFS, just append dynamic
          body.messages[0].content = firstMsg.content + dynamicContent;
          window.__injectedPromptSize = dynamicContent.length;
          console.log('[SSE-Hook] Fallback: dynamic content appended: +' + dynamicContent.length + ' chars');
        }

        var newOpts = {};
        for (var k in opts) { if (opts.hasOwnProperty(k)) newOpts[k] = opts[k]; }
        newOpts.body = JSON.stringify(body);
        return targetFetch.call(self, url, newOpts);
      }).catch(function(e) {
        console.error('[SSE-Hook] Full injection failed:', e);
        return targetFetch.apply(self, args);
      });
    };
  }

  // Install immediately with native fetch
  var __currentHook = hookFetch(__nativeFetch);

  // Use defineProperty to trap any future overwrites of window.fetch
  Object.defineProperty(window, 'fetch', {
    configurable: true,
    enumerable: true,
    get: function() {
      return __currentHook;
    },
    set: function(newFetch) {
      if (newFetch === __currentHook) return;
      __thirdPartyFetch = newFetch;
      __currentHook = hookFetch(newFetch);
      console.log('[SSE-Hook] Fetch re-hooked after third-party overwrite');
    }
  });

  // Expose for debugging
  window.__buildDynamicPrompt = buildDynamicContent;
  window.__loadSystemPrompt = loadSystemPrompt;
  window.__flushPromptCache = function() {
    __promptCache.content = null; __promptCache.ts = 0;
    __systemPromptCache.content = null; __systemPromptCache.ts = 0;
  };
  window.__fetchHookInfo = function() {
    return {
      hasThirdParty: !!__thirdPartyFetch,
      dynamicCacheAge: __promptCache.ts ? (Date.now() - __promptCache.ts) + 'ms' : 'empty',
      dynamicCacheLen: __promptCache.content ? __promptCache.content.length : 0,
      sysCacheAge: __systemPromptCache.ts ? (Date.now() - __systemPromptCache.ts) + 'ms' : 'empty',
      sysCacheLen: __systemPromptCache.content ? __systemPromptCache.content.length : 0
    };
  };

  // ── Reverse Channel: 浏览器→AI 异步结果传递 ──
  // 浏览器端写入: window.__reverseChannel.push({key, data, ts})
  // AI端读取: eval_js return window.__reverseChannel.read()
  // 也会持久化到 VFS (如果可用)
  window.__reverseChannel = {
    _queue: [],
    push: function(entry) {
      if (!entry.key) entry.key = 'unnamed';
      entry.ts = Date.now();
      this._queue.push(entry);
      console.log('[ReverseChannel] pushed: ' + entry.key + ' (' + JSON.stringify(entry.data).length + ' chars)');
      // 持久化到 VFS
      if (typeof window.vfs === 'object' && typeof window.vfs.append === 'function') {
        var line = '\n[' + new Date(entry.ts).toISOString() + '] ' + entry.key + ': ' + JSON.stringify(entry.data);
        window.vfs.append('context', line).catch(function() {});
      }
    },
    read: function(key) {
      if (key) {
        var filtered = this._queue.filter(function(e) { return e.key === key; });
        this._queue = this._queue.filter(function(e) { return e.key !== key; });
        return filtered;
      }
      var all = this._queue.slice();
      this._queue = [];
      return all;
    },
    peek: function() {
      return this._queue.slice();
    },
    size: function() {
      return this._queue.length;
    }
  };

  console.log('[SSE-Hook] Fetch prompt-injection hook v2 installed (auto-inject + append + reverse-channel)');
})();

