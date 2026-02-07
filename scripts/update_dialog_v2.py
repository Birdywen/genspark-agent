content = open('/Users/yay/workspace/genspark-agent/extension/content.js').read()

# 1. Replace topic/source fields with batch fields
old_fields = '''                <div class="vg-field">
                  <label>话题 / 标题 *</label>
                  <textarea id="vg-topic" rows="3" placeholder="输入视频话题，如：AI agents can now hire humans through a new platform"></textarea>
                </div>
                <div class="vg-field">
                  <label>来源 URL（可选）</label>
                  <input id="vg-source" type="text" placeholder="https://..." />
                </div>'''

new_fields = '''                <div class="vg-field">
                  <label>话题 1 *</label>
                  <textarea id="vg-topic" rows="2" placeholder="第一个视频话题"></textarea>
                </div>
                <div class="vg-field">
                  <label>来源 URL 1（可选）</label>
                  <input id="vg-source" type="text" placeholder="https://..." />
                </div>
                <div class="vg-field">
                  <label>话题 2（可选，留空则只创建1个）</label>
                  <textarea id="vg-topic2" rows="2" placeholder="第二个视频话题"></textarea>
                </div>
                <div class="vg-field">
                  <label>来源 URL 2（可选）</label>
                  <input id="vg-source2" type="text" placeholder="https://..." />
                </div>'''

if old_fields in content:
    content = content.replace(old_fields, new_fields)
    print('1. replaced fields OK')
else:
    print('1. ERROR: fields not found')

# 2. Replace footer
old_footer = '''              <div class="vg-footer">
                <button id="vg-preview-btn" class="vg-btn vg-btn-secondary">👁️ 预览</button>
                <button id="vg-start-btn" class="vg-btn vg-btn-primary">🚀 开始生成</button>
              </div>'''

new_footer = '''              <div class="vg-footer">
                <button id="vg-upload-btn" class="vg-btn vg-btn-secondary" style="background:#059669">📤 上传已完成</button>
                <button id="vg-preview-btn" class="vg-btn vg-btn-secondary">👁️ 预览</button>
                <button id="vg-start-btn" class="vg-btn vg-btn-primary">🚀 批量创建</button>
              </div>'''

if old_footer in content:
    content = content.replace(old_footer, new_footer)
    print('2. replaced footer OK')
else:
    print('2. ERROR: footer not found')

# 3. Replace start button handler
old_handler = """          dialog.querySelector('#vg-start-btn').onclick = async () => {
            const topic = dialog.querySelector('#vg-topic').value.trim();
            const cat = dialog.querySelector('#vg-category').value;
            const source = dialog.querySelector('#vg-source').value.trim();
      
            if (!topic) {
              this.setStatus(dialog, '请输入话题', 'error');
              return;
            }
      
            const startBtn = dialog.querySelector('#vg-start-btn');
            const previewBtn = dialog.querySelector('#vg-preview-btn');
            startBtn.disabled = true;
            previewBtn.disabled = true;
            startBtn.textContent = '⏳ 生成中...';
      
            const statusEl = dialog.querySelector('#vg-status');
            const logToDialog = (msg) => {
              statusEl.className = 'vg-status';
              statusEl.innerHTML += `<div class="vg-log">${msg}</div>`;
              statusEl.scrollTop = statusEl.scrollHeight;
              if (addLog) addLog(msg, 'info');
            };
      
            try {
              const result = await this.run(topic, {
                category: cat,
                sourceUrl: source,
                onLog: logToDialog
              });
              
              this.setStatus(dialog, '🎉 完成！视频已上传到 YouTube (Private)', 'success');
              startBtn.textContent = '✅ 完成';
              
              // 3秒后自动关闭
              setTimeout(() => dialog.remove(), 5000);
            } catch (error) {
              this.setStatus(dialog, '❌ ' + error.message, 'error');
              startBtn.disabled = false;
              previewBtn.disabled = false;
              startBtn.textContent = '🚀 重试';
            }
          };"""

new_handler = """          // 批量创建按钮
          dialog.querySelector('#vg-start-btn').onclick = async () => {
            const topic1 = dialog.querySelector('#vg-topic').value.trim();
            const cat = dialog.querySelector('#vg-category').value;
            const source1 = dialog.querySelector('#vg-source').value.trim();
            const topic2 = dialog.querySelector('#vg-topic2') ? dialog.querySelector('#vg-topic2').value.trim() : '';
            const source2 = dialog.querySelector('#vg-source2') ? dialog.querySelector('#vg-source2').value.trim() : '';

            if (!topic1) {
              this.setStatus(dialog, '请输入至少一个话题', 'error');
              return;
            }

            const topics = [{topic: topic1, category: cat, sourceUrl: source1}];
            if (topic2) topics.push({topic: topic2, category: cat, sourceUrl: source2});

            const startBtn = dialog.querySelector('#vg-start-btn');
            const previewBtn = dialog.querySelector('#vg-preview-btn');
            const uploadBtn = dialog.querySelector('#vg-upload-btn');
            startBtn.disabled = true;
            previewBtn.disabled = true;
            if (uploadBtn) uploadBtn.disabled = true;
            startBtn.textContent = '⏳ 创建中...';

            const logToDialog = (msg) => {
              this.setStatus(dialog, msg);
              if (addLog) addLog(msg, 'info');
            };

            try {
              const results = await this.batchCreate(topics, logToDialog);
              const created = results.filter(r => r.status === 'created').length;
              this.setStatus(dialog, '🎉 已创建 ' + created + ' 个项目！等视频生成完成后点「📤 上传已完成」', 'success');
              startBtn.textContent = '✅ 已创建 ' + created + ' 个';
              if (uploadBtn) uploadBtn.disabled = false;
            } catch (error) {
              this.setStatus(dialog, '❌ ' + error.message, 'error');
              startBtn.disabled = false;
              previewBtn.disabled = false;
              if (uploadBtn) uploadBtn.disabled = false;
              startBtn.textContent = '🚀 重试';
            }
          };

          // 上传已完成的视频
          dialog.querySelector('#vg-upload-btn').onclick = async () => {
            const uploadBtn = dialog.querySelector('#vg-upload-btn');
            uploadBtn.disabled = true;
            uploadBtn.textContent = '⏳ 检查中...';

            const logToDialog = (msg) => {
              this.setStatus(dialog, msg);
              if (addLog) addLog(msg, 'info');
            };

            try {
              const results = await this.batchUpload(logToDialog);
              const uploaded = results.filter(r => r.status === 'uploaded').length;
              const pending = results.filter(r => r.status === 'pending').length;
              if (uploaded > 0) {
                this.setStatus(dialog, '🎉 ' + uploaded + ' 个视频已上传! ' + (pending > 0 ? pending + ' 个仍在生成中' : ''), 'success');
              } else if (pending > 0) {
                this.setStatus(dialog, '⏳ ' + pending + ' 个视频仍在生成中，稍后再试');
              } else {
                this.setStatus(dialog, '📭 没有待上传的项目');
              }
              uploadBtn.textContent = '📤 上传已完成';
              uploadBtn.disabled = false;
            } catch(error) {
              this.setStatus(dialog, '❌ ' + error.message, 'error');
              uploadBtn.textContent = '📤 重试上传';
              uploadBtn.disabled = false;
            }
          };"""

if old_handler in content:
    content = content.replace(old_handler, new_handler)
    print('3. replaced handler OK')
else:
    print('3. ERROR: handler not found')

open('/Users/yay/workspace/genspark-agent/extension/content.js', 'w').write(content)
print('DONE')
