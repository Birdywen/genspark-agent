---
name: genspark-image
description: Genspark AI 图片生成器 - 基于 nano-banana-pro 模型，支持任意比例、带文字渲染、自动上传公开托管，可用于缩略图/封面/社交媒体/插图等场景
---

# Genspark Image Generator

## 架构概览

```
┌──────────────────────────────────────────────────────────────────┐
│                 Genspark Image Generator                        │
│                                                                  │
│  Prompt ──→ ask_proxy (SSE) ──→ 轮询 task ──→ 同源 fetch ──→   │
│              (fire-and-forget)   (async_task)   (arrayBuffer)    │
│                                                      │          │
│                                              ┌───────┴───────┐  │
│                                              │ 本地保存      │  │
│                                              │ cPanel 公开URL│  │
│                                              └───────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

## 能力

- 任意比例图片生成：16:9, 9:16, 1:1, 4:3, 3:4 等
- 直接在图片中渲染英文文字（标题、标语、水印等）
- 无水印高质量输出（JPEG, 通常 400-800KB）
- 自动上传到 cPanel 获取公开 URL
- 10-30 秒生成速度

## 前置条件

1. 浏览器已打开任意 Genspark 页面（需要登录态）
2. Chrome 扩展已加载（eval_js 可用）
3. cPanel upload.php 已部署（如需公开 URL）

## 快速使用（3 步）

### Step 1: 提交生成请求（eval_js fire-and-forget）

在任意 Genspark tab 执行，发送请求后立即 return，不等 SSE 响应完成：

```
Ω{"tool":"eval_js","params":{"code":"window._imgTid=null; window._imgDone=false; var mp={}; mp.model='nano-banana-pro'; mp.aspect_ratio='ASPECT_RATIO'; mp.auto_prompt=true; mp.background_mode=true; var tp={}; tp.type='image_generation_agent'; tp.project_id='7e6cbd20-270d-43aa-afe0-331d1c6d7f52'; tp.model_params=mp; tp.messages=[{id:Date.now().toString(),role:'user',content:'PROMPT_HERE',created_at:new Date().toISOString()}]; fetch('/api/agent/ask_proxy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(tp)}).then(function(r){return r.text()}).then(function(t){var p=t.split('task_id'); if(p.length>1){var pat=new RegExp('([a-f0-9]+-[a-f0-9]+-[a-f0-9]+-[a-f0-9]+-[a-f0-9]+)'); var u=p[1].match(pat); if(u) window._imgTid=u[1];} window._imgDone=true;}); return 'started';","tabId":GENSPARK_TAB_ID}}ΩSTOP
```

然后轮询 task_id：
```
Ω{"tool":"async_task","params":{"code":"return {taskId:window._imgTid,done:window._imgDone};","condition":"result.taskId","interval":3000,"timeout":30000,"tabId":GENSPARK_TAB_ID,"label":"等待图片task_id"}}ΩSTOP
```

### Step 2: 轮询图片生成完成

**注意**：返回结构是 `d.data.status`，不是 `d.status`。

```
Ω{"tool":"async_task","params":{"code":"return fetch('/api/spark/image_generation_task_detail?task_id=TASK_ID').then(function(r){return r.json()}).then(function(d){return {status:d.data.status, urls:d.data.image_urls_nowatermark};});","condition":"result.status === 'SUCCESS'","interval":5000,"timeout":120000,"tabId":GENSPARK_TAB_ID,"label":"图片生成轮询"}}ΩSTOP
```

### Step 3: 下载图片

**方式 A — 上传到 cPanel 获取公开 URL：**

```
Ω{"tool":"eval_js","params":{"code":"return fetch('/api/files/s/IMAGE_ID?cache_control=3600').then(function(r){return r.arrayBuffer();}).then(function(buf){return fetch('https://ezmusicstore.com/thumbnails/upload.php?key=ag3nt2026&name=FILENAME.jpg',{method:'POST',body:buf});}).then(function(r){return r.json();});","tabId":GENSPARK_TAB_ID}}ΩSTOP
```

返回：`{"ok":true, "size":422825, "url":"https://ezmusicstore.com/thumbnails/FILENAME.jpg"}`

**方式 B — 浏览器下载到本地：**

```
Ω{"tool":"eval_js","params":{"code":"return fetch('/api/files/s/IMAGE_ID?cache_control=3600').then(function(r){return r.blob()}).then(function(blob){var url=URL.createObjectURL(blob); var a=document.createElement('a'); a.href=url; a.download='FILENAME.jpg'; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); return {ok:true, size:blob.size};});","tabId":GENSPARK_TAB_ID}}ΩSTOP
```

## 关键参数

### aspect_ratio 选项

| 值 | 用途 | 输出分辨率（约） |
|----|------|------------------|
| `16:9` | YouTube 横屏缩略图、博客头图 | 1376 × 768 |
| `9:16` | YouTube Shorts、Instagram Story | 768 × 1376 |
| `1:1` | Instagram 帖子、头像 | 1024 × 1024 |
| `4:3` | 演示文稿、传统显示器 | 1024 × 768 |
| `3:4` | Pinterest、竖版海报 | 768 × 1024 |
| `auto` | 模型自动判断 | 取决于内容 |

### model_params 完整参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `model` | string | 是 | 固定 `nano-banana-pro` |
| `aspect_ratio` | string | 是 | 见上表 |
| `auto_prompt` | bool | 否 | `true` 自动优化 prompt，推荐开启 |
| `background_mode` | bool | 否 | `true` 背景模式 |
| `style` | string | 否 | `auto` 自动风格 |
| `image_size` | string | 否 | `auto` 自动尺寸 |
| `camera_control` | null | 否 | 预留参数 |

### ask_proxy 请求体结构

```javascript
{
  model_params: { model, aspect_ratio, auto_prompt, background_mode },
  type: 'image_generation_agent',
  project_id: '7e6cbd20-270d-43aa-afe0-331d1c6d7f52',
  messages: [{
    id: 'unique_id',
    role: 'user',
    content: 'prompt text',
    created_at: 'ISO timestamp'
  }]
}
```

**注意**：必须用 `messages` 数组，不能用 `query` 字段，否则不触发图片生成。

### task_detail 返回结构

```javascript
{
  status: 0,           // HTTP 层状态码，不是任务状态！
  message: "...",
  data: {
    status: "SUCCESS", // 真正的任务状态：PENDING / PROCESSING / SUCCESS / FAILED
    image_urls: [...],              // 有水印
    image_urls_nowatermark: [...],  // 无水印（用这个）
    image_ratios: [...]
  }
}
```

## Prompt 编写指南

### 通用原则

1. **明确指定方向**：aspect_ratio 参数不完全可靠，必须在 prompt 中明确写方向
   - 横屏：`"landscape 16:9 widescreen ..."`
   - 竖屏：`"vertical 9:16 portrait ..."`
   - 方形：`"square 1:1 ..."`

2. **带文字渲染**：模型可直接渲染清晰英文文字，不需要后期叠加
   - `"Bold white text at top: TITLE. Red text below: SUBTITLE."`

3. **高质量关键词**：`ultra sharp, cinematic, 8K, professional, high quality`

### 场景 Prompt 模板

| 场景 | Prompt 模板 |
|------|------------|
| YouTube 缩略图 | `YouTube thumbnail 1280x720 with bold text. [风格]: [场景描述]. [文字指令]. [色彩/光线]. Ultra sharp, cinematic.` |
| 社交媒体帖子 | `Social media post square 1:1. [场景描述]. Clean modern design, vibrant colors, eye-catching.` |
| 博客头图 | `Blog header image landscape 16:9. [主题描述]. Professional, clean, modern aesthetic.` |
| Instagram Story | `Instagram story vertical 9:16 portrait. [场景描述]. Mobile-optimized, bold visuals, trendy.` |
| 产品展示 | `Product showcase [比例]. [产品描述]. Studio lighting, clean background, commercial quality.` |
| 插图 | `Digital illustration [比例]. [场景描述]. [艺术风格]. Detailed, professional illustration.` |

### 风格关键词

| 风格 | 关键词 |
|------|--------|
| 科技 | `futuristic, neon blue, dark background, circuit board, holographic` |
| 商务 | `corporate, dramatic lighting, gold and navy, professional` |
| 科学 | `deep space blue, laboratory, data visualization, documentary` |
| 人物 | `editorial portrait, dramatic side lighting, bokeh, warm tones` |
| 新闻 | `journalistic, urban, natural lighting, gritty realism, high contrast` |
| 艺术 | `rich colors, artistic composition, museum-quality, painterly lighting` |
| 简约 | `minimal, clean, white space, geometric, modern` |
| 复古 | `retro, vintage film, grain, muted colors, nostalgic` |

## cPanel Upload 端点

路径：`~/public_html/thumbnails/upload.php`

**关键**：URL 必须带 `?key=ag3nt2026&name=文件名.jpg`，POST body 直接传 raw arrayBuffer。不带 key 返回 `{"error":"forbidden"}`。

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

## 输出规格

| 属性 | 值 |
|------|----|  
| 格式 | JPEG |
| 文件大小 | 通常 400KB - 800KB |
| 速度 | 10-30 秒 |
| 每次产出 | 1-2 张图 |

## 踩坑经验（必读）

### eval_js 构建 payload 必须用变量赋值

不要在对象字面量中直接写 `type: 'image_generation_agent'`，会被多层 JSON 解析搞坏报 `Unexpected identifier`。正确写法：
```javascript
var tp = {};
tp.type = 'image_generation_agent';
tp.project_id = '7e6cbd20-270d-43aa-afe0-331d1c6d7f52';
```

### ask_proxy 是 SSE 流，eval_js 10 秒超时不够

ask_proxy 返回 SSE 流式响应，完整读取需要 15-30 秒。**禁止**在一个 eval_js 里等待完成。正确做法：
1. eval_js 发送 fetch，结果存 `window._xxx` 变量，立即 return
2. async_task 轮询 `window._xxx` 是否有值

### task_detail 状态在 data 层

返回 `{status: 0, data: {status: 'SUCCESS', ...}}`。轮询条件用 `d.data.status === 'SUCCESS'`，不是 `d.status`。

### cPanel upload 必须带 key 和 name 参数

URL: `https://ezmusicstore.com/thumbnails/upload.php?key=ag3nt2026&name=xxx.jpg`
- 不带 key → `{"error":"forbidden"}`
- POST body 是 raw arrayBuffer，不是 multipart form-data

### aspect_ratio 参数不完全可靠

`model_params.aspect_ratio` 设为 `9:16` 不一定生成竖屏图。**必须**在 prompt 中明确写方向。生成后用 `identify` 或浏览器 `new Image()` 验证尺寸。

### Genspark 图片 API 需要登录态

`/api/files/s/` 需要 cookie 认证，只能通过 eval_js 在 Genspark tab 同源 fetch，**不能用 curl 下载**。

### eval_js 中禁止复杂正则

多层转义（JSON → JS → RegExp）会搞坏正则。提取 task_id 用 `split('task_id')` + 简单 UUID pattern：
```javascript
var pat = new RegExp('([a-f0-9]+-[a-f0-9]+-[a-f0-9]+-[a-f0-9]+-[a-f0-9]+)');
```
不要用 `{8}` 这样的量词，花括号在多层转义中不安全。

### 图片不能用 curl 下载后验证

curl 下载 Genspark 图片会拿到 JSON 错误响应（需要登录态）。验证尺寸用：
- 上传到 cPanel 后 `curl + identify`
- 或 eval_js 中 `new Image()` 检查 width/height

## 故障排查

| 问题 | 原因 | 解决 |
|------|------|------|
| eval_js 超时 | ask_proxy SSE 流太长 | fire-and-forget + async_task 轮询 |
| Unexpected identifier | 对象字面量含特殊词 | 用变量赋值方式构建对象 |
| task_detail 返回但轮询不停 | 用了 `d.status` 而非 `d.data.status` | 改为 `d.data.status === 'SUCCESS'` |
| cPanel forbidden | 缺少 key 参数 | URL 加 `?key=ag3nt2026&name=xxx.jpg` |
| 图片比例不对 | aspect_ratio 不可靠 | prompt 中明确写方向 + 生成后验证 |
| curl 下载得到 JSON | 需要登录态 | 只能 eval_js 同源 fetch |
| eval_js 正则报错 | 多层转义 | 用 `new RegExp()` + 简单 pattern |
