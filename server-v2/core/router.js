// Omega Router — 工具路由核心 (类似 Linux syscall table)
// 自动加载 drivers/, 按工具名分发到对应 driver

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createTrace } from './trace.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRIVERS_DIR = path.join(__dirname, '..', 'drivers');

class Router {
  constructor(logger) {
    this.logger = logger;
    this.handlers = new Map();
    this.drivers = new Map();
    this.fallback = null;
  }

  register(driver) {
    if (!driver.name || !driver.tools || !driver.handle) {
      this.logger.warning('[Router] Invalid driver: missing name/tools/handle');
      return false;
    }
    this.drivers.set(driver.name, driver);
    for (const tool of driver.tools) {
      if (this.handlers.has(tool)) {
        this.logger.warning('[Router] Tool "' + tool + '" already registered by "' + this.handlers.get(tool).name + '", overwriting with "' + driver.name + '"');
      }
      this.handlers.set(tool, driver);
    }
    this.logger.info('[Router] Registered driver "' + driver.name + '" with ' + driver.tools.length + ' tools: ' + driver.tools.join(', '));
    return true;
  }

  setFallback(fn) {
    this.fallback = fn;
  }

  async dispatch(tool, params, ws, message) {
    const trace = createTrace(tool, params);
    trace.span('Router', { action: 'dispatch', tool });
    const driver = this.handlers.get(tool);
    if (driver) {
      trace.span('Router', { action: 'found_driver', driver: driver.name });
      try {
        const ctx = { trace, ws, message, callOptions: {} };
        const result = await driver.handle(tool, params, ctx);
        trace.span('Router', { action: 'complete', success: true, duration: trace.duration });
        trace.flush();
        return result;
      } catch (e) {
        trace.error('Router', e);
        trace.flush();
        throw e;
      }
    }
    if (this.fallback) {
      trace.span('Router', { action: 'fallback', reason: 'no_driver_for_' + tool });
      trace.flush();
      return this.fallback(ws, message);
    }
    trace.error('Router', new Error('TOOL_NOT_FOUND: ' + tool));
    trace.flush();
    throw new Error('TOOL_NOT_FOUND: ' + tool);
  }

  async loadDrivers(deps = {}) {
    if (!fs.existsSync(DRIVERS_DIR)) {
      this.logger.warning('[Router] Drivers directory not found: ' + DRIVERS_DIR);
      return;
    }
    const files = fs.readdirSync(DRIVERS_DIR).filter(f => f.endsWith('.js') && !f.startsWith('_'));
    for (const file of files) {
      try {
        const mod = await import(path.join(DRIVERS_DIR, file));
        const driver = mod.default;
        if (driver) {
          if (typeof driver.init === "function") await driver.init(deps);
          this.register(driver);
        }
      } catch (e) {
        this.logger.error('[Router] Failed to load driver "' + file + '": ' + e.message);
      }
    }
    this.logger.info('[Router] Loaded ' + this.drivers.size + ' drivers, ' + this.handlers.size + ' tools registered');
  }

  listTools() {
    const result = {};
    for (const [driverName, driver] of this.drivers) {
      result[driverName] = driver.tools;
    }
    return result;
  }

  async shutdown() {
    for (const [name, driver] of this.drivers) {
      if (typeof driver.shutdown === 'function') {
        try {
          await driver.shutdown();
          this.logger.info('[Router] Driver "' + name + '" shutdown OK');
        } catch (e) {
          this.logger.error('[Router] Driver "' + name + '" shutdown error: ' + e.message);
        }
      }
    }
  }
}

export default Router;