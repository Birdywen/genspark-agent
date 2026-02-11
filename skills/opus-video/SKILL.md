---
name: opus-video
description: AI 视频全自动生产线 - opus.pro 视频生成 + OpusClip 字幕/缩略图/元数据 + viaSocket → YouTube，全程零成本
---

# Video Generator v3 - 全自动 YouTube 视频生产线

## 架构概览

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                    VideoGenerator v3 流水线                                  │
│                                                                              │
│  idea ──→ video-script ──→ Story Video ──→ 字幕+缩略图+元数据 ──→ YouTube   │
│                                    (并行处理)                                │
└──────────────────────────────────────────────────────────────────────────────┘

详细流程:

  ① OpusClip guest token (免费, 7天有效)
       POST /auth/grant-free-tool-credential
                    ↓
  ② opus.pro Story Video 生成 (或 Agent Video)
       POST /long-take-videos  →  CDN HEAD 轮询等 200
                    ↓
  ③ 并行启动三组任务:
       ├── 字幕: source-videos → clip-projects → 轮询 → exportable-clips → compress
       ├── 缩略图: generative-jobs {jobType: thumbnail}
       └── 元数据: generative-jobs × 3 (title + description + hashtag)
                    ↓
  ④ viaSocket webhook → YouTube
       Upload Video → Update Thumbnail → Add to Playlist
```

**零成本**: 无服务器、无 API 费用、无 Oracle/ffmpeg/Whisper 依赖。

## 三种运行模式

| 模式 | 入口方法 | 说明 |
|------|----------|------|
| **Story** (推荐) | `run(topic, {videoMode:'story', script})` | 你写 transcript → opus.pro 配画面 → 全流程 |
| **Idea** | `fromIdea(idea)` | 从一个 idea 自动生成 script → 再走 Story 流程 |
| **Process** | `processExistingVideo(url, topic)` | 已有视频 URL → 只走字幕+缩略图+元数据+上传 |
| **Agent** (legacy) | `run(topic, {videoMode:'agent'})` | opus.pro Agent Video，仅 9:16，自带字幕 |

## 前置条件

1. 浏览器已登录 `https://agent.opus.pro/`（Story/Agent 模式需要 opus.pro token）
2. Chrome 扩展已加载 video-generator.js
3. 无需其他服务器或 API key

## 核心 API 端点

### opus.pro - 视频生成

| 端点 | 用途 |
|------|------|
| `POST /long-take-videos` | Story Video 创建（transcript + 画面风格） |
| `HEAD s2v-ext.cdn.opus.pro/agent/workspace/{id}/final_video.mp4` | CDN 轮询，200=完成 |
| `POST /project` | Agent Video 创建（legacy） |

### OpusClip - 字幕 & 后处理

| 端点 | 用途 |
|------|------|
| `POST /auth/grant-free-tool-credential` | 获取 guest token（无需登录，7天有效） |
| `GET /fancy-template-presets` | 22 种字幕样式列表 |
| `POST /source-videos` | 视频预检（语言检测、时长） |
| `POST /clip-projects` | 创建字幕项目 |
| `GET /clip-projects/{id}` | 轮询项目状态（stage=COMPLETE） |
| `GET /exportable-clips?projectId={id}` | 获取高清无水印视频 URL |

### OpusClip - AI 生成服务 (generative-jobs)

| jobType | 输入参数 | 输出 |
|---------|----------|------|
| `thumbnail` | `{sourceUri}` | 2张 1280×720 PNG |
| `video-script` | `{idea, platform, videoType, audience, tone, duration}` | Markdown 脚本 |
| `youtube-title` | `{text}` | 5 个标题候选 |
| `youtube-description` | `{text}` | 3 个描述候选 |
| `youtube-hashtag` | `{description}` | 20 个 hashtag |
| `compress` | `{sourceUri}` | 压缩后视频 URL |
| `ai-video-summarizer` | `{sourceUri}` | 视频摘要（待测试） |
| `transcript` | `{sourceUri}` | 转录文本（待测试） |

所有 generative-jobs 通过 `POST /generative-jobs` 创建，`GET /generative-jobs/{jobId}` 轮询，`status=CONCLUDED` 表示完成。

### viaSocket - YouTube 上传

| 端点 | Webhook payload |
|------|----------------|
| `POST https://flow.sokt.io/func/scri42hM0QuZ` | `{video_url, thumbnail_url, youtube_title, youtube_description, playlist_id, category_id}` |

Workflow 三步: Upload Video → Update Thumbnail → Add to Playlist

## 通用认证 Headers

```
Authorization: Bearer <token>
X-OPUS-ORG-ID: <orgId>
X-OPUS-USER-ID: <userId>
Content-Type: application/json
Origin: https://clip.opus.pro
Referer: https://clip.opus.pro/captions
```

Token 通过 `grant-free-tool-credential` 获取，无需登录，每次生成新 guest 身份。

## 字幕配置

### 输出比例

| layoutAspectRatio | 分辨率 | 场景 |
|-------------------|--------|------|
| `landscape` | 16:9 | YouTube 常规视频 |
| `portrait` | 9:16 | YouTube Shorts |
| `square` | 1:1 | Instagram |
| `four_five` | 4:5 | Facebook |

### 字幕样式 (22种)

Karaoke, Gameplay, Beasty (MrBeast), Deep Diver, Youshaei, Pod P, Mozi, Netflix, Hormozi, AJ, Boldy, Minimal, Poppy, Sleek, Ali A, Spotlight, Wired, Baseline, Iman, TedX, Beast, The Standard

通过 `brandTemplateId: "preset-fancy-{Name}"` 指定。

### 必须参数

```json
{
  "videoUrl": "https://...",
  "brandTemplateId": "preset-fancy-Karaoke",
  "productTier": "FREE.CAPTIONS",
  "curationPref": { "skipSlicing": true },
  "renderPref": {
    "layoutAspectRatio": "landscape",
    "enableCaption": true,
    "enableHighlight": true
  }
}
```

## 分类与 Playlist 映射

| 内部分类 | YouTube categoryId | Playlist ID |
|----------|-------------------|-------------|
| tech | 28 (Science & Tech) | PLYtnUtZt0ZnFNjguN43KAb3aYFwCMTYZW |
| people | 22 (People & Blogs) | PLYtnUtZt0ZnGnjjJ3L60TIK7kBT93yRo3 |
| society | 24 (Entertainment) | PLYtnUtZt0ZnFssUY9G1cLpXO-D6JKPHH5 |
| science | 27 (Education) | PLYtnUtZt0ZnFn-PNqSLN-_wPkIFGGCSlw |
| business | 24 (Entertainment) | PLYtnUtZt0ZnE0_9LXZTFOlgFxFB-oh8sK |
| culture | 24 (Entertainment) | PLYtnUtZt0ZnHIwG9vhWqSr6t1vGRr0AQR |
| wildcard | 24 (Entertainment) | PLYtnUtZt0ZnF-oneo7UEDTO_OGJQ12ovZ |

每天自动轮换分类 (周日=wildcard, 周一=tech, ...)。

## 视觉风格预设 (Story Mode)

9 种风格: economic (默认), claymation, watercolor, halftone, collage, penink, schematic, line2d, animation。

通过 `options.style` 或 `options.styleText` 自定义。

## UI 入口

在 opus.pro 页面通过扩展面板触发 `VideoGenerator.showTopicDialog()`，弹出对话框选择模式、分类、比例、样式，输入 topic/script 后一键启动。实时日志显示在对话框底部。

## 文件结构

```
extension/
  video-generator.js    (707行) VideoGenerator class + UI dialog
  content.js            (3653行) 扩展主体，加载 video-generator.js
skills/opus-video/
  SKILL.md              本文档
  CAPTIONS_API.md       OpusClip Captions API 详细文档
```

## 端到端流程示例

### 从 idea 到 YouTube（全自动）

```javascript
const vg = new VideoGenerator();
const result = await vg.fromIdea('How quantum computing will change cryptography', {
  category: 'tech',
  aspectRatio: 'landscape',
  style: 'economic',
});
// result: { success, video_url, thumbnail_url, youtube_title, youtube_description, playlist_id, ... }
```

执行过程:
1. `getClipCredential()` → guest token
2. `generative-jobs {jobType: video-script}` → 生成 2 分钟脚本
3. `long-take-videos` → opus.pro 生成 Story Video → CDN 轮询
4. 并行: `addCaptions()` + `generateThumbnail()` + `generateMetadata()`
5. `pollCaptionProject()` → `getExportUrl()` → `compressVideo()`
6. `uploadToYouTube()` → viaSocket webhook
7. YouTube: Upload → Thumbnail → Playlist，约 4 分钟完成

### 处理已有视频

```javascript
const vg = new VideoGenerator();
const result = await vg.processExistingVideo(
  'https://cdn.opus.pro/.../final_video.mp4',
  'Quantum cryptography explained',
  { category: 'science', aspectRatio: 'landscape' }
);
```

### 通过 UI 对话框

在 opus.pro 页面，扩展面板点击按钮 → 弹出 Video Generator v3 对话框 → 选择模式/分类/比例/样式 → 输入 topic → Start。

## 实战操作指南（Agent 手动执行）

### 重要经验

1. **Story Video credit 有限，12小时刷新**：绝对不要用测试内容创建项目，确认脚本和所有参数无误后再调用 `POST /long-take-videos`。每次创建都消耗 credit。
2. **opus.pro token 极短命（5分钟）**：只有 `POST /long-take-videos` 创建视频那一瞬间需要。创建成功拿到 projectId 后，后续所有操作都不需要这个 token。
3. **只有 Step 1 必须在 opus.pro tab 执行**（读 localStorage token）。Step 2-6 全部可以用 curl 或任意 tab 的 eval_js，不依赖浏览器页面。
4. **CDN 轮询不需要任何认证**：`HEAD https://s2v-ext.cdn.opus.pro/agent/workspace/{id}/final_video.mp4` 纯公开 URL，404=生成中，200=完成。
5. **OpusClip guest token（7天有效）** 用于字幕、缩略图、元数据等后续步骤，与 opus.pro 登录态完全独立。
6. **任意 guest token 可查任意任务**：token 丢了（如 tab 关闭）重新 `grant-free-tool-credential` 获取一个新的即可继续查询所有 job。
7. **async_task 的 code 里不能用 await**，必须用 `.then()` Promise 链返回结果。
8. **generative-jobs 的压缩 jobType 是 `video-compression`**，不是 `compress`。

### Step 1: 在 opus.pro tab 创建 Story Video

必须在 opus.pro 的 tab 上用 eval_js 执行（需要该域的 localStorage token）：

```
Ω{"tool":"eval_js","params":{"code":"return (async () => { var token = localStorage.getItem('atom:user:access-token').replace(/^\"|\"$/g, ''); var orgId = localStorage.getItem('atom:user:org-id').replace(/^\"|\"$/g, ''); var userId = localStorage.getItem('atom:user:org-user-id').replace(/^\"|\"$/g, ''); var resp = await fetch('https://api.opus.pro/api/long-take-videos', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, 'X-OPUS-ORG-ID': orgId, 'X-OPUS-USER-ID': userId, 'Origin': 'https://agent.opus.pro', 'Referer': 'https://agent.opus.pro/' }, body: JSON.stringify({ prompt: SCRIPT_TEXT, ratio: '16:9', customStyle: false, styleText: 'STYLE_TEXT', voiceId: 'MM0375rv1dy8' }) }); var text = await resp.text(); return { status: resp.status, body: text.substring(0, 500) }; })();","tabId":OPUS_TAB_ID}}ΩSTOP
```

**返回格式**: `{"projectId":"02101512-8up","workflowId":"long-take:02101512-8up","videoId":"02101512-8up"}`
注意：字段是 `projectId`，不是 `data.id`。

### Step 2: async_task 轮询 CDN 等 200

创建成功后立即启动后台轮询，不需要任何 token：

```
Ω{"tool":"async_task","params":{"code":"return fetch('https://s2v-ext.cdn.opus.pro/agent/workspace/PROJECT_ID/final_video.mp4', {method:'HEAD'}).then(function(r) { return {status: r.status, ready: r.status === 200}; });","condition":"result.ready === true","interval":30000,"timeout":1800000,"tabId":ANY_TAB_ID,"label":"轮询 Story Video PROJECT_ID"}}ΩSTOP
```

**注意**: 不能用 await，用 `.then()`。一般 10-20 分钟完成。tabId 可以是任意 tab（CDN 无 CORS 限制）。

### Step 3: 获取 guest token

视频完成后，后续全部用 curl 操作，不需要浏览器：

```bash
curl -s -X POST 'https://api.opus.pro/api/auth/grant-free-tool-credential' \
  -H 'Content-Type: application/json' -H 'Origin: https://clip.opus.pro' | jq .
```

返回 `{data: {token, orgId, userId}}`。后续所有请求带以下 headers：
```
Authorization: Bearer TOKEN
X-OPUS-ORG-ID: ORGID
X-OPUS-USER-ID: ORGID
Origin: https://clip.opus.pro
```

### Step 4: 并行启动字幕 + 缩略图 + 元数据

**4a. 视频预检 + 创建字幕项目：**
```bash
# 预检（获取 durationMs）
curl -s -X POST 'https://api.opus.pro/api/source-videos' \
  -H 'Authorization: Bearer TOKEN' -H 'X-OPUS-ORG-ID: ORGID' -H 'X-OPUS-USER-ID: ORGID' \
  -H 'Content-Type: application/json' -H 'Origin: https://clip.opus.pro' \
  -d '{"videoUrl":"VIDEO_URL"}' | jq '{durationMs: .data.durationMs}'

# 创建字幕项目
curl -s -X POST 'https://api.opus.pro/api/clip-projects' \
  -H 'Authorization: Bearer TOKEN' -H 'X-OPUS-ORG-ID: ORGID' -H 'X-OPUS-USER-ID: ORGID' \
  -H 'Content-Type: application/json' -H 'Origin: https://clip.opus.pro' \
  -d '{"videoUrl":"VIDEO_URL","brandTemplateId":"karaoke","importPref":{"sourceLang":"auto","targetLang":null},"curationPref":{"clipDurations":[],"topicKeywords":[],"skipSlicing":true},"uploadedVideoAttr":{"title":"video","durationMs":DURATION},"renderPref":{"enableCaption":true,"enableHighlight":true,"enableEmoji":false,"layoutAspectRatio":"landscape"},"productTier":"FREE.CAPTIONS"}'
```
返回 `{id: "PROJECT_ID"}` 或 `{projectId: "PROJECT_ID"}`。

**4b. 启动缩略图 + 元数据（可与字幕同时启动）：**
```bash
# 缩略图
curl -s -X POST 'https://api.opus.pro/api/generative-jobs' \
  -H 'Authorization: Bearer TOKEN' ... \
  -d '{"jobType":"thumbnail","sourceUri":"VIDEO_URL"}'

# YouTube hashtag
curl -s -X POST 'https://api.opus.pro/api/generative-jobs' ... \
  -d '{"jobType":"youtube-hashtag","description":"TOPIC"}'

# YouTube title
curl -s -X POST 'https://api.opus.pro/api/generative-jobs' ... \
  -d '{"jobType":"youtube-title","text":"TOPIC"}'

# YouTube description
curl -s -X POST 'https://api.opus.pro/api/generative-jobs' ... \
  -d '{"jobType":"youtube-description","text":"TOPIC"}'
```
每个返回 `{data: {jobId: "..."}}`。

### Step 5: 轮询等待完成

**字幕项目**：`GET /clip-projects/{id}`，等 `stage === 'COMPLETE'`（2-5分钟）
**generative-jobs**：`GET /generative-jobs/{jobId}`，等 `data.progress.status === 'CONCLUDED'`（~30秒）

推荐用 async_task 并行轮询：
```
Ω{"tool":"async_task","params":{"code":"var headers = {Authorization:'Bearer TOKEN','X-OPUS-ORG-ID':'ORGID','X-OPUS-USER-ID':'ORGID',Origin:'https://clip.opus.pro'}; return Promise.all([fetch('https://api.opus.pro/api/clip-projects/CAPTION_ID',{headers:headers}).then(function(r){return r.json()}), fetch('https://api.opus.pro/api/generative-jobs/THUMB_JOB_ID',{headers:headers}).then(function(r){return r.json()})]).then(function(res){ return {captionStage:res[0].stage, thumbStatus:res[1].data&&res[1].data.progress&&res[1].data.progress.status, thumbUrls:res[1].data&&res[1].data.result&&res[1].data.result.generatedThumbnailUris, allDone:res[0].stage==='COMPLETE'&&res[1].data&&res[1].data.progress&&res[1].data.progress.status==='CONCLUDED'}; });","condition":"result.allDone === true","interval":15000,"timeout":600000,"label":"等待字幕+缩略图"}}ΩSTOP
```

元数据（title/desc/hashtag）通常 30 秒内完成，可先用 curl 单独查：
```bash
curl -s 'https://api.opus.pro/api/generative-jobs/JOB_ID' -H 'Authorization: Bearer TOKEN' ... | jq '.data.result'
```

**字幕完成后获取高清视频 URL：**
```bash
curl -s 'https://api.opus.pro/api/exportable-clips?projectId=CAPTION_ID' \
  -H 'Authorization: Bearer TOKEN' ... | jq '.data[0] | {video: .uriForExport, thumbnail: .uriForThumbnail}'
```
返回字段：`uriForExport`（高清）、`uriForPreview`（预览）、`uriForThumbnail`（缩略图）。

**压缩带字幕的视频：**
```bash
curl -s -X POST 'https://api.opus.pro/api/generative-jobs' ... \
  -d '{"jobType":"video-compression","sourceUri":"EXPORT_VIDEO_URL"}'
```
注意 jobType 是 `video-compression`，不是 `compress`。轮询同上，完成后取 `result.compressedVideoUri`。

### Step 6: viaSocket webhook 上传 YouTube

```bash
curl -s -X POST 'https://flow.sokt.io/func/scri42hM0QuZ' \
  -H 'Content-Type: application/json' \
  -d '{
    "video_url": "压缩后的视频URL",
    "thumbnail_url": "AI生成的缩略图URL",
    "youtube_title": "标题 #Hashtag1 #Hashtag2 #Hashtag3",
    "youtube_description": "描述文本\n\n#Hashtag1 #Hashtag2 ...",
    "playlist_id": "PLYtnUtZt0Zn...",
    "category_id": "28"
  }'
```

返回 `{data: {success: true}, message: "Flow Queued"}`。YouTube 上传约 1-3 分钟完成。

## 已淘汰

以下旧流程已被 v3 完全替代，不再使用:

- Oracle Cloud ffmpeg + Whisper 转录字幕
- cPanel 视频托管 (ezmusicstore.com/videos/)
- Genspark AI 生成 thumbnail
- AI Drive 取回 thumbnail
- 硬编码 metadata
- scp 文件传输

## 参考文档

- OpusClip Captions API 详细文档: `skills/opus-video/CAPTIONS_API.md`
- SQLite changelog/conventions: `.agent_memory/project_knowledge.db`
