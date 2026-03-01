# Context Compress SOP - 上下文压缩标准操作流程

## 触发条件
- 字符数 > 500K 或消息数 > 200 条：提醒用户
- 字符数 > 700K 或消息数 > 300 条：强烈建议压缩
- content.js 会在每次工具调用结果中附带对话状态

## 方案一：按钮压缩（推荐）

Agent 面板上的 🗜️ 压缩按钮，一键完成压缩。

### 流程

**Step 1 — AI 设置压缩总结：**

AI 通过 eval_js 设置总结内容到 window 变量：

    // eval_js
    window.__COMPRESS_SUMMARY = `[上下文压缩总结 - 日期]

    ## 项目/任务
    ...

    ## 已完成
    ...

    ## TODO
    ...`;
    return 'summary set, length: ' + window.__COMPRESS_SUMMARY.length;

总结格式要求：
- 第一行：`[上下文压缩总结 - YYYY-MM-DD]`
- 包含：项目/任务、环境、已完成、关键发现、TODO、关键信息
- 保留所有 project ID、路径、端口号等硬信息
- 简洁但完整，通常 2K-5K 字符

**Step 2 — 用户点击压缩按钮：**

按钮会自动：
1. 读取 window.__COMPRESS_SUMMARY（也支持 localStorage 备份）
2. 调用 ask_proxy API 创建压缩后的新对话上下文
3. 页面自动 reload，对话变成压缩版

**Step 3 — 验证：**

刷新后 AI 应执行 `echo hello` 确认连通，并检查压缩总结是否在上下文中。

### 按钮状态指示

- 正常：橙色背景（#92400e）
- ready 状态：红色闪烁（#dc2626 + pulse 动画）— 表示已检测到总结，可以压缩
- AI 可通过 eval_js 添加 ready class：`document.getElementById('agent-compress').classList.add('ready'); return 'ok';`

### 自动生成总结

AI 可先运行智能提取脚本辅助生成总结：

    bash /Users/yay/workspace/genspark-agent/scripts/context-compress-smart.sh <agent_id> [since_hours]

脚本会自动从 command-history.json 提取操作摘要（创建/编辑文件、部署、错误等），AI 在此基础上补充任务目标和 TODO。

## 方案二：手动 eval_js 压缩（备用）

适用于按钮不可用或需要精细控制编辑位置的场景。

### Phase 1: 智能存档

1. 运行 context-compress-smart.sh 获取自动摘要
2. AI 在模板基础上补充任务目标和 TODO
3. 保存存档到 /Users/yay/workspace/context-archives/

### Phase 2: 浏览器端压缩（延迟执行）

**⚠️ 关键：eval_js 返回结果会触发新消息插入，把编辑器顶走。所以脚本用 6 秒延迟，等消息插入完毕后再操作。**

分两步 eval_js 执行：

**Step 1 — 设置总结内容：**

    // eval_js
    window.__COMPRESS_TARGET_INDEX = 3;  // 编辑第4条用户消息
    window.__COMPRESS_SUMMARY = `[压缩总结文本]`;
    return 'summary set, length: ' + window.__COMPRESS_SUMMARY.length;

**Step 2 — 触发压缩（延迟 6 秒执行）：**

    // eval_js - 执行 context-compress.js 的内容
    // 脚本会：
    //   1. 立即返回 {status: 'timer_set'}
    //   2. 6 秒后滚动到目标消息
    //   3. 打开编辑器、填入总结
    //   4. 显示黄色顶部提示条
    //   5. 等用户手动点击 Save

### Phase 3: 用户手动确认

1. 用户看到黄色提示条 "⚠️ 压缩总结已填入 — 请检查内容后点击下方的 Save 按钮"
2. 用户检查编辑器中的内容
3. 用户点击 Save → Genspark 自动清除后续消息，从压缩总结继续对话

## 检测脚本（AI 每隔 10 轮可执行一次检测）

    // eval_js 检测当前对话状态
    var msgs = document.querySelectorAll('.conversation-statement');
    var userMsgs = document.querySelectorAll('.conversation-statement.user');
    var totalChars = 0;
    msgs.forEach(function(m) { totalChars += m.textContent.length; });
    return JSON.stringify({total: msgs.length, user: userMsgs.length, chars: totalChars});

## 敏感信息脱敏

压缩流程中自动过滤敏感信息，确保 API key、密码、token 等不会泄露到压缩总结中。

### 过滤层级（三道防线）

1. **对话内容提取时** — content.js 中 `redactSecretsForCompress()` 在传给 AI 生成总结前过滤
2. **AI 生成总结后** — `showCompressModal()` 前再次调用 `redactSecretsForCompress()` 兜底
3. **浏览器端注入时** — context-compress.js 在注入编辑器前做最后一道过滤

### 过滤规则

- `sk-` 开头的 API key（Kimi/DeepSeek/OpenAI 等） → `[REDACTED_API_KEY]`
- 41+ 位 hex 串（保留 40 位 git hash） → `[REDACTED_HEX_KEY]`
- 环境变量赋值中的敏感值（KEY/SECRET/TOKEN/PASSWORD=xxx） → 变量名保留，值替换为 `[REDACTED]`
- JSON 中的 password/secret/token 字段 → `[REDACTED]`
- URL 中内嵌的认证信息 → `[REDACTED]`
- SSH private key 块 → `[REDACTED_SSH_KEY]`

### Node.js 独立工具

    # 管道模式
    cat summary.md | node scripts/redact-secrets.js

    # 文件模式（自动加载 .env.api 中的已知 key 做精确匹配）
    node scripts/redact-secrets.js summary.md --verbose

### AI 手动写总结时的注意事项

AI 在 eval_js 设置 `__COMPRESS_SUMMARY` 时，**禁止**包含以下内容：
- 实际的 API key 值（只写变量名，如 `KIMI_API_KEY` 而非实际值）
- 密码或 token 明文
- SSH private key 内容

正确示例：`- API 配置: KIMI_API_KEY / DEEPSEEK_API_KEY / 1min.ai KEY (配置在 server-v2/.env.api)`

## 回滚

- 按钮方案：刷新页面即可恢复（ask_proxy 不修改原对话历史）
- 手动方案：点击 Cancel 或刷新页面
- 存档文件在 /Users/yay/workspace/context-archives/ 可随时查看

## 文件清单

| 文件 | 用途 |
|------|------|
| extension/content.js | 实时对话状态监控 + 压缩按钮 + 敏感信息过滤 |
| scripts/redact-secrets.js | 敏感信息脱敏模块（Node.js + CLI） |
| scripts/context-compress-smart.sh | 智能摘要生成（支持 --since，自动脱敏） |
| scripts/context-compress.js | 浏览器端压缩脚本（延迟6秒，备用方案，含兜底过滤） |
| scripts/context-check.js | 对话状态检测 |
| scripts/context-compress-archive.sh | 存档 shell 脚本 |
| scripts/CONTEXT_COMPRESS_SOP.md | 本文档 |
| .agent_memory/history_compressor.js | 历史命令压缩器 v2.1 |
| context-archives/ | 存档目录 |
