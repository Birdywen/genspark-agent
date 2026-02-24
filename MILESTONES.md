
---

## 🏆 里程碑 #1 — 远程控制桥接系统 (2026-02-23)

### 突破性成果

实现了从手机通过 Team Chat 远程控制电脑端 AI Agent 的完整链路，延迟毫秒级，架构零 DOM 依赖。

### 技术架构

手机 Team Chat
  -> CometChat REST API
Bridge v2 (Node.js, PID守护)
  -> WebSocket ws://localhost:8765
Server-v2 broadcast (新增 case)
  -> broadcastToAllTabs
Chrome Extension background.js
  -> chrome.tabs.sendMessage
Content.js enqueueMessage()
  -> 原生消息队列
AI 对话框 <- 消息注入
  -> AI 处理 -> sos say 结果 -> 手机收到推送

### 关键技术突破

1. 逆向工程 Genspark Speakly — 解包 app.asar，发现 CometChat API、authToken、WebSocket 架构
2. CometChat API 双向通信 — 读取/发送 Team Chat 消息，手机待机也能收到推送
3. WebSocket broadcast 注入 — 在 server-v2 新增 broadcast case，消息通过扩展原生管道直达对话框
4. 从 5 层 Poller 到 1 条管道 — 历经 v1-v7 的 DOM Poller 迭代，最终发现 WebSocket + enqueueMessage 的原生路径，彻底消除轮询

### 迭代历程

Poller v1-v3: eval_js 注入 setInterval -> 页面刷新丢失，延迟 4s
Poller v4-v5: 分离 inbox 轮询 + reply 检测 -> 回复检测不准，误报
Poller v6-v7: 错误日志 + action 过滤 -> 仍依赖 DOM，interval 可能被 GC
Bridge v2: WebSocket broadcast -> 零问题，毫秒级，原生管道 (最终方案)

### 工具链

sos bridge          # 启动桥接
sos bridge-stop     # 停止桥接
sos bridge-status   # 查看状态
sos say 消息        # 发消息到手机
手机发 >>> 命令     # 远程执行命令
手机发普通消息      # 路由到 AI 对话

### 文件清单

- scripts/team-chat-bridge.js — Bridge v2 主程序
- scripts/sos.sh — SOS 急救工具箱（含 bridge/say 命令）
- server-v2/index.js — 新增 broadcast case
- scripts/terminal-helper-prompt.txt — Speakly 语音提示词

### 数据

- 探索深度: 解包 Electron app.asar，分析 30+ 源文件，7 次 Poller 迭代
- 协议: CometChat REST API + WebSocket + Chrome Extension Message Passing
- 延迟: Poller 4000ms -> WebSocket <100ms (40x 提升)

---

---

## Milestone #2 — CometChat WebSocket Realtime (Bridge v3.0)
**日期**: 2026-02-24
**提交**: e733dac

### 突破
从 REST API 轮询升级为 CometChat WebSocket 实时推送，彻底消除轮询。

### 技术路径
1. 在浏览器端 hook `WebSocket` 构造函数，捕获 CometChat SDK 的认证消息
2. 逆向完整的 WebSocket 协议：
   - 连接: `wss://APP_ID.websocket-us.cometchat.io/`
   - 认证: `{type:"auth", appId, deviceId, sender, body:{auth: JWT}}`
   - 响应: `{type:"auth", body:{code:"200", status:"OK"}}`
   - 消息: `{type:"message", body:{sender, data:{text}, receiver}}`
   - 心跳: `{action:"ping"}` / `{action:"pong"}`
3. 从 localStorage 获取 sessionId，从拦截器获取 JWT token (60天有效期)
4. Node.js 端直连 CometChat WebSocket，零 SDK 依赖
5. 修复 broadcast 路由：使用 `CROSS_TAB_MESSAGE` 格式匹配 content.js

### 对比
| 指标 | Bridge v2 (轮询) | Bridge v3 (WebSocket) |
|------|------------------|----------------------|
| 延迟 | ~1500ms | <100ms |
| HTTP 请求 | 每1.5秒1次 | 0 (零轮询) |
| 模式 | REST poll | WebSocket push |
| 资源消耗 | 持续网络请求 | 单一长连接 |

### 文件
- `scripts/team-chat-bridge.js` — Bridge v3 主程序
- `scripts/team-chat-bridge-v2-backup.js` — v2 备份
- `TODO.md` — 项目待办事项

