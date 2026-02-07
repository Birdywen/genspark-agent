---
name: opus-video
description: Agent Opus (opus.pro) AI 视频生成平台 API，支持通过 API 创建视频项目、查询状态、获取结果。需要在浏览器中已登录 opus.pro
---

# Agent Opus Video Skill

通过 Agent Opus 的 API 实现自动化视频生成。所有 API 调用需在 opus.pro 的 tab 中通过 eval_js 执行（利用已登录的 session）。

## 前置条件

1. 浏览器中已打开并登录 `https://agent.opus.pro/`
2. manifest.json 中已添加 `opus.pro` 的 host_permissions
3. 用 `list_tabs` 找到 opus.pro 的 tabId

## 认证信息

所有 API 请求需要以下 headers，可从 localStorage 获取：

```javascript
const token = JSON.parse(localStorage.getItem('atom:user:access-token'));
const orgId = JSON.parse(localStorage.getItem('atom:user:org-id'));
const userId = JSON.parse(localStorage.getItem('atom:user:org-user-id'));

const headers = {
  'Authorization': 'Bearer ' + token,
  'X-OPUS-ORG-ID': orgId,
  'X-OPUS-USER-ID': userId,
  'X-OPUS-SHARED-ID': '',
  'Accept': 'application/json',
  'Content-Type': 'application/json'
};
```

## API 基础路径

`https://api.opus.pro`

## API 端点

### 1. 创建视频项目

**POST** `/api/project`

创建新的视频生成项目。提交后 AI Agent 会自动开始处理（研究主题、写脚本、生成分镜、渲染视频）。

**请求体：**
```json
{
  "initialText": "Create a video of this news [主题内容]. Please ensure the facts are accurate. Here are additional sources to reference: [参考链接]",
  "voice": {
    "labels": ["English (US)", "Female", "Entertainment", "Engaging"],
    "name": "Lily",
    "provider": "minimax",
    "type": "voice-over",
    "voiceId": "moss_audio_c12a59b9-7115-11f0-a447-9613c873494c"
  },
  "enableCaption": true
}
```

**initialText 格式模板：**
- 新闻视频: `Create a video of this news [标题]. Please ensure the facts are accurate. Here are additional sources to reference: [URL]`
- 普通主题: `Create a video about [主题描述]`
- 带脚本: `Create a video with this script: [完整脚本]`

**返回:** 201 Created，包含项目详情（id, stage, name 等）

**示例：**
```
Ω{"tool":"eval_js","params":{"code":"return (async () => { const token = JSON.parse(localStorage.getItem('atom:user:access-token')); const orgId = JSON.parse(localStorage.getItem('atom:user:org-id')); const userId = JSON.parse(localStorage.getItem('atom:user:org-user-id')); const h = {'Authorization': 'Bearer ' + token, 'X-OPUS-ORG-ID': orgId, 'X-OPUS-USER-ID': userId, 'X-OPUS-SHARED-ID': '', 'Accept': 'application/json', 'Content-Type': 'application/json'}; const r = await fetch('https://api.opus.pro/api/project', {method: 'POST', headers: h, body: JSON.stringify({initialText: 'Create a video about AI trends in 2026', voice: {labels: ['English (US)', 'Female', 'Entertainment', 'Engaging'], name: 'Lily', provider: 'minimax', type: 'voice-over', voiceId: 'moss_audio_c12a59b9-7115-11f0-a447-9613c873494c'}, enableCaption: true})}); return await r.json(); })()","tabId":OPUS_TAB_ID}}ΩSTOP
```

---

### 2. 获取项目详情

**GET** `/api/project/{projectId}`

获取项目的完整信息，包括当前阶段、脚本、视频结果等。

**关键返回字段：**
- `id` — 项目 ID
- `stage` — 当前阶段: INITIALIZING → SCRIPT → STORYBOARD → RENDERING → COMPLETE
- `script` — AI 生成的视频脚本
- `scriptConfirmed` — 脚本是否已确认
- `resultVideo` — 最终视频 URL（生成完成后）
- `watermarkVideo` — 带水印的预览视频 URL
- `previewThumbnail` — 视频缩略图
- `voiceOverJson` — 配音设置
- `isDeleted` — 是否已删除
- `createdAt` / `updatedAt` — 时间戳

---

### 3. 查询 Agent 状态

**GET** `/api/agent/{projectId}/status`

检查视频生成 Agent 是否还在运行。

**返回：**
```json
{"data": {"isRunning": true, "clientCount": 1}}
```

---

### 4. 获取项目场景

**GET** `/api/project/{projectId}/scene`

获取视频的分镜/场景列表。

---

### 5. 获取项目资产

**GET** `/api/project/{projectId}/assets`

获取项目使用的素材资源。

---

### 6. 获取项目历史

**GET** `/api/history/{projectId}?page=1&pageSize=100`

获取 Agent 的完整对话历史，包括:
- Director 意图分析
- Scriptwriter 脚本生成
- 用户确认记录
- 各阶段进度

---

### 7. 获取项目列表

**GET** `/api/project?page=1&pageSize=18&q=me&sort=createdAt`

获取当前用户的所有项目。

---

### 8. 获取配额

**GET** `/api/quotas`

获取当前账户的使用配额：
- `s2v` — 视频生成次数（每日限额 + 奖励）
- `aimg` — AI 图片次数
- `storyMode` — Story 模式次数
- `promptEnhance` — 提示词增强次数（每小时）

---

### 9. 获取权益

**GET** `/api/ao/entitlements?q=mine`

获取当前账户的计划类型（FREE / PRO 等）。

---

## 可用声音

### 预设声音
| 名称 | voiceId | 标签 |
|------|---------|------|
| Lily | moss_audio_c12a59b9-7115-11f0-a447-9613c873494c | English (US), Female, Entertainment, Engaging |
| Emma | English_captivating_female1 | English (US), Female, Educational explainers, Captivating |

### 克隆声音
| 名称 | voiceId | Provider |
|------|---------|----------|
| Tennis | MM0375rv1dy8 | minimax |

声音在创建项目时通过 `voice` 参数指定。

---

## 视频生成阶段

```
INITIALIZING → SCRIPT → STORYBOARD → RENDERING → COMPLETE
```

1. **INITIALIZING** — 项目创建，AI 开始分析意图
2. **SCRIPT** — Scriptwriter 生成脚本，等待用户确认
3. **STORYBOARD** — 生成分镜、场景规划
4. **RENDERING** — 渲染视频
5. **COMPLETE** — 视频生成完成，`resultVideo` 可用

---

## 典型工作流

### 完整的视频生成流程

```
# 1. 找到 opus.pro tab
Ω{"tool":"list_tabs","params":{}}ΩSTOP

# 2. 创建项目
Ω{"tool":"eval_js","params":{"code":"return (async () => { const token = JSON.parse(localStorage.getItem('atom:user:access-token')); const orgId = JSON.parse(localStorage.getItem('atom:user:org-id')); const userId = JSON.parse(localStorage.getItem('atom:user:org-user-id')); const h = {'Authorization': 'Bearer ' + token, 'X-OPUS-ORG-ID': orgId, 'X-OPUS-USER-ID': userId, 'X-OPUS-SHARED-ID': '', 'Accept': 'application/json', 'Content-Type': 'application/json'}; const r = await fetch('https://api.opus.pro/api/project', {method: 'POST', headers: h, body: JSON.stringify({initialText: 'YOUR_PROMPT_HERE', voice: {labels: ['English (US)', 'Female', 'Entertainment', 'Engaging'], name: 'Lily', provider: 'minimax', type: 'voice-over', voiceId: 'moss_audio_c12a59b9-7115-11f0-a447-9613c873494c'}, enableCaption: true})}); return await r.json(); })()","tabId":OPUS_TAB_ID}}ΩSTOP

# 3. 轮询状态直到完成
Ω{"tool":"eval_js","params":{"code":"return (async () => { const token = JSON.parse(localStorage.getItem('atom:user:access-token')); const orgId = JSON.parse(localStorage.getItem('atom:user:org-id')); const userId = JSON.parse(localStorage.getItem('atom:user:org-user-id')); const h = {'Authorization': 'Bearer ' + token, 'X-OPUS-ORG-ID': orgId, 'X-OPUS-USER-ID': userId, 'X-OPUS-SHARED-ID': '', 'Accept': 'application/json'}; const r = await fetch('https://api.opus.pro/api/project/PROJECT_ID', {headers: h}); const p = await r.json(); return {stage: p.stage, resultVideo: p.resultVideo, script: p.script?.substring(0, 200)}; })()","tabId":OPUS_TAB_ID}}ΩSTOP

# 4. 视频完成后下载
Ω{"tool":"run_command","params":{"command":"curl -o /tmp/video.mp4 'VIDEO_URL'"}}ΩSTOP
```

### 与 YouTube 自动上传整合

```
# 1. 创建视频 (Agent Opus)
# 2. 轮询等待完成
# 3. 下载视频到本地
# 4. 上传到 YouTube (待整合)
```

---

## 注意事项

1. **配额限制** — 免费账户每天 2 次视频生成，注意 `/api/quotas` 检查剩余次数
2. **Token 过期** — JWT token 有过期时间，如果 401 需要刷新页面重新获取
3. **脚本确认** — 部分流程需要用户确认脚本才能继续，可通过 API 或页面操作确认
4. **生成时间** — 视频生成通常需要几分钟，用 agent/status 轮询
5. **跨域执行** — 所有 fetch 必须在 opus.pro 的 tab 中执行（通过 eval_js），确保同源
