
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
