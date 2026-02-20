# AudioCleaner AI Skill

通过 audiocleaner.ai 的逆向 API 实现音频转视频和 AI 播客生成，无水印，无需登录。

## 概述

- **站点**: https://audiocleaner.ai
- **能力**: 音频转视频、AI 播客生成（文本/网页/YouTube/文档 → 多人对话播客）
- **特点**: 无需登录、无水印、支持公开 URL 直传、多种宽高比/语言/风格
- **限制**: 音频最大 500MB，时长最长 30 分钟；未登录有次数限制

> ⚠️ 所有 API 请求需要在 audiocleaner.ai 的浏览器 tab 中通过 `eval_js` 发起（同源），直接 curl 会被 Cloudflare 拦截。

---

## 一、Audio-to-Video API

将音频文件转换为 AI 生成的配图视频。

### 1. 获取预签名上传 URL（本地文件用）

```
POST /audio/api/v1/oss/presign_url
Content-Type: application/json

{ "file_name": "example.mp3" }
```

返回预签名 URL，用 `PUT` 上传文件。上传后替换域名：
- `https://6877db...r2.cloudflarestorage.com/audiocleaner/...` → `https://resource.audiocleaner.ai/...`

大文件（>100MB）用分片上传：
- `POST /audio/api/v1/oss/init-multipart-upload`
- `POST /audio/api/v1/oss/complete`

### 2. 创建视频任务

```
POST /audio/api/v1/audio-to-video/task/create
Content-Type: application/json

{
  "inputurl": "音频URL（支持公开URL直传）",
  "language": "auto",
  "aspect_ratio": "16:9",
  "uuid": "任意用户标识",
  "credit_time": 60
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| inputurl | string | ✅ | 音频 URL，支持公开 URL 直传 |
| language | string | ✅ | `"auto"` 自动检测，或语言代码 |
| aspect_ratio | string | ✅ | `"1:1"` `"16:9"` `"3:2"` `"2:3"` `"3:4"` `"4:3"` `"9:16"` |
| uuid | string | ✅ | 用户标识，任意字符串 |
| credit_time | number | ✅ | 音频时长（秒） |

可选 Header: `Turnstile-Token`

成功返回: `{ code: 100000, data: { global_id: "xxx" } }`

### 3. 轮询视频结果

```
POST /audio/api/v1/audio-to-video/task/get
{ "uuid": "xxx", "global_id": "xxx" }
```

| status | 含义 | 操作 |
|--------|------|------|
| waiting | 处理中 | 每 5-10 秒轮询 |
| success | 完成 | `result` 字段为视频 URL |
| error | 失败 | 可重试 |

### 实战示例

```
// 创建任务
Ω{"tool":"eval_js","params":{"code":"var p={inputurl:'音频URL',language:'auto',aspect_ratio:'16:9',uuid:'agent-001',credit_time:60}; return fetch('/audio/api/v1/audio-to-video/task/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)}).then(function(r){return r.json()})","tabId":TAB_ID}}ΩSTOP

// 轮询结果（async_task）
Ω{"tool":"async_task","params":{"code":"return fetch('/audio/api/v1/audio-to-video/task/get',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uuid:'agent-001',global_id:'GLOBAL_ID'})}).then(function(r){return r.json()}).then(function(d){return {status:d.data?d.data.status:'unknown',result:d.data?d.data.result:null}})","condition":"result.status === 'success' || result.status === 'error'","interval":10000,"timeout":600000,"tabId":TAB_ID,"label":"等待视频生成"}}ΩSTOP
```

---

## 二、AI Podcast API

将文本/网页/YouTube/文档转换为多人对话播客音频。

### 流程概览

```
1. task/create → 生成脚本（返回 podcast_script + highlights）
2. task/get → 轮询脚本状态
3. [可选] text-to-image/create + get → 生成封面图
4. audio/start → 启动音频合成（传入脚本）
5. audio/get → 轮询音频结果（返回 file_url）
```

### Step 1: 创建播客脚本

```
POST /audio/api/v1/podcast/task/create
Content-Type: application/json

{
  "uuid": "任意用户标识",
  "status": 4,
  "text": "输入文本内容",
  "speakers": [15810, 15822],
  "language": "en",
  "style": 1,
  "duration": 2,
  "use_mode": "ai",
  "commercial_use": 0
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| uuid | string | ✅ | 用户标识 |
| status | int | ✅ | 输入类型: `1`=网页URL, `2`=YouTube URL, `3`=文档, `4`=文本 |
| text | string | 条件 | status=4 时必填，文本内容 |
| url | string | 条件 | status=1/2 时必填，网页或YouTube URL |
| speakers | int[] | ✅ | voice ID 数组（数字ID，来自 voice 列表） |
| language | string | ✅ | 语言代码: `en` `zh` `ja` `ko` `es` `fr` `de` `pt` `ru` `ar` `it` `zh_yue` |
| style | int | ✅ | 风格: `0`=无(manual模式), `1`=教育, `2`=访谈, `3`=深度, `4`=叙事, `5`=新闻, `6`=脱口秀, `7`=个人成长, `8`=搞笑, `9`=吐槽 |
| duration | int | ✅ | 时长: `1`=0-1min, `2`=1-3min, `3`=3-5min, `4`=5-7min, `5`=7-8min, `6`=8-10min, `7`=10-15min |
| use_mode | string | ✅ | `"ai"` AI自动生成, `"manual"` 手动编辑 |
| commercial_use | int | ✅ | `0`=非商用, `1`=商用 |

可选 Header: `Turnstile-Token`

成功返回: `{ code: 100000, data: { global_id: "xxx" } }`

### Step 2: 轮询脚本结果

```
POST /audio/api/v1/podcast/task/get
{ "uuid": "xxx", "global_id": "xxx" }
```

成功返回包含: `status`, `title`, `processed_content`, `podcast_script`(数组), `hightlights`, `podcast_script_txt`

`podcast_script` 数组每项: `{ role, name, avatar, text, voice_id }`

### Step 3（可选）: 生成封面图

```
POST /audio/api/v1/podcast/task/text-to-image/create
{ "uuid": "xxx", "global_id": "xxx" }
```

轮询: `POST /audio/api/v1/podcast/task/text-to-image/get` → 返回 `image_url`

### Step 4: 启动音频合成

```
POST /audio/api/v1/podcast/task/audio/start
Content-Type: application/json

{
  "global_id": "脚本的global_id",
  "uuid": "用户标识",
  "title": "播客标题",
  "processed_content": "描述文本",
  "avatar": null,
  "podcast_script": [...脚本数组...],
  "hightlights": [...高亮数组...]
}
```

> podcast_script 和 hightlights 直接传入 Step 2 返回的数据，可以在调用前编辑脚本内容。

成功返回: `{ code: 100000, data: { global_id: "xxx" } }`

### Step 5: 轮询音频结果

```
POST /audio/api/v1/podcast/task/audio/get
{ "global_id": "xxx", "uuid": "xxx" }
```

| status | 含义 | 操作 |
|--------|------|------|
| waiting | 合成中 | 每 5-10 秒轮询 |
| success | 完成 | `file_url` 字段为音频 MP3 URL |
| failed | 失败 | 可重试 |

### 常用 Speakers (voice ID)

**English:**
| ID | Name | 性别 |
|----|------|------|
| 15810 | Calm Woman | F |
| 15822 | Aussie Bloke | M |
| 15809 | Bossy Leader | M |
| 15811 | Assertive Queen | F |

**Chinese (Mandarin):**
| ID | Name | 性别 | 特点 |
|----|------|------|------|
| 16098 | Unrestrained Young Man | M | 不羁青年 |
| 16100 | Warm Bestie | F | 闺蜜，清脆 |
| 16091 | Reliable Executive | M | 稳重中年 |
| 16087 | News Anchor | F | 新闻主播 |
| 16086 | Mature Woman | F | 成熟女性 |
| 16090 | Refreshing Young Man | M | 清爽青年 |
| 16079 | Humorous Elder | M | 幽默大叔 |
| 16077 | Gentleman | M | 绅士 |
| 16096 | Stubborn Friend | M | 倔强朋友 |
| 16097 | Sweet Lady | F | 温柔女士 |
| 16094 | Southern Young Man | M | 南方青年 |
| 16101 | Warm Girl | F | 温暖少女 |
| 16102 | Wise Women | F | 知性女性 |
| 16076 | Gentle Youth | M | 温柔少年 |
| 16085 | Male Announcer | M | 男播音员 |
| 16089 | Radio Host | M | 电台主持 |
| 16084 | Lyrical Voice | M | 抒情嗓音 |
| 16081 | Kind-hearted Antie | F | 热心阿姨 |
| 16082 | Kind-hearted Elder | F | 慈祥长辈 |
| 16073 | Cute Spirit | F | 可爱精灵(童声) |

> 吐槽/搞笑推荐组合: `[16098, 16100]`（不羁青年 + 闺蜜）或 `[16079, 16100]`（幽默大叔 + 闺蜜）
> 新闻/严肃推荐组合: `[16091, 16087]`（稳重中年 + 新闻主播）
> 完整 voice 列表可通过 `POST /audio/api/v1/podcast/voice/page` 获取
> 默认 voice 列表: `POST /audio/api/v1/podcast/voice/default/list`

### Host 组合（预设对话搭档）

12 种语言，每种 5 组搭档，通过 JSON 获取:
`https://resource.audiocleaner.ai/acweb/podcast_host_list.json`

主要语言: zh, zh_yue, en, ar, ru, es, fr, pt, de, ja, it, ko

### 实战示例：文本生成播客全流程

```
// Step 1: 创建脚本
Ω{"tool":"eval_js","params":{"code":"var p={uuid:'agent-001',status:4,text:'你的文本内容',speakers:[15810,15822],language:'en',style:1,duration:2,use_mode:'ai',commercial_use:0}; return fetch('/audio/api/v1/podcast/task/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)}).then(function(r){return r.json()})","tabId":TAB_ID}}ΩSTOP

// Step 2: 轮询脚本
Ω{"tool":"async_task","params":{"code":"return fetch('/audio/api/v1/podcast/task/get',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uuid:'agent-001',global_id:'GLOBAL_ID'})}).then(function(r){return r.json()}).then(function(d){return {status:d.data?d.data.status:'unknown',title:d.data?d.data.title:null}})","condition":"result.status === 'success' || result.status === 'failed'","interval":8000,"timeout":600000,"tabId":TAB_ID,"label":"等待脚本生成"}}ΩSTOP

// Step 3: 获取完整脚本数据后，启动音频合成
Ω{"tool":"eval_js","params":{"code":"... fetch task/get 拿完整数据 → fetch audio/start 传入 ...","tabId":TAB_ID}}ΩSTOP

// Step 4: 轮询音频
Ω{"tool":"async_task","params":{"code":"return fetch('/audio/api/v1/podcast/task/audio/get',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uuid:'agent-001',global_id:'GLOBAL_ID'})}).then(function(r){return r.json()}).then(function(d){return {status:d.data?d.data.status:'unknown',file_url:d.data?d.data.file_url:null}})","condition":"result.status === 'success' || result.status === 'failed'","interval":10000,"timeout":600000,"tabId":TAB_ID,"label":"等待音频合成"}}ΩSTOP
```

---

## 三、其他可用 API

| 功能 | 创建任务 | 获取结果 |
|------|---------|----------|
| 音频增强 | `/audio/api/v1/clean/enhance/create` | `/audio/api/v1/clean/enhance/get` |
| 音频分离 | `/audio/api/v1/separate/task/create` | `/audio/api/v1/separate/task/get` |
| AI音频生成 | `/audio/api/v1/audio-generator/task/create` | `/audio/api/v1/audio-generator/task/get` |
| 语音克隆 | `/audio/api/v1/cloning/task/create` | `/audio/api/v1/cloning/task/get` |
| 音频翻译 | `/audio/api/v1/audio-translator/task/create` | `/audio/api/v1/audio-translator/task/get` |
| 音频转文字 | `/audio/api/v1/audio-transcription/task/create` | `/audio/api/v1/audio-transcription/task/get` |
| 动画生成 | `/audio/api/v1/animation/task/create` | `/audio/api/v1/animation/task/get` |
| 混音 | `/audio/api/v1/mashup/task/create` | `/audio/api/v1/mashup/task/get` |
| 播客列表 | `/audio/api/v1/podcast/list` | - |
| 播客详情 | `/audio/api/v1/podcast/detail` | - |
| Voice列表 | `/audio/api/v1/podcast/voice/page` | - |
| Voice默认 | `/audio/api/v1/podcast/voice/default/list` | - |
| Voice上传 | `/audio/api/v1/podcast/voice/upload` | `/audio/api/v1/podcast/voice/upload/status` |

## 四、支持的音频格式

aac, aiff, m4a, mp3, wav, midi, mid, wma

## 五、错误码

| code | 含义 |
|------|------|
| 100000 | 成功 |
| 100002 | 参数错误 |
| 40000 | 参数错误 |
| 100099 | 需要重试 |
| 100100 | credit 不足 |
| 100400 | 超出限制 |
| 100500 | 超出限制 |
| 800001 | Cloudflare 验证失败 |

## 六、踩坑记录

### 必须通过浏览器 tab 发请求
**问题**: curl 直接请求会被 Cloudflare 拦截返回 403
**解决**: 必须通过 eval_js 在 audiocleaner.ai 的 tab 中发起 fetch

### 公开 URL 可直接作为 inputurl
**发现**: 任意公开可访问的音频 URL 都可以直接传入，无需上传

### uuid 可以是任意字符串
**发现**: uuid 只用于关联创建和查询，不需要真实用户 ID

### speakers 必须是数字 ID 数组
**问题**: 传入 host_id 字符串如 "3-1" 会报 Params Error
**解决**: speakers 参数需要传 voice 表中的数字 id，如 `[15810, 15822]`

### Podcast 是多阶段流程
**问题**: 以为一个 API 就能完成
**实际**: 需要 create → get(脚本) → audio/start → audio/get(音频) 共 4 步

### 未登录也可使用
**发现**: 未登录状态可创建任务，但有次数限制。首次使用后可能触发登录提示或 Cloudflare 验证

### audiocleaner.ai 需要加入扩展 host_permissions
**解决**: 编辑 extension/manifest.json 添加 `audiocleaner.ai/*` 和 `*.audiocleaner.ai/*`

### ⭐ Turnstile Token 必须手动渲染获取
**问题**: API 返回 `800001 Cloudflare Token Required` 或 `800000 Token Validation Failed:['timeout-or-duplicate']`。页面上虽然加载了 turnstile API，但没有自动渲染 widget，`turnstile.getResponse()` 返回空
**解决**: 必须手动渲染 Turnstile widget 获取 token，流程如下：
1. **Sitekey**: `0x4AAAAAABCQXI9TH_Yb4q0W`（从 `PeSBko41.js` 中逆向获取）
2. **渲染 widget**:
```
Ω{"tool":"eval_js","params":{"code":"var div = document.createElement('div'); div.id = 'cf-turnstile-agent'; div.style.cssText = 'position:fixed;bottom:10px;right:10px;z-index:99999'; document.body.appendChild(div); window._agentToken = null; turnstile.render('#cf-turnstile-agent', {sitekey: '0x4AAAAAABCQXI9TH_Yb4q0W', callback: function(t){ window._agentToken = t; }}); return {rendered: true}","tabId":TAB_ID}}ΩSTOP
```
3. **等待 token 生成**（约 3-8 秒）:
```
Ω{"tool":"js_flow","params":{"steps":[{"label":"wait","code":"return {ready: !!window._agentToken}","delay":5000},{"label":"get","code":"return {token: window._agentToken, ready: !!window._agentToken}"}],"tabId":TAB_ID}}ΩSTOP
```
4. **使用 token**: 在 fetch headers 中加 `'Turnstile-Token': window._agentToken`
5. **Token 有时效性**: 获取后必须尽快使用（几秒内），不能存着以后用。每次 API 调用前都要重新渲染获取
6. **重新获取 token**: 先清空容器再渲染：
```
var el = document.getElementById('cf-turnstile-agent'); if (el) el.innerHTML = '';
turnstile.render('#cf-turnstile-agent', {sitekey: '0x4AAAAAABCQXI9TH_Yb4q0W', callback: function(t){ window._agentToken = t; }});
```

### ⭐ audio/start 传参必须用 API 返回的原始数据
**问题**: eval_js 中手动拼装 podcast_script 数组（含大量中文和嵌套对象）极易因 JSON 多层转义导致语法错误（`Unexpected token ':'`、`Unexpected identifier`、`Invalid or unexpected token` 等）
**解决**: **绝对不要在 eval_js 中手动拼 podcast_script 数据！** 正确做法：
1. 先用 eval_js 调 `task/get` 把完整数据存到 `window._fullData`
2. 再用 eval_js 直接引用 `window._fullData` 发起 `audio/start`
```
// Step 1: 存储完整脚本数据
Ω{"tool":"eval_js","params":{"code":"var p = {uuid: 'xxx', global_id: 'xxx'}; return fetch('/audio/api/v1/podcast/task/get', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(p)}).then(function(r){ return r.json() }).then(function(d){ window._fullData = d.data; return {ok: true, scriptLen: d.data.podcast_script.length} })","tabId":TAB_ID}}ΩSTOP

// Step 2: 获取新 token 并立即发起 audio/start
Ω{"tool":"eval_js","params":{"code":"var d = window._fullData; var token = window._agentToken; var payload = {global_id: d.global_id, uuid: 'xxx', title: d.title, processed_content: d.processed_content, avatar: null, podcast_script: d.podcast_script, hightlights: d.hightlights}; return fetch('/audio/api/v1/podcast/task/audio/start', {method: 'POST', headers: {'Content-Type': 'application/json', 'Turnstile-Token': token}, body: JSON.stringify(payload)}).then(function(r){ return r.json() })","tabId":TAB_ID}}ΩSTOP
```

### ⭐ eval_js 中避免复杂中文嵌套对象
**问题**: eval_js 的 code 参数经过 JSON 序列化 → 传输 → JS 执行多层处理，中文字符 + 对象字面量中的冒号/引号极易冲突，导致各种语法错误
**解决**: 
- 简单数据（uuid、global_id 等字符串）可以在 eval_js 中直接写
- 复杂数据（podcast_script 大数组）**必须**通过 API 拉取存到 window 变量，再引用变量发请求
- 不要在 eval_js 中写包含中文的对象字面量数组

### ⭐ Podcast 完整最佳实践流程
1. **获取 Turnstile token**（渲染 widget，等 3-8 秒）
2. **创建脚本** `task/create`（带 Turnstile-Token header）
3. **轮询脚本** `task/get`（用 async_task，无需 token）
4. **脚本完成后**：用 eval_js 调 `task/get` 把完整数据存到 `window._fullData`
5. **获取新 Turnstile token**（重新渲染 widget）
6. **启动音频合成** `audio/start`（引用 `window._fullData`，带新 token）
7. **轮询音频** `audio/get`（用 async_task，无需 token）

> 关键：token 获取和使用之间不要有太多中间步骤，获取后立即用

## 七、逆向日期

2026-02-17
