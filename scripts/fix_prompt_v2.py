lines = open('/Users/yay/workspace/genspark-agent/extension/content.js').readlines()

# Replace lines 200-217 (0-indexed: 199-216)
new_func = '''        buildPrompt(topic, category, sourceUrl) {
          // Keep prompt short and natural - Opus AI agents handle the rest
          let prompt = topic;
          if (sourceUrl) {
            prompt += '\\nReference: ' + sourceUrl;
          }
          return prompt;
        },
'''

lines[199:217] = [new_func]
open('/Users/yay/workspace/genspark-agent/extension/content.js', 'w').writelines(lines)
print('SUCCESS: replaced buildPrompt lines 200-217')
