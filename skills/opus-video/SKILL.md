---
name: opus-video
description: Agent Opus (opus.pro) AI 视频生成 + YouTube 自动上传，支持分类 prompt 模板、自动 metadata 提取
---

# Agent Opus Video Skill

通过 Agent Opus API 实现自动化视频生成并上传 YouTube。

## 核心流程（一键）

```
话题 → 分类 prompt 模板 → Opus 创建项目 → AI 自动生成脚本/分镜/视频
→ 从项目结果提取 name/script → 构建 YouTube metadata → viaSocket webhook → YouTube
```

**关键点**: 只需要提供话题和类别，其他全自动。Opus 生成的 `name` 就是最好的 YouTube 标题，`script` 前几句就是最好的描述。

## 前置条件

1. 浏览器中已打开并登录 `https://agent.opus.pro/`
2. manifest.json 中已添加 `opus.pro` 的 host_permissions
3. 用 `list_tabs` 找到 opus.pro 的 tabId

## 两种模式

### 模式 A: Story Video（故事版，推荐）

新 API，支持 16:9，直接给 transcript，Opus 生成画面。

**端点**: `POST /api/long-take-videos`

**参数**:
- `prompt`: transcript 全文（最长约 450 words）
- `ratio`: `"16:9"` 或 `"9:16"`（Shorts）
- `customStyle`: `false`（用预设风格）或 `true`
- `styleText`: 风格描述文本
- `voiceId`: 配音 ID

**可用 Style**:
| Style | 适合题材 |
|-------|----------|
| 2D Line | 轻松、教育 |
| Animation | 通用 |
| Collage | 趣味、文化 |
| Blue Vox | 科技、未来 |
| Claire | 优雅、人物 |
| Claymation | 趣味、儿童 |
| Economic | 商业、数据 |
| Halftone | 新闻、纪实 |
| Marcinelle | 漫画风 |
| Pen&Ink | 严肃、历史 |
| Schematic | 科学、技术 |
| Watercolor | 艺术、文化 |
| Vox | 新闻解说 |

**Style 对应的 styleText**:
```
2D Line: "Clean 2D line art animation with minimal color palette"
Pen&Ink: "Stylize the image with whimsical corporate line art, hand-drawn doodle fidelity, a stark black-and-white palette with spot-color accents, and loose ink contours with stipple-dot shading."
Halftone: "Halftone print style with bold dots, newspaper aesthetic, dramatic contrast"
Watercolor: "Soft watercolor painting style with flowing colors and gentle brushstrokes"
```

**示例**:
```
Ω{"tool":"eval_js","params":{"code":"return (async () => { const token = JSON.parse(localStorage.getItem('atom:user:access-token')); const orgId = JSON.parse(localStorage.getItem('atom:user:org-id')); const userId = JSON.parse(localStorage.getItem('atom:user:org-user-id')); const h = {'Authorization': 'Bearer ' + token, 'X-OPUS-ORG-ID': orgId, 'X-OPUS-USER-ID': userId, 'X-OPUS-SHARED-ID': '', 'Accept': 'application/json', 'Content-Type': 'application/json'}; const r = await fetch('https://api.opus.pro/api/long-take-videos', {method: 'POST', headers: h, body: JSON.stringify({prompt: 'YOUR_TRANSCRIPT', ratio: '16:9', customStyle: false, styleText: 'YOUR_STYLE', voiceId: 'moss_audio_c12a59b9-7115-11f0-a447-9613c873494c'})}); return await r.json(); })()","tabId":OPUS_TAB_ID}}ΩSTOP
```

### 模式 B: AI Agent Video（传统模式）

旧 API，给 topic，Opus AI 自动研究、写脚本、生成视频。适合新闻类。

## 快速使用

### 1. 创建视频（AI 自动处理一切）

```
Ω{"tool":"eval_js","params":{"code":"return (async () => { const token = JSON.parse(localStorage.getItem('atom:user:access-token')); const orgId = JSON.parse(localStorage.getItem('atom:user:org-id')); const userId = JSON.parse(localStorage.getItem('atom:user:org-user-id')); const h = {'Authorization': 'Bearer ' + token, 'X-OPUS-ORG-ID': orgId, 'X-OPUS-USER-ID': userId, 'X-OPUS-SHARED-ID': '', 'Accept': 'application/json', 'Content-Type': 'application/json'}; const r = await fetch('https://api.opus.pro/api/project', {method: 'POST', headers: h, body: JSON.stringify({initialText: 'YOUR_PROMPT_HERE', voice: {labels: ['English (US)', 'Female', 'Entertainment', 'Engaging'], name: 'Lily', provider: 'minimax', type: 'voice-over', voiceId: 'moss_audio_c12a59b9-7115-11f0-a447-9613c873494c'}, enableCaption: true})}); const p = await r.json(); return JSON.stringify({id: p.id, stage: p.stage, name: p.name}); })()","tabId":OPUS_TAB_ID}}ΩSTOP
```

### 2. 查询项目状态

```
Ω{"tool":"eval_js","params":{"code":"return (async () => { const token = JSON.parse(localStorage.getItem('atom:user:access-token')); const orgId = JSON.parse(localStorage.getItem('atom:user:org-id')); const userId = JSON.parse(localStorage.getItem('atom:user:org-user-id')); const h = {'Authorization': 'Bearer ' + token, 'X-OPUS-ORG-ID': orgId, 'X-OPUS-USER-ID': userId, 'X-OPUS-SHARED-ID': '', 'Accept': 'application/json'}; const r = await fetch('https://api.opus.pro/api/project/PROJECT_ID', {headers: h}); const p = await r.json(); return JSON.stringify({stage: p.stage, name: p.name, script: p.script?.substring(0,300), resultVideo: p.resultVideo, previewThumbnail: p.previewThumbnail}); })()","tabId":OPUS_TAB_ID}}ΩSTOP
```

### 3. 视频完成后上传 YouTube（via viaSocket webhook）

Webhook URL: `https://flow.sokt.io/func/scri42hM0QuZ`

需要的字段（全部从 Opus 项目数据提取）:
- `video_url`: project.resultVideo
- `youtube_title`: project.name + " #Shorts" (最多 100 字符)
- `youtube_description`: script 前 2-3 句 + hashtags + AI disclosure
- `youtube_tags`: 从标题和类别提取

## Prompt 模板（按类别）

| 类别 | 星期 | 时长 | 风格 |
|------|------|------|------|
| tech | Mon/Thu | 45s | 快节奏、数据驱动 |
| people | Tue | 50s | 电影叙事、戏剧弧线 |
| society | Wed | 45s | 调查式、多角度 |
| science | (轮换) | 50s | 视觉隐喻、层层揭示 |
| business | Fri | 45s | 案例分析、可操作洞察 |
| culture | Sat | 50s | 机智观察、流行文化 |
| wildcard | Sun | 45s | 热门话题、病毒传播 |

每个模板自动包含:
- Thumbnail instruction（首帧必须是醒目标题卡）
- Hook requirement（前 3 秒抓住观众）
- AI disclosure statement
- Source citation requirement

## 配额

- 免费账户: 每 12 小时 2 次视频生成
- 检查配额: GET `/api/quotas` → `s2v.daily.available`

## 声音选项

| 名称 | voiceId | 特点 |
|------|---------|------|
| Lily | moss_audio_c12a59b9-7115-11f0-a447-9613c873494c | English (US), Female, Engaging（默认）|
| Emma | English_captivating_female1 | English (US), Female, Captivating |
| Tennis | MM0375rv1dy8 | 克隆声音 |

## 视频阶段

```
INITIALIZING → SCRIPT → STORYBOARD → RENDERING → EDITOR (COMPLETE)
```

通常需要 3-10 分钟完成。`stage === 'EDITOR' && resultVideo` 表示视频已就绪。

## 注意事项

1. JWT token 有效期短，刷新 opus.pro 页面可更新
2. 所有 API 调用必须在 opus.pro tab 中通过 eval_js 执行（同源策略）
3. YouTube 上传后默认 Private，需手动审核后改为 Public
4. 遵守 YouTube 2025 AI 内容政策：每个视频必须有独特叙事，不批量模板化
