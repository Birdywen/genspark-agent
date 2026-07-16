(function(root, factory) {
  var core = root.OmegaConversationCacheCore;
  if (!core && typeof require === 'function') core = require('./conversation-cache-core.js');
  var api = factory(core);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.OmegaConversationCacheStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(core) {
  'use strict';

  if (!core) throw new Error('OmegaConversationCacheCore is required');

  var DB_NAME = 'omega-conversation-cache';
  var DB_VERSION = 1;
  var SNAPSHOT_LIMIT_PER_CONVERSATION = 30;
  var dbPromise = null;

  function requestResult(request) {
    return new Promise(function(resolve, reject) {
      request.onsuccess = function() { resolve(request.result); };
      request.onerror = function() { reject(request.error || new Error('IndexedDB request failed')); };
    });
  }

  function transactionDone(transaction) {
    return new Promise(function(resolve, reject) {
      transaction.oncomplete = function() { resolve(); };
      transaction.onerror = function() {
        reject(transaction.error || new Error('IndexedDB transaction failed'));
      };
      transaction.onabort = function() {
        reject(transaction.error || new Error('IndexedDB transaction aborted'));
      };
    });
  }

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function(resolve, reject) {
      var request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function(event) {
        var db = event.target.result;
        var snapshots;
        if (!db.objectStoreNames.contains('snapshots')) {
          snapshots = db.createObjectStore('snapshots', { keyPath: 'snapshotId' });
          snapshots.createIndex('conversationId', 'conversationId', { unique: false });
          snapshots.createIndex('savedAt', 'savedAt', { unique: false });
          snapshots.createIndex('snapshotHash', 'snapshotHash', { unique: false });
        }
        if (!db.objectStoreNames.contains('conversations')) {
          var conversations = db.createObjectStore('conversations', { keyPath: 'conversationId' });
          conversations.createIndex('lastSeenAt', 'lastSeenAt', { unique: false });
        }
      };
      request.onsuccess = function() {
        var db = request.result;
        db.onversionchange = function() {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      request.onerror = function() {
        dbPromise = null;
        reject(request.error || new Error('Unable to open conversation cache'));
      };
      request.onblocked = function() {
        console.warn('[ConversationCache] IndexedDB upgrade blocked');
      };
    });
    return dbPromise;
  }

  async function getConversation(conversationId) {
    var db = await openDb();
    var tx = db.transaction('conversations', 'readonly');
    return requestResult(tx.objectStore('conversations').get(String(conversationId)));
  }

  async function getSnapshot(snapshotId) {
    var db = await openDb();
    var tx = db.transaction('snapshots', 'readonly');
    return requestResult(tx.objectStore('snapshots').get(String(snapshotId)));
  }

  async function latestSnapshot(conversationId) {
    var conversation = await getConversation(conversationId);
    if (!conversation || !conversation.latestSnapshotId) return null;
    return getSnapshot(conversation.latestSnapshotId);
  }

  async function listSnapshots(options) {
    options = options || {};
    var db = await openDb();
    var tx = db.transaction('snapshots', 'readonly');
    var store = tx.objectStore('snapshots');
    var rows;
    if (options.conversationId) {
      rows = await requestResult(
        store.index('conversationId').getAll(IDBKeyRange.only(String(options.conversationId)))
      );
    } else {
      rows = await requestResult(store.getAll());
    }
    rows.sort(function(a, b) {
      return String(b.savedAt).localeCompare(String(a.savedAt));
    });
    var limit = options.limit || 50;
    return rows.slice(0, limit).map(function(snapshot) {
      return {
        snapshotId: snapshot.snapshotId,
        conversationId: snapshot.conversationId,
        title: snapshot.title,
        savedAt: snapshot.savedAt,
        reason: snapshot.reason,
        messageCount: snapshot.messageCount,
        snapshotHash: snapshot.snapshotHash
      };
    });
  }

  async function pruneConversation(conversationId) {
    var db = await openDb();
    var readTx = db.transaction('snapshots', 'readonly');
    var rows = await requestResult(
      readTx.objectStore('snapshots').index('conversationId')
        .getAll(IDBKeyRange.only(String(conversationId)))
    );
    rows.sort(function(a, b) {
      return String(b.savedAt).localeCompare(String(a.savedAt));
    });
    var stale = rows.slice(SNAPSHOT_LIMIT_PER_CONVERSATION);
    if (!stale.length) return 0;
    var writeTx = db.transaction('snapshots', 'readwrite');
    stale.forEach(function(snapshot) {
      writeTx.objectStore('snapshots').delete(snapshot.snapshotId);
    });
    await transactionDone(writeTx);
    return stale.length;
  }

  async function saveSnapshot(snapshot) {
    if (!snapshot || !snapshot.snapshotId || !snapshot.conversationId) {
      throw new Error('Invalid conversation snapshot');
    }
    var now = new Date().toISOString();
    var existing = await getConversation(snapshot.conversationId);
    if (existing && existing.latestHash === snapshot.snapshotHash) {
      existing.lastSeenAt = now;
      existing.title = snapshot.title || existing.title;
      existing.messageCount = snapshot.messageCount;
      var dedupeDb = await openDb();
      var dedupeTx = dedupeDb.transaction('conversations', 'readwrite');
      dedupeTx.objectStore('conversations').put(existing);
      await transactionDone(dedupeTx);
      return {
        ok: true,
        deduplicated: true,
        snapshotId: existing.latestSnapshotId,
        snapshotHash: existing.latestHash,
        messageCount: snapshot.messageCount
      };
    }

    var db = await openDb();
    var tx = db.transaction(['snapshots', 'conversations'], 'readwrite');
    tx.objectStore('snapshots').put(snapshot);
    tx.objectStore('conversations').put({
      conversationId: snapshot.conversationId,
      title: snapshot.title,
      type: snapshot.type,
      latestSnapshotId: snapshot.snapshotId,
      latestHash: snapshot.snapshotHash,
      messageCount: snapshot.messageCount,
      firstSeenAt: existing ? existing.firstSeenAt : now,
      lastSeenAt: now,
      latestSavedAt: snapshot.savedAt
    });
    await transactionDone(tx);
    var pruned = await pruneConversation(snapshot.conversationId);
    return {
      ok: true,
      deduplicated: false,
      snapshotId: snapshot.snapshotId,
      snapshotHash: snapshot.snapshotHash,
      messageCount: snapshot.messageCount,
      pruned: pruned
    };
  }

  async function saveConversationData(data, conversationId, options) {
    var snapshot = core.normalizeConversation(data, conversationId, options || {});
    return saveSnapshot(snapshot);
  }

  async function diff(options) {
    options = options || {};
    var older = options.olderSnapshotId
      ? await getSnapshot(options.olderSnapshotId)
      : null;
    var newer = options.newerSnapshotId
      ? await getSnapshot(options.newerSnapshotId)
      : null;
    if (!older && options.conversationId) {
      var rows = await listSnapshots({ conversationId: options.conversationId, limit: 2 });
      if (rows.length > 1) older = await getSnapshot(rows[1].snapshotId);
      if (rows.length > 0) newer = await getSnapshot(rows[0].snapshotId);
    }
    if (!older || !newer) throw new Error('Two snapshots are required for diff');
    return core.diffSnapshots(older, newer);
  }

  async function search(query, options) {
    options = options || {};
    var db = await openDb();
    var tx = db.transaction('snapshots', 'readonly');
    var snapshots = await requestResult(tx.objectStore('snapshots').getAll());
    snapshots.sort(function(a, b) {
      return String(b.savedAt).localeCompare(String(a.savedAt));
    });
    var maxSnapshots = options.maxSnapshots || 200;
    var limit = options.limit || 20;
    var results = [];
    var seen = new Set();
    snapshots.slice(0, maxSnapshots).forEach(function(snapshot) {
      core.searchSnapshot(snapshot, query, { limit: limit }).forEach(function(result) {
        var dedupeKey = result.conversationId + ':' + result.messageId + ':' + result.preview;
        if (seen.has(dedupeKey)) return;
        seen.add(dedupeKey);
        results.push(result);
      });
    });
    results.sort(function(a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return String(b.savedAt).localeCompare(String(a.savedAt));
    });
    return results.slice(0, limit);
  }

  async function handoff(options) {
    options = options || {};
    var snapshot = options.snapshotId
      ? await getSnapshot(options.snapshotId)
      : await latestSnapshot(options.conversationId);
    if (!snapshot) throw new Error('Snapshot not found');
    return core.buildHandoff(snapshot, options);
  }

  async function stats() {
    var db = await openDb();
    var tx = db.transaction(['snapshots', 'conversations'], 'readonly');
    var snapshotCount = await requestResult(tx.objectStore('snapshots').count());
    var conversationCount = await requestResult(tx.objectStore('conversations').count());
    return {
      database: DB_NAME,
      version: DB_VERSION,
      snapshots: snapshotCount,
      conversations: conversationCount,
      retentionPerConversation: SNAPSHOT_LIMIT_PER_CONVERSATION
    };
  }

  async function handle(message) {
    message = message || {};
    switch (message.type) {
      case 'CONV_CACHE_SAVE':
        return saveConversationData(
          message.data,
          message.conversationId,
          message.options || {}
        );
      case 'CONV_CACHE_LIST':
        return { ok: true, result: await listSnapshots(message.options || {}) };
      case 'CONV_CACHE_GET':
        return { ok: true, result: await getSnapshot(message.snapshotId) };
      case 'CONV_CACHE_LATEST':
        return { ok: true, result: await latestSnapshot(message.conversationId) };
      case 'CONV_CACHE_DIFF':
        return { ok: true, result: await diff(message.options || {}) };
      case 'CONV_CACHE_SEARCH':
        return { ok: true, result: await search(message.query, message.options || {}) };
      case 'CONV_CACHE_HANDOFF':
        return { ok: true, result: await handoff(message.options || {}) };
      case 'CONV_CACHE_STATS':
        return { ok: true, result: await stats() };
      default:
        throw new Error('Unknown conversation cache message: ' + message.type);
    }
  }

  return {
    DB_NAME: DB_NAME,
    DB_VERSION: DB_VERSION,
    openDb: openDb,
    saveSnapshot: saveSnapshot,
    saveConversationData: saveConversationData,
    getSnapshot: getSnapshot,
    latestSnapshot: latestSnapshot,
    listSnapshots: listSnapshots,
    diff: diff,
    search: search,
    handoff: handoff,
    stats: stats,
    handle: handle
  };
});