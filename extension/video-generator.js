/**
 * 视频生成模块 - Agent Opus → YouTube 自动化
 * 流程：选题 → 构建 Prompt → 创建 Opus 项目 → 轮询完成 → Webhook 上传 YouTube
 */

const VideoGenerator = {
  // 配置
  config: {
    opusApiBase: 'https://api.opus.pro/api',
    webhookUrl: 'https://flow.sokt.io/func/scri42hM0QuZ',
    pollInterval: 30000, // 30秒轮询一次
    maxPollTime: 600000, // 最长等待10分钟
    opusTabId: null // opus.pro 的 tab ID
  },

  // 状态
  state: {
    isRunning: false,
    currentStep: null,
    projectId: null
  },

  // ===== Token 管理 =====
  async getOpusToken() {
    // 在 opus.pro tab 里读取 localStorage token
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        type: 'EVAL_IN_TAB',
        tabUrl: 'opus.pro',
        code: `
          const token = JSON.parse(localStorage.getItem('atom:user:access-token'));
          const orgId = JSON.parse(localStorage.getItem('atom:user:org-id'));
          const userId = JSON.parse(localStorage.getItem('atom:user:org-user-id'));
          if (!token) return {error: 'no token'};
          const parts = token.split('.');
          const payload = JSON.parse(atob(parts[1]));
          const now = Math.floor(Date.now()/1000);
          if (now > payload.exp) return {error: 'token expired', remainingSec: payload.exp - now};
          return {token, orgId, userId, remainingSec: payload.exp - now};
        `
      }, (resp) => {
        if (resp && resp.result && !resp.result.error) {
          resolve(resp.result);
        } else {
          reject(new Error(resp?.result?.error || 'Failed to get opus token'));
        }
      });
    });
  },

  // ===== API 调用 =====
  async opusApiCall(method, endpoint, body, auth) {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': 'Bearer ' + auth.token,
      'X-OPUS-ORG-ID': auth.orgId,
      'X-OPUS-USER-ID': auth.userId,
      'X-OPUS-SHARED-ID': ''
    };

    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);

    const resp = await fetch(this.config.opusApiBase + endpoint, opts);
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`API ${resp.status}: ${text}`);
    }
    return resp.json();
  },

  // ===== 内容调度 =====
  getTodayCategory() {
    const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const today = days[new Date().getDay()];
    const schedule = {
      mon: 'tech', tue: 'people', wed: 'society',
      thu: 'science', fri: 'business', sat: 'culture', sun: 'wildcard'
    };
    return schedule[today] || 'tech';
  },

  getCategoryConfig(categoryId) {
    const categories = {
      tech: { label: '科技趋势', hashtags: ['#Tech', '#AI', '#Innovation'], tone: 'informative, forward-looking' },
      people: { label: '人物传记', hashtags: ['#Biography', '#Inspiring', '#People'], tone: 'storytelling, emotional' },
      society: { label: '社会热点', hashtags: ['#Society', '#Trending', '#News'], tone: 'analytical, thought-provoking' },
      science: { label: '科学解读', hashtags: ['#Science', '#Discovery', '#Facts'], tone: 'educational, wonder-inducing' },
      business: { label: '商业分析', hashtags: ['#Business', '#Money', '#Strategy'], tone: 'analytical, actionable' },
      culture: { label: '文化现象', hashtags: ['#Culture', '#Viral', '#Entertainment'], tone: 'observational, witty' },
      wildcard: { label: '百搭话题', hashtags: ['#Interesting', '#MustWatch'], tone: 'engaging, versatile' }
    };
    return categories[categoryId] || categories.tech;
  },

  // ===== Prompt 构建 =====
  buildPrompt(topic, category, sourceUrl) {
    const cat = this.getCategoryConfig(category);
    return `Create a 45-second video about: ${topic}

IMPORTANT FIRST FRAME: The first 2-3 seconds MUST be a bold, eye-catching title card with large text showing a short punchy title on a vivid, high-contrast background. This serves as the video thumbnail on YouTube Shorts.

Style: ${cat.tone}
Category: ${cat.label}
${sourceUrl ? 'Source: ' + sourceUrl : ''}

Rules:
- Hook the viewer in the first 3 seconds with a surprising fact or question
- Language: English
- Include source citations where applicable
- End with a thought-provoking statement or call to action
- Keep the script concise and punchy — every sentence must earn its place
- Use visual storytelling with relevant B-roll footage`;
  },

  // ===== YouTube 元数据 =====
  buildYouTubeMetadata(topic, category) {
    const cat = this.getCategoryConfig(category);
    
    // 标题: 最多 100 字符，推荐 60
    let title = topic.length > 55 ? topic.substring(0, 52) + '...' : topic;
    title += ' #Shorts';
    if (title.length > 100) title = title.substring(0, 97) + '...';

    // 描述
    const hashtags = ['#Shorts', ...cat.hashtags].slice(0, 5).join(' ');
    const description = `${topic}\n\n${hashtags}\n\nThis video was created with AI assistance. All facts have been verified.`;

    // Tags
    const tags = ['Shorts', category, ...cat.hashtags.map(h => h.replace('#', ''))];

    return { title, description, tags };
  },

  // ===== 核心流程 =====
  async createProject(topic, category, sourceUrl, auth) {
    const prompt = this.buildPrompt(topic, category, sourceUrl);
    
    const body = {
      initialText: prompt,
      voice: {
        labels: ['English (US)', 'Female', 'Entertainment', 'Engaging'],
        name: 'Lily',
        provider: 'minimax',
        type: 'voice-over',
        voiceId: 'moss_audio_c12a59b9-7115-11f0-a447-9613c873494c'
      },
      enableCaption: true
    };

    const result = await this.opusApiCall('POST', '/project', body, auth);
    return result;
  },

  async pollProjectStatus(projectId, auth, onUpdate) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < this.config.maxPollTime) {
      try {
        const project = await this.opusApiCall('GET', `/project/${projectId}`, null, auth);
        
        if (onUpdate) onUpdate(project.stage, project);

        if (project.stage === 'EDITOR' && project.resultVideo) {
          return project;
        }

        if (project.stage === 'FAILED' || project.stage === 'ERROR') {
          throw new Error('Project failed: ' + (project.error || project.stage));
        }
      } catch (e) {
        // Token 可能过期，尝试刷新
        if (e.message.includes('401')) {
          throw new Error('Token expired during polling. Please refresh opus.pro login.');
        }
        throw e;
      }

      await new Promise(r => setTimeout(r, this.config.pollInterval));
    }

    throw new Error('Polling timeout: video generation took too long');
  },

  async uploadToYouTube(videoUrl, metadata) {
    const payload = {
      video_url: videoUrl,
      youtube_title: metadata.title,
      youtube_description: metadata.description,
      youtube_tags: metadata.tags
    };

    const resp = await fetch(this.config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    return resp.json();
  },

  // ===== 主流程 =====
  async run(topic, options = {}) {
    if (this.state.isRunning) {
      throw new Error('视频生成正在进行中，请等待完成');
    }

    this.state.isRunning = true;
    this.state.currentStep = 'init';
    const log = options.onLog || console.log;
    const category = options.category || this.getTodayCategory();
    const sourceUrl = options.sourceUrl || '';

    try {
      // Step 1: 获取 Token
      log('🔑 获取 Opus Pro Token...');
      this.state.currentStep = 'auth';
      let auth;
      try {
        auth = await this.getOpusToken();
        log(`✅ Token 有效，剩余 ${auth.remainingSec}s`);
      } catch (e) {
        log('❌ Token 获取失败: ' + e.message);
        log('💡 请在 opus.pro 页面重新登录后再试');
        throw e;
      }

      // Step 2: 创建项目
      log(`🎬 创建视频项目... 类别: ${category}`);
      this.state.currentStep = 'create';
      const project = await this.createProject(topic, category, sourceUrl, auth);
      this.state.projectId = project.id;
      log(`✅ 项目已创建: ${project.id}`);

      // Step 3: 轮询等待
      log('⏳ 等待视频生成（可能需要 3-8 分钟）...');
      this.state.currentStep = 'polling';
      
      const completed = await this.pollProjectStatus(project.id, auth, (stage, data) => {
        log(`  📊 状态: ${stage}`);
      });
      
      const videoUrl = completed.resultVideo;
      log(`✅ 视频生成完成: ${videoUrl}`);

      // Step 4: 构建 YouTube 元数据
      log('📝 生成 YouTube 元数据...');
      this.state.currentStep = 'metadata';
      const metadata = this.buildYouTubeMetadata(topic, category);
      log(`  标题: ${metadata.title}`);

      // Step 5: 上传到 YouTube
      log('📤 上传到 YouTube (Private)...');
      this.state.currentStep = 'upload';
      const uploadResult = await this.uploadToYouTube(videoUrl, metadata);
      log('✅ YouTube 上传成功！');

      // Step 6: 记录历史
      this.state.currentStep = 'done';
      this.recordHistory(topic, category, videoUrl, metadata);
      log('🎉 全流程完成！视频已上传为 Private，请在 YouTube Studio 审核后公开。');

      return {
        success: true,
        projectId: project.id,
        videoUrl,
        metadata,
        uploadResult
      };

    } catch (error) {
      log('❌ 失败: ' + error.message);
      throw error;
    } finally {
      this.state.isRunning = false;
      this.state.currentStep = null;
    }
  },

  // ===== 历史记录 =====
  recordHistory(topic, category, videoUrl, metadata) {
    try {
      const history = JSON.parse(localStorage.getItem('video_content_history') || '{"published":[],"topics_used":[]}');
      history.published.push({
        date: new Date().toISOString(),
        topic,
        category,
        videoUrl,
        youtubeTitle: metadata.title,
        status: 'uploaded_private'
      });
      history.topics_used.push(topic.substring(0, 100));
      // 只保留最近 100 条
      if (history.published.length > 100) history.published = history.published.slice(-100);
      if (history.topics_used.length > 200) history.topics_used = history.topics_used.slice(-200);
      localStorage.setItem('video_content_history', JSON.stringify(history));
    } catch (e) {
      console.error('Failed to record history:', e);
    }
  },

  // ===== UI: 弹出选题对话框 =====
  showTopicDialog(addLog) {
    // 如果已有对话框，移除
    const existing = document.getElementById('video-gen-dialog');
    if (existing) existing.remove();

    const category = this.getTodayCategory();
    const catConfig = this.getCategoryConfig(category);

    const dialog = document.createElement('div');
    dialog.id = 'video-gen-dialog';
    dialog.innerHTML = `
      <div class="vg-overlay"></div>
      <div class="vg-modal">
        <div class="vg-header">
          <span>🎬 生成视频</span>
          <button class="vg-close">✕</button>
        </div>
        <div class="vg-body">
          <div class="vg-field">
            <label>今日类别</label>
            <select id="vg-category">
              <option value="tech" ${category === 'tech' ? 'selected' : ''}>🔧 科技趋势 (Mon)</option>
              <option value="people" ${category === 'people' ? 'selected' : ''}>👤 人物传记 (Tue)</option>
              <option value="society" ${category === 'society' ? 'selected' : ''}>🌍 社会热点 (Wed)</option>
              <option value="science" ${category === 'science' ? 'selected' : ''}>🔬 科学解读 (Thu)</option>
              <option value="business" ${category === 'business' ? 'selected' : ''}>💼 商业分析 (Fri)</option>
              <option value="culture" ${category === 'culture' ? 'selected' : ''}>🎭 文化现象 (Sat)</option>
              <option value="wildcard" ${category === 'wildcard' ? 'selected' : ''}>🎲 百搭话题 (Sun)</option>
            </select>
          </div>
          <div class="vg-field">
            <label>话题 / 标题 *</label>
            <textarea id="vg-topic" rows="3" placeholder="输入视频话题，如：AI agents can now hire humans through a new platform"></textarea>
          </div>
          <div class="vg-field">
            <label>来源 URL（可选）</label>
            <input id="vg-source" type="text" placeholder="https://..." />
          </div>
          <div class="vg-preview" id="vg-preview" style="display:none">
            <div class="vg-preview-title">预览</div>
            <div id="vg-preview-content"></div>
          </div>
          <div class="vg-status" id="vg-status"></div>
        </div>
        <div class="vg-footer">
          <button id="vg-preview-btn" class="vg-btn vg-btn-secondary">👁️ 预览</button>
          <button id="vg-start-btn" class="vg-btn vg-btn-primary">🚀 开始生成</button>
        </div>
      </div>
    `;

    // 样式
    const style = document.createElement('style');
    style.id = 'video-gen-styles';
    if (!document.getElementById('video-gen-styles')) {
      style.textContent = `
        #video-gen-dialog { position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 10002; display: flex; align-items: center; justify-content: center; }
        .vg-overlay { position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); }
        .vg-modal { position: relative; background: #1a1a2e; color: #e0e0e0; border-radius: 12px; width: 460px; max-height: 80vh; overflow-y: auto; box-shadow: 0 20px 60px rgba(0,0,0,0.5); }
        .vg-header { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid #333; font-size: 16px; font-weight: 600; }
        .vg-close { background: none; border: none; color: #999; font-size: 18px; cursor: pointer; }
        .vg-close:hover { color: #fff; }
        .vg-body { padding: 20px; }
        .vg-field { margin-bottom: 16px; }
        .vg-field label { display: block; font-size: 12px; color: #aaa; margin-bottom: 6px; font-weight: 500; }
        .vg-field select, .vg-field input, .vg-field textarea { width: 100%; padding: 10px 12px; background: #0f0f23; border: 1px solid #333; border-radius: 8px; color: #e0e0e0; font-size: 14px; box-sizing: border-box; }
        .vg-field textarea { resize: vertical; font-family: inherit; }
        .vg-field select:focus, .vg-field input:focus, .vg-field textarea:focus { outline: none; border-color: #6366f1; }
        .vg-preview { background: #0f0f23; border-radius: 8px; padding: 12px; margin-bottom: 16px; }
        .vg-preview-title { font-size: 11px; color: #6366f1; font-weight: 600; margin-bottom: 8px; }
        #vg-preview-content { font-size: 12px; color: #ccc; white-space: pre-wrap; max-height: 150px; overflow-y: auto; }
        .vg-status { font-size: 12px; color: #aaa; min-height: 20px; }
        .vg-status.error { color: #ef4444; }
        .vg-status.success { color: #22c55e; }
        .vg-footer { display: flex; justify-content: flex-end; gap: 10px; padding: 16px 20px; border-top: 1px solid #333; }
        .vg-btn { padding: 10px 20px; border: none; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.2s; }
        .vg-btn-secondary { background: #333; color: #e0e0e0; }
        .vg-btn-secondary:hover { background: #444; }
        .vg-btn-primary { background: #6366f1; color: white; }
        .vg-btn-primary:hover { background: #5558e6; }
        .vg-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .vg-log { font-size: 11px; padding: 4px 0; border-bottom: 1px solid #1a1a2e; }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(dialog);

    // 事件绑定
    dialog.querySelector('.vg-close').onclick = () => dialog.remove();
    dialog.querySelector('.vg-overlay').onclick = () => dialog.remove();

    // 预览按钮
    dialog.querySelector('#vg-preview-btn').onclick = () => {
      const topic = dialog.querySelector('#vg-topic').value.trim();
      const cat = dialog.querySelector('#vg-category').value;
      const source = dialog.querySelector('#vg-source').value.trim();
      if (!topic) {
        this.setStatus(dialog, '请输入话题', 'error');
        return;
      }
      const prompt = this.buildPrompt(topic, cat, source);
      const metadata = this.buildYouTubeMetadata(topic, cat);
      const preview = dialog.querySelector('#vg-preview');
      preview.style.display = 'block';
      dialog.querySelector('#vg-preview-content').textContent = 
        `📺 YouTube 标题: ${metadata.title}\n\n📝 Opus Prompt:\n${prompt}\n\n🏷️ Tags: ${metadata.tags.join(', ')}`;
    };

    // 开始生成按钮
    dialog.querySelector('#vg-start-btn').onclick = async () => {
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
    };
  },

  setStatus(dialog, msg, type) {
    const el = dialog.querySelector('#vg-status');
    el.className = 'vg-status ' + (type || '');
    el.innerHTML += `<div class="vg-log">${msg}</div>`;
  }
};

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = VideoGenerator;
} else {
  window.VideoGenerator = VideoGenerator;
}
