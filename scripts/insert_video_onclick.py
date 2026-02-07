lines = open('/Users/yay/workspace/genspark-agent/extension/content.js').readlines()

video_onclick = """    document.getElementById('agent-video').onclick = () => {
      if (window.VideoGenerator) {
        window.VideoGenerator.showTopicDialog(addLog);
      } else {
        addLog('❌ VideoGenerator 模块未加载，请刷新页面', 'error');
      }
    };

"""

# Find 'agent-clear' onclick line and insert before it
for i, line in enumerate(lines):
    if "document.getElementById('agent-clear').onclick" in line:
        lines.insert(i, video_onclick)
        print(f'inserted agent-video onclick before line {i+1}')
        break

open('/Users/yay/workspace/genspark-agent/extension/content.js', 'w').writelines(lines)
