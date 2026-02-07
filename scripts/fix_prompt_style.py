content = open('/Users/yay/workspace/genspark-agent/extension/content.js').read()

old_prompt = '''        buildPrompt(topic, category, sourceUrl) {
          const cat = this.getCategoryConfig(category);
          return `Create a 45-second video about: ${topic}\n\nIMPORTANT FIRST FRAME: The first 2-3 seconds MUST be a bold, eye-catching title card with large text showing a short punchy title on a vivid, high-contrast background. This serves as the video thumbnail on YouTube Shorts.\n\nStyle: ${cat.tone}\nCategory: ${cat.label}\n${sourceUrl ? 'Source: ' + sourceUrl : ''}\n\nRules:\n- Hook the viewer in the first 3 seconds with a surprising fact or question\n- Language: English\n- Include source citations where applicable\n- End with a thought-provoking statement or call to action\n- Keep the script concise and punchy — every sentence must earn its place\n- Use visual storytelling with relevant B-roll footage`;
        },'''

new_prompt = '''        buildPrompt(topic, category, sourceUrl) {
          // Keep prompt short and natural - Opus AI agents handle the rest
          let prompt = topic;
          if (sourceUrl) {
            prompt += '\\n\\nReference: ' + sourceUrl;
          }
          return prompt;
        },'''

if old_prompt in content:
    content = content.replace(old_prompt, new_prompt)
    open('/Users/yay/workspace/genspark-agent/extension/content.js', 'w').write(content)
    print('SUCCESS: simplified buildPrompt')
else:
    print('ERROR: old prompt not found')
    idx = content.find('buildPrompt(topic')
    if idx > -1:
        print('found at:', idx)
        print(repr(content[idx:idx+200]))
