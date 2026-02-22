// 按关键词过滤拦截日志
// 使用: 修改 FILTER_KEYWORDS 数组，eval_js 执行
// 也可以通过 eval_js 传参: window._filterKeywords = ['api','auth'] 然后执行此脚本

var keywords = window._filterKeywords || ['api', 'auth', 'token', 'script', 'step'];
var logs = window._reqLog || [];
if (logs.length === 0) return 'No requests captured.';

var filtered = [];
for (var i = 0; i < logs.length; i++) {
  var l = logs[i];
  var text = (l.url || '') + ' ' + (l.body || '');
  var textLower = text.toLowerCase();
  for (var k = 0; k < keywords.length; k++) {
    if (textLower.indexOf(keywords[k].toLowerCase()) > -1) {
      filtered.push({
        index: i,
        type?',
        method: l.method || 'GET',
        url: l.url || '',
        body: (l.body || '').substring(0, 500),
        time: l.time || '',
        matched: keywords[k]
      });
      break;
    }
  }
}

return JSON.stringify({
  total: logs.length,
  filtered: filtered.length,
  keywords: keywords,
  results: filtered
});