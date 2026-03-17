// Omega Router
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createTrace } from './trace.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRIVERS_DIR = path.join(__dirname, '..', 'drivers');

let _toolHelp = null;
function loadToolHelp() {
  if (_toolHelp) return _toolHelp;
  try { _toolHelp = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tool-help.json'), 'utf8')); }
  catch(e) { _toolHelp = {}; }
  return _toolHelp;
}

function fuzzyMatch(input, candidates) {
  const results = [];
  const il = input.toLowerCase();
  for (const c of candidates) {
    const cl = c.toLowerCase();
    if (cl.includes(il) || il.includes(cl)) { results.push({ tool: c, score: 0.9 }); continue; }
    const ip = il.split(/[_\-:]/); const cp = cl.split(/[_\-:]/);
    let overlap = 0;
    for (const a of ip) { for (const b of cp) { if (a === b) overlap++; } }
    const score = overlap / Math.max(ip.length, cp.length);
    if (score >= 0.4) results.push({ tool: c, score });
  }
  results.sort((a,b) => b.score - a.score);
  return results.slice(0, 3);
}

function formatHelp(toolName) {
  const help = loadToolHelp();
  const h = help[toolName];
  if (!h) return null;
  let out = '=== ' + toolName + ' ===\n';
  out += 'Driver: ' + h.driver + '\n';
  out += 'Desc: ' + h.desc + '\n';
  if (h.params && Object.keys(h.params).length) {
    out += 'Params:\n';
    for (const [k,v] of Object.entries(h.params)) out += '  @' + k + ' - ' + v + '\n';
  }
  out += 'Example: ' + h.example + '\n';
  if (h.notes) out += 'Notes: ' + h.notes + '\n';
  return out;
}

class Router {
  constructor(logger) { this.logger = logger; this.handlers = new Map(); this.drivers = new Map(); this.fallback = null; }

  register(driver) {
    if (!driver.name || !driver.tools || !driver.handle) { this.logger.warning('[Router] Invalid driver'); return false; }
    this.drivers.set(driver.name, driver);
    for (const tool of driver.tools) {
      if (this.handlers.has(tool)) this.logger.warning('[Router] Tool "' + tool + '" overwritten by "' + driver.name + '"');
      this.handlers.set(tool, driver);
    }
    this.logger.info('[Router] Registered "' + driver.name + '" with ' + driver.tools.length + ' tools: ' + driver.tools.join(', '));
    return true;
  }

  setFallback(fn) { this.fallback = fn; }

  async dispatch(tool, params, ws, message, callOptions) {
    if (tool && tool.endsWith('--help')) {
      const rt = tool.replace(/\s*--help$/, '').trim();
      const ht = formatHelp(rt);
      if (ht) return { ok: true, help: true, result: ht };
    }
    if (params && params.help) { const ht = formatHelp(tool); if (ht) return { ok: true, help: true, result: ht }; }
    const trace = createTrace(tool, params);
    trace.span('Router', { action: 'dispatch', tool });
    const driver = this.handlers.get(tool);
    if (driver) {
      trace.span('Router', { action: 'found_driver', driver: driver.name });
      try {
        const ctx = { trace, ws, message, callOptions: callOptions || {}, browserTool: this._browserTool || null };
        const result = await driver.handle(tool, params, ctx);
        trace.span('Router', { action: 'complete', success: true, duration: trace.duration });
        trace.flush();
        return result;
      } catch (e) { trace.error('Router', e); trace.flush(); throw e; }
    }
    if (this.fallback) { trace.span('Router', { action: 'fallback' }); trace.flush(); return this.fallback(ws, message); }
    trace.error('Router', new Error('TOOL_NOT_FOUND: ' + tool));
    trace.flush();
    const cands = fuzzyMatch(tool, Array.from(this.handlers.keys()));
    if (cands.length) {
      let sug = 'Tool "' + tool + '" not found. Did you mean:\n';
      for (const c of cands) { sug += '  - ' + c.tool; const hd = loadToolHelp()[c.tool]; if (hd) sug += ': ' + hd.desc; sug += '\n'; }
      sug += '\nUse @help=true for usage details.';
      return { ok: false, error: 'TOOL_NOT_FOUND', suggestion: sug };
    }
    throw new Error('TOOL_NOT_FOUND: ' + tool);
  }

  async loadDrivers(deps = {}) {
    if (!fs.existsSync(DRIVERS_DIR)) { this.logger.warning('[Router] No drivers dir'); return; }
    const files = fs.readdirSync(DRIVERS_DIR).filter(f => f.endsWith('.js') && !f.startsWith('_'));
    for (const file of files) {
      try {
        const mod = await import(path.join(DRIVERS_DIR, file));
        const driver = mod.default;
        if (driver) { if (typeof driver.init === 'function') await driver.init(deps); this.register(driver); }
      } catch (e) { this.logger.error('[Router] Failed to load "' + file + '": ' + e.message); }
    }
    this.logger.info('[Router] Loaded ' + this.drivers.size + ' drivers, ' + this.handlers.size + ' tools');
  }

  async reloadDriver(driverName) {
    const files = fs.readdirSync(DRIVERS_DIR).filter(f => f.endsWith('.js') && !f.startsWith('_'));
    const file = files.find(f => f.replace('.js','') === driverName);
    if (!file) return { ok: false, error: 'Driver not found: ' + driverName };
    try {
      const old = this.drivers.get(driverName);
      if (old && typeof old.shutdown === 'function') await old.shutdown();
      for (const [tool, d] of this.handlers) { if (d.name === driverName) this.handlers.delete(tool); }
      this.drivers.delete(driverName);
      const mod = await import(path.join(DRIVERS_DIR, file) + '?t=' + Date.now());
      const driver = mod.default;
      if (driver) { if (typeof driver.init === 'function') await driver.init(this._deps || {}); this.register(driver); }
      this.logger.info('[Router] Hot-reloaded "' + driverName + '"');
      return { ok: true, driver: driverName, tools: driver.tools };
    } catch(e) { this.logger.error('[Router] Reload failed: ' + e.message); return { ok: false, error: e.message }; }
  }

  async reloadAll() {
    const names = Array.from(this.drivers.keys());
    const results = [];
    for (const n of names) results.push(await this.reloadDriver(n));
    return results;
  }

  listTools() { const r = {}; for (const [n, d] of this.drivers) r[n] = d.tools; return r; }

  getHelp(toolName) {
    if (!toolName || toolName === '*') {
      const help = loadToolHelp();
      const r = {};
      for (const [dn, d] of this.drivers) r[dn] = d.tools.map(t => ({ name: t, desc: help[t] ? help[t].desc : 'No help' }));
      return r;
    }
    return formatHelp(toolName) || 'No help for: ' + toolName;
  }

  async shutdown() {
    for (const [name, driver] of this.drivers) {
      if (typeof driver.shutdown === 'function') {
        try { await driver.shutdown(); this.logger.info('[Router] "' + name + '" shutdown OK'); }
        catch (e) { this.logger.error('[Router] "' + name + '" shutdown error: ' + e.message); }
      }
    }
  }
}

export default Router;
