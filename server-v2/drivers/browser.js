// Browser Driver - 浏览器委托工具
// Tools: eval_js, take_screenshot, list_tabs
// 这些工具不走 MCP hub，通过 WebSocket 委托给浏览器扩展执行

let _logger = null;

async function init(deps) {
  _logger = deps.logger;
  _logger.info('[Browser Driver] initialized');
}

async function handle(tool, params, context) {
  const { trace } = context;
  trace.span('browser', { tool });
  // 浏览器工具由 content.js 直接拦截，不经过 server-v2
  // 此 driver 仅做 trace 记录，实际执行走 browserToolPending 机制
  return { delegate: true };
}

export default {
  name: 'browser',
  tools: ['eval_js', 'take_screenshot', 'list_tabs'],
  init,
  handle
};
