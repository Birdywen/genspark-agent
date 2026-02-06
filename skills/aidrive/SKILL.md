# AI Drive Skill

通过 `eval_js` 直接调用 Genspark AI Drive API。无需 DevTools、无需 navigate、无需 Chrome DevTools MCP。

## 原理

`eval_js` 在当前页面的 MAIN world 执行 JS，与 genspark.ai 同源，自动携带 cookie（含 Cloudflare cf_clearance），所有 API 请求直接放行。

## API 端点

| 操作 | 方法 | 端点 |
|------|------|------|
| 列目录 | GET | `/api/aidrive/ls/files/{path}/?filter_type=all&sort_by=name_asc&file_type=all&limit=100` |
| 创建目录 | POST | `/api/aidrive/mkdir/files/{name}/` |
| 上传文件 | POST | `/api/aidrive/upload/files/{dir}/{filename}` (FormData) |
| 下载文件 | GET | `/api/aidrive/download/files/{path}` |
| 删除 | DELETE | `/api/aidrive/delete/files/{path}` (移到回收站) |
| 最近文件 | GET | `/api/aidrive/recent/files?limit=20` |

## 操作方法

### 1. 列目录

```
Ω{"tool":"eval_js","params":{"code":"return fetch('/api/aidrive/ls/files/?filter_type=all&sort_by=name_asc&file_type=all&limit=100').then(r => r.json())"}}ΩSTOP
```

列子目录：
```
Ω{"tool":"eval_js","params":{"code":"return fetch('/api/aidrive/ls/files/目录名/?filter_type=all&sort_by=name_asc&file_type=all&limit=100').then(r => r.json())"}}ΩSTOP
```

### 2. 创建目录

```
Ω{"tool":"eval_js","params":{"code":"return fetch('/api/aidrive/mkdir/files/新目录名/', {method:'POST'}).then(r => r.json())"}}ΩSTOP
```

### 3. 上传文件

**上传文本内容：**
```
Ω{"tool":"eval_js","params":{"code":"var blob = new Blob(['文件内容'], {type:'text/plain'}); var form = new FormData(); form.append('file', blob, 'filename.txt'); return fetch('/api/aidrive/upload/files/目录名/filename.txt', {method:'POST', body:form}).then(r => r.json())"}}ΩSTOP
```

**上传本地文件（配合 run_command 读取 base64）：**
1. 先用 run_command 读取文件为 base64: `base64 < /path/to/file`
2. 再用 eval_js 上传：
```
Ω{"tool":"eval_js","params":{"code":"var b64 = 'BASE64内容'; var bin = atob(b64); var arr = new Uint8Array(bin.length); for(var i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i); var blob = new Blob([arr], {type:'image/png'}); var form = new FormData(); form.append('file', blob, 'filename.png'); return fetch('/api/aidrive/upload/files/目录名/filename.png', {method:'POST', body:form}).then(r => r.json())"}}ΩSTOP
```

### 4. 下载/读取文件

**文本文件：**
```
Ω{"tool":"eval_js","params":{"code":"return fetch('/api/aidrive/download/files/路径/文件名.txt').then(r => r.text())"}}ΩSTOP
```

**二进制文件（通过 thumbnail URL + curl）：**
先 ls 获取 thumbnail URL，再用 run_command 下载：
```
Ω{"tool":"run_command","params":{"command":"curl -o output.png 'THUMBNAIL_URL'"}}ΩSTOP
```

### 5. 删除文件/目录

```
Ω{"tool":"eval_js","params":{"code":"return fetch('/api/aidrive/delete/files/路径/文件名', {method:'DELETE'}).then(r => r.json())"}}ΩSTOP
```

### 6. 最近文件

```
Ω{"tool":"eval_js","params":{"code":"return fetch('/api/aidrive/recent/files?limit=20').then(r => r.json())"}}ΩSTOP
```

## 完整 CRUD 流程

```
ls     → eval_js + fetch GET
mkdir  → eval_js + fetch POST
upload → eval_js + fetch POST + FormData
read   → eval_js + fetch GET
delete → eval_js + fetch DELETE
```

## 对比旧方案

| | 旧方案 (DevTools MCP) | 新方案 (eval_js) |
|---|---|---|
| 前提 | 需开 DevTools + MCP 连接 | 无需任何额外工具 |
| 步骤 | navigate → evaluate → snapshot | 一条 eval_js |
| 返回 | 需解析页面文本 | 直接拿到 JSON |
| 速度 | 慢（页面加载+截图） | 快（纯 API 调用） |
| 可靠性 | 依赖 DevTools 连接 | 极高（原生 fetch） |
