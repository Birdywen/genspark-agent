#!/usr/bin/env node
/**
 * conversation-archaeology.cjs
 * 一体考古：引用打点 + 按次数晋升 snapshot/messages
 *
 * Usage:
 *   node conversation-archaeology.cjs record --conversation_id ID [--snapshot_id S] [--message_id M] [--command_id N] --ref_type handoff|search|diff|compress|manual|recover|ask|link [--source ui|agent|compress|dream|user] [--meta JSON]
 *   node conversation-archaeology.cjs promote --snapshot_id S --conversation_id ID [--title T] [--saved_at ISO] [--message_count N] [--content_hash H] [--force] [--reason threshold|force_event|manual] [--messages JSON]
 *   node conversation-archaeology.cjs status --snapshot_id S | --conversation_id ID
 *   node conversation-archaeology.cjs smoke
 */
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'data', 'agent.db');
const HEAD_THRESHOLD = 2;
const MSG_THRESHOLD = 3;

function openDb() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  return db;
}

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1] != null) return process.argv[i + 1];
  return fallback;
}
hasFlag = (name) => process.argv.includes(`--${name}`);

function recordRef(db, input) {
  if (!input.conversation_id) throw new Error('conversation_id required');
  if (!input.ref_type) throw new Error('ref_type required');
  const info = db.prepare(`INSERT INTO conversation_refs
    (conversation_id, snapshot_id, message_id, command_id, ref_type, source, meta)
    VALUES (@conversation_id, @snapshot_id, @message_id, @command_id, @ref_type, @source, @meta)`).run({
    conversation_id: input.conversation_id,
    snapshot_id: input.snapshot_id || null,
    message_id: input.message_id || null,
    command_id: input.command_id == null || input.command_id === '' ? null : Number(input.command_id),
    ref_type: input.ref_type,
    source: input.source || 'agent',
    meta: input.meta || null
  });

  let refCount = 0;
  if (input.snapshot_id) {
    refCount = db.prepare('SELECT COUNT(*) AS n FROM conversation_refs WHERE snapshot_id = ?').get(input.snapshot_id).n;
    // 若头已存在则同步 ref_count；否则仅返回计数，等 promote
    db.prepare(`UPDATE conversation_snapshots SET ref_count = ? WHERE snapshot_id = ?`).run(refCount, input.snapshot_id);
  } else {
    refCount = db.prepare('SELECT COUNT(*) AS n FROM conversation_refs WHERE conversation_id = ?').get(input.conversation_id).n;
  }

  return { refId: info.lastInsertRowid, refCount, snapshot_id: input.snapshot_id || null, conversation_id: input.conversation_id };
}

function promoteSnapshot(db, input) {
  if (!input.snapshot_id || !input.conversation_id) throw new Error('snapshot_id and conversation_id required');
  const refCount = db.prepare('SELECT COUNT(*) AS n FROM conversation_refs WHERE snapshot_id = ?').get(input.snapshot_id).n;
  const force = !!input.force;
  const reason = input.reason || (force ? 'force_event' : 'threshold');

  if (!force && refCount < HEAD_THRESHOLD) {
    return { promoted: false, level: 'none', refCount, need: HEAD_THRESHOLD, reason: 'below_threshold' };
  }

  const existing = db.prepare('SELECT * FROM conversation_snapshots WHERE snapshot_id = ?').get(input.snapshot_id);
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO conversation_snapshots (
      snapshot_id, conversation_id, saved_at, title, message_count, ref_count,
      promoted_at, promote_reason, content_hash, source, head_json
    ) VALUES (
      @snapshot_id, @conversation_id, @saved_at, @title, @message_count, @ref_count,
      @promoted_at, @promote_reason, @content_hash, @source, @head_json
    )
    ON CONFLICT(snapshot_id) DO UPDATE SET
      conversation_id=excluded.conversation_id,
      saved_at=COALESCE(excluded.saved_at, conversation_snapshots.saved_at),
      title=COALESCE(excluded.title, conversation_snapshots.title),
      message_count=COALESCE(excluded.message_count, conversation_snapshots.message_count),
      ref_count=excluded.ref_count,
      promoted_at=COALESCE(conversation_snapshots.promoted_at, excluded.promoted_at),
      promote_reason=COALESCE(conversation_snapshots.promote_reason, excluded.promote_reason),
      content_hash=COALESCE(excluded.content_hash, conversation_snapshots.content_hash),
      head_json=COALESCE(excluded.head_json, conversation_snapshots.head_json)
  `).run({
    snapshot_id: input.snapshot_id,
    conversation_id: input.conversation_id,
    saved_at: input.saved_at || now,
    title: input.title || null,
    message_count: input.message_count == null ? null : Number(input.message_count),
    ref_count: refCount,
    promoted_at: existing?.promoted_at || now,
    promote_reason: existing?.promote_reason || reason,
    content_hash: input.content_hash || null,
    source: input.source || 'idb',
    head_json: input.head_json || null
  });

  let messagesInserted = 0;
  const promoteMessages = force || refCount >= MSG_THRESHOLD;
  if (promoteMessages && input.messages) {
    const messages = typeof input.messages === 'string' ? JSON.parse(input.messages) : input.messages;
    const upsert = db.prepare(`INSERT INTO conversation_messages (
      snapshot_id, message_id, role, content, command_ids, artifact_refs, importance
    ) VALUES (@snapshot_id, @message_id, @role, @content, @command_ids, @artifact_refs, @importance)
    ON CONFLICT(snapshot_id, message_id) DO UPDATE SET
      role=excluded.role,
      content=excluded.content,
      command_ids=excluded.command_ids,
      artifact_refs=excluded.artifact_refs,
      importance=excluded.importance`);
    const tx = db.transaction((rows) => {
      for (const m of rows) {
        upsert.run({
          snapshot_id: input.snapshot_id,
          message_id: String(m.id || m.message_id),
          role: m.role || null,
          content: m.content || null,
          command_ids: m.command_ids ? JSON.stringify(m.command_ids) : (m.meta && m.meta.commandIds ? JSON.stringify(m.meta.commandIds) : null),
          artifact_refs: m.artifact_refs ? JSON.stringify(m.artifact_refs) : (m.meta && m.meta.artifactRefs ? JSON.stringify(m.meta.artifactRefs) : null),
          importance: m.importance == null ? null : Number(m.importance)
        });
        messagesInserted += 1;
      }
    });
    tx(Array.isArray(messages) ? messages : []);
  }

  return {
    promoted: true,
    level: promoteMessages && messagesInserted ? 'messages' : 'head',
    refCount,
    snapshot_id: input.snapshot_id,
    messagesInserted,
    existed: !!existing
  };
}

function status(db, { snapshot_id, conversation_id }) {
  if (snapshot_id) {
    const refs = db.prepare('SELECT * FROM conversation_refs WHERE snapshot_id = ? ORDER BY id').all(snapshot_id);
    const snap = db.prepare('SELECT * FROM conversation_snapshots WHERE snapshot_id = ?').get(snapshot_id);
    const msgs = db.prepare('SELECT snapshot_id, message_id, role, length(content) AS content_len FROM conversation_messages WHERE snapshot_id = ?').all(snapshot_id);
    return { snapshot_id, refCount: refs.length, refs, snapshot: snap || null, messages: msgs };
  }
  if (conversation_id) {
    const refs = db.prepare('SELECT * FROM conversation_refs WHERE conversation_id = ? ORDER BY id DESC LIMIT 50').all(conversation_id);
    const snaps = db.prepare('SELECT * FROM conversation_snapshots WHERE conversation_id = ? ORDER BY ref_count DESC, promoted_at DESC').all(conversation_id);
    return { conversation_id, refCount: refs.length, refs, snapshots: snaps };
  }
  throw new Error('snapshot_id or conversation_id required');
}

function smoke() {
  const db = openDb();
  const conversation_id = 'smoke-conv-' + Date.now();
  const snapshot_id = conversation_id + ':snap:1';
  const r1 = recordRef(db, { conversation_id, snapshot_id, ref_type: 'search', source: 'smoke' });
  const p1 = promoteSnapshot(db, { conversation_id, snapshot_id, title: 'smoke', force: false });
  const r2 = recordRef(db, { conversation_id, snapshot_id, ref_type: 'handoff', source: 'smoke', command_id: 72099 });
  const p2 = promoteSnapshot(db, {
    conversation_id,
    snapshot_id,
    title: 'smoke-promoted',
    message_count: 2,
    messages: [
      { id: 'm1', role: 'user', content: 'hello smoke', meta: { commandIds: [72099] } },
      { id: 'm2', role: 'assistant', content: 'world' }
    ]
  });
  // third ref should allow messages if not force
  const r3 = recordRef(db, { conversation_id, snapshot_id, ref_type: 'manual', source: 'smoke' });
  const p3 = promoteSnapshot(db, {
    conversation_id,
    snapshot_id,
    title: 'smoke-promoted-msgs',
    message_count: 2,
    messages: [
      { id: 'm1', role: 'user', content: 'hello smoke', meta: { commandIds: [72099] } },
      { id: 'm2', role: 'assistant', content: 'world' }
    ]
  });
  const st = status(db, { snapshot_id });
  db.close();
  return { r1, p1, r2, p2, r3, p3, status: { refCount: st.refCount, hasSnapshot: !!st.snapshot, messageRows: st.messages.length } };
}

function main() {
  const cmd = process.argv[2] || 'help';
  const db = openDb();
  try {
    if (cmd === 'record') {
      const out = recordRef(db, {
        conversation_id: arg('conversation_id'),
        snapshot_id: arg('snapshot_id'),
        message_id: arg('message_id'),
        command_id: arg('command_id'),
        ref_type: arg('ref_type'),
        source: arg('source', 'agent'),
        meta: arg('meta')
      });
      // auto promote head if threshold met
      if (out.snapshot_id) {
        const promo = promoteSnapshot(db, {
          snapshot_id: out.snapshot_id,
          conversation_id: out.conversation_id,
          force: hasFlag('force')
        });
        console.log(JSON.stringify({ ok: true, record: out, promote: promo }, null, 2));
      } else {
        console.log(JSON.stringify({ ok: true, record: out }, null, 2));
      }
      return;
    }
    if (cmd === 'promote') {
      const out = promoteSnapshot(db, {
        snapshot_id: arg('snapshot_id'),
        conversation_id: arg('conversation_id'),
        title: arg('title'),
        saved_at: arg('saved_at'),
        message_count: arg('message_count'),
        content_hash: arg('content_hash'),
        reason: arg('reason'),
        source: arg('source', 'idb'),
        head_json: arg('head_json'),
        messages: arg('messages'),
        force: hasFlag('force')
      });
      console.log(JSON.stringify({ ok: true, promote: out }, null, 2));
      return;
    }
    if (cmd === 'status') {
      const out = status(db, { snapshot_id: arg('snapshot_id'), conversation_id: arg('conversation_id') });
      console.log(JSON.stringify({ ok: true, status: out }, null, 2));
      return;
    }
    if (cmd === 'smoke') {
      db.close();
      console.log(JSON.stringify({ ok: true, smoke: smoke() }, null, 2));
      return;
    }
    console.log(JSON.stringify({ ok: false, error: 'unknown command', cmd }, null, 2));
    process.exit(2);
  } finally {
    try { db.close(); } catch {}
  }
}

main();
