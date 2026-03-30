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
        let __lineBuffer = '';
    let fullText = '';
    let chunkCount = 0;
    const decoder = new TextDecoder();

    reader.read = function() {
      return origRead().then(result => {
        if (result.done) {
          if (isAgentStream) {
            // Flush remaining lineBuffer before closing
            if (__lineBuffer.trim()) {
              var flushed = __lineBuffer.trim();
              if (flushed.startsWith('data: ')) {
                var jsonStr = flushed.substring(6);
                if (jsonStr && jsonStr !== '[DONE]') {
                  try {
                    document.dispatchEvent(new CustomEvent('__sse_data__', {
                      detail: { data: jsonStr, timestamp: Date.now() }
                    }));
                  } catch (e) {}
                }
              }
              __lineBuffer = '';
            }
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

          // [2026-03-27] Line-buffered SSE parsing to prevent chunk-boundary data loss
          __lineBuffer += text;
          var bufLines = __lineBuffer.split('\n');
          // Last element may be incomplete - save it for next chunk
          __lineBuffer = bufLines.pop() || '';
          for (var li = 0; li < bufLines.length; li++) {
            var trimmed = bufLines[li].trim();
            if (trimmed.startsWith('data: ')) {
              var jsonStr = trimmed.substring(6);
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
  // ── Slot Content Cache ──
  var _slotCache = {};
  var _slotTTL = 10000; // 10s content cache
  var _origReadSlot = function(slotId) {
    return fetch('/api/project/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ id: slotId, request_not_update_permission: true })
    }).then(function(r) { return r.json(); })
      .then(function(d) { return d.data ? (d.data.name || '') : ''; })
      .catch(function(e) { console.error('readSlot failed:', e); return ''; });
  };
  var _origWriteSlot = function(slotId, text) {
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
    var now = Date.now();
    var cached = _slotCache[slotId];
    if (cached && (now - cached.time) < _slotTTL) return Promise.resolve(cached.data);
    return _origReadSlot(slotId).then(function(data) {
      _slotCache[slotId] = { data: data, time: Date.now() };
      return data;
    });
  };

  window.writeSlot = function(slotId, text) {
    delete _slotCache[slotId];
    return _origWriteSlot(slotId, text).then(function(result) {
      _slotCache[slotId] = { data: text, time: Date.now() };
      return result;
    });
  };

  window.__slotCache = {
    stats: function() {
      var keys = Object.keys(_slotCache);
      var entries = keys.map(function(k) {
        return { id: k.substring(0,8)+"...", age: (Date.now()-_slotCache[k].time)+"ms", size: (_slotCache[k].data||"").length };
      });
      return { count: keys.length, ttl: _slotTTL+"ms", entries: entries };
    },
    setTTL: function(ms) { _slotTTL = ms; },
    invalidate: function(id) { if (id) delete _slotCache[id]; else _slotCache = {}; },
    warmSlot: function(id, data) { _slotCache[id] = { data: data, time: Date.now() }; }
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

  // ── VFS (Virtual File System) ──
  var VFS_REGISTRY_ID = '9045a811-9a4c-4d33-ad79-31c12cebd911';
  window.__VFS_REGISTRY_ID = VFS_REGISTRY_ID;

  // Registry cache (30s TTL)
  var _regCache = null, _regCacheTime = 0, _regPending = null, _regTTL = 30000;

  function vfsReadRegistry() {
    var now = Date.now();
    if (_regCache && (now - _regCacheTime) < _regTTL) return Promise.resolve(_regCache);
    if (_regPending) return _regPending;
    _regPending = window.readSlot(VFS_REGISTRY_ID).then(function(data) {
      _regPending = null;
      if (data) {
        try { _regCache = JSON.parse(data); _regCacheTime = Date.now(); return _regCache; } catch(e) { /* fall through */ }
      }
      window.dispatchEvent(new CustomEvent('__vfs_recovery_needed__'));
      return { __meta: { version: 1 }, slots: {} };
    }).catch(function(e) { _regPending = null; throw e; });
    return _regPending;
  }

  function vfsInvalidateCache() { _regCache = null; _regCacheTime = 0; }

  function vfsSaveRegistry(reg) {
    var json = JSON.stringify(reg);
    vfsInvalidateCache();
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


    // ── Messages Channel (read only - write/delete/list in vfs-messages extension) ──
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
    },

    listMsg: function(name) {
      return window.vfs.resolve(name).then(function(id) {
        if (!id) return [];
        return window.readSlotMessages(id).then(function(msgs) {
          return msgs.map(function(m) { return { key: m.id, role: m.role, size: (m.content || '').length }; });
        });
      });
    },



    writeMsg: function(name, key, value) {
      return window.vfs.resolve(name).then(function(id) {
        if (!id) return { error: 'not_found: ' + name };
        return window.readSlotMessages(id).then(function(msgs) {
          var idx = -1;
          for (var i = 0; i < msgs.length; i++) { if (msgs[i].id === key) { idx = i; break; } }
          if (idx >= 0) { msgs[idx].content = value; } else { msgs.push({ id: key, role: 'user', content: value }); }
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

    // ── Stub: methods loaded by fn/vfs-* extensions ──
    // write, append, snapshot, safeWrite → vfs-crud
    // backup, exec, restoreFrom → vfs-backup
    // writeMsg, deleteMsg, listMsg, full → vfs-messages
    // cleanup, inject, export, clone → vfs-conversation
    // batch, lazy, warmup, invalidateCache, cacheStats → vfs-performance
    // _logChange, history, rollback → vfs-history
    // query, search → vfs-query, vfs-search
  };

  // Expose cache internals for vfs-performance module
  window.__vfsReadRegistry = vfsReadRegistry;
  window.__vfsInvalidateCache = vfsInvalidateCache;
  window.__vfsCache = { get reg() { return _regCache; }, get time() { return _regCacheTime; }, get ttl() { return _regTTL; }, get pending() { return _regPending; } };

  console.log('[SSE-Hook] VFS + Context + Code storage functions registered in MAIN world');
  // Self-contained extension loader (no dependency on fn modules)
  setTimeout(function() {
    if (!window.vfs || !window.vfs.readMsg) return;
    window.vfs.readMsg('fn').then(function(list) {
      if (!Array.isArray(list)) return;
      var chain = Promise.resolve(), loaded = [];
      list.forEach(function(m) {
        if (m.key.indexOf('_') !== 0) {
          chain = chain.then(function() {
            return window.vfs.readMsg('fn', m.key).then(function(code) {
              try { var fn = new Function(code); fn(); loaded.push(m.key); } catch(e) { console.error('[VFS] Load fail ' + m.key + ':', e); }
            });
          });
        }
      });
      chain.then(function() { console.log('[VFS] Extensions loaded:', loaded); });
    }).catch(function(e) { console.error('[VFS] Extension load error:', e); });
  }, 3000);
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
      // boot-prompt disabled — forged dialogues handle all injection
      return Promise.resolve(lines.join('\n'));
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


      if (typeof url !== 'string' || (url.indexOf('/api/agent/ask_proxy') === -1 && url.indexOf('/api/chat/') === -1) || !opts || !opts.body) {
        return targetFetch.apply(this, args);
      }
      console.log('[SSE-Hook] INTERCEPTED: ' + url);

      var body;
      try { body = JSON.parse(opts.body); } catch(e) {
        return targetFetch.apply(this, args);
      }

      if (!body.messages || body.messages.length === 0) {
        return targetFetch.apply(this, args);
      }

      var firstMsg = body.messages[0];
      console.log('[SSE-Hook] messages[0] role=' + firstMsg.role + ' len=' + (firstMsg.content||'').length + ' first100=' + (firstMsg.content||'').substring(0,100));
      console.log('[SSE-Hook] total messages=' + body.messages.length + ' roles=' + body.messages.map(function(m){return m.role}).join(','));


      // [2026-03-27] Forged injection REMOVED.
      // Forged identity injected ONCE at create/fork time.
      var newOptsFinal = {};
      for (var kf in opts) { if (opts.hasOwnProperty(kf)) newOptsFinal[kf] = opts[kf]; }
      newOptsFinal.body = JSON.stringify(body);
      return targetFetch.call(this, url, newOptsFinal);
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


  // === SHORTCUTS (auto-registered) ===
  window.__shortcuts = {
    _cache: {},
    _loadAndRun: function(key, args) {
      var self = this;
      if (self._cache[key]) {
        return new Function("args", self._cache[key])(args);
      }
      return fetch("http://localhost:8766/local/read?slot=toolkit&key=" + encodeURIComponent(key))
        .then(function(r) { return r.json(); })
        .then(function(d) {
          var content = d.content || "";
          if (!content) return "script not found: " + key;
          self._cache[key] = content;
          return new Function("args", content)(args);
        }).catch(function(e) { return "error: " + e.message; });
    },
    compress: function(opts) {
      return this._loadAndRun("compress-chat", opts || {headN:3, tailN:30});
    },
    recover: function(date) {
      return this._loadAndRun("agent-recover", {date: date || new Date().toISOString().split("T")[0]});
    }
  };
  console.log("[SSE-Hook] Shortcuts registered: compress, recover (playbook/mine/restart/status → sys-tools)");

  // === DB MINING: moved to sys-tools.js (mine tool) ===
  // Use ΩCODE {"tool":"mine","params":{"action":"how","keyword":"..."}} instead
  // Actions: how|fail|recent|today|file|struggle

  console.log('[SSE-Hook] Fetch prompt-injection hook v2 installed (auto-inject + append + reverse-channel)');
})();
// [2026-03-30] __mine fully removed — use sys-tools: {tool:"mine",params:{action:"how|fail|recent|today|file",keyword:"..."}}
