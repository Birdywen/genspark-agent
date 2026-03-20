import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

// VFS Driver - Supabase-backed (migrated from IndexedDB)
// Tools: vfs_read, vfs_write, vfs_delete, vfs_list, vfs_query, vfs_search, vfs_exec, vfs_backup

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_KEY;

let _logger = null;

function hdrs(extra) {
  return Object.assign({
    'apikey': SB_KEY,
    'Authorization': 'Bearer ' + SB_KEY,
    'Content-Type': 'application/json'
  }, extra || {});
}

async function sb(path, opts = {}) {
  const url = SB_URL + '/rest/v1/' + path;
  const h = hdrs(opts.headers);
  const fetchOpts = Object.assign({}, opts, { headers: h });
  const res = await fetch(url, fetchOpts);
  const text = await res.text();
  try { return { status: res.status, data: JSON.parse(text) }; }
  catch(e) { return { status: res.status, data: text }; }
}

// Map old VFS slot:key naming to Supabase name field
function toName(slot, key) {
  if (key) return slot + ':' + key;
  return 'slot:' + slot;
}

async function init(deps) {
  _logger = deps.logger;
  if (!SB_URL || !SB_KEY) {
    _logger.warning('[VFS] SUPABASE_URL/KEY not set, driver disabled');
    return;
  }
  _logger.info('[VFS] Supabase-backed VFS driver ready');
}

async function handle(tool, params, ctx) {
  const trace = ctx.trace || ctx; trace.span('vfs', { action: 'start', tool });
  let result;

  switch(tool) {
    case 'vfs_write': {
      if (!params.slot) { result = { isError: true, error: 'vfs_write needs slot' }; break; }
      const name = toName(params.slot, params.key);
      let contentStr = typeof params.content === 'string' ? params.content : JSON.stringify(params.content || '');
      // support @file param
      if (params.file && !params.content) {
        try { contentStr = readFileSync(params.file, "utf-8"); } catch(e) { result = { isError: true, error: "read file failed: " + e.message }; break; }
      }
      
      // upsert: check existing
      const eq = 'agent_memory?name=eq.' + encodeURIComponent(name) + '&limit=1';
      const ex = await sb(eq, { method: 'GET' });
      const row = {
        type: params.key ? 'msg' : 'slot',
        scene: params.slot,
        name: name,
        content: contentStr,
        updated_at: new Date().toISOString()
      };
      
      if (ex.data && ex.data[0]) {
        await sb('agent_memory?id=eq.' + ex.data[0].id, {
          method: 'PATCH', headers: { 'Prefer': 'return=minimal' },
          body: JSON.stringify(row)
        });
        result = 'writeMsg ok: updated ' + name;
      } else {
        await sb('agent_memory', {
          method: 'POST', headers: { 'Prefer': 'return=minimal' },
          body: JSON.stringify(row)
        });
        result = 'writeMsg ok: created ' + name;
      }
      break;
    }

    case 'vfs_read': {
      if (!params.slot) { result = { isError: true, error: 'vfs_read needs slot' }; break; }
      if (params.key) {
        // read msg
        const name = toName(params.slot, params.key);
        const r = await sb('agent_memory?name=eq.' + encodeURIComponent(name) + '&select=content&limit=1', { method: 'GET' });
        result = (r.data && r.data[0]) ? r.data[0].content : null;
      } else if (params.keys) {
        // list msg keys
        const r = await sb('agent_memory?scene=eq.' + encodeURIComponent(params.slot) + '&type=eq.msg&select=name,updated_at&order=name', { method: 'GET' });
        result = JSON.stringify((r.data || []).map(function(row) {
          return { key: row.name.replace(params.slot + ':', ''), updated_at: row.updated_at };
        }));
      } else {
        // read slot content
        const name = 'slot:' + params.slot;
        const r = await sb('agent_memory?name=eq.' + encodeURIComponent(name) + '&select=content&limit=1', { method: 'GET' });
        result = (r.data && r.data[0]) ? r.data[0].content : null;
      }
      break;
    }

    case 'vfs_delete': {
      if (!params.slot || !params.key) { result = { isError: true, error: 'vfs_delete needs slot and key' }; break; }
      const name = toName(params.slot, params.key);
      await sb('agent_memory?name=eq.' + encodeURIComponent(name), {
        method: 'DELETE', headers: { 'Prefer': 'return=minimal' }
      });
      result = 'deleteMsg ok: ' + name;
      break;
    }

    case 'vfs_list': {
      if (params.slot) {
        // list msgs in slot
        const r = await sb('agent_memory?scene=eq.' + encodeURIComponent(params.slot) + '&type=eq.msg&select=name,updated_at&order=name', { method: 'GET' });
        result = JSON.stringify((r.data || []).map(function(row) {
          const key = row.name.replace(params.slot + ':', '');
          return { key: key, updated_at: row.updated_at };
        }));
      } else {
        // list all slots
        const r = await sb('agent_memory?type=eq.slot&select=name,updated_at&order=name', { method: 'GET' });
        result = JSON.stringify((r.data || []).map(function(row) {
          return { name: row.name.replace('slot:', ''), updated_at: row.updated_at };
        }));
      }
      break;
    }

    case 'vfs_query': {
      if (!params.slot) { result = { isError: true, error: 'vfs_query needs slot' }; break; }
      let q = 'agent_memory?scene=eq.' + encodeURIComponent(params.slot) + '&type=eq.msg&select=name,content,updated_at&order=name';
      if (params.prefix) q += '&name=like.' + encodeURIComponent(params.slot + ':' + params.prefix + '*');
      if (params.limit) q += '&limit=' + parseInt(params.limit);
      const r = await sb(q, { method: 'GET' });
      result = JSON.stringify((r.data || []).map(function(row) {
        return { key: row.name.replace(params.slot + ':', ''), size: (row.content || '').length, updated_at: row.updated_at };
      }));
      break;
    }

    case 'vfs_search': {
      if (!params.keyword) { result = { isError: true, error: 'vfs_search needs keyword' }; break; }
      const r = await sb('agent_memory?content=ilike.*' + encodeURIComponent(params.keyword) + '*&select=name,type,scene&limit=20', { method: 'GET' });
      result = JSON.stringify(r.data || []);
      break;
    }

    case 'vfs_exec': {
      // 从 Supabase 读代码，通过 browserEval 在浏览器执行
      const execSlot = params.slot || 'toolkit';
      const execKey = params.key;
      if (!execKey) { result = { isError: true, error: 'vfs_exec needs @key' }; break; }
      const execArgs = params.args ? JSON.stringify(params.args) : '{}';
      const r_exec = await sb('agent_memory?name=eq.' + encodeURIComponent(execSlot + ':' + execKey) + '&select=content', { method: 'GET' });
      if (!r_exec.data || !r_exec.data[0]) { result = { isError: true, error: 'not found: ' + execSlot + ':' + execKey }; break; }
      const execCode = r_exec.data[0].content;
      const wrappedCode = 'var args=' + execArgs + ';' + execCode;
      const execResult = await ctx.browserTool('eval_js', { code: wrappedCode }, 30000);
      result = execResult;
      break;
    }

    case 'vfs_backup': {
      // 导出所有数据
      const r = await sb('agent_memory?select=type,name,scene,content,updated_at&order=type,name', { method: 'GET' });
      result = JSON.stringify({ count: (r.data || []).length, exported_at: new Date().toISOString() });
      break;
    }


    case 'vfs_genspark_write': {
      if (!params.slot) { result = { isError: true, error: 'vfs_genspark_write needs slot' }; break; }
      if (!ctx.browserTool) { result = { isError: true, error: 'browserTool not available' }; break; }
      let gContent = params.content || '';
      if (params.file) {
        try {
          gContent = readFileSync(params.file, 'utf-8');
          if (_logger) _logger.info('[VFS-Genspark] read file: ' + params.file + ' (' + gContent.length + ' chars)');
        } catch(e) {
          result = { isError: true, error: 'cannot read file: ' + e.message };
          break;
        }
      }
      const gContentJson = JSON.stringify(gContent);
      let gWriteCode;
      if (params.key) {
        gWriteCode = 'return window.vfs.writeMsg(' + JSON.stringify(params.slot) + ',' + JSON.stringify(params.key) + ',' + gContentJson + ').then(function(r){return "writeMsg ok: "+JSON.stringify(r)})';
      } else {
        gWriteCode = 'return window.vfs.write(' + JSON.stringify(params.slot) + ',' + gContentJson + ').then(function(r){return "write ok: "+JSON.stringify(r)})';
      }
      try {
        const gwr = await ctx.browserTool('eval_js', { code: gWriteCode });
        result = typeof gwr === 'string' ? gwr : JSON.stringify(gwr);
      } catch(e) {
        result = { isError: true, error: 'browserTool failed: ' + e.message };
      }
      break;
    }
    case 'vfs_genspark_read': {
      if (!params.slot) { result = { isError: true, error: 'vfs_genspark_read needs slot' }; break; }
      if (!ctx.browserTool) { result = { isError: true, error: 'browserTool not available' }; break; }
      let gReadCode;
      if (params.key) { gReadCode = 'return window.vfs.readMsg(' + JSON.stringify(params.slot) + ',' + JSON.stringify(params.key) + ').then(function(r){return r||"null"})';
      } else if (params.keys) {
        gReadCode = 'return window.vfs.listMsg(' + JSON.stringify(params.slot) + ').then(function(r){return JSON.stringify(r)})';
      } else {
        gReadCode = 'return window.vfs.read(' + JSON.stringify(params.slot) + ').then(function(r){return r||"null"})';
      }
      try {
        if (params.saveTo) {
          const grr2 = await ctx.browserTool("eval_js", { code: gReadCode });
          const content = typeof grr2 === "string" ? grr2 : JSON.stringify(grr2);
          try {
            mkdirSync(dirname(params.saveTo), { recursive: true });
            writeFileSync(params.saveTo, content, 'utf-8');
            result = "saved:" + params.saveTo + " len:" + content.length;
          } catch(we) {
            result = { isError: true, error: "writeFile failed: " + we.message };
          }
          break;
        } else {
          const grr = await ctx.browserTool("eval_js", { code: gReadCode });
          result = typeof grr === "string" ? grr : JSON.stringify(grr);
        }
      } catch(e) {
        result = { isError: true, error: 'browserTool failed: ' + e.message };
      }
      break;
    }

    // === vfs_local tools (added 2026-03-16) ===
    case 'vfs_local_write': {
      if (!params.path) { result = { isError: true, error: 'vfs_local_write needs @path' }; break; }
      if (!params.content && params.content !== '') { result = { isError: true, error: 'vfs_local_write needs @content' }; break; }
      try {
        mkdirSync(dirname(params.path), { recursive: true });
        writeFileSync(params.path, params.content, 'utf-8');
        result = 'written: ' + params.path + ' (' + params.content.length + ' chars)';
      } catch(e) {
        result = { isError: true, error: 'write failed: ' + e.message };
      }
      break;
    }
    case 'vfs_local_read': {
      if (!params.path) { result = { isError: true, error: 'vfs_local_read needs @path' }; break; }
      try {
        const lContent = readFileSync(params.path, 'utf-8');
        result = lContent;
      } catch(e) {
        result = { isError: true, error: 'read failed: ' + e.message };
      }
      break;
    }
    case 'vfs_save': {
      if (!params.slot) { result = { isError: true, error: 'vfs_save needs @slot' }; break; }
      if (!params.content && params.content !== '') { result = { isError: true, error: 'vfs_save needs @content' }; break; }
      const saveName = params.key ? (params.slot + ':' + params.key) : ('slot:' + params.slot);
      const saveType = params.key ? 'msg' : 'slot';
      try {
        const existing = await sb('agent_memory?name=eq.' + encodeURIComponent(saveName) + '&select=id&limit=1');
        if (existing.data && existing.data.length > 0) {
          await sb('agent_memory?name=eq.' + encodeURIComponent(saveName), {
            method: 'PATCH',
            body: JSON.stringify({ content: params.content, updated_at: new Date().toISOString() })
          });
          result = 'vfs_save ok: updated ' + saveName;
        } else {
          await sb('agent_memory', {
            method: 'POST',
            body: JSON.stringify({ name: saveName, type: saveType, content: params.content })
          });
          result = 'vfs_save ok: inserted ' + saveName;
        }
      } catch(e) {
        result = { isError: true, error: 'vfs_save failed: ' + e.message };
      }
      break;
    }


    case 'vfs_append': {
      if (!params.slot) { result = { isError: true, error: 'vfs_append needs @slot' }; break; }
      if (!params.content && params.content !== '') { result = { isError: true, error: 'vfs_append needs @content' }; break; }
      const appendName = params.key ? (params.slot + ':' + params.key) : ('slot:' + params.slot);
      const separator = params.separator || '\n';
      try {
        const existing = await sb('agent_memory?name=eq.' + encodeURIComponent(appendName) + '&select=id,content&limit=1');
        if (existing.data && existing.data.length > 0) {
          const oldContent = existing.data[0].content || '';
          const newContent = oldContent + separator + params.content;
          await sb('agent_memory?name=eq.' + encodeURIComponent(appendName), {
            method: 'PATCH',
            body: JSON.stringify({ content: newContent, updated_at: new Date().toISOString() })
          });
          result = 'vfs_append ok: ' + appendName + ' (' + oldContent.length + ' + ' + params.content.length + ' = ' + newContent.length + ' chars)';
        } else {
          await sb('agent_memory', {
            method: 'POST',
            body: JSON.stringify({ name: appendName, type: params.key ? 'msg' : 'slot', content: params.content })
          });
          result = 'vfs_append ok: created ' + appendName + ' (' + params.content.length + ' chars)';
        }
      } catch(e) {
        result = { isError: true, error: 'vfs_append failed: ' + e.message };
      }
      break;
    }

    case 'local_read': {
      if (!params.slot) { result = { isError: true, error: 'local_read needs @slot' }; break; }
      try {
        const db = (await import('../core/db.js')).default;
        const key = params.key || '_default';
        const row = db.query("SELECT content, updated_at FROM local_store WHERE slot='" + params.slot.replace(/'/g,"''") + "' AND key='" + key.replace(/'/g,"''") + "' LIMIT 1");
        if (row && row.length > 0) {
          result = row[0].content;
        } else {
          result = { isError: true, error: 'not found: ' + params.slot + ':' + key };
        }
      } catch(e) {
        result = { isError: true, error: 'local_read failed: ' + e.message };
      }
      break;
    }

    case 'local_write': {
      if (!params.slot) { result = { isError: true, error: 'local_write needs @slot' }; break; }
      if (!params.content && params.content !== '') { result = { isError: true, error: 'local_write needs @content' }; break; }
      try {
        const db = (await import('../core/db.js')).default;
        const key = params.key || '_default';
        const slot = params.slot.replace(/'/g,"''");
        const k = key.replace(/'/g,"''");
        const existing = db.query("SELECT id FROM local_store WHERE slot='" + slot + "' AND key='" + k + "' LIMIT 1");
        if (existing && existing.length > 0) {
          db.raw.prepare("UPDATE local_store SET content=?, updated_at=datetime('now') WHERE slot=? AND key=?").run(params.content, params.slot, key);
          result = 'local_write ok: updated ' + params.slot + ':' + key + ' (' + params.content.length + ' chars)';
        } else {
          db.raw.prepare("INSERT INTO local_store (slot, key, content) VALUES (?, ?, ?)").run(params.slot, key, params.content);
          result = 'local_write ok: created ' + params.slot + ':' + key + ' (' + params.content.length + ' chars)';
        }
      } catch(e) {
        result = { isError: true, error: 'local_write failed: ' + e.message };
      }
      break;
    }

    case 'local_list': {
      try {
        const db = (await import('../core/db.js')).default;
        const slot = params.slot;
        const where = slot ? "WHERE slot='" + slot.replace(/'/g,"''") + "'" : '';
        const rows = db.query("SELECT slot, key, length(content) as size, updated_at FROM local_store " + where + " ORDER BY updated_at DESC LIMIT 50");
        result = JSON.stringify(rows || []);
      } catch(e) {
        result = { isError: true, error: 'local_list failed: ' + e.message };
      }
      break;
    }

    case 'local_delete': {
      if (!params.slot) { result = { isError: true, error: 'local_delete needs @slot' }; break; }
      try {
        const db = (await import('../core/db.js')).default;
        const key = params.key || '_default';
        db.raw.prepare("DELETE FROM local_store WHERE slot=? AND key=?").run(params.slot, key);
        result = 'local_delete ok: ' + params.slot + ':' + key;
      } catch(e) {
        result = { isError: true, error: 'local_delete failed: ' + e.message };
      }
      break;
    }

        default:
      result = { isError: true, error: 'unknown vfs tool: ' + tool };
  }

  trace.span('vfs', { action: 'done', tool });
  return { success: true, result: typeof result === 'string' ? result : JSON.stringify(result) };
}

async function healthCheck() {
  if (!SB_URL) return { ok: false, reason: 'no SUPABASE_URL' };
  try {
    const r = await sb('agent_memory?type=eq.slot&select=name&limit=1', { method: 'GET' });
    return { ok: r.status < 300, slots: (r.data || []).length };
  } catch(e) {
    return { ok: false, reason: e.message };
  }
}

export default {
  name: 'vfs',
  tools: ['vfs_read', 'vfs_write', 'vfs_delete', 'vfs_list', 'vfs_query', 'vfs_search', 'vfs_exec', 'vfs_backup', 'vfs_genspark_write', 'vfs_genspark_read', 'vfs_local_write', 'vfs_local_read', 'vfs_save', 'vfs_append', 'local_read', 'local_write', 'local_list', 'local_delete'],
  init, handle, healthCheck,
  async shutdown() {}
};
