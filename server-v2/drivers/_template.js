// Driver Template — 复制此文件创建新 driver
export default {
  name: 'template',
  tools: ['tool_name_1', 'tool_name_2'],
  async init() {},
  async handle(tool, params, trace, ws, message) {
    trace.span(this.name, { action: 'start', tool });
    // 实现工具逻辑...
    trace.span(this.name, { action: 'done' });
    return { success: true, result: '' };
  },
  async healthCheck() { return { ok: true }; },
  async shutdown() {}
};