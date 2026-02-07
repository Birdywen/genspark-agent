content = open('/Users/yay/workspace/genspark-agent/extension/content.js').read()

old_api_call = """        async opusApiCall(method, endpoint, body, auth) {
          const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': 'Bearer ' + auth.token,
            'X-OPUS-ORG-ID': auth.orgId,
            'X-OPUS-USER-ID': auth.userId,
            'X-OPUS-SHARED-ID': ''
          };
      
          const opts = { method, headers };
          if (body) opts.body = JSON.stringify(body);
      
          const resp = await fetch(this.config.opusApiBase + endpoint, opts);
          if (!resp.ok) {
            const text = await resp.text();
            throw new Error(`API ${resp.status}: ${text}`);
          }
          return resp.json();
        },"""

new_api_call = """        async opusApiCall(method, endpoint, body, auth) {
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
        },"""

if old_api_call in content:
    content = content.replace(old_api_call, new_api_call)
    open('/Users/yay/workspace/genspark-agent/extension/content.js', 'w').write(content)
    print('SUCCESS: replaced opusApiCall with EVAL_IN_TAB version')
else:
    print('ERROR: old opusApiCall not found')
    # Debug
    idx = content.find('async opusApiCall')
    if idx > -1:
        print('Found at index', idx)
        print(repr(content[idx:idx+200]))
