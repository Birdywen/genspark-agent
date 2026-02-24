# Genspark Agent 系统架构

## 概览

本地 Mac 作为中枢，连接 Genspark AI 平台和手机，实现双向实时通信和远程控制。



手机 ←→ CometChat WebSocket ←→ Bridge (Node.js) ←→ 本地 WebSocket ←→ Chrome 扩展 ←→ Genspark AI 对话


## 目录结构



genspark-agent/ ├── extension/ # Chrome 扩展 │ ├── manifest.json # MV3 配置 (含 alarms 权限) │ ├── background.js # Service Worker: WebSocket 连接, chrome.alarms 保活 │ └── content.js # 注入 Genspark 页面: DOM 操作, 工具执行, SSE 监听 ├── scripts/ │ ├── team-chat-bridge.js # Bridge v3: CometChat WebSocket 实时双向通信 │ └── sos.sh # SOS 工具箱: 急救命令集合 ├── server-v2/ # 本地服务 │ ├── index.js # 主服务 (1984行): WebSocket 服务器, MCP Hub, 工具调用 │ ├── watchdog.js # 守护进程: 监控主服务, 自动重启 │ ├── logger.js # 日志模块 │ ├── safety.js # 安全检查 │ ├── health-checker.js # 健康检查 │ ├── error-classifier.js # 错误分类 │ ├── retry-manager.js # 重试管理 │ ├── auto-healer.js # 自愈机制 │ ├── self-validator.js # 自校验 │ ├── task-engine.js # 任务引擎 │ ├── state-manager.js # 状态管理 │ ├── async-executor.js # 异步执行器 │ ├── process-manager.js # 进程管理 │ ├── notify.js # 通知 │ ├── skills.js # Skills 加载器 │ ├── config.json # 唯一配置文件 │ ├── start-all.sh # 启动脚本 │ └── stop-all.sh # 停止脚本 └── docs/ ├── system-architecture.md # 本文档 └── cochat-api-reference.md # CoChat API 参考


## 核心组件

### 1. Bridge v3 (team-chat-bridge.js)
- 直连 CometChat WebSocket (非轮询)
- 延迟 ~200ms
- 自动重连 (指数退避)
- 端口: 8769 (HTTP API)
- 功能: 手机消息转发, >>> 远程命令执行

### 2. Chrome 扩展
- **background.js**: Service Worker, 管理 WebSocket 到 server-v2 (ws://localhost:8765)
  - chrome.alarms 保活 (keepAlive 每24秒, wsCheck 每分钟)
  - 跨 Tab 通信 (REGISTER_AGENT, CROSS_TAB_SEND)
- **content.js**: 注入 Genspark 页面
  - ΩHERE heredoc 格式解析 (零转义)
  - 工具执行 (eval_js, run_command, list_tabs 等)
  - Tab 保活心跳 (30秒)
  - SSE + DOM 双通道去重
  - visibilitychange 自动重注册

### 3. Server-v2 (index.js)
- WebSocket 服务器 (端口 8765)
- MCP Hub: 连接多个 MCP Server, 聚合工具
- 工具调用处理: 复杂命令自动脚本化, payload 文件引用, base64 解码
- 命令历史记录和归档
- Skills 系统: 14 个技能模块

### 4. SOS 工具箱 (sos.sh)
- `sos say "消息"` — 发文字到手机
- `sos img <url>` — 发图片到手机
- `sos status` — 检查系统状态
- `sos check` — 全面健康检查
- `sos restart` / `sos force-restart` — 重启服务
- `sos bridge` / `sos bridge-stop` / `sos bridge-status` — Bridge 控制
- `sos bridge-switch <id>` — 切换 Team Chat
- `sos log` / `sos logf` — 查看日志
- `sos history` / `sos rollback` / `sos reset` — Git 操作
- `sos port` / `sos disk` / `sos clean` — 系统维护

## 通信流程

### 手机 → AI
1. 手机在 Team Chat 发消息
2. CometChat WebSocket 推送到 Bridge
3. Bridge 转发到本地 WebSocket (8765)
4. background.js 广播到 content.js
5. content.js 注入消息到 Genspark 对话

### AI → 手机
1. AI 回复通过 content.js 捕获
2. 执行 `sos say "消息"` 命令
3. Bridge HTTP API (/reply) 发送到 CometChat
4. CometChat 推送到手机 Team Chat

### 远程命令 (>>>)
1. 手机发 `>>> sos check`
2. Bridge 识别 >>> 前缀
3. 本地执行命令 (source ~/.zshrc + cmd)
4. 结果通过 Bridge 返回手机

## 防断连机制
- **caffeinate -s**: launchd 开机自启, 阻止系统睡眠
- **pmset**: AC Power 下 sleep=0, standby=0, disksleep=0
- **chrome.alarms**: 防止 MV3 Service Worker 挂起
- **content.js 心跳**: 30秒 title 刷新防 Tab 休眠
- **Bridge 自动重连**: CometChat 断开后指数退避重连
- **Watchdog**: 监控主服务, 异常自动重启

## 端口
- 8765: server-v2 WebSocket 主服务
- 8768: watchdog HTTP 状态
- 8769: Bridge HTTP API

## 关键配置
- CometChat GROUP_ID: project_ed4d004e-cd80-4a68-95c6-a7c1eba23ab9
- Chrome 扩展 host_permissions: genspark.ai, cochat.ai 等
- launchd: ~/Library/LaunchAgents/com.genspark.caffeinate.plist
