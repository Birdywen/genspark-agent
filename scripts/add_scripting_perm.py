content = open('/Users/yay/workspace/genspark-agent/extension/manifest.json').read()
if '"scripting"' not in content:
    content = content.replace(
        '"activeTab",',
        '"activeTab",\n    "scripting",'
    )
    open('/Users/yay/workspace/genspark-agent/extension/manifest.json', 'w').write(content)
    print('added scripting permission')
else:
    print('scripting permission already exists')
