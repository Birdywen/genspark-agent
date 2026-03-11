// SSH Driver - Oracle ARM remote server ops
// Tools: ssh-oracle:exec, ssh-oracle:read_file, ssh-oracle:write_file, ssh-oracle:edit_file

let _logger = null;
let _hub = null;

async function init(deps) {
  _hub = deps.hub;
  _logger = deps.logger;
  _logger.info('[SSH Driver] initialized');
}

async function handle(tool, params, context) {
  const { trace, callOptions } = context;
  const action = tool.replace('ssh-oracle:', '');
  trace.span('ssh', { action, host: 'oracle' });
  const result = await _hub.call(tool, params, callOptions);
  trace.span('ssh_done', { action, success: !result.isError });
  return result;
}

export default {
  name: 'ssh',
  tools: ['ssh-oracle:exec', 'ssh-oracle:read_file', 'ssh-oracle:write_file', 'ssh-oracle:edit_file'],
  init,
  handle
};
