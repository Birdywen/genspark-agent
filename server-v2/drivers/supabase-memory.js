// Supabase agent_memory driver
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_KEY;

function hdrs(extra) {
  return Object.assign({
    'apikey': SB_KEY,
    'Authorization': 'Bearer ' + SB_KEY,
    'Content-Type': 'application/json'
  }, extra || {});
}

async function sb(path, opts) {
  const res = await fetch(SB_URL + '/rest/v1/' + path, Object.assign({ headers: hdrs(opts.headers) }, opts));
  const text = await res.text();
  try { return { status: res.status, data: JSON.parse(text) }; }
  catch(e) { return { status: res.status, data: text }; }
}

export default {
  name: 'memory',
  tools: ['memory_list', 'memory_read', 'memory_write', 'memory_delete'],

  async init() {
    if (!SB_URL || !SB_KEY) {
      console.warn('[memory] SUPABASE_URL/KEY not set, driver disabled');
      return;
    }
    console.log('[memory] Supabase driver ready:', SB_URL);
  },

  async handle(tool, params, ctx) {
    const trace = ctx.trace || ctx; trace.span(this.name, { action: 'start', tool });
    let result;

    switch(tool) {
      case 'memory_list': {
        let q = 'agent_memory?select=id,type,scene,name,created_at,updated_at';
        if (params.type) q += '&type=eq.' + params.type;
        if (params.scene) q += '&scene=eq.' + params.scene;
        q += '&order=updated_at.desc';
        const r = await sb(q, { method: 'GET' });
        result = r.data;
        break;
      }
      case 'memory_read': {
        const q = 'agent_memory?name=eq.' + encodeURIComponent(params.name) + '&limit=1';
        const r = await sb(q, { method: 'GET' });
        result = r.data && r.data[0] || null;
        break;
      }
      case 'memory_write': {
        const row = {
          type: params.type, scene: params.scene || null,
          name: params.name, messages: params.messages || null,
          content: params.content || null, updated_at: new Date().toISOString()
        };
        // upsert: check existing
        const eq = 'agent_memory?name=eq.' + encodeURIComponent(params.name) + '&limit=1';
        const ex = await sb(eq, { method: 'GET' });
        if (ex.data && ex.data[0]) {
          const r = await sb('agent_memory?id=eq.' + ex.data[0].id, {
            method: 'PATCH', headers: { 'Prefer': 'return=representation' },
            body: JSON.stringify(row)
          });
          result = { ok: true, action: 'updated', name: params.name };
        } else {
          const r = await sb('agent_memory', {
            method: 'POST', headers: { 'Prefer': 'return=representation' },
            body: JSON.stringify(row)
          });
          result = { ok: true, action: 'created', name: params.name };
        }
        break;
      }
      case 'memory_delete': {
        await sb('agent_memory?name=eq.' + encodeURIComponent(params.name), {
          method: 'DELETE', headers: { 'Prefer': 'return=representation' }
        });
        result = { ok: true, deleted: params.name };
        break;
      }
      default:
        result = { error: 'unknown tool: ' + tool };
    }

    trace.span(this.name, { action: 'done', tool });
    return { success: true, result: JSON.stringify(result) };
  },

  async healthCheck() {
    if (!SB_URL) return { ok: false, reason: 'no SUPABASE_URL' };
    const r = await sb('agent_memory?select=count&limit=0', { method: 'HEAD' });
    return { ok: r.status < 300 };
  },

  async shutdown() {}
};
