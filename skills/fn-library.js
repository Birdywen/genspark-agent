// 🧰 Toolkit Functions — vfs.exec('fn') 加载
// 所有函数注册到 window.__tk，调用: window.__tk.funcName(args)

window.__tk = window.__tk || {};

// ═══ Genspark API ═══

window.__tk.ask = function(prompt, model) {
  model = model || 'claude-opus-4-6';
  var pid = new URLSearchParams(location.search).get('id');
  return fetch('/api/agent/ask_proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      ai_chat_model: model,
      ai_chat_enable_search: false,
      ai_chat_disable_personalization: true,
      use_moa_proxy: false, moa_models: [],
      type: 'ai_chat',
      project_id: pid,
      messages: [{ id: crypto.randomUUID(), role: 'user', content: prompt }],
      user_s_input: prompt.substring(0, 200),
      is_private: true, push_token: ''
    })
  }).then(function(r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    var reader = r.body.getReader();
    var decoder = new TextDecoder();
    var result = '';
    function read() {
      return reader.read().then(function(chunk) {
        if (chunk.done) return result;
        var text = decoder.decode(chunk.value, { stream: true });
        var lines = text.split('\n');
        for (var i = 0; i < lines.length; i++) {
          if (lines[i].indexOf('data: ') === 0) {
            try {
              var d = JSON.parse(lines[i].substring(6));
              if (d.type === 'message_field_delta' && d.field_name === 'content') result += d.delta;
            } catch(e) {}
          }
        }
        return read();
      });
    }
    return read();
  });
};

window.__tk.readFile = function(projectId, path) {
  return fetch('/api/code_sandbox/download_file?project_id=' + projectId + '&path=' + encodeURIComponent(path), {
    credentials: 'include'
  }).then(function(r) { return r.text(); });
};

window.__tk.writeFile = function(projectId, path, content) {
  return fetch('/api/code_sandbox/save_file', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ project_id: projectId, file_path: path, content: content })
  }).then(function(r) { return r.json(); });
};

window.__tk.listDir = function(projectId, path) {
  path = path || '/';
  return fetch('/api/code_sandbox/list_directory?project_id=' + projectId + '&path=' + encodeURIComponent(path), {
    credentials: 'include'
  }).then(function(r) { return r.json(); });
};

// ═══ 页面数据提取 ═══

window.__tk.extractConversation = function(maxLen) {
  maxLen = maxLen || 80000;
  var msgs = document.querySelectorAll('.conversation-statement');
  var lines = [];
  var totalLen = 0;
  for (var i = 0; i < msgs.length; i++) {
    if (totalLen > maxLen) { lines.push('...(省略)'); break; }
    var m = msgs[i];
    var isUser = m.classList.contains('user');
    var el = m.querySelector('.markdown-viewer') || m.querySelector('.bubble .content') || m.querySelector('.bubble');
    var text = (el ? el.innerText : m.innerText) || '';
    if (text.length > 2000) text = text.substring(0, 2000) + '...(截断)';
    lines.push((isUser ? '【用户】' : '【AI】') + text);
    totalLen += text.length;
  }
  return { messages: lines.length, totalChars: totalLen, text: lines.join('\n\n') };
};

window.__tk.chatStats = function() {
  var msgs = document.querySelectorAll('.conversation-statement');
  var totalChars = 0;
  for (var i = 0; i < msgs.length; i++) totalChars += msgs[i].textContent.length;
  var injected = window.__injectedPromptSize || 0;
  return {
    messages: msgs.length,
    domChars: totalChars,
    injectedChars: injected,
    effectiveChars: totalChars + injected,
    effectiveK: Math.round((totalChars + injected) / 1000)
  };
};

// ═══ 网络请求 ═══

window.__tk.fetchJSON = function(url, opts) {
  opts = opts || {};
  opts.credentials = opts.credentials || 'include';
  return fetch(url, opts).then(function(r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  });
};

window.__tk.postJSON = function(url, data) {
  return window.__tk.fetchJSON(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
};

// ═══ DOM 操作辅助 ═══

window.__tk.waitFor = function(selector, timeout) {
  timeout = timeout || 10000;
  return new Promise(function(resolve, reject) {
    var el = document.querySelector(selector);
    if (el) return resolve(el);
    var observer = new MutationObserver(function() {
      el = document.querySelector(selector);
      if (el) { observer.disconnect(); resolve(el); }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(function() { observer.disconnect(); reject(new Error('waitFor timeout: ' + selector)); }, timeout);
  });
};

window.__tk.click = function(selector) {
  var el = document.querySelector(selector);
  if (!el) return false;
  el.click();
  return true;
};

window.__tk.type = function(selector, text) {
  var el = document.querySelector(selector);
  if (!el) return false;
  var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set ||
                     Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  nativeSetter.call(el, text);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
};

// ═══ 工具函数 ═══

window.__tk.sleep = function(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
};

window.__tk.copy = function(text) {
  return navigator.clipboard.writeText(text).then(function() { return true; });
};

window.__tk.download = function(content, filename, type) {
  type = type || 'text/plain';
  var blob = new Blob([content], { type: type });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return true;
};

window.__tk.uuid = function() { return crypto.randomUUID(); };

window.__tk.now = function() { return new Date().toISOString(); };

window.__tk.redact = function(text) {
  if (!text) return text;
  var r = text;
  r = r.replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, '[REDACTED_API_KEY]');
  r = r.replace(/Bearer\s+[A-Za-z0-9_\-\.]{20,}/g, 'Bearer [REDACTED]');
  r = r.replace(/((?:API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY)\s*[=:]\s*)[^\s\n'"]{8,}/gi, '$1[REDACTED]');
  return r;
};

// ═══ VFS 批量操作 ═══

window.__tk.vfsReadAll = function() {
  return vfs.ls().then(function(list) {
    var promises = list.map(function(s) {
      return vfs.read(s.name).then(function(content) {
        return { name: s.name, desc: s.desc, length: content ? content.length : 0 };
      });
    });
    return Promise.all(promises);
  });
};

window.__tk.vfsStatus = function() {
  return window.__tk.vfsReadAll().then(function(slots) {
    var total = 0;
    slots.forEach(function(s) { total += s.length; });
    return { slots: slots, totalSlots: slots.length, totalChars: total };
  });
};

// ═══ Python 代码模板 ═══

window.__tk.py = {
  csvToJson: "import csv, json, sys\nreader = csv.DictReader(sys.stdin)\nprint(json.dumps(list(reader), ensure_ascii=False, indent=2))",
  jsonToCsv: "import csv, json, sys\ndata = json.load(sys.stdin)\nif data:\n  w = csv.DictWriter(sys.stdout, fieldnames=data[0].keys())\n  w.writeheader()\n  w.writerows(data)",
  sort: "import json, sys\ndata = json.load(sys.stdin)\nprint(json.dumps(data, sort_keys=True, ensure_ascii=False, indent=2))",
  flattenJson: "import json, sys\ndef flatten(d, prefix=''):\n  items = {}\n  for k, v in d.items():\n    key = prefix + '.' + k if prefix else k\n    if isinstance(v, dict):\n      items.update(flatten(v, key))\n    else:\n      items[key] = v\n  return items\ndata = json.load(sys.stdin)\nprint(json.dumps(flatten(data), ensure_ascii=False, indent=2))"
};

return Object.keys(window.__tk).length + ' functions registered (including ' + Object.keys(window.__tk.py).length + ' Python templates)';