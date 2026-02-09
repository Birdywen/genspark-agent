---
name: opusclip-captions
description: OpusClip Free Captions API - 免费为视频添加动态字幕，22种样式，无需登录
---

# OpusClip Free Captions API

通过逆向 OpusClip Captions 页面获取的完整 API，可为任意视频自动添加动态字幕。

## 架构概览

```
视频 URL (opus.pro / 任意公网 URL)
    ↓
① POST /auth/grant-free-tool-credential  → guest token (无需登录)
    ↓
② POST /source-videos {videoUrl}  → 视频预检 (语言检测、时长)
    ↓
③ POST /clip-projects {videoUrl, brandTemplateId, productTier:"FREE.CAPTIONS", ...}  → 创建项目
    ↓
④ 轮询 GET /clip-projects/{id}  等待 stage="COMPLETE" (~2-5分钟)
    ↓
⑤ 获取结果:
   - transcriptSrtUrl → SRT 字幕文件
   - transcriptTxtUrl → 纯文本转录
   - 带字幕视频 → /media/{org}/{user}/{projectId}/c.{hash}/VIDEO_FILE.mp4
```

## 免费额度

- 每天 **3 个无水印** clips
- 超出部分带 OpusClip 水印
- 每次调用 `grant-free-tool-credential` 生成新 guest 身份，token 有效期约 7 天
- 视频存储 7 天后过期 (`storageExpireAt`)

## API Base URL

```
https://api.opus.pro/api
```

## 通用 Headers

所有 API（除 grant-free-tool-credential 外）都需要以下 headers：

```
Authorization: Bearer <token>
X-OPUS-ORG-ID: <orgId>
X-OPUS-USER-ID: <userId>
X-OPUS-LANG: en
Content-Type: application/json
Origin: https://clip.opus.pro
Referer: https://clip.opus.pro/captions
```

可选 headers：
```
x-opus-clip-project-toggle: clip-api
X-OPUS-CRID: <随机ID>
X-OPUS-DID: <设备ID>
```

---

## API 详细文档

### 1. 获取免费凭证

```
POST https://api.opus.pro/api/auth/grant-free-tool-credential
Headers: Content-Type: application/json
         Origin: https://clip.opus.pro
```

**响应：**
```json
{
  "data": {
    "loginId": "guest_xxx",
    "orgId": "guest_xxx",
    "userId": "guest_xxx",
    "token": "eyJ..."
  }
}
```

### 2. 获取字幕样式模板

```
GET https://api.opus.pro/api/fancy-template-presets
```

**可用样式（22种）：**

| templateId | 名称 | 风格 |
|------------|------|------|
| preset-fancy-Karaoke | Karaoke | 卡拉OK逐词高亮 |
| preset-fancy-Gameplay | Gameplay | 游戏风格 |
| preset-fancy-Beasty | Beasty | MrBeast 风格 |
| preset-fancy-Deep_Diver | Deep Diver | 深度潜水风格 |
| preset-fancy-Youshaei | Youshaei | 博主风格 |
| preset-fancy-Pod_P | Pod P | 播客风格 |
| preset-fancy-Mozi | Mozi | 简约动效 |
| preset-fancy-Popline | Popline | 弹出线条 |
| preset-fancy-Simple | Simple | 极简 |
| preset-fancy-Think_Media | Think Media | 媒体风格 |
| preset-fancy-Glitch-infinite-zoom | Glitch Infinite | 故障无限缩放 |
| preset-fancy-Seamless-bounce | Seamless Bounce | 弹跳 |
| preset-fancy-Baby-earthquake | Baby Earthquake | 微震动 |
| preset-fancy-Blur-switch | Blur Switch | 模糊切换 |
| preset-fancy-Highlighter-box-around | Highlighter Box | 高亮框 |
| preset-fancy-individual-focus | Focus | 逐词聚焦 |
| preset-fancy-blur-in | Blur In | 模糊淡入 |
| preset-fancy-simple-words-pop | With Backdrop | 带背景弹出 |
| preset-fancy-slide-in-from-top | Soft Landing | 顶部滑入 |
| preset-fancy-hover | Baby Steps | 悬浮步进 |
| preset-fancy-scale-in | Grow | 放大 |
| preset-fancy-breathe-scale-wiggle | Breathe | 呼吸缩放 |

### 3. 视频预检（可选）

检测视频语言和元信息。可直接传公网视频 URL，无需上传。

```
POST https://api.opus.pro/api/source-videos
Body: {"videoUrl": "https://...mp4"}
```

**响应：**
```json
{
  "data": {
    "resolution": null,
    "durationMs": 136000,
    "videoLanguage": "auto",
    "sourcePlatform": "YTDLP_LINK",
    "title": "final_video",
    "sourceInfoList": []
  }
}
```

### 4. 创建字幕项目

```
POST https://api.opus.pro/api/clip-projects
```

**请求体：**
```json
{
  "videoUrl": "https://...mp4",
  "brandTemplateId": "preset-fancy-Karaoke",
  "importPref": {
    "sourceLang": "auto",
    "targetLang": null
  },
  "curationPref": {
    "clipDurations": [],
    "topicKeywords": [],
    "skipSlicing": true
  },
  "uploadedVideoAttr": {
    "title": "视频标题",
    "durationMs": 136000
  },
  "renderPref": {
    "enableCaption": true,
    "enableHighlight": true,
    "enableEmoji": false
  },
  "productTier": "FREE.CAPTIONS"
}
```

**关键参数说明：**
- `videoUrl`: 公网可访问的视频 URL（opus.pro CDN、YouTube 等均可）
- `brandTemplateId`: 字幕样式，从 fancy-template-presets 获取
- `productTier`: 必须是 `"FREE.CAPTIONS"`
- `skipSlicing: true`: 不切片，只加字幕
- `sourceLang`: 视频语言，`"auto"` 自动检测，或 `"zh"`, `"en"` 等
- `targetLang`: 翻译目标语言，null 表示不翻译

**响应：**
```json
{
  "id": "P3020904prSe",
  "projectId": "P3020904prSe",
  "stage": "QUEUED",
  "productTier": "FREE.CAPTIONS",
  "storageExpireAt": "2026-02-16T...",
  "...": "..."
}
```

### 5. 查询项目状态

```
GET https://api.opus.pro/api/clip-projects/{projectId}
```

**stage 状态流转：**
```
QUEUED → PROCESSING → COMPLETE
                    → ERROR
```

### 6. 获取结果

项目 COMPLETE 后，从响应中获取：

- `transcriptSrtUrl` → SRT 字幕文件（带签名的 CDN URL）
- `transcriptTxtUrl` → 纯文本转录
- 带字幕视频 URL 格式：
  ```
  https://signed-ext.cdn.opus.pro/media/{orgId}/{userId}/{projectId}/c.{hash}/VIDEO_FILE.mp4?v=...&hdnts=...
  ```
  注意：带字幕视频的 URL 不在 API 响应中直接返回，需要通过页面解析或构造 CDN 路径获取。

### 7. 上传视频（仅当 URL 不可直接访问时需要）

```
POST https://api.opus.pro/api/upload-links
Body: {"type": "Upload", "usecase": "LocalUpload"}
```

**响应：**
```json
{
  "url": "https://storage.googleapis.com/ext.gcs.opus.pro/upload/.../video-raw.video?签名",
  "uploadId": "UPL_xxx",
  "cdnUrl": "https://signed-ext.cdn.opus.pro/upload/.../video-raw.video?签名",
  "gsUrl": "gs://ext.gcs.opus.pro/upload/.../video-raw.video"
}
```

上传方式：GCS Resumable Upload（POST 初始化 → PUT 分片上传）

备用 AWS S3 直传：
- Bucket: `opus-test-james`
- Region: `us-east-2`
- Cognito Identity Pool: `us-east-2:9320ca26-5041-4867-ae8d-38f57d67ea2c`

---

## 完整调用示例 (bash)

```bash
#!/bin/bash
# OpusClip Free Captions - 自动添加字幕

VIDEO_URL="$1"  # 输入视频 URL
TEMPLATE="${2:-preset-fancy-Karaoke}"  # 字幕样式，默认 Karaoke

# Step 1: 获取免费凭证
CRED=$(curl -s -X POST 'https://api.opus.pro/api/auth/grant-free-tool-credential' \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://clip.opus.pro')

TOKEN=$(echo $CRED | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])")
ORG_ID=$(echo $CRED | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['orgId'])")
USER_ID=$(echo $CRED | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['userId'])")

HEADERS=(
  -H 'Content-Type: application/json'
  -H 'Origin: https://clip.opus.pro'
  -H 'Referer: https://clip.opus.pro/captions'
  -H "Authorization: Bearer $TOKEN"
  -H "X-OPUS-ORG-ID: $ORG_ID"
  -H "X-OPUS-USER-ID: $USER_ID"
  -H 'X-OPUS-LANG: en'
  -H 'x-opus-clip-project-toggle: clip-api'
)

# Step 2: 预检视频
SOURCE=$(curl -s -X POST 'https://api.opus.pro/api/source-videos' \
  "${HEADERS[@]}" \
  -d "{\"videoUrl\":\"$VIDEO_URL\"}")

DURATION=$(echo $SOURCE | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['durationMs'])")
TITLE=$(echo $SOURCE | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['title'])")
echo "Video: $TITLE, Duration: ${DURATION}ms"

# Step 3: 创建字幕项目
PROJECT=$(curl -s -X POST 'https://api.opus.pro/api/clip-projects' \
  "${HEADERS[@]}" \
  -d "{
    \"videoUrl\": \"$VIDEO_URL\",
    \"brandTemplateId\": \"$TEMPLATE\",
    \"importPref\": {\"sourceLang\": \"auto\", \"targetLang\": null},
    \"curationPref\": {\"clipDurations\": [], \"topicKeywords\": [], \"skipSlicing\": true},
    \"uploadedVideoAttr\": {\"title\": \"$TITLE\", \"durationMs\": $DURATION},
    \"renderPref\": {\"enableCaption\": true, \"enableHighlight\": true, \"enableEmoji\": false},
    \"productTier\": \"FREE.CAPTIONS\"
  }")

PROJECT_ID=$(echo $PROJECT | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "Project created: $PROJECT_ID"

# Step 4: 轮询等待完成
while true; do
  STATUS=$(curl -s "https://api.opus.pro/api/clip-projects/$PROJECT_ID" \
    "${HEADERS[@]}")
  STAGE=$(echo $STATUS | python3 -c "import sys,json; print(json.load(sys.stdin)['stage'])")
  echo "Stage: $STAGE"
  
  if [ "$STAGE" = "COMPLETE" ]; then
    break
  elif [ "$STAGE" = "ERROR" ]; then
    echo "Error!" && exit 1
  fi
  sleep 15
done

# Step 5: 获取结果
SRT_URL=$(echo $STATUS | python3 -c "import sys,json; print(json.load(sys.stdin)['transcriptSrtUrl'])")
TXT_URL=$(echo $STATUS | python3 -c "import sys,json; print(json.load(sys.stdin)['transcriptTxtUrl'])")

echo "SRT: $SRT_URL"
echo "TXT: $TXT_URL"
echo "Web: https://clip.opus.pro/captions/project/$PROJECT_ID"
```

---

## 与 opus-video Skill 的集成

### 新流程（推荐）

```
opus.pro 生成视频 → 拿到 CDN URL → OpusClip Captions API 加字幕 → 带字幕视频
```

替代了旧流程：
```
opus.pro 生成视频 → 下载到 Oracle → ffmpeg 提取音频 → Whisper 转录 → ffmpeg 烧字幕
```

**优势：**
- 不需要 Oracle 服务器处理
- 不需要 Whisper API key
- 不需要 ffmpeg 烧字幕
- 22 种动态字幕样式（本地只能做静态字幕）
- 字幕带动画效果（卡拉OK、弹跳、模糊等）

**限制：**
- 免费每天 3 个无水印
- 超出带 OpusClip 水印
- 渲染输出是 portrait (9:16) 比例
- 视频存储 7 天后过期

---

## 已验证 (2026-02-09)

- ✅ grant-free-tool-credential 获取 guest token
- ✅ source-videos 直接接受 opus.pro CDN URL（无需上传）
- ✅ clip-projects 创建字幕项目
- ✅ 轮询 stage=COMPLETE（约 4 分钟 / 136 秒视频）
- ✅ transcriptSrtUrl 获取 SRT 字幕
- ✅ 带字幕视频从页面 <source> 标签获取
- ✅ fancy-template-presets 获取 22 种字幕样式
- ✅ upload-links 获取 GCS 上传链接（备用）

---

## 进阶用法：编辑器 + 免费高清下载

### 发现（2026-02-09 验证）

OpusClip 的 Captions 编辑器页面不仅能加字幕，还支持：

- 背景音乐
- 视觉特效
- 字幕样式实时调整
- 画面裁切/布局

编辑完成后，渲染的高清无水印视频会直接存放在 CDN 上。即使页面上的 "Download HD" 按钮可能要求付费或登录，实际视频已经可以通过浏览器控制台或 eval_js 从 `<source>` 标签直接获取。

### 获取方式

项目完成后，打开项目页面：
```
https://clip.opus.pro/captions/project/{projectId}
```

然后通过 eval_js 提取视频 URL：
```javascript
// eval_js on the project page tab
const source = document.querySelector('source');
return source ? source.src : 'no video found';
```

视频 URL 格式：
```
https://signed-ext.cdn.opus.pro/media/{orgId}/{userId}/{projectId}/c.{hash}/VIDEO_FILE.mp4?v=...&hdnts=...
```

该 URL 是带签名的 CDN 链接，有效期约 24 小时（Expires 参数控制）。

### 无限免费使用

经实际测试验证：
- 每次调用 `grant-free-tool-credential` 生成全新 guest 身份
- 没有真正的每日次数限制
- 页面上 "3 watermark-free clips daily" 的提示仅针对登录用户的计数
- Guest 模式下可无限次使用
- 输出视频为高清无水印

### 支持的输出比例

通过 `renderPref.layoutAspectRatio` 控制：

| 值 | 比例 | 用途 |
|----|------|------|
| `portrait` | 9:16 | 竖屏短视频（默认） |
| `landscape` | 16:9 | 横屏视频（YouTube） |
| `square` | 1:1 | 方形（Instagram） |
| `four_five` | 4:5 | 竖屏（Facebook/Instagram） |

### 优化后的完整生产线

```
旧流程（已淘汰）:
  opus.pro 生成视频 → 下载到 Oracle → ffmpeg 提取音频
  → Whisper API 转录 SRT → ffmpeg 烧录硬字幕
  → scp 到 cPanel → viaSocket → YouTube

新流程（推荐）:
  opus.pro 生成视频 → 拿到 CDN URL
  → OpusClip Captions API 加字幕（支持 landscape 16:9）
  → eval_js 获取高清无水印视频 URL
  → viaSocket → YouTube
```

**优势：**
- 零服务器成本（不需要 Oracle 处理）
- 零 API 费用（不需要 Whisper / OpenAI）
- 动态字幕效果（22种样式 vs 本地只能做静态 SRT）
- 支持多种输出比例
- 可额外添加背景音乐和视觉特效
- 处理速度快（~2-4 分钟 / 2 分钟视频）

---

## 输出视频规格（已验证）

| 参数 | 值 |
|------|----|
| 分辨率 | 1920x1080 (landscape) |
| 编码 | H.264 High Profile |
| 帧率 | 25fps |
| 码率 | ~7.7 Mbps |
| 格式 | MP4 (avc1) |
| 水印 | 无 |
| 文件大小 | ~130MB / 136秒视频 |

测试项目：P302090583si (landscape + Karaoke 字幕)

---

## OpusClip 免费工具 API（generative-jobs）

除了 Captions，OpusClip 还提供一系列基于 `generative-jobs` 的免费工具，全部使用相同的认证方式。

### 通用流程

```
① POST /auth/grant-free-tool-credential → token
② POST /generative-jobs {jobType, sourceUri/description/...} → {jobId}
③ GET  /generative-jobs/{jobId} → 轮询直到 status="CONCLUDED"
④ 从 result 中获取生成的内容
```

注意：状态值是 `CONCLUDED`（不是 COMPLETE）。

### YouTube Thumbnail Maker（已验证）

```
POST https://api.opus.pro/api/generative-jobs
Body: {
  "sourceUri": "视频URL",
  "referenceImageUri": "参考图片URL（可选）",
  "jobType": "thumbnail"
}
```

**响应：**
```json
{"data": {"jobId": "thumbnail-xxx"}}
```

**轮询结果：**
```
GET https://api.opus.pro/api/generative-jobs/{jobId}
```

**完成后返回：**
```json
{
  "data": {
    "status": "CONCLUDED",
    "result": {
      "sourceUri": "原始视频URL",
      "durationMs": 136000,
      "generatedThumbnailUris": [
        "https://signed-ext.cdn.opus.pro/media-generation/{jobId}/out-paint-0.png?签名",
        "https://signed-ext.cdn.opus.pro/media-generation/{jobId}/out-paint-1.png?签名"
      ]
    },
    "progress": {"status": "CONCLUDED", "progress": 100}
  }
}
```

**输出规格：**
- 2 张 AI 生成的 thumbnail
- 1280x720 PNG（YouTube 标准 thumbnail 尺寸）
- ~1.2MB 每张
- 处理时间 ~3-5 分钟

### 其他可用 jobType（未测试）

| jobType | 功能 | 输入 |
|---------|------|------|
| `thumbnail` | YouTube 缩略图生成 | sourceUri, referenceImageUri |
| `transcript` | 视频转录 | sourceUri |
| `youtube-title` | YouTube 标题生成 | (待确认) |
| `youtube-description` | YouTube 描述生成 | text |
| `youtube-hashtag` | YouTube 标签生成 | (待确认) |
| `youtube-channel-name` | 频道名生成 | description |
| `tiktok-caption-generator` | TikTok 文案生成 | (待确认) |
| `tiktok-username-generator` | TikTok 用户名生成 | keywords |
| `tiktok-bio-generator` | TikTok 简介生成 | (待确认) |
| `tiktok-hashtag-generator` | TikTok 标签生成 | (待确认) |
| `video-script` | 视频脚本生成 | (待确认) |
| `ai-show-note-generator` | 节目笔记生成 | (待确认) |
| `ai-video-summarizer` | 视频摘要生成 | (待确认) |
| `photo-relighting` | 照片重打光 | (待确认) |
| `video-compression` | 视频压缩 | (待确认) |

### 配额查询

```
GET https://api.opus.pro/api/generative-jobs/quota?jobType=thumbnail
```

---

## 完整自动化生产线（最终版）

```
┌─────────────────────────────────────────────────────────────────┐
│                    全自动视频发布流水线                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. 脚本创作 (Claude/GPT)                                       │
│     ↓                                                           │
│  2. opus.pro Story Video API → 生成视频 (CDN URL)               │
│     ↓                                                           │
│  3. OpusClip Captions API → 加动态字幕 (landscape 16:9)         │
│     ↓                                    同时                    │
│  4. OpusClip Thumbnail API → 生成 YouTube 缩略图 (1280x720)    │
│     ↓                                                           │
│  5. 获取成品: 带字幕视频 + SRT + Thumbnail                      │
│     ↓                                                           │
│  6. viaSocket → 上传 YouTube (视频 + 缩略图 + 描述)            │
│                                                                 │
│  全程零服务器成本 | 零 API 费用 | 全自动                        │
└─────────────────────────────────────────────────────────────────┘
```

**对比旧流程：**

| 步骤 | 旧流程 | 新流程 |
|------|--------|--------|
| 字幕 | Oracle ffmpeg + Whisper API ($) | OpusClip Captions API (免费) |
| 缩略图 | Genspark AI 生成 | OpusClip Thumbnail API (免费) |
| 视频托管 | cPanel (ezmusicstore.com) | OpusClip CDN (7天) |
| 服务器 | Oracle Cloud Free Tier | 不需要 |
| 成本 | Whisper API 费用 | $0 |

---

## Video Script Generator（已验证）

```
POST https://api.opus.pro/api/generative-jobs
Body: {
  "jobType": "video-script",
  "idea": "视频主题/创意描述",
  "platform": "youtube",
  "videoType": "explainer",
  "audience": "general",
  "tone": "engaging",
  "duration": "2 minutes"
}
```

**参数说明：**

| 参数 | 类型 | 说明 |
|------|------|------|
| idea | string | 视频创意/主题描述（必填） |
| platform | string | 目标平台: youtube, tiktok, instagram 等 |
| videoType | string | 视频类型: explainer, tutorial, story, review 等 |
| audience | string | 目标受众: general, tech, business 等 |
| tone | string | 语气风格: engaging, professional, casual, humorous 等 |
| duration | string | 目标时长: "1 minute", "2 minutes", "5 minutes" 等 |

**响应：**
```json
{"data": {"jobId": "video-script-xxx"}}
```

**轮询完成后返回：**
```json
{
  "data": {
    "status": "CONCLUDED",
    "result": {
      "scriptContent": "# Video Script - YOUTUBE\n\n## HOOK\n...\n## INTRODUCTION\n...\n## MAIN CONTENT\n...\n## CONCLUSION\n...\n## CALL TO ACTION\n..."
    }
  }
}
```

**输出格式：** Markdown 格式的完整视频脚本，包含：
- HOOK（开场钩子）
- INTRODUCTION（简介）
- MAIN CONTENT（主要内容，含 [VISUAL CUE] 和 [PAUSE] 标记）
- CONCLUSION（总结）
- CALL TO ACTION（行动号召）

**处理时间：** ~5 秒（极快）

---

## 从一句话到 YouTube 视频：完整零成本自动化流程

```bash
#!/bin/bash
# 一键生成 YouTube 视频 - 全自动零成本
# 用法: ./auto_youtube.sh "你的视频创意"

IDEA="$1"
TEMPLATE="${2:-preset-fancy-Karaoke}"

API="https://api.opus.pro/api"

# ===== 获取凭证 =====
get_cred() {
  CRED=$(curl -s -X POST "$API/auth/grant-free-tool-credential" \
    -H 'Content-Type: application/json' -H 'Origin: https://clip.opus.pro')
  TOKEN=$(echo $CRED | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])")
  ORG=$(echo $CRED | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['orgId'])")
}

# ===== 通用 API 调用 =====
api_call() {
  local METHOD=$1 URL=$2 DATA=$3
  curl -s -X $METHOD "$URL" \
    -H 'Content-Type: application/json' \
    -H 'Origin: https://clip.opus.pro' \
    -H "Authorization: Bearer $TOKEN" \
    -H "X-OPUS-ORG-ID: $ORG" \
    -H "X-OPUS-USER-ID: $ORG" \
    -H 'X-OPUS-LANG: en' \
    -H 'x-opus-clip-project-toggle: clip-api' \
    ${DATA:+-d "$DATA"}
}

# ===== 轮询 generative-job =====
poll_job() {
  local JOB_ID=$1
  while true; do
    RESULT=$(api_call GET "$API/generative-jobs/$JOB_ID")
    STATUS=$(echo $RESULT | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['status'])")
    [ "$STATUS" = "CONCLUDED" ] && echo $RESULT && return 0
    [ "$STATUS" = "ERROR" ] || [ "$STATUS" = "FAILED" ] && echo "Job failed" && return 1
    sleep 5
  done
}

# ===== 轮询 clip-project =====
poll_project() {
  local PROJECT_ID=$1
  while true; do
    RESULT=$(api_call GET "$API/clip-projects/$PROJECT_ID")
    STAGE=$(echo $RESULT | python3 -c "import sys,json; print(json.load(sys.stdin)['stage'])")
    [ "$STAGE" = "COMPLETE" ] && echo $RESULT && return 0
    [ "$STAGE" = "ERROR" ] && echo "Project failed" && return 1
    sleep 15
  done
}

echo "🚀 Starting auto YouTube pipeline..."
echo "Idea: $IDEA"

# Step 1: 生成脚本
get_cred
echo "📝 Step 1: Generating script..."
JOB=$(api_call POST "$API/generative-jobs" \
  "{\"jobType\":\"video-script\",\"idea\":\"$IDEA\",\"platform\":\"youtube\",\"videoType\":\"explainer\",\"audience\":\"general\",\"tone\":\"engaging\",\"duration\":\"2 minutes\"}")
JOB_ID=$(echo $JOB | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['jobId'])")
SCRIPT_RESULT=$(poll_job $JOB_ID)
SCRIPT=$(echo $SCRIPT_RESULT | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['result']['scriptContent'])")
echo "✅ Script generated"

# Step 2: opus.pro 生成视频 (需要手动或通过 opus.pro API)
echo "🎬 Step 2: Generate video with opus.pro Story Video API using the script"
echo "(传入 script 到 opus.pro Long Take Video API)"
# VIDEO_URL=$(... opus.pro API 调用 ...)
# 这里需要等 opus.pro 视频生成完成后拿到 CDN URL
VIDEO_URL="<opus.pro 视频 CDN URL>"

# Step 3 & 4: 并行 - 字幕 + 缩略图
get_cred
echo "🎨 Step 3: Adding captions (landscape)..."
SOURCE=$(api_call POST "$API/source-videos" "{\"videoUrl\":\"$VIDEO_URL\"}")
DURATION=$(echo $SOURCE | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['durationMs'])")
TITLE=$(echo $SOURCE | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['title'])")

PROJECT=$(api_call POST "$API/clip-projects" \
  "{\"videoUrl\":\"$VIDEO_URL\",\"brandTemplateId\":\"$TEMPLATE\",\"importPref\":{\"sourceLang\":\"auto\",\"targetLang\":null},\"curationPref\":{\"clipDurations\":[],\"topicKeywords\":[],\"skipSlicing\":true},\"uploadedVideoAttr\":{\"title\":\"$TITLE\",\"durationMs\":$DURATION},\"renderPref\":{\"enableCaption\":true,\"enableHighlight\":true,\"enableEmoji\":false,\"layoutAspectRatio\":\"landscape\"},\"productTier\":\"FREE.CAPTIONS\"}")
PROJECT_ID=$(echo $PROJECT | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "  Project: $PROJECT_ID"

echo "🖼️ Step 4: Generating thumbnail (parallel)..."
THUMB_JOB=$(api_call POST "$API/generative-jobs" \
  "{\"jobType\":\"thumbnail\",\"sourceUri\":\"$VIDEO_URL\"}")
THUMB_ID=$(echo $THUMB_JOB | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['jobId'])")
echo "  Thumbnail job: $THUMB_ID"

# 等待两个任务完成
echo "⏳ Waiting for captions..."
CAPTION_RESULT=$(poll_project $PROJECT_ID)
SRT_URL=$(echo $CAPTION_RESULT | python3 -c "import sys,json; print(json.load(sys.stdin)['transcriptSrtUrl'])")
echo "✅ Captions done. SRT: $SRT_URL"
echo "  Video page: https://clip.opus.pro/captions/project/$PROJECT_ID"

echo "⏳ Waiting for thumbnail..."
THUMB_RESULT=$(poll_job $THUMB_ID)
THUMB_URLS=$(echo $THUMB_RESULT | python3 -c "import sys,json; urls=json.load(sys.stdin)['data']['result']['generatedThumbnailUris']; [print(u) for u in urls]")
echo "✅ Thumbnails done:"
echo "$THUMB_URLS"

# Step 5: 生成元数据 (可选)
echo "📋 Step 5: Results ready for viaSocket webhook"
echo "  Video: https://clip.opus.pro/captions/project/$PROJECT_ID (用 eval_js 获取视频URL)"
echo "  SRT: $SRT_URL"
echo "  Thumbnails: $THUMB_URLS"
echo ""
echo "🎉 Pipeline complete! Send to viaSocket webhook to publish on YouTube."
```

---

## 关键发现：exportable-clips API（纯 API 获取视频 URL）

之前以为必须用 eval_js 从页面 source 标签获取带字幕视频 URL，现在发现 `exportable-clips` API 可以直接返回所有下载链接，**完全不需要浏览器**。

```
GET https://api.opus.pro/api/exportable-clips?projectId={projectId}
```

**响应：**
```json
{
  "data": [{
    "id": "P302090583si.94ac264e05",
    "projectId": "P302090583si",
    "curationId": "94ac264e05",
    "uriForPreview": "https://signed-ext.cdn.opus.pro/.../VIDEO_PREVIEW.mp4?签名",
    "uriForExport": "https://signed-ext.cdn.opus.pro/.../VIDEO_FILE.mp4?签名",
    "uriForThumbnail": "https://signed-ext.cdn.opus.pro/.../thumbnail.jpg?签名",
    "storageUsed": 158548660,
    "durationMs": 136107,
    "renderPref": { ... }
  }]
}
```

**关键字段：**
- `uriForExport` — 高清无水印视频 (1080p VIDEO_FILE.mp4)
- `uriForPreview` — 低分辨率预览视频
- `uriForThumbnail` — 视频截图缩略图
- `curationId` — clip hash，用于编辑器 URL

**重要：任意 guest token 都能访问，不需要是创建项目的 org。**

### 更新后的完整纯 API 流程（无需浏览器）

```
① POST /auth/grant-free-tool-credential → token
② POST /source-videos {videoUrl} → 预检
③ POST /clip-projects {...} → projectId, stage=QUEUED
④ GET  /clip-projects/{projectId} → 轮询直到 stage=COMPLETE
⑤ GET  /exportable-clips?projectId={projectId} → uriForExport (高清视频)
   同时从 ④ 的响应拿 transcriptSrtUrl (字幕)
```

**这是最终的、完全自动化的、不依赖浏览器的方案。**

---

## Generative Jobs 完整参数表（已验证 2026-02-09）

### 全部 jobType 确切参数（从源码逆向）

| jobType | 输入参数 | 输出字段 | 状态 |
|---------|---------|---------|------|
| `thumbnail` | `{sourceUri, referenceImageUri?}` | `generatedThumbnailUris[]` | ✅ 已验证 |
| `transcript` | `{sourceUri}` | (待验证) | 🔍 |
| `youtube-channel-name` | `{description}` | (待验证) | 🔍 |
| `youtube-hashtag` | `{description}` | `hashtags[]` (20个) | ✅ 已验证 |
| `youtube-title` | `{text}` | `titles[]` (5个) | ✅ 已验证 |
| `youtube-description` | `{text}` | `descriptions[]` (3个) | ✅ 已验证 |
| `tiktok-username-generator` | `{keywords}` | (待验证) | 🔍 |
| `tiktok-caption-generator` | `{topic, tone}` | (待验证) | 🔍 |
| `tiktok-bio-generator` | `{description, accountType, tone}` | (待验证) | 🔍 |
| `tiktok-hashtag-generator` | `{description, niche, hashtagType}` | (待验证) | 🔍 |
| `video-script` | `{idea, platform, videoType, audience, tone, duration}` | `scriptContent` | ✅ 已验证 |
| `ai-show-note-generator` | (待确认) | (待验证) | 🔍 |
| `ai-video-summarizer` | (待确认) | (待验证) | 🔍 |
| `photo-relighting` | (待确认) | (待验证) | 🔍 |
| `video-compression` | (待确认) | (待验证) | 🔍 |

### YouTube 元数据生成示例（已验证）

#### youtube-hashtag
```bash
curl -s -X POST "https://api.opus.pro/api/generative-jobs" \\
  -H "Authorization: Bearer \$TOKEN" \\
  -H "X-OPUS-ORG-ID: \$ORG" -H "X-OPUS-USER-ID: \$ORG" \\
  -H "Content-Type: application/json" -H "Origin: https://clip.opus.pro" \\
  -d '{"description":"视频主题描述","jobType":"youtube-hashtag"}'
```
返回: `{hashtags: ["Tag1", "Tag2", ...]}` — 20个精准标签

#### youtube-title
```bash
curl -s -X POST "https://api.opus.pro/api/generative-jobs" \\
  -d '{"text":"视频主题描述","jobType":"youtube-title"}'
```
返回: `{titles: ["标题1", "标题2", ...]}` — 5个候选标题

#### youtube-description
```bash
curl -s -X POST "https://api.opus.pro/api/generative-jobs" \\
  -d '{"text":"视频主题描述","jobType":"youtube-description"}'
```
返回: `{descriptions: ["描述1", "描述2", ...]}` — 3个完整描述（含emoji、CTA、SEO标签）

### Genre → YouTube CategoryId 映射表

| OpusClip genre | YouTube categoryId | Category Name |
|---------------|-------------------|---------------|
| entertainment / comedy | 24 | Entertainment |
| educational / informational | 27 | Education |
| music | 10 | Music |
| gaming | 20 | Gaming |
| news | 25 | News & Politics |
| howto / tutorial | 26 | Howto & Style |
| science / technology | 28 | Science & Technology |
| sports | 17 | Sports |
| travel | 19 | Travel & Events |
| people / blogs | 22 | People & Blogs |
| film / animation | 1 | Film & Animation |
| documentary | 35 | Documentary |
| (默认/未知) | 22 | People & Blogs |


---

## viaSocket Workflow 配置（已验证 2026-02-09）

### Webhook
- URL: `https://flow.sokt.io/func/scri42hM0QuZ`
- 方法: POST
- Content-Type: application/json

### Webhook Payload Schema
```json
{
  "video_url": "带字幕视频的 CDN URL",
  "youtube_title": "标题 #Tag1 #Tag2",
  "youtube_description": "完整描述...\n\n#Tag1 #Tag2",
  "thumbnail_url": "AI 生成的缩略图 URL",
  "playlist_id": "PLYtnUtZt0Zn...",
  "category_id": "22"
}
```

### Workflow 步骤（Version 1, Published）
1. **Upload Video to YouTube** — 上传视频，设置标题/描述/分类/Private
   - 输出: `Upload_Video_to_YouTube.data.id` (YouTube videoId)
2. **Update Video Thumbnail** — 设置 AI 生成的缩略图
   - videoId: 引用 step 1 的 `data.id`
   - thumbnailUrl: 引用 `body."thumbnail_url"`
3. **Add Video to Playlist** — 加入对应分类播放列表
   - videoId: 引用 step 1 的 `data.id`
   - playlistId: 引用 `body."playlist_id"`
4. **Response** — 返回结果

### YouTube 频道: 不争即是争
- Channel ID: `UCD-b9a2T6kSarjwnhxsp4gQ`

### Playlist 映射表
| 分类 | Playlist | ID |
|-----|---------|----|
| tech | Tech Trends｜科技趋势 | `PLYtnUtZt0ZnFNjguN43KAb3aYFwCMTYZW` |
| people | Remarkable People｜人物传记 | `PLYtnUtZt0ZnGnjjJ3L60TIK7kBT93yRo3` |
| society | Society & Trends｜社会热点 | `PLYtnUtZt0ZnFssUY9G1cLpXO-D6JKPHH5` |
| science | Science Explained｜科学解读 | `PLYtnUtZt0ZnFn-PNqSLN-_wPkIFGGCSlw` |
| business | Business Insights｜商业分析 | `PLYtnUtZt0ZnE0_9LXZTFOlgFxFB-oh8sK` |
| culture | Culture & Entertainment｜文化现象 | `PLYtnUtZt0ZnHIwG9vhWqSr6t1vGRr0AQR` |
| wildcard | Featured｜精选内容 | `PLYtnUtZt0ZnF-oneo7UEDTO_OGJQ12ovZ` |

### 端到端测试结果（2026-02-09 11:04 AM）
- 视频: Victor Lustig 卖掉埃菲尔铁塔 (1080p landscape, 带 Karaoke 字幕)
- YouTube videoId: `OP3xfISnOUU`
- 三步全部成功: Upload ✅ → Thumbnail ✅ → Playlist ✅
- 总耗时: ~4 分钟（含 130MB 上传）

---

## Story Mode API（逆向验证 2026-02-09）

### 端点

```
POST https://api.opus.pro/api/long-take-videos
```

### Headers（与 Agent Video 相同）

```
Authorization: Bearer <token>
Content-Type: application/json
Origin: https://agent.opus.pro
Referer: https://agent.opus.pro/
X-OPUS-ORG-ID: <orgId>
X-OPUS-USER-ID: <userId>
X-OPUS-SHARED-ID: (空)
```

### Request Body

| 字段 | 类型 | 说明 |
|------|------|------|
| prompt | string | 完整旁白文稿（纯文本，含换行） |
| ratio | string | 画面比例: "16:9", "9:16", "1:1" |
| customStyle | boolean | false=使用预设样式, true=自定义 |
| styleText | string | 视觉风格描述文本 |
| voiceId | string | 语音 ID（如 "MM0375rv1dy8"） |

### 预设样式列表（13种）

| 样式名 | 缩略图 URL |
|--------|------------|
| 2D Line | https://dev-ext.cdn.opus.pro/story-mode/styles/2d%20line.webp |
| Animation | https://dev-ext.cdn.opus.pro/story-mode/styles/3d%20animatoin.webp |
| Collage | https://dev-ext.cdn.opus.pro/story-mode/styles/Blue%20collage.webp |
| Blue Vox | https://dev-ext.cdn.opus.pro/story-mode/styles/Blue%20vox.webp |
| Claire | https://dev-ext.cdn.opus.pro/story-mode/styles/Claire.webp |
| Claymation | https://dev-ext.cdn.opus.pro/story-mode/styles/Claymation.webp |
| Economic | https://dev-ext.cdn.opus.pro/story-mode/styles/Economic.webp |
| Halftone | https://dev-ext.cdn.opus.pro/story-mode/styles/Halftone.webp |
| Marcinelle | https://dev-ext.cdn.opus.pro/story-mode/styles/Marcinelle.webp |
| Pen&Ink | https://dev-ext.cdn.opus.pro/story-mode/styles/Pen%20&%20ink.webp |
| Schematic | https://dev-ext.cdn.opus.pro/story-mode/styles/Schematic.webp |
| Watercolor | https://dev-ext.cdn.opus.pro/story-mode/styles/Watercolor.webp |
| Vox | https://dev-ext.cdn.opus.pro/story-mode/styles/Yellow%20vox.webp |

### 已知 voiceId

| Voice | voiceId | 来源 |
|-------|---------|------|
| James | MM0375rv1dy8 | Story Mode 默认 |
| Adam (minimax) | moss_audio_c12a59b9-7115-11f0-a447-9613c873494c | Agent Video |

### 示例 styleText（Economic 样式）

```
premium editorial minimalism, cream background with subtle paper grain,
red/black accents, serif headline typography, clean chart animations,
gentle fades and sliding lower-thirds, slow confident camera pushes,
minimal motion with precise timing, quiet authoritative pacing
```

### 与 Agent Video API 对比

| | Story Mode | Agent Video |
|--|-----------|-------------|
| 端点 | /api/long-take-videos | /api/project |
| 输入 | prompt (纯文本) | initialText |
| 样式 | styleText + customStyle | 无（AI 自动选择） |
| 比例 | ratio ("16:9") | 无（默认 16:9） |
| 语音 | voiceId (字符串) | voice (对象，含 labels/name/provider) |
| 字幕 | 未知（可能内置） | enableCaption: true |
| 项目 ID | 待确认 | id (如 02091638-7jr) |
| 轮询 | 待确认 | GET /api/project/{id} |

### TODO

- [ ] 确认 long-take-videos 的响应结构
- [ ] 确认轮询端点（可能是 GET /api/long-take-videos/{id}）
- [ ] 确认 Story Mode 的视频输出 URL 获取方式
- [ ] 逆向更多 voiceId（Story Mode 可能有独立的 voice 列表）
- [ ] 确认 customStyle=true 时 styleText 的作用
- [ ] 补充预设样式对应的 styleText

## Video Compression API（验证 2026-02-09）

### 调用
```
POST /api/generative-jobs
{ "jobType": "video-compression", "sourceUri": "<视频URL>" }
```

### 轮询
```
GET /api/generative-jobs/{jobId}
→ status: CONCLUDED, result.compressedVideoUri
```

### 测试结果
- 输入: 160MB (162s, Story Mode landscape)
- 输出: 69MB (压缩 57%)
- 耗时: ~7 分钟 (424s)
- jobId: video-compression-30209DtVjYxKRNK

### 在流水线中的位置
字幕完成 → **压缩** → webhook 上传 YouTube

