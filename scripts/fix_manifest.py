content = open('/Users/yay/workspace/genspark-agent/extension/manifest.json').read()
content = content.replace(
    '"resources": ["panel-enhancer.js"]',
    '"resources": ["panel-enhancer.js", "video-generator.js"]'
)
open('/Users/yay/workspace/genspark-agent/extension/manifest.json', 'w').write(content)
print('added video-generator.js to web_accessible_resources')
