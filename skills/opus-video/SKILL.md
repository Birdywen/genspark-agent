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
