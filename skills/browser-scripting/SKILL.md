---
name: browser-scripting
description: 浏览器页面脚本工具，通过 Chrome 扩展直接操控浏览器标签页，支持跨 tab 执行 JavaScript、抓取页面数据、操作 DOM 等
---

# Browser Scripting Skill

通过 genspark-agent Chrome 扩展提供的页面脚本能力，直接在浏览器标签页中执行 JavaScript。这些工具由扩展的 background.js 处理，在页面的 MAIN world 中运行，可绕过 CSP/Cloudflare 限制。

## 工具列表

### 1. list_tabs

查询当前浏览器中所有打开的标签页。

**参数**: 无

**返回**: JSON 数组，每个元素包含:
- `id` (number) — 标签页唯一 ID，用于 eval_js 的 targetTabId
- `title` (string) — 页面标题
- `url` (string) — 页面 URL
- `active` (boolean) — 是否为当前活跃标签
- `windowId` (number) — 所属窗口 ID

**调用示例**:

```
Ω{"tool":"list_tabs","params":{}}ΩSTOP
```

**返回示例**:
```json
[
  {
    "id": 1698024191,
    "title": "Google",
    "url": "https://www.google.com/",
    "active": true,
    "windowId": 1698024189
  },
  {
    "id": 1698024270,
    "title": "GitHub",
    "url": "https://github.com/",
    "active": false,
    "windowId": 1698024189
  }
]
```

---

### 2. eval_js

在指定标签页的 MAIN world 中执行 JavaScript 代码。可访问页面的全局变量、DOM、cookie、localStorage 等。

**参数**:
- `code` (string, 必需) — 要执行的 JavaScript 代码。用 `return` 语句返回结果
- `tabId` (number, 可选) — 目标标签页 ID。不指定则在当前 tab 执行

**特性**:
- 在页面的 MAIN world 执行，与页面自身脚本共享全局作用域
- 支持 async/await 和 Promise 返回值
- 对象结果自动 JSON.stringify，基本类型转为字符串
- 执行超时: 10 秒
- 绕过 CSP 和 Cloudflare 保护

**调用示例**:

在当前 tab 执行:
```
Ω{"tool":"eval_js","params":{"code":"return document.title"}}ΩSTOP
```

在指定 tab 执行:
```
Ω{"tool":"eval_js","params":{"code":"return document.title","tabId":1698024270}}ΩSTOP
```

获取页面所有链接:
```
Ω{"tool":"eval_js","params":{"code":"return Array.from(document.querySelectorAll('a[href]')).map(a => ({text: a.textContent.trim(), href: a.href})).filter(a => a.text)"}}ΩSTOP
```

读取 localStorage:
```
Ω{"tool":"eval_js","params":{"code":"return JSON.stringify(Object.fromEntries(Object.entries(localStorage)))"}}ΩSTOP
```

读取 cookie:
```
Ω{"tool":"eval_js","params":{"code":"return document.cookie"}}ΩSTOP
```

async 示例 (fetch API):
```
Ω{"tool":"eval_js","params":{"code":"const r = await fetch('/api/data'); const data = await r.json(); return data"}}ΩSTOP
```

---

### 3. js_flow

浏览器 JS 微型工作流引擎。多步骤顺序执行，支持延迟、等待条件、上下文传递。适合需要多步交互的浏览器自动化场景。

**参数**:
- `steps` (array, 必需) — 步骤数组，每步包含:
  - `code` (string) — 要执行的 JS 代码，可用 `ctx` 访问前几步的结果数组
  - `label` (string) — 步骤标签，用于日志和结果标识
  - `delay` (number) — 执行前等待毫秒数
  - `waitFor` (string) — 等待条件: CSS 选择器（等待元素出现）或 JS 表达式（等待返回 true）
  - `waitTimeout` (number) — waitFor 超时，默认 15000ms
  - `optional` (boolean) — 失败时是否继续下一步
  - `continueOnError` (boolean) — 出错时是否继续
  - `tabId` (number) — **步骤级 tabId**，覆盖 flow 级 tabId，实现跨 tab 工作流
- `tabId` (number, 可选) — flow 级默认目标标签页 ID，可被每步的 step.tabId 覆盖
- `timeout` (number, 可选) — 总超时，默认 60000ms

**上下文传递**: 每步代码中可访问 `ctx` 数组，包含前面所有步骤的结果:
```js
ctx = [
  { step: "label1", success: true, result: "..." },
  { step: "label2", success: true, result: "..." }
]
```

**调用示例**:

在 hix.ai 聊天中发送问题并等待回复:
```
Ω{"tool":"js_flow","params":{"tabId":1698024278,"timeout":30000,"steps":[
  {"label":"clear","code":"const e=document.querySelector('div[contenteditable=\"true\"]'); e.focus(); e.textContent=''; return 'cleared'"},
  {"label":"type","code":"const e=document.querySelector('div[contenteditable=\"true\"]'); const ev=new InputEvent('beforeinput',{inputType:'insertText',data:'Hello!',bubbles:true,cancelable:true,composed:true}); e.dispatchEvent(ev); return 'typed'","delay":500},
  {"label":"send","code":"document.querySelector('button[class*=\"rounded-[20px]\"]').click(); return 'sent'","delay":1000},
  {"label":"wait","waitFor":"article","waitTimeout":20000,"code":"const articles=document.querySelectorAll('article'); return articles[articles.length-1]?.textContent?.substring(0,3000) || 'no reply'"}
]}}ΩSTOP
```

通用网页表单填写并提交:
```
Ω{"tool":"js_flow","params":{"tabId":12345,"steps":[
  {"label":"fill_name","code":"document.querySelector('#name').value='John'; return 'filled'"},
  {"label":"fill_email","code":"document.querySelector('#email').value='john@example.com'; return 'filled'","delay":300},
  {"label":"submit","code":"document.querySelector('form').submit(); return 'submitted'","delay":500},
  {"label":"wait_result","waitFor":".success-message","waitTimeout":10000,"code":"return document.querySelector('.success-message').textContent"}
]}}ΩSTOP
```

等待页面加载后抓取数据:
```
Ω{"tool":"js_flow","params":{"tabId":12345,"steps":[
  {"label":"wait_table","waitFor":"table tbody tr","code":"return 'table ready'"},
  {"label":"scrape","code":"const rows=document.querySelectorAll('table tr'); return Array.from(rows).map(r=>Array.from(r.cells).map(c=>c.textContent.trim()))"}
]}}ΩSTOP
```

---

## 典型工作流

### 跨 Tab 操作

#### 方式一: eval_js 逐步操作
1. 先用 `list_tabs` 获取所有标签页，找到目标 tab 的 ID
2. 用 `eval_js` + `tabId` 在目标 tab 中执行代码

```
# 第一步: 查看所有标签页
Ω{"tool":"list_tabs","params":{}}ΩSTOP

# 第二步: 在目标 tab 中抓取数据
Ω{"tool":"eval_js","params":{"code":"return document.querySelector('h1').textContent","tabId":目标tabId}}ΩSTOP
```

#### 方式二: js_flow 跨 tab 工作流 (v1.0.53+)
在一个 js_flow 中，不同步骤可以操作不同的标签页，ctx 自动跨 tab 传递：

```
Ω{"tool":"js_flow","params":{"timeout":30000,"steps":[
  {"label":"get_from_A","tabId":111,"code":"return document.querySelector('.price').textContent"},
  {"label":"get_from_B","tabId":222,"code":"return document.querySelector('.price').textContent"},
  {"label":"compare","tabId":111,"code":"const priceA = ctx[0].result; const priceB = ctx[1].result; return `A: ${priceA}, B: ${priceB}`"}
]}}ΩSTOP
```

每步的 `step.tabId` 会覆盖 flow 级的 `tabId`，未指定则使用 flow 级默认值或当前 tab。

### 页面数据抓取

抓取表格数据:
```
Ω{"tool":"eval_js","params":{"code":"const rows = document.querySelectorAll('table tr'); return Array.from(rows).map(r => Array.from(r.cells).map(c => c.textContent.trim()))"}}ΩSTOP
```

### 自动填表

```
Ω{"tool":"eval_js","params":{"code":"document.querySelector('#username').value = 'myuser'; document.querySelector('#email').value = 'me@example.com'; return 'filled'"}}ΩSTOP
```

### 页面截图/内容提取

获取页面完整 HTML:
```
Ω{"tool":"eval_js","params":{"code":"return document.documentElement.outerHTML.substring(0, 50000)"}}ΩSTOP
```

获取页面可见文本:
```
Ω{"tool":"eval_js","params":{"code":"return document.body.innerText.substring(0, 30000)"}}ΩSTOP
```

---

## 注意事项

1. **用 return 返回结果** — eval_js 内部会用 `new Function(code)` 包裹代码，必须用 `return` 才能拿到返回值
2. **结果长度限制** — 返回内容过长会被截断，建议用 `.substring()` 控制
3. **超时 10 秒** — 长时间操作可能超时，复杂任务建议拆分
4. **跨域限制** — eval_js 在目标页面的域下执行，fetch 等请求受该页面的同源策略约束
5. **结果发回发起 tab** — 跨 tab 执行时，结果始终返回给发起请求的 tab（当前对话 tab），不会丢失
6. **对象自动序列化** — 返回对象会自动 `JSON.stringify`，无需手动转换
