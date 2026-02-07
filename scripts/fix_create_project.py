content = open('/Users/yay/workspace/genspark-agent/extension/content.js').read()

# Find createProject and add hookTemplateName
idx = content.find('async createProject')
if idx == -1:
    print('ERROR: createProject not found')
else:
    # Find enableCaption: true in createProject
    search = "enableCaption: true\n          };\n      \n          const result = await this.opusApiCall('POST', '/project', body, auth);"
    if search in content:
        replacement = "hookTemplateName: 'hook_slidecut_down',\n            enableCaption: true\n          };\n      \n          const result = await this.opusApiCall('POST', '/project', body, auth);"
        content = content.replace(search, replacement, 1)
        open('/Users/yay/workspace/genspark-agent/extension/content.js', 'w').write(content)
        print('SUCCESS: added hookTemplateName')
    else:
        # Try to find what's actually there
        cap_idx = content.find('enableCaption: true', idx)
        if cap_idx > -1:
            print('found enableCaption at:', cap_idx)
            print(repr(content[cap_idx:cap_idx+150]))
        else:
            print('enableCaption not found after createProject')
