# Agent 模式视频发布 — 严格执行手册

> 每一步都是完整的工具调用模板，替换 {{占位符}} 直接执行。
> 禁止自由发挥，禁止跳步，禁止合并步骤到 batch。

## 铁律

- 所有 run_command 用 stdin 模式: {"command":"bash","stdin":"命令"}
- async_task / bg_run / bg_status 必须单独执行，禁止放 batch
- run_command 需要读 stdout 时必独执行，禁止放 batch（batch 会吞 stdout）
- 大文件（>50行）用 run_command stdin heredoc 写，禁止 write_file
- ffmpeg 命令一律先 printf 写 .sh 脚本再 bash 执行
- 元数据直接手写，不用 generative-jobs（guest token 不稳定）
- opus.pro API 只eval_js，禁止 curl
- eval_js 超时后先检查是否已成功，禁止直接重试

## 分类轮换表

| 星期 | 分类 | categoryId | playlist_id |
|------|------|-----------|-------------|
| 一 | tech | 28 | PLYtnUtZt0ZnFNjguN43KAb3aYFwMTYZW |
| 二 | business | 24 | PLYtnUtZt0ZnE0_9LXZTFOlgFxFB-oh8sK |
| 三 | science | 27 | PLYtnUtZtn-PNqSLN-_wPkIFGGCSlw |
| 四 | people | 22 | PLYtnUtZt0ZnGnjjJ3L60TIK7kBT93yRo3 |
| 五 | society | 24 | PLYtnUtZt0ZnFssUY9G1cLpXO-D6JKPHH5 |
| 六 | culture | 24 | PLYtnUtZt0ZnHIwG9vhWqSr6t1vGRr0AQR |
| 日 | wildcard | 24 | PLYtnUtZt0ZnF-oneo7UEDTO_OGJQ12ovZ |

---

## Step 1: 获取 Tabs

```
Ω{"tool":"list_tabs","params":{}}ΩSTOP
```

从结果中记录:
- OPUS_TAB = URL 含 opus.pro 的 tab id
- GS_TAB = URL 含 genspark.ai 的 tab id

缺 opus.pro tab → 让用户打开 https://agent.opus.pro/ 并登录

---

## Step 2: 确认项目

### 如果用户给了项目 URL:
提取 PROJECT_ID（URL 最后一段），跳到 Step 3。

### 如果需要新建:
```
Ω{"tool":"eval_js","params":{"code":"var token=JSON.parse(localStorage.getItem('atom:user:access-token')); var orgId=JSON.parse(localStorage.getItem('atom:user:org-id')); var userId=JSON.parse(localStorage.getItem('atom:user:org-user-id')); return fetch('https://api.opus.pro/api/project',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token,'X-OPUS-ORG-ID':orgId,'X-OPUS-USER-ID':userId,'Origin':'https://agent.opus.pro','Referer':'https://agent.opus.pro/'},body:JSON.stringify({prompt:'{{SCRIPT}}',ratio:'9:16'})}).then(function(r){return r.json()});","tabId":{{OPUS_TAB}}}}ΩSTOP
```
记录 PROJECT_ID。

---

## Step 3: CDN 轮询（后台）

```
Ω{"tool":"async_task","params":{"code":"return fetch('https://s2v-ext.cdn.opus.pro/agent/workspace/{{PROJECT_ID}}/final_video.mp4',{method:'HEAD'}).then(function(r){return {status:r.status,ready:r.status===200};})","condition":"result.ready","interval":30000,"timeout":1800000,"tabId":{{OPUS_TAB}},"label":"CDN轮询"}}ΩSTOP
```

不等结果，立即执行 Step 4。

---

## Step 4: 生成缩略图

### 4a. 发求（fire-and-forget）

```
Ω{"tool":"eval_js","params":{"code":"window._tid=null; window._tdone=false; var mp=; mp.model='nano-banana-pro'; mp.aspect_ratio='9:16'; mp.auto_prompt=true; mp.background_mode=true; var tp={}; tp.type='image_generation_agent'; tp.project_id='7e6cbd20-270d-43aa-afe0-331d1c6d7f52'; tp.model_params=mp; var msg='{{THUMB_PROMPT}}'; tp.messages=[{id:Date.now().toString(),role:'user',content:msg,_at:new Date().toISOString()}]; fetch('/api/agent/ask_proxy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(tp)}).then(function(r){return r.text()}).then(function(t){var p=t.split('task_id'); if(p.length>1){var pat=/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/; var u=p[1].match(pat); if(u) window._tid=u[1];} window._tdone=true;}); return 'started';","tabId":{{GS_TAB}}}}ΩSTOP
```

{{THUMB_PROMPT}} 必须包含 "YouTube Shorts vertical 9:16 portrait thumbnail"

### 4b. 拿 task_id

```
Ω{"tool":"async_task","params":{"code":"return {tid:window._tid,done:window._tdone};","condition":"result.tid","interval":3000,"timeout":30000,"tabId":{{GS_TAB}},"label":"拿task_id"}}ΩSTOP
```

记录 TASK_ID = result.tid

### 4c. 等图片生成完成

```
Ω{"tool":"async_task","params":{"code":"return fetch('/api/spark/image_generation_task_detail?task_id={{TASK_ID}}').then(function(r){return r.json()}).then(function(d){return {status:d.data.status,urls:d.data.image_urls_nowatermark};})","condition":"result.urls","interval":5000,"timeout":120000,"tabId":{{GS_TAB}},"label":"等缩略图"}}ΩSTOP
```

从 result.urls[0] 提取 IMAGE_ID（/api/files/s/{{IMAGE_ID}}?cache_control=3600）

---

## Step 5: 上传缩略图到 cPanel

```
Ω{"tool":"eval_js","params":{"code":"return fetch('/api/files/s/{{IMAGE_ID}}?cache_control=3600').then(function(r){return r.arrayBuffer()}).then(function(buf){return fetch('https://ezmusicstore.com/thumbnails/upload.php?key=ag3nt2026&name={{FILENAME}}.jpg',{method:'POST',body:buf})}).then(function(r){return r.json()});","tabId":{{GS_TAB}}}}ΩSTOP
```

记录 THUMB_URL = https://ezmusicstore.com/thumbnails/{{FILENAME}}.jpg

---

## Step 6: 等视频完成

等 Step 3 的 async_task 通知。如果超时或想手动查:

```
Ω{"tool":"run_command","params":{"command":"bash","stdin":"curl -s -o /dev/null -w '%{http_code}' -I 'https://s2v-ext.cdn.opus.pro/agent/workspace/{{PROJECT_ID}}/final_video.mp4'"}}ΩSTOP
```

200 = 完成。记录 VIDEO_URL = https://s2v-ext.cdn.opus.pro/agent/workspace/{{PROJECT_ID}}/final_video.mp4

---

## Step 7: ffmpeg 嵌入缩略图到视频末尾

Shorts 不支持自定义缩略图，必须嵌入视频让 YouTube 自动选取。
缩略图加到视频最后 1 秒（不要加开头，会导致音频偏移）。

### 7a. 下载素材

```
Ω{"tool":"bg_run","params":{"command":"curl -L -o /private/tmp/original.mp4 '{{VIDEO_URL}}' && curl -L -o /private/tmp/thumb.jpg '{{THUMB_URL}}' && echo DONE"}}ΩSTOP
```

用 bg_status 等完成。

### 7b. 获取视频参数

```
Ω{"tool":"run_command","params":{"command":"bash","stdin":"ffprobe -v quiet -print_format json -show_streams /private/tmp/original.mp4 | python3 -c 'import sys,json;s=json.load(sys.stdin)[\"streams\"];v=[x for x in s if x[\"codec_type\"]==\"video\"][0];a=[x for x in s if x[\"codec_type\"]==\"audio\"][0];print(v[\"width\"],v[\"height\"],v[\"r_frame_rate\"],a[\"sample_rate\"])'"}}ΩSTOP
```

记录 W H FPS SR（如: 1080 1920 25/1 48000）

### 7c. 一条命令搞定

用 printf 写脚本避免转义问题:

```
Ω{"tool":"run_command","params":{"command":"bash","stdin":"printf '#!/bin/bash\nset -e\nffmpeg -y -i /private/tmp/thumb.jpg -vf \"scale={{W}}:{{H}}:force_original_aspect_ratio=decrease,pad={{W}}:{{H}}:(ow-iw)/2:(oh-ih)/2\" /private/tmp/ts.jpg\nffmpeg -y -loop 1 -i /private/tmp/ts.jpg -f lavfi -i \"anullsrc=r={{SR}}:cl=stereo\" -t 1 -c:v libx264 -tune stillimage -pix_fmt yuv420p -r {{FPS}} -c:a aac -ar {{SR}} -shortest /private/tmp/outro.mp4\nffmpeg -y -i /private/tmp/original.mp4 -c:v libx264 -preset faster -crf 18 -r {{FPS}} -pix_fmt yuv420p -c:a aac -ar {{SR}} -ac 2 /private/tmp/main.mp4\nprintf \"file main.mp4\\nfile outro.mp4\\n\" > /private/tmp/cl.txt\nffmpeg -y -f concat -safe 0 -i /private/tmp/cl.txt -c copy /private/tmp/final.mp4\nls -lh /private/tmp/final.mp4\n' > /private/tmp/do.sh && echo ready"}}ΩSTOP
```

替换 {{PS}} {{SR}} 为 7b 获取的值。FPS 如果是 25/1 就写 25。

然后:
```
Ω{"tool":"bg_run","params":{"command":"bash /private/tmp/do.sh"}}ΩSTOP
```

bg_status 等 exited。

### 7d. 上传最终视频

```
Ω{"tool":"bg_run","params":{"command":"curl -s -X POST 'https://ezmusicstore.com/thumbnails/upload.php?key=ag3nt2026&name={{FILENAME}}.mp4' --data-binary @/private/tmp/final.mp4"}}ΩSTOP
```

bg_status 等完成。记录 FINAL_URL。

如果 >50MB 上传失败，直接用原始 CDN URL（没有嵌入缩略图但能用）。

---

## Step 8: 提交 YouTube

手写元数据。title <= 70 字符，hashtag 只放 description。

```
Ω{"tool":"run_command","params":{"command":"bash","stdin":"curl -s -X POST 'https://flow.sokt.io/func/scri42hM0QuZ' -H 'Content-Type: application/json' -d '{\"video_url\":\"{{FINAL_URL}}\",\"thumbnail_url\":\"{{THUMB_URL}}\",\"youtube_title\":\"{{TITLE}}\",\"youtube_description\":\"{{DESCRIPTION}}\",\"playlist_id\":\"{{PLAYLIST_ID}}\",\"category_id\":\"{{CATEGORY_ID}}\"}'"}}ΩSTOP
```

返回 {"data":{"success":true}} 即完成。

---

## 踩坑速查

| 问题 | 解决 |
|------||
| batch 中 async_task/bg_run 报错 | 单独执行 |
| batch 中 run_command 无 stdout | 单独执行 |
| eval_js 超时 | fire-and-forget + window 变量 |
| generative-jobs UNKNOWN | 手写元数据 |
| 缩略图方向错 | prompt 写 vertical 9:16 portrait |
| ffmpeg 转义错 | printf 写 .sh 脚本执行 |
| 401 | 用户刷新 opus.pro 页面 |
| CDN 一直 404 两分钟 | 放弃改 Story 模式 |
| cPanel forbidden | URL 带 ?key=ag3nt2026&name=xxx |
| write_file 大文件失败 | run_command stdin heredoc/printf |
| concat 音频不同步 | 重编码时 sample_rate 必须匹配原视频 |
