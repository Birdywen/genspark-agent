// XHR 请求拦截器 - 最通用，兼容 Service Worker 场景
// 使用: eval_js 注入目标页面，操作页面后用 log_reader.js 读取日志
// 修复: 防重复注入保护

window._reqLog = window._reqLog || [];

if (!window._xhrInterceptorInstalled) {
  var _origOpen = XMLHttpRequest.prototype.open;
  var _origSend = XMLHttpRequest.prototype.send;

   function(method, url) {
    this._logMethod = method;
    this._logUrl = url;
    return _origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function(body) {
    window._reqLog.push({
      url: this._logUrl || '',
      method: this._logMethod || 'GET',
      body: body ? String(body).substring(0, 3000) : '',
      time: new Date().toISOString()
    });
    return _origSend.apply(this, arguments);
  };

  window._xhrInterceptorInstalled = true;
  return 'XHR interceptor installed, log at window._reqLog (current: ' + window._reqLog.length + ')';
} else {
  window._reqLog = [];
  return 'XHR interceptor already installed, log reset';
}
