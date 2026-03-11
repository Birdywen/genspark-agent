// MCP Driver - 通用 MCP hub 工具 (catch-all)
// 处理所有未被其他 driver 注册的 MCP 工具
// 不注册具体 tools，作为 router 的 fallback 前最后一层

let _logger = null;
let _hub = null;

async function init(deps) {
  _hub = deps.hub;
  _logger = deps.logger;
  _logger.info('[MCP Driver] initialized');
}

async function handle(tool, params, context) {
  const { trace, callOptions } = context;
  trace.span('mcp', { tool });
  const result = await _hub.call(tool, params, callOptions);
  trace.span('mcp_done', { tool, success: !result.isError });
  return result;
}

export default {
  name: 'mcp',
  tools: [],
  init,
  handle
};
