content = open('/Users/yay/workspace/genspark-agent/extension/content.js').read()
content = content.replace(
    'maxPollTime: 600000, // 最长等待10分钟',
    'maxPollTime: 3600000, // 最长等待60分钟'
)
open('/Users/yay/workspace/genspark-agent/extension/content.js', 'w').write(content)
print('updated maxPollTime to 60 minutes')
