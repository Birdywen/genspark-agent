// VFS Driver - Genspark VFS 操作 (jsCode 生成)
// Tools: vfs_read, vfs_write, vfs_delete, vfs_list, vfs_query, vfs_search, vfs_exec, vfs_backup

let _logger = null;

async function init(deps) {
  _logger = deps.logger;
  _logger.info('[VFS Driver] initialized');
}

function buildJsCode(tool, params) {
  if (tool === 'vfs_write') {
    if (!params.slot) return { isError: true, error: 'vfs_write 需要 slot 参数' };
    if (params.key) {
      const contentJson = JSON.stringify(params.content || '');
      const keyJson = JSON.stringify(params.key);
      return { code: `return window.vfs.writeMsg(${JSON.stringify(params.slot)}, ${keyJson}, ${contentJson}).then(function(r) { return 'writeMsg ok: ' + JSON.stringify(r); })` };
    } else {
      const contentJson = JSON.stringify(params.content || '');
      return { code: `return window.vfs.write(${JSON.stringify(params.slot)}, ${contentJson}).then(function(r) { return 'write ok: ' + JSON.stringify(r); })` };
    }
  }

  if (tool === 'vfs_read') {
    if (!params.slot) return { isError: true, error: 'vfs_read 需要 slot 参数' };
    if (params.key) {
      return { code: `return window.vfs.readMsg(${JSON.stringify(params.slot)}, ${JSON.stringify(params.key)}).then(function(r) { return JSON.stringify(r); })` };
    } else if (params.keys) {
      return { code: `return window.vfs.listMsg(${JSON.stringify(params.slot)}).then(function(r) { return JSON.stringify(r); })` };
    } else {
      return { code: `return window.vfs.read(${JSON.stringify(params.slot)}).then(function(r) { return r; })` };
    }
  }

  if (tool === 'vfs_delete') {
    if (!params.slot || !params.key) return { isError: true, error: 'vfs_delete 需要 slot 和 key 参数' };
    return { code: `return window.vfs.deleteMsg(${JSON.stringify(params.slot)}, ${JSON.stringify(params.key)}).then(function(r) { return 'deleteMsg ok: ' + JSON.stringify(r); })` };
  }

  if (tool === 'vfs_list') {
    if (params.slot) {
      return { code: `return window.vfs.listMsg(${JSON.stringify(params.slot)}).then(function(r) { return JSON.stringify(r); })` };
    } else {
      return { code: `return window.vfs.ls().then(function(r) { return JSON.stringify(r); })` };
    }
  }

  if (tool === 'vfs_query') {
    if (!params.slot) return { isError: true, error: 'vfs_query 需要 slot 参数' };
    const qOpts = {};
    if (params.prefix) qOpts.prefix = params.prefix;
    if (params.exclude) qOpts.exclude = params.exclude;
    if (params.contains) qOpts.contains = params.contains;
    if (params.limit) qOpts.limit = parseInt(params.limit);
    return { code: `return window.vfs.query(${JSON.stringify(params.slot)}, ${JSON.stringify(qOpts)}).then(function(r) { return JSON.stringify(r); })` };
  }

  if (tool === 'vfs_search') {
    if (!params.keyword) return { isError: true, error: 'vfs_search 需要 keyword 参数' };
    return { code: `return window.vfs.search(${JSON.stringify(params.keyword)}).then(function(r) { return JSON.stringify(r); })` };
  }

  if (tool === 'vfs_exec') {
    if (!params.slot) return { isError: true, error: 'vfs_exec 需要 slot 参数' };
    const execArgs = params.args ? JSON.stringify(params.args) : 'undefined';
    if (params.key) {
      return { code: `return window.vfs.execMsg(${JSON.stringify(params.slot)}, ${JSON.stringify(params.key)}, ${execArgs}).then(function(r) { return JSON.stringify(r); })` };
    } else {
      return { code: `return window.vfs.exec(${JSON.stringify(params.slot)}, ${execArgs}).then(function(r) { return JSON.stringify(r); })` };
    }
  }

  if (tool === 'vfs_backup') {
    const bkOpts = {};
    if (params.messages === 'false' || params.messages === false) bkOpts.messages = false;
    return { code: `return window.vfs.backup(${JSON.stringify(bkOpts)}).then(function(r) { return JSON.stringify(r); })` };
  }

  return { isError: true, error: `未知 VFS 工具: ${tool}` };
}

async function handle(tool, params, context) {
  const { trace } = context;
  trace.span('vfs', { tool, slot: params.slot });

  _logger.info(`[VFS] ${tool} slot=${params.slot} key=${params.key || '(name)'} contentLen=${params.content?.length}`);

  const result = buildJsCode(tool, params);
  if (result.error) {
    return { isError: true, error: result.error };
  }
  return { browserEval: result.code };
}

export default {
  name: 'vfs',
  tools: ['vfs_read', 'vfs_write', 'vfs_delete', 'vfs_list', 'vfs_query', 'vfs_search', 'vfs_exec', 'vfs_backup'],
  init,
  handle
};
