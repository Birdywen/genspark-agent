// 读取拦截日志 - 格式化输出所有捕获的请求
// 使用: 注入拦截器后，操作页面，再用 eval_js 执行此脚本读取日志

var logs = window._reqLog || [];
if (logs.length === 0) return 'No requests captured. Inject interceptor first.';

var summary = [];
for (var i = 0; i < logs.length; i++) {
  var l = logs[i];
  var line = (l.type ? '[' + l.type + '] ' : '') + (l.method || 'GET') + ' ' + (l.url || '?');
  if (l.body && l.body.length > 0) {
    line += '\n  Body: ' + l.body.substring(0, 500);
  }
  if (l.headers && Object.keys(l.headers).length > 0) {
    line += '\n  Headers: ' + JSON.stringify(l.headers).substring(0, 300);
  }
  summary.push(line);
}

return 'Captured ' + logs.length + ' requests:\n\n' + summary.join('\n\n');