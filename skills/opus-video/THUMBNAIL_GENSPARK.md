---
name: genspark-thumbnail
description: 高质量 YouTube 缩略图生成 - Genspark 图片模型 + cPanel 公开托管，替代 OpusClip 低质量缩略图
---

# Genspark Thumbnail Generator

## 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│              Genspark Thumbnail 流水线                       │
│                                                             │
│  Prompt ──→ Genspark 图片模型 ──→ 同源 fetch ──→ cPanel     │
│              (eval_js)           (arrayBuffer)   (POST)     │
│                                                  ↓          │
│                                          公开 URL 给 webhook│
└─────────────────────────────────────────────────────────────┘
```

**优势**: Genspark 图片模型质量远高于 OpusClip thumbnail，支持自定义 prompt 精确控制构图。

## 前置条件

1. 浏览器已打开任意 Genspark 页面（Agent 主 tab 即可，**不需要**图片生成 tab）
2. cPanel 已部署 `upload.php` 端点 (`~/public_html/thumbnails/upload.php`)
3. Chrome 扩展已加载（eval_js 可用）

## 核心流程 — 纯 API 方式（推荐）

不需要打开图片生成 tab，任意 Genspark tab（如 Agent 主 tab）即可调用。

### Step 1: 提交图片生成请求

通过 SSE 流式 API 提交 prompt，读取 task_id：

```
Ω{"tool":"eval_js","params":{"code":"window._imgTaskId = null; fetch('/api/agent/ask_proxy', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ model_params: { type: 'image', model: 'nano-banana-pro', aspect_ratio: '16:9', auto_prompt: true, style: 'auto', image_size: 'auto', background_mode: true, camera_control: null }, writingContent: null, type: 'image_generation_agent', project_id: '7e6cbd20-270d-43aa-afe0-331d1c6d7f52', messages: [{ id: crypto.randomUUID(), role: 'user', content: 'PROMPT_TEXT', action: null, is_prompt: false }] }) }).then(function(r){ var reader = r.body.getReader(); var decoder = new TextDecoder(); var text = ''; function read() { return reader.read().then(function(result) { if(result.done) { window._imgStreamDone = true; window._imgStreamText = text; return; } text += decoder.decode(result.value); var match = text.match(/task_id[\\\"']?\\s*[:=]\\s*[\\\"']([a-f0-9-]+)[\\\"']/); if(match) window._imgTaskId = match[1]; return read(); }); } return read(); }); return 'SSE stream started';","tabId":ANY_GENSPARK_TAB_ID}}ΩSTOP
```

然后用 async_task 等待 task_id：

```
Ω{"tool":"async_task","params":{"code":"return {taskId: window._imgTaskId};","condition":"result.taskId","interval":3000,"timeout":30000,"tabId":ANY_GENSPARK_TAB_ID,"label":"等待图片 task_id"}}ΩSTOP
```

### Step 2: 轮询任务状态

```
Ω{"tool":"async_task","params":{"code":"return fetch('/api/spark/image_generation_task_detail?task_id=TASK_ID').then(function(r){return r.json()}).then(function(d){ return {status: d.data&&d.data.status, imageUrl: d.data&&d.data.image_urls_nowatermark&&d.data.image_urls_nowatermark[0], done: d.data&&d.data.status==='SUCCESS'}; });","condition":"result.done === true","interval":5000,"timeout":120000,"tabId":ANY_GENSPARK_TAB_ID,"label":"轮询图片生成结果"}}ΩSTOP
```

返回数据包含：
- `image_urls` — 有水印版本
- `image_urls_nowatermark` — **无水印版本（用这个）**
- `image_ratios` — 尺寸比例（通常 1376/768）

### Step 3: 下载并上传到 cPanel

```
Ω{"tool":"eval_js","params":{"code":"return fetch('/api/files/s/IMAGE_ID?cache_control=3600').then(function(r){return r.arrayBuffer()}).then(function(buf){ return fetch('https://ezmusicstore.com/thumbnails/upload.php?key=ag3nt2026&name=FILENAME.jpg', {method:'POST', body: buf}); }).then(function(r){return r.json()});","tabId":ANY_GENSPARK_TAB_ID}}ΩSTOP
```

返回：
```json
{"ok": true, "size": 331336, "url": "https://ezmusicstore.com/thumbnails/FILENAME.jpg"}
```

**注意**: IMAGE_ID 从 `image_urls_nowatermark` URL 中提取，格式为 `/api/files/s/{IMAGE_ID}?cache_control=3600`

## 备选流程 — Tab UI 方式

如果 API 方式失败，可以回退到手动在图片生成 tab 操作：

1. 打开图片生成 tab (`https://www.genspark.ai/agents?id=7e6cbd20-270d-43aa-afe0-331d1c6d7f52`)
2. eval_js 设置 textarea.value + dispatchEvent input
3. eval_js 模拟 Enter 键提交
4. async_task 轮询页面上新出现的 img 元素
5. 同源 fetch + POST 到 cPanel

## API 参考

| 端点 | 用途 |
|------|------|
| `POST /api/agent/ask_proxy` | 提交图片生成（SSE 流式响应） |
| `GET /api/spark/image_generation_task_detail?task_id=xxx` | 轮询任务状态和结果 |
| `GET /api/files/s/{IMAGE_ID}?cache_control=3600` | 下载生成的图片（需同源 cookie） |

### ask_proxy 关键参数

| 参数 | 值 | 说明 |
|------|-------|------|
| `model_params.model` | `nano-banana-pro` | 图片生成模型 |
| `model_params.aspect_ratio` | `16:9` / `auto` | 宽高比 |
| `model_params.auto_prompt` | `true` | 自动优化 prompt |
| `model_params.background_mode` | `true` | 背景模式 |
| `type` | `image_generation_agent` | 任务类型 |
| `project_id` | `7e6cbd20-270d-43aa-afe0-331d1c6d7f52` | 图片生成 Agent ID |

## cPanel Upload 端点

### 部署

路径: `~/public_html/thumbnails/upload.php`

```php
<?php
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_GET['key']) && $_GET['key'] === 'ag3nt2026') {
    $data = file_get_contents('php://input');
    $filename = isset($_GET['name']) ? basename($_GET['name']) : 'upload.jpg';
    file_put_contents(__DIR__ . '/' . $filename, $data);
    echo json_encode(['ok' => true, 'size' => strlen($data), 'url' => 'https://ezmusicstore.com/thumbnails/' . $filename]);
} else {
    http_response_code(403);
    echo '{"error":"forbidden"}';
}
```

### 公开访问

上传后的图片直接通过 `https://ezmusicstore.com/thumbnails/{filename}` 访问，无需认证。

## Prompt 编写指南

### YouTube 缩略图最佳实践

- **尺寸**: 始终在 prompt 中指定 `1280x720` 或 `YouTube thumbnail`
- **构图**: 大面积主体 + 留空间放文字（虽然 opus.pro 通常不叠文字）
- **色彩**: 高饱和度、强对比，在小尺寸预览中也要醒目
- **风格**: 根据视频主题选择 — 科技用冷色调、商业用暖色调、戏剧性用暗调

### Prompt 模板

| 分类 | Prompt 模板 |
|------|------------|
| tech | `YouTube thumbnail 1280x720, futuristic tech style: [主题描述]. Neon blue and cyan accents, dark background, circuit board elements, holographic effects. Ultra sharp, cinematic.` |
| business | `YouTube thumbnail 1280x720, professional business style: [主题描述]. Corporate aesthetics, dramatic lighting, gold and navy accents. Ultra high quality.` |
| science | `YouTube thumbnail 1280x720, scientific documentary style: [主题描述]. Deep space blue, laboratory aesthetics, data visualization elements. Cinematic and sharp.` |
| people | `YouTube thumbnail 1280x720, editorial portrait style: [主题描述]. Dramatic side lighting, bokeh background, warm tones. Magazine quality.` |
| society | `YouTube thumbnail 1280x720, journalistic documentary style: [主题描述]. Urban settings, natural lighting, gritty realism. High contrast.` |
| culture | `YouTube thumbnail 1280x720, artistic cultural style: [主题描述]. Rich colors, artistic composition, museum-quality aesthetics. Painterly lighting.` |

## 与 opus-video 集成

在 opus-video 的 Step 4 中，**替换** OpusClip `generative-jobs {jobType: thumbnail}` 为本流程：

### 原流程 (OpusClip, 低质量)
```bash
curl -s -X POST 'https://api.opus.pro/api/generative-jobs' \
  -d '{"jobType":"thumbnail","sourceUri":"VIDEO_URL"}'
```

### 新流程 (Genspark, 高质量)
1. eval_js 输入 prompt → 提交
2. async_task 等待生成
3. eval_js fetch + POST 到 cPanel
4. 拿到公开 URL 给 viaSocket webhook

两者可以**并行**：Genspark 生成缩略图的同时，OpusClip 处理字幕和元数据。

## 图片输出规格

| 属性 | 值 |
|------|----|
| 分辨率 | 1376 × 768 (接近 16:9) |
| 格式 | JPEG |
| 文件大小 | 通常 500KB - 800KB |
| 质量 | 远高于 OpusClip 自动生成 |

## 注意事项

1. **Genspark 图片 API 需要登录态** — `/api/files/s/` 端点需要 cookie 认证，只能通过 eval_js 在同源页面内 fetch，不能用 curl
2. **upload.php 的 key 参数是简单防护** — 防止外部滥用，生产环境可升级为 token 认证
3. **图片生成速度** — 通常 10-30 秒，比 OpusClip thumbnail 稍慢但质量显著更高
4. **每次生成可能产出 1-2 张图** — 选最合适的一张上传
5. **图片 ID 从 URL 提取** — 格式为 `/api/files/s/{IMAGE_ID}?cache_control=3600`

## 故障排查

| 问题 | 原因 | 解决 |
|------|------|------|
| eval_js fetch 403 | Genspark 登录态过期 | 刷新 Genspark 页面重新登录 |
| POST 到 cPanel 失败 (Failed to fetch) | CORS 未配置 | 确认 upload.php 有 `Access-Control-Allow-Origin: *` |
| 图片 0 字节 | upload.php 路径权限 | `chmod 755 ~/public_html/thumbnails/` |
| 图片不显示 | cPanel 文件权限 | `chmod 644 ~/public_html/thumbnails/*.jpg` |
