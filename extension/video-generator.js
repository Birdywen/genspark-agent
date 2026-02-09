/**
 * VideoGenerator v3 - Story Mode + OpusClip API 全自动化
 * 
 * 流程:
 *   1. grant-free-tool-credential -> OpusClip 免费 token (7天)
 *   2. long-take-videos API -> Story Video (CDN 200 轮询)
 *   3. source-videos + clip-projects -> 动态字幕
 *   4. generative-jobs -> AI 缩略图 + YouTube 元数据
 *   5. viaSocket webhook -> YouTube 上传 + 缩略图 + Playlist
 *
 * Story Mode CDN 捷径: HEAD https://s2v-ext.cdn.opus.pro/agent/workspace/{id}/final_video.mp4
 * 返回 200 即完成，无需 token，不会过期
 */

class VideoGenerator {
  constructor() {
    this.config = {
      opusApiBase: 'https://api.opus.pro/api',
      webhookUrl: 'https://flow.sokt.io/func/scri42hM0QuZ',
      pollInterval: 30000,
      maxPollTime: 3600000, // 60 min
    };
    this.state = { isRunning: false, currentStep: null };
    this.onLog = null;

    // 内部分类 -> YouTube categoryId
    this.categoryMap = {
      entertainmentOrComedy: '24', educational: '27', music: '10',
      gaming: '20', peopleBlogs: '22', howto: '26', scienceTech: '28',
    };
    this.internalCategoryMap = {
      tech: '28', people: '22', society: '24', science: '27',
      business: '24', culture: '24', wildcard: '24',
    };

    // 内部分类 -> YouTube Playlist ID
    this.playlistMap = {
      wildcard: 'PLYtnUtZt0ZnF-oneo7UEDTO_OGJQ12ovZ',
      culture:  'PLYtnUtZt0ZnHIwG9vhWqSr6t1vGRr0AQR',
      business: 'PLYtnUtZt0ZnE0_9LXZTFOlgFxFB-oh8sK',
      science:  'PLYtnUtZt0ZnFn-PNqSLN-_wPkIFGGCSlw',
      society:  'PLYtnUtZt0ZnFssUY9G1cLpXO-D6JKPHH5',
      people:   'PLYtnUtZt0ZnGnjjJ3L60TIK7kBT93yRo3',
      tech:     'PLYtnUtZt0ZnFNjguN43KAb3aYFwCMTYZW',
    };

    // Story Mode 预设样式
    this.storyStyles = {
      economic:   'premium editorial minimalism, cream background with subtle paper grain, red/black accents, serif headline typography, clean chart animations, gentle fades and sliding lower-thirds, slow confident camera pushes, minimal motion with precise timing, quiet authoritative pacing',
      claymation: 'claymation style, colorful clay characters, stop motion aesthetic',
      watercolor: 'watercolor painting style, soft flowing colors, artistic transitions',
      halftone:   'halftone print style, newspaper aesthetic, bold dots and contrast',
      collage:    'blue collage style, mixed media cutouts, layered paper textures',
      penink:     'pen and ink illustration, detailed line work, crosshatching',
      schematic:  'schematic blueprint style, technical drawing aesthetic, clean lines',
      line2d:     '2D line animation, simple clean strokes, minimalist motion',
      animation:  '3D animation style, vibrant colors, dynamic camera movements',
    };

    // 内容分类调度
    this.categories = {
      tech:     { label: 'Tech Trends',     hashtags: ['#Tech','#Innovation','#Future'], tone: 'analytical' },
      people:   { label: 'People Stories',  hashtags: ['#People','#Biography','#Inspiring'], tone: 'narrative' },
      society:  { label: 'Society',         hashtags: ['#Society','#Trends','#Culture'], tone: 'observational' },
      science:  { label: 'Science',         hashtags: ['#Science','#Discovery','#Facts'], tone: 'educational' },
      business: { label: 'Business',        hashtags: ['#Business','#Money','#Strategy'], tone: 'analytical' },
      culture:  { label: 'Culture',         hashtags: ['#Culture','#Viral','#Entertainment'], tone: 'witty' },
      wildcard: { label: 'Featured',        hashtags: ['#Interesting','#MustWatch'], tone: 'engaging' },
    };
  }

  log(msg) { if (this.onLog) this.onLog(msg); else console.log('[VG]', msg); }

  getTodayCategory() {
    const day = new Date().getDay();
    return ['wildcard','tech','people','society','science','business','culture'][day] || 'tech';
  }

  resolveCategoryId(genre, internalCategory) {
    if (genre && this.categoryMap[genre]) return this.categoryMap[genre];
    if (internalCategory && this.internalCategoryMap[internalCategory]) return this.internalCategoryMap[internalCategory];
    return '24';
  }

  // === OpusClip 免费凭证 ===
  async getClipCredential() {
    const resp = await fetch(this.config.opusApiBase + '/auth/grant-free-tool-credential', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Origin': 'https://clip.opus.pro' },
    });
    const data = await resp.json();
    this.clipAuth = { token: data.data.token, orgId: data.data.orgId };
    return this.clipAuth;
  }

  async clipApiCall(method, endpoint, body) {
    if (!this.clipAuth) await this.getClipCredential();
    const opts = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + this.clipAuth.token,
        'X-OPUS-ORG-ID': this.clipAuth.orgId,
        'X-OPUS-USER-ID': this.clipAuth.orgId,
        'Origin': 'https://clip.opus.pro',
      },
    };
    if (body) opts.body = JSON.stringify(body);
    const resp = await fetch(this.config.opusApiBase + endpoint, opts);
    if (!resp.ok) throw new Error('API ' + resp.status + ': ' + endpoint);
    return resp.json();
  }

  // === opus.pro 登录态 Token ===
  async getOpusToken() {
    let token = localStorage.getItem('atom:user:access-token');
    if (token && token.startsWith('"')) token = token.slice(1);
    if (token && token.endsWith('"')) token = token.slice(0, -1);
    if (!token) throw new Error('opus.pro not logged in');
    let orgId = localStorage.getItem('atom:user:org-id');
    if (orgId && orgId.startsWith('"')) orgId = orgId.slice(1);
    if (orgId && orgId.endsWith('"')) orgId = orgId.slice(0, -1);
    let userId = localStorage.getItem('atom:user:org-user-id');
    if (userId && userId.startsWith('"')) userId = userId.slice(1);
    if (userId && userId.endsWith('"')) userId = userId.slice(0, -1);
    return { token, orgId, userId };
  }

  // === Story Mode API (primary path) ===
  async createStoryVideo(script, options = {}) {
    const auth = await this.getOpusToken();
    const body = {
      prompt: script,
      ratio: options.ratio || '16:9',
      customStyle: options.customStyle || false,
      styleText: options.styleText || this.storyStyles.economic,
      voiceId: options.voiceId || 'MM0375rv1dy8',
    };
    const resp = await fetch(this.config.opusApiBase + '/long-take-videos', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + auth.token,
        'X-OPUS-ORG-ID': auth.orgId,
        'X-OPUS-USER-ID': auth.userId,
        'Origin': 'https://agent.opus.pro',
        'Referer': 'https://agent.opus.pro/',
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error('Story Video API ' + resp.status);
    const data = await resp.json();
    const project = data.data || data;
    this.log('Story Video created: ' + project.id);
    return project;
  }

  // CDN URL pattern - fixed, no auth needed
  getStoryVideoUrl(projectId) {
    return 'https://s2v-ext.cdn.opus.pro/agent/workspace/' + projectId + '/final_video.mp4';
  }

  // Poll CDN URL until 200 - simplest and most reliable method
  async pollStoryVideo(projectId, onUpdate) {
    const cdnUrl = this.getStoryVideoUrl(projectId);
    const startTime = Date.now();
    const maxTime = this.config.maxPollTime;
    let pollCount = 0;
    while (Date.now() - startTime < maxTime) {
      pollCount++;
      try {
        const resp = await fetch(cdnUrl, { method: 'HEAD' });
        if (onUpdate) onUpdate({ poll: pollCount, status: resp.status, elapsed: Math.round((Date.now() - startTime) / 1000) });
        if (resp.ok) {
          this.log('Story Video ready! (' + pollCount + ' polls, ' + Math.round((Date.now() - startTime) / 1000) + 's)');
          return cdnUrl;
        }
      } catch (e) { /* network error, continue */ }
      await new Promise(r => setTimeout(r, this.config.pollInterval));
    }
    throw new Error('Story Video timeout');
  }

  // === Captions ===
  async addCaptions(videoUrl, aspectRatio, durationMs) {
    const source = await this.clipApiCall('POST', '/source-videos', { videoUrl });
    const duration = source.data?.durationMs || durationMs || 120000;
    const title = source.data?.title || 'video';
    const layout = aspectRatio === 'portrait' ? 'portrait' : aspectRatio === 'square' ? 'square' : 'landscape';
    const project = await this.clipApiCall('POST', '/clip-projects', {
      videoUrl,
      brandTemplateId: 'karaoke',
      importPref: { sourceLang: 'auto', targetLang: null },
      curationPref: { clipDurations: [], topicKeywords: [], skipSlicing: true },
      uploadedVideoAttr: { title, durationMs: duration },
      renderPref: { enableCaption: true, enableHighlight: true, enableEmoji: false, layoutAspectRatio: layout },
      productTier: 'FREE.CAPTIONS',
    });
    return { id: project.id || project.projectId, duration };
  }

  async pollCaptionProject(projectId) {
    const startTime = Date.now();
    while (Date.now() - startTime < 600000) { // 10 min max
      const data = await this.clipApiCall('GET', '/clip-projects/' + projectId);
      if (data.stage === 'COMPLETE') return data;
      if (data.error) throw new Error('Caption error: ' + data.error);
      await new Promise(r => setTimeout(r, 20000));
    }
    throw new Error('Caption project timeout');
  }

  async getExportUrl(projectId) {
    const data = await this.clipApiCall('GET', '/exportable-clips?projectId=' + projectId);
    const clip = data.data?.[0];
    if (!clip) throw new Error('No exportable clips');
    return { videoUrl: clip.uriForExport, thumbnailUrl: clip.uriForThumbnail, previewUrl: clip.uriForPreview };
  }

  // === Thumbnail ===
  async generateThumbnail(videoUrl) {
    const data = await this.clipApiCall('POST', '/generative-jobs', { jobType: 'thumbnail', sourceUri: videoUrl });
    return data.data.jobId;
  }

  // === YouTube Metadata (hashtag + title + description) ===
  async generateMetadata(description) {
    const jobs = {};
    const [h, t, d] = await Promise.all([
      this.clipApiCall('POST', '/generative-jobs', { jobType: 'youtube-hashtag', description }),
      this.clipApiCall('POST', '/generative-jobs', { jobType: 'youtube-title', text: description }),
      this.clipApiCall('POST', '/generative-jobs', { jobType: 'youtube-description', text: description }),
    ]);
    jobs.hashtagId = h.data.jobId;
    jobs.titleId = t.data.jobId;
    jobs.descriptionId = d.data.jobId;
    return jobs;
  }

  async pollGenerativeJob(jobId) {
    const startTime = Date.now();
    while (Date.now() - startTime < 120000) {
      const data = await this.clipApiCall('GET', '/generative-jobs/' + jobId);
      if (data.data?.progress?.status === 'CONCLUDED') return data.data.result;
      await new Promise(r => setTimeout(r, 5000));
    }
    throw new Error('Generative job timeout: ' + jobId);
  }

  async collectMetadata(jobIds) {
    const [hashResult, titleResult, descResult] = await Promise.all([
      this.pollGenerativeJob(jobIds.hashtagId),
      this.pollGenerativeJob(jobIds.titleId),
      this.pollGenerativeJob(jobIds.descriptionId),
    ]);
    return {
      hashtags: hashResult.hashtags || [],
      title: (titleResult.titles || [])[0] || 'Untitled',
      altTitles: titleResult.titles || [],
      description: (descResult.descriptions || [])[0] || '',
      altDescriptions: descResult.descriptions || [],
    };
  }

  // === viaSocket Webhook ===
  async uploadToYouTube(payload) {
    const resp = await fetch(this.config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return resp.json();
  }

  // === History ===
  recordHistory(entry) {
    try {
      const history = JSON.parse(localStorage.getItem('video_gen_history_v3') || '[]');
      history.push({ ...entry, timestamp: new Date().toISOString() });
      if (history.length > 100) history.splice(0, history.length - 100);
      localStorage.setItem('video_gen_history_v3', JSON.stringify(history));
    } catch (e) { console.error('History save failed:', e); }
  }

  // === Main Pipeline ===
  async run(topic, options = {}) {
    if (this.state.isRunning) throw new Error('Pipeline already running');
    this.state.isRunning = true;
    const log = (msg) => this.log(msg);
    if (options.onLog) this.onLog = options.onLog;
    const category = options.category || this.getTodayCategory();
    const aspectRatio = options.aspectRatio || 'landscape';
    const skipCaptions = options.skipCaptions || (aspectRatio === 'portrait');
    const skipThumbnail = options.skipThumbnail || false;
    const videoMode = options.videoMode || 'story';

    try {
      // == Step 1: OpusClip credentials ==
      log('Step 1: Getting OpusClip credentials...');
      await this.getClipCredential();
      log('Credentials OK');

      // == Step 2: Video generation ==
      let videoUrl = options.videoUrl;
      let durationMs = options.durationMs || 120000;

      if (!videoUrl) {
        if (videoMode === 'story') {
          log('Step 2: Story Mode - creating video...');
          const storyProject = await this.createStoryVideo(options.script || topic, {
            ratio: aspectRatio === 'portrait' ? '9:16' : aspectRatio === 'square' ? '1:1' : '16:9',
            styleText: options.styleText || this.storyStyles[options.style] || this.storyStyles.economic,
            voiceId: options.voiceId,
          });
          log('Project: ' + storyProject.id + ' | Polling CDN...');
          videoUrl = await this.pollStoryVideo(storyProject.id, (u) => {
            log('  Poll #' + u.poll + ': ' + (u.status === 200 ? 'Ready!' : u.status) + ' (' + u.elapsed + 's)');
          });
          log('Story Video done!');

        } else if (videoMode === 'agent') {
          log('Step 2: Agent Video - creating video...');
          const auth = await this.getOpusToken();
          const resp = await fetch(this.config.opusApiBase + '/project', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + auth.token, 'X-OPUS-ORG-ID': auth.orgId, 'X-OPUS-USER-ID': auth.userId },
            body: JSON.stringify({ initialText: options.script || topic, voice: { labels: ['English (US)','Female','Entertainment','Engaging'], name: 'Lily', provider: 'minimax', type: 'voice-over', voiceId: 'moss_audio_c12a59b9-7115-11f0-a447-9613c873494c' }, enableCaption: true }),
          });
          const project = await resp.json();
          log('Project: ' + (project.data || project).id);
          const pid = (project.data || project).id;
          const startTime = Date.now();
          while (Date.now() - startTime < this.config.maxPollTime) {
            const s = await fetch(this.config.opusApiBase + '/project/' + pid, { headers: { 'Authorization': 'Bearer ' + auth.token, 'X-OPUS-ORG-ID': auth.orgId, 'X-OPUS-USER-ID': auth.userId } }).then(r => r.json());
            const sd = s.data || s;
            log('  ' + sd.stage);
            if (sd.stage === 'EDITOR' && sd.resultVideo) { videoUrl = sd.resultVideo; break; }
            if (sd.stage === 'FAILED') throw new Error('Video failed');
            await new Promise(r => setTimeout(r, 30000));
          }
          if (!videoUrl) throw new Error('Video timeout');
          log('Agent Video done!');
        }
      }
      if (!videoUrl) throw new Error('No video URL');

      // == Step 3: Parallel - Captions + Thumbnail + Metadata ==
      log('Step 3: Launching parallel tasks...');
      const tasks = {};

      if (!skipCaptions) {
        log('  Creating captions project...');
        const cap = await this.addCaptions(videoUrl, aspectRatio, durationMs);
        tasks.captionProjectId = cap.id;
        log('  Captions: ' + cap.id);
      }
      if (!skipThumbnail) {
        log('  Generating thumbnail...');
        tasks.thumbnailJobId = await this.generateThumbnail(videoUrl);
        log('  Thumbnail: ' + tasks.thumbnailJobId);
      }
      log('  Generating YouTube metadata...');
      tasks.metadataJobs = await this.generateMetadata(topic);
      log('  Metadata jobs created');

      // == Step 4: Wait for all ==
      log('Step 4: Waiting for tasks...');
      const results = {};

      if (tasks.captionProjectId) {
        log('  Waiting for captions...');
        await this.pollCaptionProject(tasks.captionProjectId);
        const exp = await this.getExportUrl(tasks.captionProjectId);
        results.videoUrl = exp.videoUrl;
        log('  Captions done!');
      } else {
        results.videoUrl = videoUrl;
      }

      if (tasks.thumbnailJobId) {
        log('  Waiting for thumbnail...');
        const thumbResult = await this.pollGenerativeJob(tasks.thumbnailJobId);
        results.thumbnailUrl = (thumbResult.generatedThumbnailUris || [])[0] || '';
        log('  Thumbnail done!');
      }

      log('  Waiting for metadata...');
      const metadata = await this.collectMetadata(tasks.metadataJobs);
      log('  Metadata done: ' + metadata.title);

      // == Step 5: Upload to YouTube ==
      const categoryId = this.resolveCategoryId(null, category);
      log('Step 5: Uploading to YouTube...');
      const webhookPayload = {
        video_url: results.videoUrl,
        thumbnail_url: results.thumbnailUrl || '',
        youtube_title: metadata.title + ' ' + metadata.hashtags.slice(0, 3).map(h => '#' + h).join(' '),
        youtube_description: metadata.description + '\n\n' + metadata.hashtags.map(h => '#' + h).join(' '),
        playlist_id: options.playlistId || this.playlistMap[category] || this.playlistMap.wildcard,
        category_id: categoryId,
      };
      const uploadResult = await this.uploadToYouTube(webhookPayload);
      log('YouTube upload sent!');

      // == Step 6: Record history ==
      this.recordHistory({ topic, category, aspectRatio, videoMode, videoUrl: results.videoUrl, thumbnailUrl: results.thumbnailUrl, title: metadata.title, categoryId, status: 'uploaded' });

      log('Pipeline complete!');
      return { success: true, ...webhookPayload, uploadResult, metadata };

    } catch (e) {
      log('Error: ' + e.message);
      throw e;
    } finally {
      this.state.isRunning = false;
    }
  }

  // === Shortcut: process existing video ===
  async processExistingVideo(videoUrl, topic, options = {}) {
    return this.run(topic, { ...options, videoUrl, videoMode: 'skip' });
  }

  // === Shortcut: from idea (generate script first) ===
  async fromIdea(idea, options = {}) {
    this.log('Generating script from idea...');
    await this.getClipCredential();
    const job = await this.clipApiCall('POST', '/generative-jobs', {
      jobType: 'video-script', idea, platform: 'youtube',
      videoType: 'explainer', audience: 'general', tone: 'engaging', duration: '2 minutes',
    });
    const result = await this.pollGenerativeJob(job.data.jobId);
    const script = result.scriptContent || idea;
    this.log('Script generated (' + script.length + ' chars)');
    return this.run(idea.substring(0, 200), { ...options, script, videoMode: 'story' });
  }
}

// === UI Dialog ===
VideoGenerator.showTopicDialog = function(addLog) {
  if (document.getElementById('vg-dialog')) return;
  const overlay = document.createElement('div');
  overlay.id = 'vg-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:99998;';
  document.body.appendChild(overlay);

  const dialog = document.createElement('div');
  dialog.id = 'vg-dialog';
  dialog.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#1a1a2e;color:#eee;padding:24px;border-radius:12px;z-index:99999;width:480px;max-height:80vh;overflow-y:auto;font-family:sans-serif;';
  dialog.innerHTML = `
    <h3 style="margin:0 0 16px;color:#00d4aa;">Video Generator v3</h3>
    <div style="margin-bottom:12px;">
      <label style="font-size:13px;color:#aaa;">Mode</label><br>
      <select id="vg-mode" style="width:100%;padding:8px;background:#16213e;color:#eee;border:1px solid #333;border-radius:6px;">
        <option value="story">Story Mode (recommended)</option>
        <option value="process">Process Existing Video</option>
        <option value="idea">From Idea (auto-script)</option>
        <option value="agent">Agent Video (legacy)</option>
      </select>
    </div>
    <div style="margin-bottom:12px;">
      <label style="font-size:13px;color:#aaa;">Category</label><br>
      <select id="vg-category" style="width:100%;padding:8px;background:#16213e;color:#eee;border:1px solid #333;border-radius:6px;">
        <option value="tech">Tech Trends</option><option value="people">People Stories</option>
        <option value="society">Society</option><option value="science">Science</option>
        <option value="business">Business</option><option value="culture">Culture</option>
        <option value="wildcard">Featured</option>
      </select>
    </div>
    <div style="margin-bottom:12px;">
      <label style="font-size:13px;color:#aaa;">Aspect Ratio</label><br>
      <select id="vg-ratio" style="width:100%;padding:8px;background:#16213e;color:#eee;border:1px solid #333;border-radius:6px;">
        <option value="landscape">16:9 Landscape</option>
        <option value="portrait">9:16 Portrait (Shorts)</option>
        <option value="square">1:1 Square</option>
      </select>
    </div>
    <div style="margin-bottom:12px;">
      <label style="font-size:13px;color:#aaa;">Style</label><br>
      <select id="vg-style" style="width:100%;padding:8px;background:#16213e;color:#eee;border:1px solid #333;border-radius:6px;">
        <option value="economic">Economic</option><option value="claymation">Claymation</option>
        <option value="watercolor">Watercolor</option><option value="halftone">Halftone</option>
        <option value="collage">Collage</option><option value="penink">Pen & Ink</option>
        <option value="schematic">Schematic</option><option value="line2d">2D Line</option>
        <option value="animation">Animation</option>
      </select>
    </div>
    <div style="margin-bottom:12px;">
      <label style="font-size:13px;color:#aaa;">Topic / Script</label><br>
      <textarea id="vg-topic" rows="4" style="width:100%;padding:8px;background:#16213e;color:#eee;border:1px solid #333;border-radius:6px;resize:vertical;" placeholder="Enter topic, idea, or full script..."></textarea>
    </div>
    <div id="vg-url-row" style="margin-bottom:12px;display:none;">
      <label style="font-size:13px;color:#aaa;">Video URL</label><br>
      <input id="vg-video-url" type="text" style="width:100%;padding:8px;background:#16213e;color:#eee;border:1px solid #333;border-radius:6px;" placeholder="https://...">
    </div>
    <div id="vg-log" style="background:#0d1117;padding:8px;border-radius:6px;font-size:12px;max-height:150px;overflow-y:auto;margin-bottom:12px;display:none;"></div>
    <div style="display:flex;gap:8px;">
      <button id="vg-start-btn" style="flex:1;padding:10px;background:#00d4aa;color:#000;border:none;border-radius:6px;cursor:pointer;font-weight:bold;">Start</button>
      <button id="vg-close-btn" style="padding:10px 16px;background:#333;color:#eee;border:none;border-radius:6px;cursor:pointer;">Close</button>
    </div>
  `;
  document.body.appendChild(dialog);

  const modeSelect = dialog.querySelector('#vg-mode');
  const urlRow = dialog.querySelector('#vg-url-row');
  modeSelect.onchange = () => { urlRow.style.display = modeSelect.value === 'process' ? 'block' : 'none'; };

  dialog.querySelector('#vg-close-btn').onclick = () => { overlay.remove(); dialog.remove(); };
  overlay.onclick = () => { overlay.remove(); dialog.remove(); };

  dialog.querySelector('#vg-start-btn').onclick = async () => {
    const mode = modeSelect.value;
    const topic = dialog.querySelector('#vg-topic').value.trim();
    const videoUrl = dialog.querySelector('#vg-video-url').value.trim();
    const category = dialog.querySelector('#vg-category').value;
    const ratio = dialog.querySelector('#vg-ratio').value;
    const style = dialog.querySelector('#vg-style').value;

    if (!topic && mode !== 'process') { alert('Please enter a topic'); return; }
    if (mode === 'process' && !videoUrl) { alert('Please enter a video URL'); return; }

    const logDiv = dialog.querySelector('#vg-log');
    logDiv.style.display = 'block';
    const logMsg = (msg) => {
      logDiv.innerHTML += '<div>' + msg + '</div>';
      logDiv.scrollTop = logDiv.scrollHeight;
      if (addLog) addLog(msg, 'info');
    };

    dialog.querySelector('#vg-start-btn').disabled = true;
    const vg = new VideoGenerator();
    vg.onLog = logMsg;

    try {
      let result;
      if (mode === 'process') {
        result = await vg.processExistingVideo(videoUrl, topic, { category, aspectRatio: ratio, style });
      } else if (mode === 'idea') {
        result = await vg.fromIdea(topic, { category, aspectRatio: ratio, style });
      } else {
        result = await vg.run(topic, { category, aspectRatio: ratio, style, videoMode: mode, script: topic });
      }
      logMsg('Done! ' + JSON.stringify(result.uploadResult || {}).substring(0, 100));
    } catch (e) {
      logMsg('Error: ' + e.message);
    }
    dialog.querySelector('#vg-start-btn').disabled = false;
  };
};

window.VideoGenerator = VideoGenerator;
