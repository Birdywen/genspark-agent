content = open('/Users/yay/workspace/genspark-agent/extension/content.js').read()
content = content.replace('loadPanelEnhancer();', 'loadPanelEnhancer();\n    loadVideoGenerator();', 1)
open('/Users/yay/workspace/genspark-agent/extension/content.js', 'w').write(content)
print('inserted loadVideoGenerator() call')
