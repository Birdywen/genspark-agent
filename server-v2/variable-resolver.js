// [STUB] 原模块已移至 _unused/，此为简单实现防止 import 报错
import Logger from './logger.js';

export default class VariableResolver {
  constructor(logger) {
    this.logger = logger;
  }

  resolve(template, vars = {}) {
    if (typeof template !== 'string') return template;
    // Simple variable replacement: {{varName}} or ${varName}
    return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}|\$\{(\w+(?:\.\w+)*)\}/g, (match, g1, g2) => {
      const key = g1 || g2;
      const parts = key.split('.');
      let val = vars;
      for (const p of parts) {
        if (val == null) return match;
        val = val[p];
      }
      return val != null ? String(val) : match;
    });
  }
}