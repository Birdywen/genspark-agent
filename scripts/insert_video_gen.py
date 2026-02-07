lines = open('/Users/yay/workspace/genspark-agent/extension/content.js').readlines()

insert_code = """  function loadVideoGenerator() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('video-generator.js');
    script.onload = () => {
      if (window.VideoGenerator) {
        console.log('[Agent] VideoGenerator loaded');
      }
    };
    document.head.appendChild(script);
  }

"""

# Insert after line 73 (0-indexed: 72)
lines.insert(73, insert_code)
open('/Users/yay/workspace/genspark-agent/extension/content.js', 'w').writelines(lines)
print('inserted loadVideoGenerator')
