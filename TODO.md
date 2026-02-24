# TODO List
> 更新于 2026-02-24

## 高优先级

### ~~1. CometChat WebSocket 实时连接（替代轮询）~~ ✅ 已完成
- **现状**: Bridge v2 用 REST API 每 1.5s 轮询，延迟可接受但不优雅
- **方案**: Node.js 端用 CometChat JS SDK 完整 init + login，让 SDK 管理 WebSocket
- **难点**: JWT token 绑定 session/deviceId，需要 SDK 走完整认证流程
- **已知信息**:
  - WS 地址: wss://1670754dd7dd407a4.websocket-us.cometchat.io/
  - 认证消息: type=auth, appId, deviceId, sender(uid), body.auth=JWT
  - 认证响应: type=auth, body.code=200, body.status=OK
  - 消息推送: type=message, 包含完整消息数据
  - 心跳: {action:"ping",ack:"true"} / {action:"pong"}
- **文件**: `scripts/team-chat-bridge.js`

### 2. Bridge 断线自动恢复优化
- 偶发 ETIMEDOUT / DNS 错误后自动恢复
- 增加连续失败计数，超阈值重启

### 3. 系统提示词自动注入
- 新对话 tab 自动识别 bridge 消息并用 sos say 回复
- content.js 已插入说明（第248行），需验证新对话是否生效

### 3. Code Sandbox 远程操作
- **已发现 API**:
  - `GET /api/code_sandbox/list_directory?project_id=ID&path=PATH` — 列目录
  - `GET /api/code_sandbox/download_file?project_id=ID&path=PATH` — 读文件
  - `PUT /api/code_sandbox/save_file` body: {project_id, file_path, content} — 写文件
- **待解决**: 命令执行 API（终端输入框可能通过 WebSocket）
- **sandbox_id**: iqjibt8rmgxnlo3q2tphz-cbeee0f9 (novita 类型)
- **目标**: 当作免费远程虚拟环境使用

## 中优先级

### 4. Speakly 提示词持久化
- Speakly 重启后覆盖 custom-instructions.json
- 需要找到 app.asar 内置模板或用 UI 手动粘贴
- 已将提示词保存在 scripts/terminal-helper-prompt.txt

### 5. bg_run 推送增强
- 当前只推送 exit code，可附带最后几行输出
- 长任务增加进度推送（每 N 秒推一次 stdout 最新行）

### 6. 手机端图片/文件支持
- Team Chat 手机端无图片输入框
- 可通过 CometChat media message API 实现

## 低优先级

### 7. ntfy 备用通道
- 当 bridge 不可用时，用 ntfy.sh 作为备用推送
- 已验证 curl 可用: echo "msg" | curl -d @- ntfy.sh/mytopic

### 8. sos 工具箱扩展
- sos deploy - 一键部署
- sos update - 自动更新 extension
- sos doctor - 深度诊断

### 9. ArrangeMe 逆向工程
- 已有 skills/reverse-engineering/arrangeme/
- 待继续分析 API

---
## 已完成 ✅
- [x] Team Chat Bridge v2 (WebSocket broadcast)
- [x] sos say 快捷命令
- [x] bg_run 自动推送到手机
- [x] 开机自启 (launchd)
- [x] Speakly Terminal Helper 集成
- [x] MILESTONES.md 里程碑
- [x] Git push (daac5a9)
- [x] Bridge v3 CometChat WebSocket 实时连接 (e733dac)
- [x] 图片发送 sos img (d85fdca)
- [x] bridge-switch 快捷切换 (0738196)
- [x] 优化 phone-bridge 延迟 200ms (a9efd21)
- [x] 远程命令环境修复 source zshrc (7a4b805)

## 🔗 CoChat 跨平台协作 (构想中)

### 平台能力已探明
- API 认证: JWT Bearer token (localStorage)
- 自定义 Agent API: /api/custom/agents/ (POST 创建, 需 name + system_prompt)
- Tools API: /api/v1/tools/ (24个工具, 含 delegate_task, web_search, browser_control, coder_workspaces)
- Functions API: /api/v1/functions/ (11个过滤器, 含 OpenRouter Manifold Pipe)
- Automations API: /api/v1/automations/ (可创建定时任务)
- Chat API: /api/chat/completions (OpenAI 兼容格式)
- 免费模型: 9个 (Llama 3.3 70B, Gemma 3 27B, Mistral Small 3.1 等, 通过 OpenRouter, 易限流)
- 付费模型: Claude Sonnet 4.5, Grok 4.1 Fast 等

### 构想方向
- [ ] CoChat Agent 通过 HTTP Client 调用 Genspark bridge API (需公网隧道: ngrok/cloudflare tunnel)
- [ ] Genspark 侧通过 bridge 调用 CoChat API, 利用 MCP 工具链
- [ ] 跨平台任务委派: Genspark 做主力对话, CoChat 做高级任务 (浏览器控制, 代码环境, Google 集成)
- [ ] 自定义 MCP 工具接入我们的 bridge 系统
- [ ] Automations 定时任务利用免费模型低峰期批量执行


### 工具链完整清单 (已探明)
- delegate_task / delegate_tasks: 子 agent 任务委派 (单任务+并行)
- web_search: 网页搜索
- url_fetch: 抓取网页内容
- http_client: 任意 HTTP 请求 (可调 bridge API)
- automations_tools: 创建定时任务/自动化工作流
- Google Drive / Sheets / Calendar: Google 全家桶
- markdown_document / html_document / python_document: 文档生成
- search_conversation_history: 搜索历史对话
- activity_tools: 活动日志查询
- MCP: Coder Workspaces (VS Code), Browser Control (Chrome 自动化), Fetch Youtube
- 所有内置工具均为 Python 实现, MCP 工具为外部服务协议接入
- 可自建 MCP server 接入本地 shell, 实现远程命令执行 (无转义问题)
### 注意事项
- 免费模型共享 OpenRouter 额度, 高峰期 429
- 付费模型按量计费
- localhost bridge 需公网隧道才能被 CoChat 云端访问
