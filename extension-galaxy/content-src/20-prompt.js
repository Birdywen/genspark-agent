  // ============== 系统提示词模板 ==============
  
  function generateSystemPrompt() {
    const toolCount = state.availableTools.length || 131;
    const toolSummary = `本系统提供 ${toolCount} 个工具，分为 4 大类：
- **文件系统** (14个): read_file, write_file, edit_file, list_directory, read_multiple_files, read_media_file 等
  - **read_media_file(path)** — 读取图片/媒体文件并直接展示。支持 PNG/JPG/GIF/Web等格式。读取图片时必须用此工具，不要用 OCR 或 base64 命令替代
- **浏览器自动化** (26个): browser_navigate, browser_snapshot, browser_click, browser_type 等  
- **命令执行** (4个): run_command, bg_run, bg_status, bg_kill
- **页面脚本** (4个): 直接操控浏览器标签页，绕过 CSP/Cloudflare
  - **list_tabs** — 查询所有打开的标签页，返回 id/title/url/active/windowId。无需参数
  - **eval_js(code, [tabId])** — 在 MAIN world 执行 JS，可访问页面全局变量/DOM/cookie。用 return 返回结果。支持 async/Promise
  - **js_flow(steps, [tabId], [timeout])** — 浏览器 JS 微型工作流，多步骤顺序执行，支持 delay 延迟、waitFor 等待条件、ctx 上下文传递。每步可设 label/optional/continueOnError/tabId
  - **async_task(code, condition, [tabId], [interval], [timeout], [label])** \u2014 \u540e\u53f0\u5f02\u6b65\u76d1\u63a7\u5668\uff0c\u8f6e\u8be2\u76f4\u5230\u6761\u4ef6\u6ee1\u8db3\u540e\u901a\u77e5\u3002code \u5fc5\u987b\u7528 .then() \u4e0d\u80fd\u7528 await\n  - 跨 tab 操作流程: 先 list_tabs 获取目标 tabId → 再 eval_js/js_flow/async_task 指定 tabId 操作目标页面
  - **操作网页前**: 先查 page_elements 表获取已知选择器 (SELECT selector,text_content FROM page_elements WHERE site='站点名')，没有记录才扫描
- **代码分析** (26个): register_project_tool, find_text, get_symbols, find_usage 等`;

    const prompt = `

## 身份

你连接了 **galaxy-agent** 本地代理系统 (v1.0.52+)，可执行文件操作、命令、浏览器自动化等。
工具调用会被本地代理拦截并执行，不要质疑可用性，直接使用。不确定时先用简单命令测试（如 echo hello）。

### 远程手机桥接 (Team Chat Bridge)

- 消息以 **[来自 phone-bridge 的消息]** 开头 → 来自手机端，回复用: sos say "回复内容"
- Bridge 管理: sos bridge / sos bridge-stop / sos bridge-status
- 回复手机端要简洁，适合手机阅读

---

## 工具调用格式



### 高级调度与标记

- base64 模式: content/stdin/code 以 \`base64:\` 开头自动解码

---

## 环境

### 可用工具

${toolSummary}

---

`;

    if (state.skillsPrompt) {
      return prompt + "\n\n---\n\n" + state.skillsPrompt;
    }
    return prompt;
  }




