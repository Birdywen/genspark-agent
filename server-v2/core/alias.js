// Alias Resolver — 工具别名统一解析
// 在 router.dispatch 之前把所有别名/参数转换统一处理

const ALIASES = {
  'run_command': { target: 'run_process', transform: (p) => ({
    command_line: p.command,
    mode: 'shell',
    ...(p.stdin && { stdin: p.stdin }),
    ...(p.stdinFile && { stdinFile: p.stdinFile }),
    ...(p.timeout && { timeout_ms: p.timeout * 1000 }),
    ...(p.cwd && { cwd: p.cwd })
  })},
  'screenshot': { target: 'take_screenshot', transform: (p) => p },
  'browser_navigate': { target: 'navigate', transform: (p) => p },
  'browser_eval': { target: 'eval_js', transform: (p) => p },
  'reload_tools': { target: 'list_tools', transform: () => ({}) },
  'run': { target: 'run_process', transform: (p) => p },
  'read_text_file': { target: 'read_file', transform: (p) => p },
  'crawler': { target: 'read_file', transform: (p) => p },
  'broadcast': { target: 'eval_js', transform: (p) => p },
  '_command': { target: 'run_process', transform: (p) => p },
  '_file': { target: 'write_file', transform: (p) => p }
};

// 不做别名转换的工具（直接处理）
const PASSTHROUGH = new Set(['bg_run', 'bg_status', 'bg_kill']);

function resolve(tool, params) {
  if (PASSTHROUGH.has(tool)) {
    return { tool, params, aliased: false };
  }
  const alias = ALIASES[tool];
  if (alias) {
    return {
      tool: alias.target,
      params: alias.transform ? alias.transform(params) : params,
      aliased: true,
      originalTool: tool
    };
  }
  return { tool, params, aliased: false };
}

function listAliases() {
  const result = {};
  for (const [from, to] of Object.entries(ALIASES)) {
    result[from] = to.target;
  }
  return result;
}

export { resolve, listAliases, ALIASES, PASSTHROUGH };
