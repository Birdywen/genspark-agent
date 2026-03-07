#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const LOG_FILE = process.argv[2] || '/Users/yay/workspace/genspark-agent/server-v2/logs/agent.log';
const OUTPUT = process.argv[3] || '/Users/yay/workspace/genspark-agent-site/public/data/agent-stats.json';

const lines = fs.readFileSync(LOG_FILE, 'utf8').trim().split('\n');
const entries = [];
for (const line of lines) {
  try { entries.push(JSON.parse(line)); } catch {}
}
console.log(`Parsed ${entries.length} / ${lines.length} log entries`);

// 1. Level distribution
const levels = {};
entries.forEach(e => { levels[e.level] = (levels[e.level] || 0) + 1; });

// 2. Tool call stats
const toolCalls = entries.filter(e => e.message && e.message.startsWith('Tool: '));
const toolStats = {};
toolCalls.forEach(e => {
  const toolName = e.message.replace('Tool: ', '');
  if (!toolStats[toolName]) toolStats[toolName] = { calls: 0, errors: 0 };
  toolStats[toolName].calls++;
  if (e.data && e.data.result) {
    const match = e.data.result.match(/^(\d+)\n/);
    if (match && parseInt(match[1]) !== 0) toolStats[toolName].errors++;
  }
});

// 3. Error classification
const errors = entries.filter(e => e.level === 'error');
const errorTypes = {};
errors.forEach(e => {
  let cat = 'other';
  const msg = e.message || '';
  if (msg.includes('TIMEOUT')) cat = 'timeout';
  else if (msg.includes('TOOL_NOT_FOUND')) cat = 'tool_not_found';
  else if (msg.includes('StateManager')) cat = 'state_manager';
  else if (msg.includes('MCP 启动失败')) cat = 'mcp_startup';
  else if (msg.includes('require is not defined')) cat = 'esm_require';
  else if (msg.includes('处理消息失败')) cat = 'message_parse';
  else if (msg.includes('BrowserTool')) cat = 'browser';
  else if (msg.includes('INVALID_PARAMS')) cat = 'invalid_params';
  else if (msg.includes('UNKNOWN')) cat = 'unknown_tool_error';
  errorTypes[cat] = (errorTypes[cat] || 0) + 1;
});

// 4. Daily stats + progress curve
const dailyStats = {};
entries.forEach(e => {
  const day = e.timestamp ? e.timestamp.substring(0, 10) : null;
  if (!day) return;
  if (!dailyStats[day]) dailyStats[day] = { total: 0, tools: 0, errors: 0, warnings: 0, errorsByType: {} };
  dailyStats[day].total++;
  if (e.level === 'tool') dailyStats[day].tools++;
  if (e.level === 'error') {
    dailyStats[day].errors++;
    // classify
    let cat = 'other';
    const msg = e.message || '';
    if (msg.includes('TIMEOUT')) cat = 'timeout';
    else if (msg.includes('TOOL_NOT_FOUND')) cat = 'tool_not_found';
    else if (msg.includes('StateManager')) cat = 'state_manager';
    else if (msg.includes('MCP')) cat = 'mcp_startup';
    else if (msg.includes('require')) cat = 'esm_require';
    dailyStats[day].errorsByType[cat] = (dailyStats[day].errorsByType[cat] || 0) + 1;
  }
  if (e.level === 'warning') dailyStats[day].warnings++;
});

// 5. Hourly distribution
const hourlyStats = {};
entries.filter(e => e.level === 'tool').forEach(e => {
  const hour = e.timestamp ? parseInt(e.timestamp.substring(11, 13)) : null;
  if (hour !== null) hourlyStats[hour] = (hourlyStats[hour] || 0) + 1;
});

// 6. Tool error details
const toolErrors = entries.filter(e => e.level === 'error' && e.message && e.message.includes('工具执行失败'));
const toolErrorDetails = {};
toolErrors.forEach(e => {
  const match = e.message.match(/工具执行失败: (\S+) \[(\w+)\]/);
  if (match) {
    const key = `${match[1]}|${match[2]}`;
    toolErrorDetails[key] = (toolErrorDetails[key] || 0) + 1;
  }
});

// 7. Not found tools
const notFoundTools = {};
toolErrors.filter(e => e.message.includes('TOOL_NOT_FOUND')).forEach(e => {
  const match = e.message.match(/工具执行失败: (\S+)/);
  if (match) notFoundTools[match[1]] = (notFoundTools[match[1]] || 0) + 1;
});

// 8. Timeout tools
const timeoutTools = {};
toolErrors.filter(e => e.message.includes('TIMEOUT')).forEach(e => {
  const match = e.message.match(/工具执行失败: (\S+)/);
  if (match) timeoutTools[match[1]] = (timeoutTools[match[1]] || 0) + 1;
});

// 9. StateManager samples
const stateErrors = entries.filter(e => e.level === 'error' && e.message && e.message.includes('StateManager'));
const stateErrorSamples = stateErrors.slice(0, 5).map(e => e.message.substring(0, 200));

// 10. Progress curve - daily error rate + rolling 3-day average
const dailyArr = Object.entries(dailyStats)
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([date, stats]) => ({ date, ...stats }));

const progressCurve = dailyArr.map((d, i) => {
  const errorRate = d.tools > 0 ? +(d.errors / d.tools * 100).toFixed(1) : 0;
  // Rolling 3-day average
  let rollingErrors = 0, rollingTools = 0;
  for (let j = Math.max(0, i - 2); j <= i; j++) {
    rollingErrors += dailyArr[j].errors;
    rollingTools += dailyArr[j].tools;
  }
  const rollingRate = rollingTools > 0 ? +(rollingErrors / rollingTools * 100).toFixed(1) : 0;
  return {
    date: d.date,
    tools: d.tools,
    errors: d.errors,
    errorRate,
    rollingErrorRate: rollingRate,
    errorsByType: d.errorsByType
  };
});

// 11. Bug fix timeline (manually maintained milestones)
const bugFixes = [
  { date: '2026-03-06', fix: 'Topic rotation + dedup', errors_fixed: 'content drift' },
  { date: '2026-03-07', fix: 'bg_run stdin support', errors_fixed: 'bg_run silent failure' },
  { date: '2026-03-07', fix: 'VariableResolver.resolve()', errors_fixed: 'StateManager 163x' },
  { date: '2026-03-07', fix: 'Tool aliases (6 added)', errors_fixed: 'TOOL_NOT_FOUND 18x' },
  { date: '2026-03-07', fix: 'Smart routing + SSH timeout', errors_fixed: 'TIMEOUT 115x' },
  { date: '2026-03-07', fix: 'ESM require→writeFileSync', errors_fixed: 'require not defined' },
];

const report = {
  meta: {
    generatedAt: new Date().toISOString(),
    logFile: LOG_FILE,
    totalEntries: entries.length,
    dateRange: {
      from: entries[0]?.timestamp?.substring(0, 10) || 'unknown',
      to: entries[entries.length - 1]?.timestamp?.substring(0, 10) || 'unknown'
    },
    daysActive: Object.keys(dailyStats).length
  },
  summary: {
    totalToolCalls: toolCalls.length,
    totalErrors: errors.length,
    errorRate: (errors.length / Math.max(toolCalls.length, 1) * 100).toFixed(1) + '%',
    levels
  },
  toolUsage: Object.entries(toolStats)
    .sort((a, b) => b[1].calls - a[1].calls)
    .map(([name, stats]) => ({
      name, calls: stats.calls, errors: stats.errors,
      successRate: stats.calls > 0 ? +((stats.calls - stats.errors) / stats.calls * 100).toFixed(1) : 0
    })),
  errorBreakdown: Object.entries(errorTypes)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({ type, count })),
  toolErrorDetails: Object.entries(toolErrorDetails)
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => {
      const [tool, errorType] = key.split('|');
      return { tool, errorType, count };
    }),
  notFoundTools: Object.entries(notFoundTools)
    .sort((a, b) => b[1] - a[1])
    .map(([tool, count]) => ({ tool, count })),
  timeoutTools: Object.entries(timeoutTools)
    .sort((a, b) => b[1] - a[1])
    .map(([tool, count]) => ({ tool, count })),
  dailyTrend: dailyArr.map(({ errorsByType, ...rest }) => rest),
  hourlyDistribution: Array.from({ length: 24 }, (_, h) => ({
    hour: h, label: `${h.toString().padStart(2, '0')}:00`, calls: hourlyStats[h] || 0
  })),
  stateManagerSamples: stateErrorSamples,
  progressCurve,
  bugFixes
};

const outDir = path.dirname(OUTPUT);
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(OUTPUT, JSON.stringify(report, null, 2));
console.log(`Report: ${OUTPUT}`);
console.log(`Summary: ${report.meta.totalEntries} entries, ${report.summary.totalToolCalls} tools, ${report.summary.totalErrors} errors (${report.summary.errorRate})`);
