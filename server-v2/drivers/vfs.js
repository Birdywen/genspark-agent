// VFS Driver - Genspark VFS 操作
// Tools: vfs_read, vfs_write, vfs_delete, vfs_list, vfs_query, vfs_search, vfs_exec, vfs_backup

let _logger = null;

async function init(deps) {
  _logger = deps.logger;
  _logger.info('[VFS Driver] initialized');
}

async function handle(tool, params, context) {
  const { trace } = context;
  trace.span('vfs', { tool, slot: params.slot || params.name });
  // VFS 操作委托给 browser，只做 trace
  return { delegate: true };
}

export default {
  name: 'vfs',
  tools: ['vfs_read', 'vfs_write', 'vfs_delete', 'vfs_list', 'vfs_query', 'vfs_search', 'vfs_exec', 'vfs_backup'],
  init,
  handle
};
