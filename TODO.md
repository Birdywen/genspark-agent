# TODO - Genspark Agent

> Updated: 2026-02-26

## High Priority

### 1. CometChat WebSocket 替代方案
- 当前 WS URL: `wss://1670754dd7dd407a4.websocket-us.cometchat.io/`
- 需要实现: JWT 认证, 自动重连 (ETIMEDOUT/DNS errors)
- 脚本: `scripts/team-chat-bridge.js`

### 2. System Prompt 自动注入
- 新 chat tab 打开时自动注入 system prompt
- 参考: `content.js` line 248

### 3. Sandbox 实时数据对接
- 当前 Dashboard 是静态数据, 需对接真实监控
- Oracle booker 数据 → sandbox API → 手机查看
- extend_lifecycle 自动保活已通过 Oracle PM2 实现

## Medium Priority

### 4. Speakly Prompt 持久化
- 源文件: `scripts/terminal-helper-prompt.txt`
- Speakly 重启会覆盖 `custom-instructions.json`

### 5. bg_run 推送增强
- 加入 stdout 行数, 进度更新

### 6. Deploy to Cloudflare
- API: `POST /api/code_sandbox/deploy_cloudflare`
- 需要配置 Cloudflare API key
- 部署后永久在线, 不怕 sandbox 超时

## Low Priority

### 7. sos 工具扩展
- deploy, update, doctor 命令

### 8. ArrangeMe 逆向工程
- 继续 API 分析

---

## Sandbox API 完整清单

### Genspark API (需浏览器 eval_js, Cloudflare 保护)

| API | Method | 用途 |
|-----|--------|------|
| `/api/code_sandbox/list_directory?project_id=X&path=Y` | GET | 列目录 |
| `/api/code_sandbox/download_file?project_id=X&path=Y` | GET | 读文件 |
| `/api/code_sandbox/save_file` {project_id, file_path, content} | PUT | 写文件 |
| `/api/code_sandbox/extend_lifecycle?project_id=X` | POST | 延长3600s |
| `/api/code_sandbox/get_metrics?project_id=X` | GET | CPU/内存监控 |
| `/api/code_sandbox/start_sandbox_service` {project_id} | POST | PM2启动服务 |
| `/api/code_sandbox/backup` {project_id} | POST | 备份下载 |
| `/api/code_sandbox/restore` {project_id, ...} | POST | 恢复备份 |
| `/api/code_sandbox/deploy_cloudflare` {project_id, rebuild_db} | POST | 部署CF Workers |
| `/api/code_sandbox/preview_url?sandbox_id=X&port=Y&type=novita` | GET | 预览URL |
| `/api/code_sandbox/github/oauth` | GET | GitHub授权 |
| `/api/code_sandbox/github/oauth/revoke` | POST | 撤销GitHub授权 |

### 直连 Sandbox API (无 Cloudflare, curl 直接调用)

| API | Method | 用途 |
|-----|--------|------|
| `/api/file/{path}` | PUT | 写文件 (自建) |
| `/api/file/{path}` | GET | 读文件 (自建) |
| `/api/ls/{path}` | GET | 列目录 (自建) |
| `/api/notes` | GET/POST | Notes CRUD (自建) |
| `/api/notes/:id` | DELETE | 删除 Note (自建) |
| `/api/status` | GET | 服务状态 (自建) |

### Sandbox 配置

| 项目 | 标准版 | 高性能版 (Plus) |
|------|--------|----------------|
| CPU | ~2核 | 4核 |
| 内存 | ~1G | 7.8G |
| 磁盘 | 26G | 26G |
| project_id | a6e50804-320f-4f61-bcd6-93c57f8d6403 | c172a082-7ba2-4105-8050-a56b7cf52cf4 |
| sandbox_id | i3tin0xbrjov9c7se6vov-8f57ffe2 | isjad10r8glpogdbe5r7n-02b9cc79 |
| 公网URL | 3000-i3tin0x....sandbox.novita.ai | 3000-isjad10r....sandbox.novita.ai |
| AI Model | kimi-k2p5 | kimi-k2p5 |

### AI Developer (ask_proxy) 参数
```json
{
  "models": ["gpt-4.1"],
  "use_model": "kimi-k2p5",
  "type": "code_sandbox",
  "project_id": "...",
  "query": "...",
  "custom_tools": ["github", "ssh_hosts", "notion", "email_accounts", "mcp_websrch1"]
}

保活机制
Oracle PM2: sandbox-keepalive.js 每3分钟 ping 两个 sandbox
浏览器: extend_lifecycle 每次延长3600s
Sandbox 不活跃 5-10 分钟可能关闭, 但文件/数据持久化
Completed
2026-02-26
✅ High-Performance Sandbox (4核 7.8G) 接入
✅ Express + SQLite 后端部署
✅ 直连文件 API (绕过 Cloudflare)
✅ sos sandbox 命令集 (push/list/read/status/url)
✅ ecosystem.config.cjs (PM2 兼容)
✅ Oracle sandbox-keepalive 保活
✅ 完整 Sandbox API 逆向 (12个端点)
2026-02-25
✅ MCP 并行启动优化: 30s → 5s (6x)
✅ MCP SSE Transport: stdio + SSE 双模式
✅ RacquetDesk Booker 修复 + ntfy 通知
✅ Sandbox API 打通 (标准版)
✅ Agent Dashboard 部署
✅ Speakly Terminal Helper 增强
✅ 稳定性修复 TODOEOF

echo "✅ TODO.md updated"

Update milestones

cat >> /Users/yay/workspace/.agent_memory/milestones.md << 'MSEOF'

2026-02-26 — High-Perf Sandbox + 直连 API + 完整逆向
High-Performance Sandbox
4核 CPU, 7.8G RAM, 26G disk
project_id: c172a082-7ba2-4105-8050-a56b7cf52cf4
sandbox_id: isjad10r8glpogdbe5r7n-02b9cc79
公网: https://3000-isjad10r8glpogdbe5r7n-02b9cc79.sandbox.novita.ai
Express + SQLite 全栈应用
server.js: Express 后端 + better-sqlite3
Notes CRUD API + 文件读写 API
自建直连 API 绕过 Cloudflare (PUT/GET /api/file/*)
ecosystem.config.cjs PM2 配置
Sandbox API 完整逆向 (12个端点)
文件: list_directory, download_file, save_file
控制: extend_lifecycle (+3600s), start_sandbox_service, get_metrics
部署: backup, restore, deploy_cloudflare, preview_url
GitHub: oauth, oauth/revoke
保活机制
Oracle PM2: sandbox-keepalive.js 每3分钟 ping
extend_lifecycle 每次延长1小时
sos sandbox 命令集
sandbox-push (sp): curl 直推文件, 零转义
sandbox-list (sl): 列目录
sandbox-read (sr): 读文件
sandbox-status (ss): 服务状态
sandbox-url (su): 预览地址 MSEOF

echo "✅ milestones.md updated"

Git

git add -A git status --short git diff --cached --stat SCRIPT 
