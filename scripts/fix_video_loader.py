content = open('/Users/yay/workspace/genspark-agent/extension/content.js').read()

# Replace the loadVideoGenerator function
old_func = """  function loadVideoGenerator() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('video-generator.js');
    script.onload = () => {
      if (window.VideoGenerator) {
        console.log('[Agent] VideoGenerator loaded');
      }
    };
    document.head.appendChild(script);
  }"""

new_func = """  function loadVideoGenerator() {
    try {
      const url = chrome.runtime.getURL('video-generator.js');
      fetch(url).then(r => r.text()).then(code => {
        eval(code);
        console.log('[Agent] VideoGenerator loaded, available:', !!window.VideoGenerator);
      }).catch(e => console.error('[Agent] Failed to load VideoGenerator:', e));
    } catch(e) {
      console.error('[Agent] loadVideoGenerator error:', e);
    }
  }"""

if old_func in content:
    content = content.replace(old_func, new_func)
    open('/Users/yay/workspace/genspark-agent/extension/content.js', 'w').write(content)
    print('replaced loadVideoGenerator with fetch+eval approach')
else:
    print('ERROR: old function not found')
    # Debug: show what we have
    idx = content.find('function loadVideoGenerator')
    if idx > -1:
        print('Found at index', idx)
        print(repr(content[idx:idx+300]))
    else:
        print('function not found at all')
