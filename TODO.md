# TODO - Genspark Agent

> Updated: 2026-02-25

## High Priority

### 1. CometChat WebSocket 替代方案
- 当前 WS URL: `wss://1670754dd7dd407a4.websocket-us.cometchat.io/`
- 需要实现: JWT 认证, 自动重连 (ETIMEDOUT/DNS errors)
- 脚本: `scripts/team-chat-bridge.js`

### 2. System Prompt 自动注入
- 新 chat tab 打开时自动注入 system prompt
- 参考: `content.js` line 248

### 3. Sandbox 集成优化
- ✅ Full-Stack sandbox API 打通 (read/write/list)
- ✅ 公网预览: `https://3000-i3tin0xbrjov9c7se6vov-8f57ffe2.sandbox.novita.ai`
- project_id: `a6e50804-320f-4f61-bcd6-93c57f8d6403`
- API 需通过浏览器 eval_js 调用 (Cloudflare 保护)
- AI Developer (Kimi) 可执行 Bash 命令, 安装工具
- 待办: 实时数据对接, 真实监控面板

## Medium Priority

### 4. Speakly Prompt 持久化
- 源文件: `scripts/terminal-helper-prompt.txt`
- Speakly 重启会覆盖 `custom-instructions.json`

### 5. bg_run 推送增强
- 加入 stdout 行数, 进度更新

### 6. 手机端文件支持
- CometChat media API 上传/下载

## Low Priority

### 7. sos 工具扩展
- deploy, update, doctor 命令

### 8. ArrangeMe 逆向工程
- 继续 API 分析

## Completed (2026-02-25)

- ✅ **MCP 并行启动优化**: 30s → 5s (6x 提速)
  - npx → node 直接调用 (2.9s → 0.26s, 11x)
  - 串行 → Promise.allSettled 并行
- ✅ **MCP SSE Transport**: stdio + SSE 双模式支持
  - config.json 用 `url` 字段触发 SSE, `command` 用 stdio
- ✅ **RacquetDesk Booker 修复**: `booker.connect()` → `booker.smartLogin()`
- ✅ **ntfy 通知集成**: 预约成功即时推送 + 每日 21:30 汇总
- ✅ **Sandbox API 打通**: Full-Stack E2B 容器
  - save_file / download_file / list_directory
  - Node 20 + Python 3.12 + PM2 + 20G 磁盘
  - Agent Dashboard 部署成功
- ✅ **Speakly Terminal Helper 增强**: sos img, bridge-switch, Quick Recipes
- ✅ **稳定性修复**: recorder.activeRecordings guard, health-checker SSE, reload 并行化
