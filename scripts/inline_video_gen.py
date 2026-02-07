# Read video-generator.js content
vg_code = open('/Users/yay/workspace/genspark-agent/extension/video-generator.js').read()

# Read content.js
content = open('/Users/yay/workspace/genspark-agent/extension/content.js').read()

# Replace loadVideoGenerator function with inline version
old_func = """  function loadVideoGenerator() {
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

# Strip the export/module wrapper from video-generator.js
# Remove the last block: if (typeof module...) else { window.VideoGenerator = VideoGenerator; }
vg_clean = vg_code.replace("""// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = VideoGenerator;
} else {
  window.VideoGenerator = VideoGenerator;
}""", '// VideoGenerator is now available in scope')

new_func = """  // === VideoGenerator 内联模块 ===
  function loadVideoGenerator() {
    try {
""" + '\n'.join('      ' + line for line in vg_clean.split('\n')) + """
      window.VideoGenerator = VideoGenerator;
      console.log('[Agent] VideoGenerator loaded (inline)');
    } catch(e) {
      console.error('[Agent] loadVideoGenerator error:', e);
    }
  }"""

if old_func in content:
    content = content.replace(old_func, new_func)
    open('/Users/yay/workspace/genspark-agent/extension/content.js', 'w').write(content)
    print('SUCCESS: inlined VideoGenerator into content.js')
else:
    print('ERROR: old function not found')
