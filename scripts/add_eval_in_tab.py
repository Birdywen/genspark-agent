content = open('/Users/yay/workspace/genspark-agent/extension/background.js').read()

# Find the SWITCH_SERVER case and insert EVAL_IN_TAB before it
eval_in_tab_code = """    case 'EVAL_IN_TAB':
      // Execute code in a tab matching the given URL pattern
      (async () => {
        try {
          const tabUrl = message.tabUrl || '';
          const code = message.code || '';
          
          // Find tab matching URL
          const tabs = await chrome.tabs.query({});
          const targetTab = tabs.find(t => t.url && t.url.includes(tabUrl));
          
          if (!targetTab) {
            sendResponse({ success: false, error: 'No tab found matching: ' + tabUrl });
            return;
          }
          
          // Execute script in the target tab
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
          });
          
          const result = results && results[0] ? results[0].result : null;
          sendResponse({ success: true, result });
        } catch(e) {
          console.error('[BG] EVAL_IN_TAB error:', e);
          sendResponse({ success: false, error: e.message });
        }
      })();
      break;

"""

target = "    case 'SWITCH_SERVER':"
if target in content:
    content = content.replace(target, eval_in_tab_code + target)
    open('/Users/yay/workspace/genspark-agent/extension/background.js', 'w').write(content)
    print('SUCCESS: added EVAL_IN_TAB case to background.js')
else:
    print('ERROR: SWITCH_SERVER case not found')
