content = open('/Users/yay/workspace/genspark-agent/extension/content.js').read()

# Find the recordHistory method and add batchCreate and batchUpload after it
old_record = '''        // ===== 历史记录 =====
        recordHistory(topic, category, videoUrl, metadata) {'''

batch_methods = '''        // ===== 批量创建（一次登录创建多个项目） =====
        async batchCreate(topics, onLog) {
          const log = onLog || console.log;
          const results = [];
          
          log('🔑 获取 Token...');
          let auth;
          try {
            auth = await this.getOpusToken();
            log('✅ Token 有效，剩余 ' + auth.remainingSec + 's');
          } catch(e) {
            log('❌ Token 获取失败: ' + e.message);
            throw e;
          }
          
          for (let i = 0; i < topics.length; i++) {
            const t = topics[i];
            log('🎬 [' + (i+1) + '/' + topics.length + '] 创建: ' + t.topic.substring(0, 50) + '...');
            try {
              const project = await this.createProject(t.topic, t.category, t.sourceUrl || '', auth);
              const metadata = this.buildYouTubeMetadata(t.topic, t.category);
              results.push({
                projectId: project.id,
                topic: t.topic,
                category: t.category,
                metadata,
                status: 'created',
                createdAt: new Date().toISOString()
              });
              log('✅ 项目已创建: ' + project.id);
            } catch(e) {
              log('❌ 创建失败: ' + e.message);
              results.push({ topic: t.topic, status: 'failed', error: e.message });
            }
            // 间隔 2 秒避免限流
            if (i < topics.length - 1) await new Promise(r => setTimeout(r, 2000));
          }
          
          // 保存待上传列表到 localStorage
          const pending = JSON.parse(localStorage.getItem('video_pending_uploads') || '[]');
          pending.push(...results.filter(r => r.status === 'created'));
          localStorage.setItem('video_pending_uploads', JSON.stringify(pending));
          
          log('📋 已创建 ' + results.filter(r => r.status === 'created').length + '/' + topics.length + ' 个项目，等待生成完成后上传');
          return results;
        },

        // ===== 批量上传（检查完成的项目并上传） =====
        async batchUpload(onLog) {
          const log = onLog || console.log;
          const pending = JSON.parse(localStorage.getItem('video_pending_uploads') || '[]');
          
          if (pending.length === 0) {
            log('📭 没有待上传的项目');
            return [];
          }
          
          log('🔑 获取 Token...');
          let auth;
          try {
            auth = await this.getOpusToken();
            log('✅ Token 有效，剩余 ' + auth.remainingSec + 's');
          } catch(e) {
            log('❌ Token 获取失败: ' + e.message);
            throw e;
          }
          
          const results = [];
          const stillPending = [];
          
          for (const item of pending) {
            log('🔍 检查项目: ' + item.projectId);
            try {
              const project = await this.opusApiCall('GET', '/project/' + item.projectId, null, auth);
              
              if (project.stage === 'EDITOR' && project.resultVideo) {
                log('✅ 视频已完成: ' + project.resultVideo.substring(0, 60) + '...');
                log('📤 上传到 YouTube...');
                const uploadResult = await this.uploadToYouTube(project.resultVideo, item.metadata);
                log('✅ YouTube 上传成功! 标题: ' + item.metadata.title);
                this.recordHistory(item.topic, item.category, project.resultVideo, item.metadata);
                results.push({ ...item, status: 'uploaded', videoUrl: project.resultVideo });
              } else if (project.stage === 'FAILED' || project.stage === 'ERROR') {
                log('❌ 项目失败: ' + item.projectId);
                results.push({ ...item, status: 'failed' });
              } else {
                log('⏳ 仍在生成中: ' + project.stage);
                stillPending.push(item);
                results.push({ ...item, status: 'pending', stage: project.stage });
              }
            } catch(e) {
              log('⚠️ 查询失败: ' + e.message);
              stillPending.push(item);
            }
            await new Promise(r => setTimeout(r, 1000));
          }
          
          // 更新待上传列表
          localStorage.setItem('video_pending_uploads', JSON.stringify(stillPending));
          log('📊 结果: ' + results.filter(r => r.status === 'uploaded').length + ' 已上传, ' + stillPending.length + ' 待处理');
          return results;
        },

''' + '        // ===== 历史记录 =====\n        recordHistory(topic, category, videoUrl, metadata) {'

if old_record in content:
    content = content.replace(old_record, batch_methods)
    open('/Users/yay/workspace/genspark-agent/extension/content.js', 'w').write(content)
    print('SUCCESS: added batchCreate and batchUpload methods')
else:
    print('ERROR: insertion point not found')
