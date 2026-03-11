// Omega Trace — 全链路追踪模块
// 每个工具调用生成 TraceContext, 记录跨 World 的完整调用链

import fs from 'fs';

const TRACE_LOG = '/private/tmp/omega-trace.log';
const MAX_ENTRIES = 1000;

class TraceContext {
  constructor(tool, params = {}) {
    this.traceId = `T-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.tool = tool;
    this.spans = [];
    this.startTime = Date.now();
    this.metadata = { paramsKeys: Object.keys(params) };
  }

  // 记录一个 span (经过一个处理节点)
  span(world, detail = {}) {
    const stackLine = new Error().stack.split('\n')[2] || '';
    const fileMatch = stackLine.match(/(?:at\s+.+?\s+\()?(?:file:\/\/)?(.+?):(\d+):\d+\)?/);
    const file = fileMatch ? fileMatch[1].split('/').slice(-2).join('/') : 'unknown';
    const line = fileMatch ? parseInt(fileMatch[2]) : 0;

    const s = {
      world,
      file,
      line,
      time: Date.now() - this.startTime,
      detail: typeof detail === 'string' ? { message: detail } : detail
    };
    this.spans.push(s);
    return this;
  }

  // 记录错误 span
  error(world, err) {
    return this.span(world, {
      status: 'error',
      message: err.message || String(err),
      stack: (err.stack || '').split('\n').slice(0, 3).join(' | ')
    });
  }

  // 生成可读的调用链
  toChain() {
    return this.spans.map(s => {
      const status = s.detail?.status === 'error' ? ' ✗' : '';
      return `${s.world}(${s.file}:${s.line})${status}`;
    }).join(' → ');
  }

  // 计算总耗时
  get duration() {
    return Date.now() - this.startTime;
  }

  // 序列化为日志条目
  toJSON() {
    return {
      traceId: this.traceId,
      tool: this.tool,
      duration: this.duration,
      chain: this.toChain(),
      spans: this.spans,
      metadata: this.metadata,
      timestamp: new Date().toISOString()
    };
  }

  // 写入 trace log
  flush() {
    try {
      const entry = JSON.stringify(this.toJSON());
      fs.appendFileSync(TRACE_LOG, entry + '\n');
      
      // 简单轮转: 文件超过 500KB 时截断前半部分
      const stat = fs.statSync(TRACE_LOG);
      if (stat.size > 512 * 1024) {
        const content = fs.readFileSync(TRACE_LOG, 'utf8');
        const lines = content.trim().split('\n');
        const keep = lines.slice(Math.floor(lines.length / 2));
        fs.writeFileSync(TRACE_LOG, keep.join('\n') + '\n');
      }
    } catch (e) {
      // trace 失败不应该影响主流程
      console.error(`[Trace] flush error: ${e.message}`);
    }
  }
}

// 工厂函数
function createTrace(tool, params) {
  return new TraceContext(tool, params);
}

// 查询工具: 按 traceId 查找
function queryTrace(traceId) {
  try {
    const content = fs.readFileSync(TRACE_LOG, 'utf8');
    return content.trim().split('\n')
      .map(line => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean)
      .filter(entry => entry.traceId === traceId);
  } catch { return []; }
}

// 查询最近 N 条
function recentTraces(n = 20) {
  try {
    const content = fs.readFileSync(TRACE_LOG, 'utf8');
    const lines = content.trim().split('\n');
    return lines.slice(-n)
      .map(line => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

// 查询失败的调用
function failedTraces(n = 20) {
  try {
    const content = fs.readFileSync(TRACE_LOG, 'utf8');
    return content.trim().split('\n')
      .map(line => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean)
      .filter(entry => entry.spans.some(s => s.detail?.status === 'error'))
      .slice(-n);
  } catch { return []; }
}

export { TraceContext, createTrace, queryTrace, recentTraces, failedTraces };
export default TraceContext;
