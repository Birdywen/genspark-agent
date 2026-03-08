# 自建平台迁移方案 — Agent Standalone

> 创建: 2026-03-08 | 状态: 规划中

## 一、为什么要迁移

| Genspark 限制 | 自建优势 |
|---|---|
| sse-hook fetch 拦截是 hack，平台更新可能搞坏 | 服务端直接拼装 prompt，零 hack |
| VFS 借用平台项目 API，有配额和稳定性风险 | 本地 SQLite/Redis，完全自主 |
| 浏览器扩展沙箱限跨域/CSP 问题 | 全栈自控，无沙箱 |
| 依赖平台 ask_proxy 转发 AI 请求 | 直连 Claude API，延迟更低 |
| 对话 token 上限受平台控制 | 自定义上下文窗口管理 |
| 无法自定义模型参数 (temperature等) | 完全控制推理参数 |

## 二、架构设计

```
┌─────────────────────────────────────────────────┐
│                   前端 (Web UI)                   │
│  Open WebUI / LibreChat / 自研 (React/Vue)       │
│  - 聊天界面 + 工具结果渲染                         │
│  - WebSocket 实时通信                              板: 工具状态、VFS 管理、上下文监控              │
└──────────────────┬──────────────────────────────│ WebSocket / HTTP
┌──────────────────▼──────────────────────────────┐
│              中间层 (Agent Gateway)                │
│  - Prompt 组装 (系统提示词 + VFS 动态注入)          │
│  - ΩHERE / ΩBATCH 解析器                          │
│  - 工具调用路由 (已有 server-v2 逻辑)               │
│  - 上下文管理 (阈值检测 + 自动压缩)                 │
│  - 反向通道 (服务端原生，不需要浏览器中转)           │
│  - SSE 流式响应转发                                 │
└────────┬─────────────────┬──────────────────────┘
         │                 │
┌────────▼───────┐  ┌──────▼──────────────────────┐
│  Claude API     │  │   工具执行层 (server-v2)      │
│  (Anthropic)    │  │   - 文件/命令/浏览器/代码分析  │
│  直连，零中转    │  │   - Skills 系统               │
│  完全控制参数    │  │   - bg_run 后任务           │
└────────────────┘  │   - SSH 远程执行              │
                    └───────────────────────────────┘

┌─────────────────────────────────              存储层                                │
│  - SQLite: VFS 槽位 + 对话历史 + 上下文记忆        │
│  - 文件系统: Skills / 配置 / 日志                   │
│  - (可选) Redis: 会话缓存 + 反向通道队列            │
└─────────────────────────────────────────────────┘
```

## 三、模块迁移清单

### 3.1 直接复用 (零改动)

| 模块 | 文件 | 说明 |
|---|---|---|
| 工具执行核心 | server-v2/index.js (2440行) | 文件/命令/浏览器自动化 |
| 进程管理 | server-v2/process-manager.js | bg_run/bg_status/bg_kill |
| 错误分类 | server-v2/error-classifier.js | 智能错误分析 |
| 重试管理 | server-v2/retry-manager.js | 自动重试策略 |
| 安全校验 | server-v2/safety.js | 路径/命令安全检查 |
| Skills 系统 | server-v2/skills.js + skills/ | 23个 Skill 模块 |
| 健康检查 | server-v2/health-checker.js | 自检机制 |
| 状态管理 | server-v2/state-manager.js | 会话状态 |
| 自校验 | server-v2/self-validator.js | 运行时自检 |
| 异步执行 | server-v2/async-executor.js | 异步任务 |
| 通知推送 | server-v2/notify.js | ntfy 推送 |

### 3.2 需要改造

| 模块 | 当前实现 | 迁移方案 | 工作量 |
|---|---|---|---|
| **VFS 存储** | Genspark 项目 API | SQLite key-value 表 | 2-3小时 |
| **Prompt 注入** | sse-hook.js fetch 拦截 | 服务端 prompt 组装 | 3-4小时 |
| **上下文压缩** | 浏览器端 autoCompress | 服务端调 Claude API | 2-3小时 |
| **反向通道** | 浏览器 __reverseChannel | 服务端 EventEmitter/Redis | 1-2小时 |
| **对话状态** | DOM 计数 (.conversation-statement) | 服务端 token 计数 | 1-2小时 |

### 3.3 需要新建

| 模块 | 说明 | 工作量 |
|---|---|---|
| **Claude API 客户端** | SSE 流式调用，支持 tool_use | 3-4小时 |
| **Agent Gateway** | HTTP/WS 服务，prompt组装+工具路由 | 4-6小时 |
| **Web UI** | 基于 Open WebUI 或自研 | 4-8小时 |
| **ΩHERE 解析器 (服务端)** | 从 SSE 流中提取工具调用 | 2-3小时 |

## 四、关键设计决策

### 4.1 前端选型

**方案 A: Open WebUI (推荐起步)**
- 优点: 开箱即用，支持自定义 API 端点，社区活跃
- 改造: 添加工具结果渲染组件，ΩHERE 格式高亮
- 风险: 定制深度受限

**方案 B: LibreChat**
- 优点: 原生支持 Anthropic API，插件系统
- 改造: 类似 Open WebUI

**方案 C: 自研 (长期最优)**
- 技术栈: Next.js + Tailwind + shadcn/ui
- 优点: 完全控制，可以复刻现有面板(工具状态/VFS管理/压缩按钮)
- 工作量: 最大，但最灵活

### 4.2 Claude API 集成

```javascript
// 核心调用逻辑
const response = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'x-api-key': CLAUDE_API_KEY,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json'
  },
  body: JSON.stringify({
    model: 'claude-opus-4',
    max_tokens: 8192,
    system: buildSystemPrompt(),  // 直接服务端组装！
    messages: conversationHistory,
    stream: true
  })
});
// SSE 流式解析 → 提取 ΩHERE 工具调用 → 执行 → 注入结果 → 继续
```

### 4.3 VFS 迁移到 SQLite

```sql
CREATE TABLE vfs_slots (
  name TEXT PRIMARY KEY,
  content TEXT,
  description_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 完全兼容现有 API: ls/read/write/append/mount/unmount
```

### 4.4 Prompt 组装 (服务端)

```javascript
function buildSystemPrompt() {
  const template = db.get('SELECT content FROM vfs_slots WHERE name = ?', 'system-prompt');
  const context = db.get('SELECT content FROM vfs_slots WHERE name = ?', 'context');
  const refGuide = db.get('SELECT content FROM vfs_slots WHERE name = ?', 'ref-guide');
  
  // 直接拼装，不需要 fetch 拦截！
  return template
    .replace('{{toolSummary}}', getToolSummary())
    .replace('{{skillsPrompt}}', getSkillsPrompt())
    + '\n\n' + buildDynamicInjection(context, refGuide);
}
```

## 五、迁移路径 (分阶段)

### Phase M1: 最小可用 (MVP) — 预计 1-2 天
1. 搭建 Agent Gateway (Express/Fastify)
2. Claude API SSE 客户端
3. ΩHERE 解析器 (从流中提取工具调用)
4. 复用 server-v2 工具执行
5. 简单终端 UI (readline 或 blessed)
→ **交付: 终端版 Agent，功能等价于当前系统**

### Phase M2: Web UI — 预计 2-3 天
1. 选择前端方案 (Open WebUI 或自研)
2. WebSocket 实时通信
3. 工具结果渲染
4. VFS 管理面板
→ **交付: 网页版 Agent**

### Phase M3: 全功能迁移 — 预计 2-3 天
1. VFS SQLite 存储
2. 上下文自(服务端)
3. 反向通道 (原生)
4. Skills 热加载
5. 多会话管理
→ **交付: 完全自主的 Agent 平台**

### Phase M4: 增强 — 持续
1. 多模型支持 (Claude + GPT + 本地模型)
2. 团队协作 (多用户)
3. 移动端适配
4. 插件市场
5. 部署到云 (Oracle ARM 猛兽)

## 六、成本评估

| 项目 | 成本 |
|---|---|
| Claude API (Opus 4.6) | ~$15/百万输入 token, ~$75/百万输出 token |
| 预估月费 (日均50次对话) | ~$30-80/月 |
| 服务器 | Oracle ARM 免费套餐 (已有) |
| 域名 + SSL | ~$10/年 (已有 Cloudflare) |

对比 Genspark Pro 订阅 + 1min.ai credits，长期来看自建更划算且无限制。

## 七、风险与应对

| 风险 | 应对 |
|---|---|
| Claude API 成本超预期 | 智能缓存 + 小模型分流简单任务 |
| 工具调用解析出错 | 复用现有 ΩHERE 解析器，已经过实战检验 |
| 前端开发工作量大 | 先用终端版快速上线，再迭代 Web UI |
| 迁移期间双系统运行 | Genspark 版作为后备，新系统稳定后切换 |