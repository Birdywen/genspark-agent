content = open('/Users/yay/workspace/genspark-agent/extension/background.js').read()

old_exec = """          // Execute script in the target tab
          const results = await chrome.scripting.executeScript({
            target: { tabId: targetTab.id },
            func: (codeStr) => {
              try {
                const fn = new Function(codeStr);
                return fn();
              } catch(e) {
                return { error: e.message };
              }
            },
            args: [code],
            world: 'MAIN'
          });"""

new_exec = """          // Execute script in the target tab (supports async code)
          const results = await chrome.scripting.executeScript({
            target: { tabId: targetTab.id },
            func: async (codeStr) => {
              try {
                const fn = new Function(codeStr);
                const result = fn();
                // If result is a Promise, await it
                if (result && typeof result.then === 'function') {
                  return await result;
                }
                return result;
              } catch(e) {
                return { error: e.message };
              }
            },
            args: [code],
            world: 'MAIN'
          });"""

if old_exec in content:
    content = content.replace(old_exec, new_exec)
    open('/Users/yay/workspace/genspark-agent/extension/background.js', 'w').write(content)
    print('SUCCESS: updated EVAL_IN_TAB to support async')
else:
    print('ERROR: old exec block not found')
