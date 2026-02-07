content = open('/Users/yay/workspace/genspark-agent/extension/content.js').read()

old_call = '''        async opusApiCall(method, endpoint, body, auth) {
          // Execute API call in opus.pro tab context to avoid CORS
          return new Promise((resolve, reject) => {
            const bodyStr = body ? JSON.stringify(body) : 'null';
            const code = `
              return (async () => {
                const headers = {
                  'Content-Type': 'application/json',
                  'Accept': 'application/json',
                  'Authorization': 'Bearer ' + '${auth.token}',
                  'X-OPUS-ORG-ID': '${auth.orgId}',
                  'X-OPUS-USER-ID': '${auth.userId}',
                  'X-OPUS-SHARED-ID': ''
                };
                const opts = { method: '${method}', headers };
                const bodyData = ${bodyStr};
                if (bodyData) opts.body = JSON.stringify(bodyData);
                const resp = await fetch('https://api.opus.pro/api${endpoint}', opts);
                if (!resp.ok) {
                  const text = await resp.text();
                  return { __error: true, status: resp.status, message: text };
                }
                return resp.json();
              })()
            `;
            chrome.runtime.sendMessage({
              type: 'EVAL_IN_TAB',
              tabUrl: 'opus.pro',
              code: code
            }, (resp) => {
              if (resp && resp.success && resp.result) {
                if (resp.result.__error) {
                  reject(new Error('API ' + resp.result.status + ': ' + resp.result.message));
                } else {
                  resolve(resp.result);
                }
              } else {
                reject(new Error(resp?.error || 'EVAL_IN_TAB failed'));
              }
            });
          });
        },'''

new_call = '''        async opusApiCall(method, endpoint, body, auth) {
          // Execute API call in opus.pro tab context to avoid CORS
          // Pass params as JSON-safe strings to avoid injection issues
          return new Promise((resolve, reject) => {
            const safeBody = body ? JSON.stringify(JSON.stringify(body)) : 'null';
            const code = [
              'return (async () => {',
              '  const token = JSON.parse(localStorage.getItem("atom:user:access-token"));',
              '  const orgId = JSON.parse(localStorage.getItem("atom:user:org-id"));',
              '  const userId = JSON.parse(localStorage.getItem("atom:user:org-user-id"));',
              '  const headers = {',
              '    "Content-Type": "application/json",',
              '    "Accept": "application/json",',
              '    "Authorization": "Bearer " + token,',
              '    "X-OPUS-ORG-ID": orgId,',
              '    "X-OPUS-USER-ID": userId,',
              '    "X-OPUS-SHARED-ID": ""',
              '  };',
              '  const opts = { method: "' + method + '", headers };',
              '  const bodyData = ' + safeBody + ';',
              '  if (bodyData && bodyData !== "null") opts.body = bodyData;',
              '  const resp = await fetch("https://api.opus.pro/api' + endpoint + '", opts);',
              '  if (!resp.ok) {',
              '    const text = await resp.text();',
              '    return { __error: true, status: resp.status, message: text };',
              '  }',
              '  return resp.json();',
              '})()'
            ].join('\\n');
            chrome.runtime.sendMessage({
              type: 'EVAL_IN_TAB',
              tabUrl: 'opus.pro',
              code: code
            }, (resp) => {
              if (resp && resp.success && resp.result) {
                if (resp.result.__error) {
                  reject(new Error('API ' + resp.result.status + ': ' + resp.result.message));
                } else {
                  resolve(resp.result);
                }
              } else {
                reject(new Error(resp?.error || 'EVAL_IN_TAB failed'));
              }
            });
          });
        },'''

if old_call in content:
    content = content.replace(old_call, new_call)
    open('/Users/yay/workspace/genspark-agent/extension/content.js', 'w').write(content)
    print('SUCCESS: replaced opusApiCall v2 - reads token from localStorage in opus.pro tab')
else:
    print('ERROR: old call not found')
    idx = content.find('async opusApiCall')
    print('found at:', idx)
    if idx > -1:
        print(repr(content[idx:idx+100]))
