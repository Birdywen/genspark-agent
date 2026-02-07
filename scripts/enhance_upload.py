content = open('/Users/yay/workspace/genspark-agent/extension/content.js').read()

# Find the upload section where we get project data and enhance metadata
old_upload_log = """                log('✅ 视频已完成: ' + project.resultVideo.substring(0, 60) + '...');
                log('📤 上传到 YouTube...');
                const uploadResult = await this.uploadToYouTube(project.resultVideo, item.metadata);"""

new_upload_log = """                log('✅ 视频已完成: ' + project.resultVideo.substring(0, 60) + '...');
                // Enhance metadata with actual project data
                if (project.name) item.metadata.title = (project.name + ' #Shorts').substring(0, 100);
                if (project.script) {
                  const scriptPreview = project.script.substring(0, 200) + '...';
                  item.metadata.description = project.name + '\\n\\n' + scriptPreview + '\\n\\n' + (item.metadata.description || '');
                }
                log('📤 上传到 YouTube... 标题: ' + item.metadata.title);
                const uploadResult = await this.uploadToYouTube(project.resultVideo, item.metadata);"""

if old_upload_log in content:
    content = content.replace(old_upload_log, new_upload_log)
    open('/Users/yay/workspace/genspark-agent/extension/content.js', 'w').write(content)
    print('SUCCESS: enhanced upload with project metadata')
else:
    print('ERROR: old upload log not found')
    idx = content.find('视频已完成')
    if idx > -1:
        print('found at:', idx)
        print(repr(content[idx:idx+200]))
