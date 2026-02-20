---
name: opus-video
description: AI 视频全自动生产线 - opus.pro 视频生成 + OpusClip 字幕/元数据 + Genspark 高质量缩略图 + viaSocket → YouTube，全程零成本
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
       ├── 缩略图: Genspark 图片模型 (eval_js SSE) → 轮询 → 同源 fetch → cPanel 公开托管
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
2. 浏览器已打开任意 Genspark 页面（缩略图生成需要登录态，Agent 主 tab 即可）
3. Chrome 扩展已加载 video-generator.js
4. cPanel 已部署 `upload.php` 端点 (`~/public_html/thumbnails/upload.php`)，用于缩略图公开托管
5. 无需其他服务器或 API key

## 核心 API 端点

### opus.pro - 视频生成

| 端点 | 用途 |
|------|------|
| `POST /long-take-videos` | Story Video 创建（transcript + 画面风格） |
| `HEAD s2v-ext.cdn.opus.pro/agent/workspace/{id}/final_video.mp4` | CDN 轮询，200=完成 |
| `POST /project` | Agent Video 创建（legacy） |

### Genspark - 高质量缩略图生成

| 端点 | 用途 |
|------|------|
| `POST /api/agent/ask_proxy` | 提交图片生成请求（SSE 流式响应，返回 task_id） |
| `GET /api/spark/image_generation_task_detail?task_id=xxx` | 轮询任务状态，等 status=SUCCESS |
| `GET /api/files/s/{IMAGE_ID}?cache_control=3600` | 下载无水印图片（需同源 cookie） |
| `POST ezmusicstore.com/thumbnails/upload.php` | 上传到 cPanel 获取公开 URL |

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
| `thumbnail` | `{sourceUri}` | 2张 1280×720 PNG（**备选，质量较低，已被 Genspark 替代**） |
| `video-script` | `{idea, platform, videoType, audience, tone, duration}` | Markdown 脚本 |
| `youtube-title` | `{text}` | 5 个标题候选 |
| `youtube-description` | `{text}` | 3 个描述候选 |
| `youtube-hashtag` | `{description}` | 20 个 hashtag |
| `video-compression` | `{sourceUri}` | 压缩后视频 URL |
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

## Genspark 缩略图

### 概述

Genspark 图片模型 (nano-banana-pro) 生成的缩略图质量远高于 OpusClip `generative-jobs {jobType: thumbnail}`。支持自定义 prompt 精确控制构图，输出无水印 1376×768 JPEG。

### 流程（3 步）

1. **eval_js 提交 prompt**：在任意 Genspark tab 调 `POST /api/agent/ask_proxy`（SSE 流），拿 task_id
2. **async_task 轮询**：`GET /api/spark/image_generation_task_detail`，等 `status=SUCCESS`，拿 `image_urls_nowatermark`
3. **eval_js 下载+上传 cPanel**：同源 fetch 图片 arrayBuffer → POST 到 `ezmusicstore.com/thumbnails/upload.php` → 拿到公开 URL

### ask_proxy 关键参数

| 参数 | 值 | 说明 |
|------|-------|------|
| `model_params.model` | `nano-banana-pro` | 图片生成模型 |
| `model_params.aspect_ratio` | `16:9` | 宽高比 |
| `model_params.auto_prompt` | `true` | 自动优化 prompt |
| `model_params.background_mode` | `true` | 背景模式 |
| `type` | `image_generation_agent` | 任务类型 |
| `project_id` | `7e6cbd20-270d-43aa-afe0-331d1c6d7f52` | 图片生成 Agent ID |

### YouTube 缩略图制作流程（推荐）

直接在 Genspark prompt 中要求生成带文字的完整缩略图，**不需要 ImageMagick 后期叠加**。nano-banana-pro 模型可以直接渲染清晰的英文文字。在 prompt 中明确指定文字内容、颜色、位置、大小即可。

### Prompt 模板（直接生成带文字的完整缩略图）

在 prompt 中同时描述场景和文字，一步到位生成完整缩略图。[文字指令] 示例：`Large bold white text at top: TITLE LINE. Large bold red text below: SUBTITLE. Small yellow text at bottom: TAGLINE.`

| 分类 | Prompt 模板 |
|------|------------|
| tech | `YouTube thumbnail 1280x720 with bold text. Futuristic tech style: [场景描述]. [文字指令]. Neon blue and cyan accents, dark background, circuit board elements. Ultra sharp, cinematic.` |
| business | `YouTube thumbnail 1280x720 with bold text. Professional business style: [场景描述]. [文字指令]. Corporate aesthetics, dramatic lighting, gold and navy accents. Ultra high quality.` |
| science | `YouTube thumbnail 1280x720 with bold text. Scientific documentary style: [场景描述]. [文字指令]. Deep space blue, laboratory aesthetics, data visualization elements. Cinematic.` |
| people | `YouTube thumbnail 1280x720 with bold text. Editorial portrait style: [场景描述]. [文字指令]. Dramatic side lighting, bokeh background, warm tones. Magazine quality.` |
| society | `YouTube thumbnail 1280x720 with bold text. Journalistic documentary style: [场景描述]. [文字指令]. Urban settings, natural lighting, gritty realism. High contrast.` |
| culture | `YouTube thumbnail 1280x720 with bold text. Artistic cultural style: [场景描述]. [文字指令]. Rich colors, artistic composition, museum-quality aesthetics. Painterly lighting.` |

### 图片输出规格

| 属性 | 值 |
|------|----|  
| 分辨率 | 1376 × 768 (接近 16:9) |
| 格式 | JPEG |
| 文件大小 | 通常 500KB - 800KB |
| 速度 | 10-30 秒 |

### 注意事项

1. **Genspark 图片 API 需要登录态** — `/api/files/s/` 端点需要 cookie 认证，只能通过 eval_js 在同源页面内 fetch，不能用 curl
2. **async_task 的 code 里不能用 await**，必须用 `.then()` Promise 链
3. **每次生成可能产出 1-2 张图** — 选最合适的一张上传
4. **IMAGE_ID 从 URL 提取** — `image_urls_nowatermark` 格式为 `/api/files/s/{IMAGE_ID}?cache_control=3600`

详细 API 文档见: `skills/opus-video/THUMBNAIL_GENSPARK.md`

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
  THUMBNAIL_GENSPARK.md Genspark 缩略图 API 详细文档
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
4. 并行: `addCaptions()` + `generateThumbnail()` (Genspark API → cPanel) + `generateMetadata()`
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

## 实战操作指南（Agent 手动执行 — 并行优化版）

### 核心原则

1. **最大并行化**：缩略图和元数据不依赖视频，在 Step 1 创建视频后立即与 CDN 轮询并行启动
2. **guest token 用完即弃**：每次使用前重新获取，用 bash 子命令一步到位
3. **eval_js fire-and-forget**：ask_proxy SSE 流超过 10 秒，发请求存 window 变量立即 return，再用 async_task 轮询结果
4. **task_detail 返回在 data 层**：轮询条件是 `d.data.status === 'SUCCESS'`
5. **cPanel upload 必须带参数**：`?key=ag3nt2026&name=文件名.jpg`，POST raw body
6. **缩略图比例匹配视频**：9:16 视频生成 9:16 缩略图，16:9 视频生成 16:9 缩略图

### 重要经验

1. **Story Video credit 有限，12小时刷新**：绝对不要用测试内容创建项目，确认脚本和所有参数无误后再调用 `POST /long-take-videos`。每次创建都消耗 credit。
2. **opus.pro token 比预期长命**：只要 opus.pro 页面保持打开（不关闭、不登出），localStorage 里的 token 会自动刷新。只有关掉页面或清 cookie 后才需要重新登录。
3. **只有 Step 1 必须在 opus.pro tab 执行**（读 localStorage token）。其余全部可以用 curl 或任意 tab 的 eval_js。
4. **CDN 轮询不需要任何认证**：`HEAD https://s2v-ext.cdn.opus.pro/agent/workspace/{id}/final_video.mp4` 纯公开 URL，404=生成中，200=完成。
5. **async_task 的 code 里不能用 await**，必须用 `.then()` Promise 链返回结果。
6. **generative-jobs 的压缩 jobType 是 `video-compression`**，不是 `compress`。
7. **eval_js 超时 ≠ 请求未发出**：遇到超时**绝对不要直接重试**，先检查是否已创建成功。
8. **YouTube title 控制在 60-70 字符以内**，hashtag 不放 title 只放 description。
9. **OpusClip guest token 实际有效期很短**，每次使用前都重新获取，不要缓存复用。

### Step 1: 在 opus.pro tab 创建 Story Video

必须在 opus.pro 的 tab 上用 eval_js 执行（需要该域的 localStorage token）：

```
Ω{"tool":"eval_js","params":{"code":"return (async () => { var token = localStorage.getItem('atom:user:access-token').replace(/^\\\"|\\\"$/g, ''); var orgId = localStorage.getItem('atom:user:org-id').replace(/^\\\"|\\\"$/g, ''); var userId = localStorage.getItem('atom:user:org-user-id').replace(/^\\\"|\\\"$/g, ''); var resp = await fetch('https://api.opus.pro/api/long-take-videos', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, 'X-OPUS-ORG-ID': orgId, 'X-OPUS-USER-ID': userId, 'Origin': 'https://agent.opus.pro', 'Referer': 'https://agent.opus.pro/' }, body: JSON.stringify({ prompt: SCRIPT_TEXT, ratio: '9:16', customStyle: false, styleText: 'STYLE_TEXT', voiceId: 'MM0375rv1dy8' }) }); var text = await resp.text(); return { status: resp.status, body: text.substring(0, 500) }; })();","tabId":OPUS_TAB_ID}}ΩSTOP
```

**返回格式**: `{"projectId":"02101512-8up","workflowId":"long-take:02101512-8up","videoId":"02101512-8up"}`

### Step 2: 三路并行启动（CDN 轮询 + 缩略图 + 元数据）

创建成功后**立即同时启动**以下三组任务，不需要等视频完成：

**2a. CDN 轮询（async_task）：**
```
Ω{"tool":"async_task","params":{"code":"return fetch('https://s2v-ext.cdn.opus.pro/agent/workspace/PROJECT_ID/final_video.mp4',{method:'HEAD'}).then(function(r){return {status:r.status,ready:r.status===200};});","condition":"result.ready === true","interval":30000,"timeout":1800000,"tabId":ANY_TAB_ID,"label":"轮询 Story Video PROJECT_ID"}}ΩSTOP
```

**2b. 缩略图生成（eval_js fire-and-forget + async_task 轮询）：**

第一步：发送请求，存 window 变量，立即 return：
```
Ω{"tool":"eval_js","params":{"code":"window._tid=null; window._tdone=false; var mp={}; mp.model='nano-banana-pro'; mp.aspect_ratio='9:16'; mp.auto_prompt=true; mp.background_mode=true; var tp={}; tp.type='image_generation_agent'; tp.project_id='7e6cbd20-270d-43aa-afe0-331d1c6d7f52'; tp.model_params=mp; var msg='THUMBNAIL_PROMPT_HERE'; tp.messages=[{id:Date.now().toString(),role:'user',content:msg,created_at:new Date().toISOString()}]; fetch('/api/agent/ask_proxy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(tp)}).then(function(r){return r.text()}).then(function(t){var p=t.split('task_id'); if(p.length>1){var pat=new RegExp('([a-f0-9]+-[a-f0-9]+-[a-f0-9]+-[a-f0-9]+-[a-f0-9]+)'); var u=p[1].match(pat); if(u) window._tid=u[1];} window._tdone=true;}); return 'started';","tabId":GENSPARK_TAB_ID}}ΩSTOP
```

第二步：轮询 task_id：
```
Ω{"tool":"async_task","params":{"code":"return {taskId:window._tid,done:window._tdone};","condition":"result.taskId","interval":3000,"timeout":30000,"tabId":GENSPARK_TAB_ID,"label":"等待缩略图task_id"}}ΩSTOP
```

第三步：拿到 task_id 后轮询图片生成状态（注意 `d.data.status`）：
```
Ω{"tool":"async_task","params":{"code":"return fetch('/api/spark/image_generation_task_detail?task_id=TASK_ID').then(function(r){return r.json()}).then(function(d){return {status:d.data.status, urls:d.data.image_urls_nowatermark};});","condition":"result.status === 'SUCCESS'","interval":5000,"timeout":120000,"tabId":GENSPARK_TAB_ID,"label":"缩略图轮询"}}ΩSTOP
```

第四步：下载 + 上传 cPanel（注意带 key 和 name 参数）：
```
Ω{"tool":"eval_js","params":{"code":"return fetch('/api/files/s/IMAGE_ID?cache_control=3600').then(function(r){return r.arrayBuffer();}).then(function(buf){return fetch('https://ezmusicstore.com/thumbnails/upload.php?key=ag3nt2026&name=FILENAME.jpg',{method:'POST',body:buf});}).then(function(r){return r.json();});","tabId":GENSPARK_TAB_ID}}ΩSTOP
```

**2c. 元数据（bash 一次性获取 token + 创建 3 个 jobs）：**
```bash
bash -c '
RESP=$(curl -s -X POST https://api.opus.pro/api/auth/grant-free-tool-credential -H "Content-Type: application/json" -H "Origin: https://clip.opus.pro")
T=$(echo $RESP | python3 -c "import sys,json;d=json.load(sys.stdin);print(d[\"data\"][\"token\"])")
O=$(echo $RESP | python3 -c "import sys,json;d=json.load(sys.stdin);print(d[\"data\"][\"orgId\"])")
TEXT="VIDEO_SUMMARY_TEXT"
echo "=== TITLE ==="
curl -s -X POST https://api.opus.pro/api/generative-jobs -H "Authorization: Bearer $T" -H "X-OPUS-ORG-ID: $O" -H "X-OPUS-USER-ID: $O" -H "Content-Type: application/json" -H "Origin: https://clip.opus.pro" -d "{\"jobType\":\"youtube-title\",\"text\":\"$TEXT\"}"
echo ""
echo "=== DESC ==="
curl -s -X POST https://api.opus.pro/api/generative-jobs -H "Authorization: Bearer $T" -H "X-OPUS-ORG-ID: $O" -H "X-OPUS-USER-ID: $O" -H "Content-Type: application/json" -H "Origin: https://clip.opus.pro" -d "{\"jobType\":\"youtube-description\",\"text\":\"$TEXT\"}"
echo ""
echo "=== HASHTAG ==="
curl -s -X POST https://api.opus.pro/api/generative-jobs -H "Authorization: Bearer $T" -H "X-OPUS-ORG-ID: $O" -H "X-OPUS-USER-ID: $O" -H "Content-Type: application/json" -H "Origin: https://clip.opus.pro" -d "{\"jobType\":\"youtube-hashtag\",\"description\":\"$TEXT\"}"
'
```

查询结果时也要重新获取 token（因为有效期短）：
```bash
bash -c '
RESP=$(curl -s -X POST https://api.opus.pro/api/auth/grant-free-tool-credential -H "Content-Type: application/json" -H "Origin: https://clip.opus.pro")
T=$(echo $RESP | python3 -c "import sys,json;d=json.load(sys.stdin);print(d[\"data\"][\"token\"])")
O=$(echo $RESP | python3 -c "import sys,json;d=json.load(sys.stdin);print(d[\"data\"][\"orgId\"])")
curl -s "https://api.opus.pro/api/generative-jobs/JOB_ID" -H "Authorization: Bearer $T" -H "X-OPUS-ORG-ID: $O" -H "X-OPUS-USER-ID: $O" -H "Origin: https://clip.opus.pro"
'
```

### Step 3: 视频就绪后 — 下载 + ffmpeg 加封面帧

视频较大（通常 50-100MB），用 bg_run 后台下载：
```
Ω{"tool":"bg_run","params":{"command":"curl -o /Users/yay/workspace/VIDEO_NAME.mp4 'https://s2v-ext.cdn.opus.pro/agent/workspace/PROJECT_ID/final_video.mp4'"}}ΩSTOP
```

下载完成后获取视频参数并写 ffmpeg 脚本：
```bash
ffprobe -v 0 -select_streams v:0 -show_entries stream=r_frame_rate,width,height -of csv=p=0 VIDEO.mp4
ffprobe -v 0 -select_streams a:0 -show_entries stream=sample_rate -of csv=p=0 VIDEO.mp4
```

ffmpeg 脚本（写成 .sh 文件执行，不要在 run_command 直接拼复杂参数）：
```bash
#!/bin/bash
set -e
VIDEO=/Users/yay/workspace/VIDEO_NAME.mp4
THUMB=/Users/yay/workspace/THUMB_NAME.jpg  # 先 curl 从 cPanel 下载
OUTPUT=/Users/yay/workspace/VIDEO_FINAL.mp4
ENDFRAME=/Users/yay/workspace/endframe.mp4

# 生成 1 帧视频（时长 = 1/fps 秒）
ffmpeg -y \
  -loop 1 -i $THUMB \
  -f lavfi -i anullsrc=r=SAMPLE_RATE:cl=stereo \
  -t FRAME_DURATION \
  -vf scale=WIDTH:HEIGHT \
  -c:v libx264 \
  -preset veryfast \
  -crf 18 \
  -c:a aac \
  -ar SAMPLE_RATE \
  -pix_fmt yuv420p \
  -r FPS \
  $ENDFRAME

# concat
printf "file 'VIDEO_NAME.mp4'\nfile 'endframe.mp4'\n" > /Users/yay/workspace/concat-list.txt
ffmpeg -y -f concat -safe 0 -i /Users/yay/workspace/concat-list.txt -c copy $OUTPUT
```

### Step 4: 上传最终视频 + webhook 发布 YouTube

上传最终视频到 cPanel（bg_run 因为文件大）：
```
Ω{"tool":"bg_run","params":{"command":"curl -X POST 'https://ezmusicstore.com/thumbnails/upload.php?key=ag3nt2026&name=VIDEO_FINAL.mp4' --data-binary @/Users/yay/workspace/VIDEO_FINAL.mp4"}}ΩSTOP
```

提交 webhook（用 bash stdin 避免转义问题）：
```bash
curl -s -X POST 'https://flow.sokt.io/func/scri42hM0QuZ' \
  -H 'Content-Type: application/json' \
  -d '{
    "video_url": "https://ezmusicstore.com/thumbnails/VIDEO_FINAL.mp4",
    "thumbnail_url": "https://ezmusicstore.com/thumbnails/THUMB_NAME.jpg",
    "youtube_title": "TITLE (60-70字符以内)",
    "youtube_description": "DESCRIPTION\n\n#Hashtag1 #Hashtag2 ...",
    "playlist_id": "PLAYLIST_ID",
    "category_id": "CATEGORY_ID"
  }'
```

### Step 5: 清理本地临时文件

```bash
rm -f /Users/yay/workspace/VIDEO_NAME.mp4 /Users/yay/workspace/VIDEO_FINAL.mp4 /Users/yay/workspace/endframe.mp4 /Users/yay/workspace/concat-list.txt /Users/yay/workspace/*.sh
```

## 踩坑经验（必读）

### ask_proxy 必须用 messages 数组而不是 query

`POST /api/agent/ask_proxy` 的请求体必须用 `messages: [{id, role, content, ...}]` 数组格式，不能用 `query` 字段。用 `query` 会返回 SSE 流但不触发图片生成任务（没有 task_id），白白浪费请求。

### eval_js 对象字面量中字符串值含特殊词会解析出错

在 eval_js 中直接写 `{type: 'image_generation_agent', project_id: '...'}` 这样的对象字面量，字符串值中的某些词（如 `image_generation_agent`）会被 JSON 多层解析搞坏，报 `Unexpected identifier。**解决**：用变量赋值方式构建对象，如 `var mp = {}; mp.type = 'image_generation_agent';`，避免在对象字面量中直接写含特殊词的字符串。

### 缩略图直接在 prompt 中要求文字，不需要 ImageMagick

Genspark nano-banana-pro 模型可以直接在图片中渲染清晰的英文文字。不需要分两步（AI 背景 + ImageMagick 叠加），直接在 prompt 中描述文字内容、颜色、位置即可一步生成完整缩略图。

### viaSocket webhook 的 video_url 注意签名过期

OpusClip 签名 URL（含 `hdnts=` 参数）有有效期，过期后 webhook 下载会报 "Failed to download video"。如果从生成签名 URL 到提交 webhook 间隔较长，签名可能已过期。**保险做法**：优先用 Story Video 的原始 CDN URL `https://s2v-ext.cdn.opus.pro/agent/workspace/{id}/final_video.mp4`（无需签名，永久可访问）。如果需要带字幕版，确保签名 URL 未过期再提交 webhook。

### 善用 async_task 和 bg_run，减少 sleep + 手动查询

所有需要等待的任务都应该用 async_task（浏览器端轮询）或 bg_run（命令行后台）来异步执行，而不是反复 `sleep N && curl` 手动轮询。具体来说：CDN 视频轮询、图片生成轮询、字幕项目轮询、generative-jobs 轮询都应该用 async_task 一次启动后台等通知，不要来回对话浪费轮次。

### eval_js 正则转义

在 eval_js 中写正则表达式极易被多层转义搞坏（JSON → JS → 正则）。**禁止**在 eval_js 中使用 `[^...]` 等复杂正则。

提取 task_id 的正确方式：用 `split` + 简单 UUID 匹配：
```javascript
var parts = text.split('task_id');
if (parts.length > 1) {
  var uuid = parts[1].match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/);
  if (uuid) window._taskId = uuid[1];
}
```

### Genspark 缩略图 aspect_ratio 不可靠

`model_params.aspect_ratio` 设为 `9:16` 不一定生成竖屏图。nano-banana-pro 会根据 prompt 内容自行判断方向。**必须**在 prompt 文本中明确写上方向，例如：
- 竖屏：`"YouTube Shorts vertical 9:16 portrait thumbnail for ..."`
- 横屏：`"YouTube landscape 16:9 widescreen thumbnail for ..."`

生成后**必须用 identify 验证尺寸**，不符合就重新生成。

### Agent Video 模式不稳定

Agent Video 后台 worker 偶发任务调度失败，项目会永远卡在 `INITIALIZING`（`updatedAt` 不变）。判断方法：创建后 2 分钟查一次，如果 `stage` 仍是 `INITIALIZING` 且 `updatedAt` 没变，基本确定卡死了。此时应放弃该项目，用 **Story 模式**重做。

Story 模式更稳定，作为首选。Agent 模式仅在需要 9:16 自带字幕时使用。

### ffmpeg 嵌入缩略图不要加在开头

在视频开头加 3 秒静态缩略图 intro 会致：
1. 音频偏移 3 秒，字幕对不上
2. 结尾出现无声段

正确做法：**把缩略图只加 1 帧到视频结尾**，不影响音频和字幕同步。

### ffmpeg concat 音频采样率必须匹配

用 concat demuxer 合并视频时，intro 和原视频的音频采样率必须一致。opus.pro 输出视频通常是 48000Hz，生成 intro 的静音音轨也要用 `anullsrc=r=48000`，不能用默认的 44100。

### opus.pro token 管理

- token 5 分钟过期，但只要 opus.pro 页面保持打开会自动刷新
- 从 localStorage 取 token 用 `JSON.parse()` 去引号，不要用正则 replace
- curl 请求 opus.pro API 会被 Cloudflare 拦截，**必须通过 eval_js 在浏览器内 fetch**
- token 过期返回 401 时，需要用户刷新 opus.pro 页面

### cPanel upload.php 必须带 key 和 name 参数

上传缩略图到 cPanel 时，URL 必须带 `?key=ag3nt2026&name=文件名.jpg`，且 POST body 直接传 raw arrayBuffer，**不是** multidata。正确写法：
```javascript
fetch('https://ezmusicstore.com/thumbnails/upload.php?key=ag3nt2026&name=xxx.jpg', {method:'POST', body: arrayBuffer})
```
不带 key 参数会返回 `{"error":"forbidden"}`。每次都在这里浪费重试，必须记住。

### task_detail 返回结构是 data 包裹

`GET /api/spark/image_generation_task_detail` 返回 `{status: 0, message: "...", data: {status: "SUCCESS", image_urls_nowatermark: [...]}}`。轮询条件必须用 `d.data.status === 'SUCCESS'`，不是 `d.status === 'SUCCESS'`。第一层 status 是 HTTP 状态码 0，真正的任务状态在 `data.status` 里。

### 缩略图 aspect_ratio 必须匹配视频比例

9:16 竖屏视频（如 Story Video ratio='9:16'）必须生成 9:16 竖屏缩略图，不要默认生成 16:9。生成时 `model_params.aspect_ratio` 和 prompt 中都要明确写方向。

### eval_js 提交 ask_proxy 用 js_flow 分步执行

`ask_proxy` 是 SSE 流式响应，eval_js 10 秒超时经常不够。正确做法：
1. 第一步 eval_js：发送 fetch 请求，结果存到 `window._xxx` 变量，立即 return 不等响应完成
2. 第二步：用 async_task 或 js_flow waitFor 轮询 `window._xxx` 是否有值

不要试图在一个 eval_js 里完成 fetch + 读取 SSE + 提取 task_id，超时概率极高。

### OpusClip guest token 实际有效期很短

SKILL 文档说 guest token 7 天有效，但实测几分钟内就会 Unauthorized。**每次使用前都新获取**，不要缓存复用。用 bash 子命令一步到位：
```bash
bash -c 'TOKEN=$(curl -s -X POST https://api.opus.pro/api/auth/grant-free-tool-credential -H "Content-Type: application/json" -H "Origin: https://clip.opus.pro" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[\"data\"][\"token\"],d[\"data\"][\"orgId\"])"); read -r T O <<< "$TOKEN"; curl -s ... -H "Authorization: Bearer $T" -H "X-OPUS-ORG-ID: $O" ...'
```

## 参考文档

- OpusClip Captions API 详细文档: `skills/opus-video/CAPTIONS_API.md`
- Genspark 高质量缩略图生成: `skills/opus-video/THUMBNAIL_GENSPARK.md`
- SQLite changelog/conventions: `.agent_memory/project_knowledge.db`
