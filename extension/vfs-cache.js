(function() {
  var _cache = null;
  var _cacheTime = 0;
  var _pending = null;
  var _cfg = { ttl: 30000 };

  function readReg() {
    var now = Date.now();
    if (_cache && (now - _cacheTime) < _cfg.ttl) {
      return Promise.resolve(_cache);
    }
    if (_pending) { return _pending; }
    _pending = window.readSlot(window.__VFS_REGISTRY_ID).then(function(data) {
      _pending = null;
      if (data) {
        try {
          _cache = JSON.parse(data);
          _cacheTime = Date.now();
          return _cache;
        } catch(e) { /* fall through */ }
      }
      return { __meta: { version: 1 }, slots: {} };
    }).catch(function(e) {
      _pending = null;
      throw e;
    });
    return _pending;
  }

  function invalidate() {
    _cache = null;
    _cacheTime = 0;
  }

  function fastResolve(name) {
    return readReg().then(function(reg) {
      var s = reg.slots[name];
      return s ? s.id : null;
    });
  }

  function fastRead(name) {
    return fastResolve(name).then(function(id) {
      if (!id) { return ''; }
      return window.readSlot(id);
    });
  }

  function batch(names) {
    return readReg().then(function(reg) {
      return Promise.all(names.map(function(name) {
        var s = reg.slots[name];
        if (!s) {
          return Promise.resolve({ name: name, data: '', error: 'not_found' });
        }
        return window.readSlot(s.id).then(function(d) {
          return { name: name, data: d };
        }).catch(function(e) {
          return { name: name, data: '', error: e.message };
        });
      }));
    });
  }

  function batchFull(names) {
    return readReg().then(function(reg) {
      return Promise.all(names.map(function(name) {
        var s = reg.slots[name];
        if (!s) {
          return Promise.resolve({ name: name, error: 'not_found' });
        }
        return window.readSlotFull(s.id).then(function(d) {
          return { name: name, full: d };
        }).catch(function(e) {
          return { name: name, error: e.message };
        });
      }));
    });
  }

  function lazy(names) {
    var idx = 0;
    var regP = readReg();
    return {
      next: function() {
        if (idx >= names.length) {
          return Promise.resolve({ done: true });
        }
        var name = names[idx++];
        return regP.then(function(reg) {
          var s = reg.slots[name];
          if (!s) {
            return { done: false, value: { name: name, error: 'not_found' } };
          }
          return window.readSlot(s.id).then(function(d) {
            return { done: false, value: { name: name, data: d } };
          });
        });
      },
      remaining: function() { return names.length - idx; },
      reset: function() { idx = 0; }
    };
  }

  function lazyMsg(slotName, filterKeys) {
    var idx = 0;
    var loaded = null;
    return {
      next: function() {
        if (!loaded) {
          loaded = fastResolve(slotName).then(function(id) {
            if (!id) { return []; }
            return window.readSlotMessages(id).then(function(msgs) {
              return msgs.map(function(m) {
                try { return JSON.parse(m.content); } catch(e) { return { key: '?', value: m.content }; }
              }).filter(function(p) {
                return !filterKeys || filterKeys.indexOf(p.key) > -1;
              });
            });
          });
        }
        return loaded.then(function(items) {
          if (idx >= items.length) { return { done: true }; }
          return { done: false, value: items[idx++] };
        });
      },
      reset: function() { idx = 0; loaded = null; }
    };
  }

  var orig = {
    resolve: vfs.resolve,
    read: vfs.read,
    write: vfs.write,
    mount: vfs.mount,
    unmount: vfs.unmount
  };

  vfs.resolve = fastResolve;
  vfs.read = fastRead;

  vfs.write = function(name, content) {
    return orig.write.call(vfs, name, content).then(function(r) {
      invalidate();
      return r;
    });
  };

  if (orig.mount) {
    vfs.mount = function() {
      return orig.mount.apply(vfs, arguments).then(function(r) {
        invalidate();
        return r;
      });
    };
  }

  if (orig.unmount) {
    vfs.unmount = function() {
      return orig.unmount.apply(vfs, arguments).then(function(r) {
        invalidate();
        return r;
      });
    };
  }

  vfs.batch = batch;
  vfs.batchFull = batchFull;
  vfs.lazy = lazy;
  vfs.lazyMsg = lazyMsg;
  vfs.warmup = function() { return readReg(); };
  vfs.invalidateCache = invalidate;
  vfs.cacheStats = function() {
    return {
      cached: !!_cache,
      age: _cache ? (Date.now() - _cacheTime) + 'ms' : 'N/A',
      ttl: _cfg.ttl + 'ms',
      pending: !!_pending,
      slots: _cache ? Object.keys(_cache.slots).length : 0
    };
  };
  vfs.cacheCfg = _cfg;
  vfs._orig = orig;

  console.log('[VFS-Cache] v2 loaded: TTL=' + _cfg.ttl + 'ms');
})();