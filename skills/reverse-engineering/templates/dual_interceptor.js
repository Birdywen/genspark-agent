// XHR + Fetch 双拦截器 - 确保不漏请求
// 使用: eval_js 注入目标页面
// 修复: _origOpen 赋值、window._reqLog 前缀、防重复注入

window._reqLog = window._reqLog || [];

if (!window._dualInterceptorInstalled) {

  // --- XHR 拦截 ---
  var _origOpen = XMLHttpRequest.prototype.open;
  var _origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url) {
    this._logMethod = method;
    this._logUrl = url;
    return _origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function(body) {
    window._reqLog.push({
      type: 'xhr',
      url: this._logUrl || '',
      method: this._logMethod || 'GET',
      body: body ? String(body).substring(0, 3000) : '',
      time: new Date().toISOString()
    });
    return _origSend.apply(this, arguments);
  拦截 ---
  var _origFetch = window.fetch;

  window.fetch = function(resource, init) {
    var url = typeof resource === 'string' ? resource : (resource && resource.url ? resource.url : '?');
    var method = (init && init.method) ? init.method : 'GET';
    var body = '';
    if (init && init.body) {
      try { body = String(init.body).substring(0, 3000); } catch(e) { body = '[unreadable]'; }
    }
    window._reqLog.push({
      type: 'fetch',
      url: url,
      method: method,
      body: body,
      time: new Date().toISOString()
    });
    return _origFetch.apply(this, arguments);
  };

  window._dualInterceptorInstalled = true;
  return 'Dual interceptor installed (XHR+Fetch), log at window._reqLog (current: ' + window._reqLog.length + ')';

} else {
  window._reqLog = [];
  return 'Dual interceptor already installed, log reset';
}
