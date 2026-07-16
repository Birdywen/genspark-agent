(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.OmegaConversationCacheCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var VERSION = 1;
  var MAX_MESSAGE_CHARS = 1200;
  var LOW_VALUE = /^(好的|好|收到|明白|继续|可以|行|ok|okay|thanks|thank you|哈哈|嗯|对|是)$/i;
  var IMPORTANT = /(根因|最终|决定|结论|已验证|验证通过|失败|错误|风险|待办|下一步|未完成|不要|必须|记住|恢复|回滚|commit|artifact|command|#[0-9]{3,}|error|failed|timeout|decision|verified|todo|next step|root cause)/i;
  var NOISY = /(安装进度|下载进度|progress:|node_modules|完整日志|批量执行完成)/i;

  function text(value) {
    return value == null ? '' : String(value);
  }

  function fingerprint(value) {
    var input = text(value);
    var hash = 2166136261;
    for (var i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return ('00000000' + (hash >>> 0).toString(16)).slice(-8);
  }

  function messageKey(message, index) {
    return text(message && message.id) || ('index:' + index);
  }

function uniqueNums(list, limit) {
  var out = [];
  var seen = Object.create(null);
  (list || []).forEach(function(v) {
    var n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return;
    if (seen[n]) return;
    seen[n] = 1;
    out.push(n);
  });
  return out.slice(0, limit || 20);
}

function extractCommandIds(content) {
  content = text(content);
  var ids = [];
  var match;
  var reHash = /\[#(\d+)\]/g;
  while ((match = reHash.exec(content)) !== null) ids.push(match[1]);
  var reHist = /"historyId"\s*:\s*(\d+)/g;
  while ((match = reHist.exec(content)) !== null) ids.push(match[1]);
  var reHist2 = /historyId\s*[:=]\s*(\d+)/g;
  while ((match = reHist2.exec(content)) !== null) ids.push(match[1]);
  var reCmd = /command(?:Id)?\s*[:=#]\s*(\d+)/gi;
  while ((match = reCmd.exec(content)) !== null) ids.push(match[1]);
  return uniqueNums(ids, 20);
}

function extractArtifactRefs(content) {
  content = text(content);
  var refs = [];
  var seen = Object.create(null);
  var re = /artifact:\/\/[^\s)'"\\]+/g;
  var match;
  while ((match = re.exec(content)) !== null) {
    var ref = match[0];
    if (seen[ref]) continue;
    seen[ref] = 1;
    refs.push(ref);
  }
  return refs.slice(0, 20);
}

function normalizeMessage(message, index) {
  message = message || {};
  var content = text(message.content);
  var existingMeta = message.meta && typeof message.meta === 'object' ? message.meta : {};
  var commandIds = uniqueNums([].concat(existingMeta.commandIds || existingMeta.command_ids || [], extractCommandIds(content)), 20);
  var artifactRefs = [].concat(existingMeta.artifactRefs || existingMeta.artifact_refs || [], extractArtifactRefs(content));
  var seenRef = Object.create(null);
  artifactRefs = artifactRefs.filter(function(ref) {
    ref = text(ref);
    if (!ref || seenRef[ref]) return false;
    seenRef[ref] = 1;
    return true;
  }).slice(0, 20);
  var meta = {};
  Object.keys(existingMeta).forEach(function(k) { meta[k] = existingMeta[k]; });
  if (commandIds.length) meta.commandIds = commandIds;
  if (artifactRefs.length) meta.artifactRefs = artifactRefs;
  return {
    id: messageKey(message, index),
    role: text(message.role || 'unknown'),
    content: content,
    ctime: message.ctime || message.created_at || null,
    index: index,
    hash: fingerprint(text(message.role) + '\n' + content),
    meta: meta,
    commandIds: commandIds,
    artifactRefs: artifactRefs
  };
}

function normalizeConversation(data, conversationId, options) {
    options = options || {};
    data = data || {};
    var state = data.session_state || {};
    var rawMessages = Array.isArray(state.messages) ? state.messages : [];
    var messages = rawMessages.map(normalizeMessage);
    var savedAt = options.savedAt || new Date().toISOString();
    var hashSource = messages.map(function(message) {
      return message.id + ':' + message.hash;
    }).join('|');
    var snapshotHash = fingerprint(hashSource);
    return {
      version: VERSION,
      snapshotId: text(conversationId) + ':' + Date.parse(savedAt) + ':' + snapshotHash,
      conversationId: text(conversationId),
      title: text(data.name || options.title),
      type: text(data.type || options.type),
      ctime: data.ctime || null,
      mtime: data.mtime || null,
      savedAt: savedAt,
      reason: text(options.reason || 'manual'),
      messageCount: messages.length,
      snapshotHash: snapshotHash,
      sessionStateKeys: Object.keys(state),
      messages: messages
    };
  }

  function preview(value, limit) {
    var clean = text(value).replace(/\s+/g, ' ').trim();
    limit = limit || 180;
    return clean.length > limit ? clean.slice(0, limit) + '…' : clean;
  }

  function diffSnapshots(older, newer) {
    older = older || { messages: [] };
    newer = newer || { messages: [] };
    var oldMap = new Map();
    var newMap = new Map();
    (older.messages || []).forEach(function(message, index) {
      oldMap.set(messageKey(message, index), message);
    });
    (newer.messages || []).forEach(function(message, index) {
      newMap.set(messageKey(message, index), message);
    });
    var added = [];
    var removed = [];
    var changed = [];
    newMap.forEach(function(message, id) {
      if (!oldMap.has(id)) {
        added.push({ id: id, role: message.role, preview: preview(message.content) });
      } else if (oldMap.get(id).hash !== message.hash) {
        changed.push({
          id: id,
          role: message.role,
          before: preview(oldMap.get(id).content),
          after: preview(message.content)
        });
      }
    });
    oldMap.forEach(function(message, id) {
      if (!newMap.has(id)) {
        removed.push({ id: id, role: message.role, preview: preview(message.content) });
      }
    });
    return {
      olderSnapshotId: older.snapshotId || null,
      newerSnapshotId: newer.snapshotId || null,
      oldCount: (older.messages || []).length,
      newCount: (newer.messages || []).length,
      added: added,
      removed: removed,
      changed: changed,
      identical: added.length === 0 && removed.length === 0 && changed.length === 0
    };
  }

  function scoreMessage(message, index, total) {
    var content = text(message && message.content).trim();
    if (!content || LOW_VALUE.test(content)) return -100;
    var score = 0;
    var role = text(message && message.role);
    if (role === 'user') score += 3;
    if (role === 'assistant') score += 1;
    if (IMPORTANT.test(content)) score += 8;
    if (/ΩCODE|OMEGACODE|tool_result|historyId/.test(content)) score += 3;
    if (NOISY.test(content) && !IMPORTANT.test(content)) score -= 5;
    if (content.length > 50 && content.length < 1800) score += 2;
    if (content.length > 8000 && !IMPORTANT.test(content)) score -= 4;
    var distance = Math.max(0, total - index);
    if (distance <= 12) score += 7;
    else if (distance <= 30) score += 3;
    return score;
  }

  function buildHandoff(snapshot, options) {
    options = options || {};
    snapshot = snapshot || { messages: [] };
    var messages = snapshot.messages || [];
    var maxMessages = options.maxMessages || 18;
    var candidates = messages.map(function(message, index) {
      return {
        message: message,
        index: index,
        score: scoreMessage(message, index, messages.length)
      };
    }).filter(function(item) {
      return item.score > 0;
    });
    candidates.sort(function(a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return b.index - a.index;
    });
    var selected = candidates.slice(0, maxMessages).sort(function(a, b) {
      return a.index - b.index;
    });
    var lines = [
      '[Omega Conversation Handoff]',
      'source_conversation: ' + text(snapshot.conversationId),
      'source_snapshot: ' + text(snapshot.snapshotId),
      'saved_at: ' + text(snapshot.savedAt),
      'title: ' + text(snapshot.title),
      'message_count: ' + text(snapshot.messageCount),
      'command_ids: ' + text((function() {
        var all = [];
        (snapshot.messages || []).forEach(function(m) {
          var ids = (m && m.commandIds) || (m && m.meta && m.meta.commandIds) || [];
          ids.forEach(function(id) { all.push(id); });
        });
        return uniqueNums(all, 50).join(',');
      })()),
      ''
    ];
    selected.forEach(function(item) {
      var content = text(item.message.content);
      if (content.length > MAX_MESSAGE_CHARS) {
        content = content.slice(0, MAX_MESSAGE_CHARS) + '\n[原文已截断，可按 snapshot/message id 召回]';
      }
      lines.push('---');
      lines.push('message_id: ' + item.message.id);
      lines.push('role: ' + item.message.role);
      lines.push('importance: ' + item.score);
      lines.push(content);
    });
    lines.push('');
    lines.push('[Source preserved in browser cache; verify live state before side effects.]');
    return {
      text: lines.join('\n'),
      selectedCount: selected.length,
      selectedMessageIds: selected.map(function(item) { return item.message.id; }),
      sourceSnapshotId: snapshot.snapshotId
    };
  }

  function searchSnapshot(snapshot, query, options) {
    options = options || {};
    var words = text(query).toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    var limit = options.limit || 20;
    var results = [];
    (snapshot.messages || []).forEach(function(message, index) {
      var haystack = (text(message.role) + ' ' + text(message.content)).toLowerCase();
      var hits = 0;
      words.forEach(function(word) {
        if (haystack.indexOf(word) >= 0) hits++;
      });
      if (!hits) return;
      results.push({
        snapshotId: snapshot.snapshotId,
        conversationId: snapshot.conversationId,
        title: snapshot.title,
        savedAt: snapshot.savedAt,
        messageId: message.id,
        role: message.role,
        score: hits * 10 + scoreMessage(message, index, snapshot.messages.length),
        preview: preview(message.content, options.previewChars || 260)
      });
    });
    results.sort(function(a, b) { return b.score - a.score; });
    return results.slice(0, limit);
  }

  return {
    VERSION: VERSION,
    fingerprint: fingerprint,
    normalizeMessage: normalizeMessage,
    extractCommandIds: extractCommandIds,
    extractArtifactRefs: extractArtifactRefs,
    normalizeConversation: normalizeConversation,
    diffSnapshots: diffSnapshots,
    scoreMessage: scoreMessage,
    buildHandoff: buildHandoff,
    searchSnapshot: searchSnapshot
  };
});