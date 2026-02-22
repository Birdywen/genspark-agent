// Fetch 请求拦截器
// 注意: 如果目标网站用 Service Worker，fetch patch 可能被绕过，改用 xhr_interceptor.js
// 修复: 防重复注入保护

window._reqLog = window._reqLog || [];

if (!window._fetchInterceptorInstalled) {
  var _origFetch = window.fetch;

  window.fetch = function(resource, init) {
    var url = typeof resource === 'string' ? resource : (resource && resource.url ? resource.url : '?');
    var method = (init && init.method) ? init.method : 'GET';
    var body = '';
    if (init && init.body) {
      try { body = String(init.body).substring(0, 3000); } catch(e) { body = '[unreadable]'; }
    }
    var headers = {};
    if (init && init.headers) {
      if init.headers.forEach === 'function') {
        init.headers.forEach(function(v, k) { headers[k] = v; });
      } else if (typeof init.headers === 'object') {
        for (var k in init.headers) { headers[k] = init.headers[k]; }
      }
    }
    window._reqLog.push({
      type: 'fetch',
      url: url,
      method: method,
      body: body,
      headers: headers,
      time: new Date().toISOString()
    });
    return _origFetch.apply(this, arguments);
  };

  window._fetchInterceptorInstalled = true;
  return 'Fetch interceptor installed, log at window._reqLog (current: ' + window._reqLog.length + ')';
} else {
  window._reqLog = [];
  return 'Fetch interceptor already installed, log reset';
}
