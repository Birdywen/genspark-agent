# TODO - Genspark Agent

> Updated: 2026-03-08

## ✅ Completed

### System Prompt 自动注入 (Phase 3)
- VFS 动态注入, 双模式 (Mode1 追加/Mode2 前缀)
- autoInjectEnabled 开关, Skills 桥接

### Context Auto-Management (Phase 4)
- 阈值计算含注入 prompt 长度
- autoCompress 同步 VFS context 槽位
- 手动压缩按钮同步 VFS context 槽位
- 反向通道 (Reverse Channel): 浏览器→AI 异步结果

### VFS 数据库化 + fn 函数库 (Phase 4+)
- 7 个 VFS 槽位: context, registry, boot-prompt, ref-guide, system-prompt, toolkit, fn
- fn 槽位: 20 个 JS 函数 + 4 Python 模板, vfs.exec('fn') 加载到 window.__tk
- OMEGACODE-8 问题解决: base64 pipeline (run_command base64 → eval_js atob → vfs.write)
- boot-prompt 动态提取 fn 函数名列表注入 prompt踩坑经验统一由 VFS ref-guide 管理, skills.js 已标记 integrated
- commit: e00e787

### VFS 自动备份
- 猛兽 chromium CDP 直连读取 VFS 槽位 (/api/project/update)
- Python 脚本: ~/genspark-agent/scripts/vfs-backup.py
- PM2 cron 每 6 小时自动备份, 保留 10 份
- 备份目录: ~/genspark-agent/backups/

## High Priority

### 1. CometChat WebSocket 稳定性
- 当前状态: 连上后 ~2 分钟断开 (code 1005), 自动重连循环
- error log: ERR_MODULE_NOT_FOUND (可能缺依赖)
- 脚本: `scripts/team-chat-bridge.js`
- 需要: 修复模块依赖, 排查频繁断连原因

### 2. 端到端压缩测试
- 需验证: 长对话触发阈值 → autoCompress → VFS context 写入 → 新对话恢复
- VFS 写入和恢复已部分验证 (fn 修复过程中确认)

## Medium Priority

### 3. Speakly Prompt 持久化
- 源文件: `scripts/terminal-helper-prompt.txt`
- Speakly 重启会覆盖 `custom-instructions.json`

### 4. bg_run 推送增强
- 加入 stdout 行数, 进度更新

### 5. Deploy to Cloudflare
- API: `POST /api/code_sandbox/deploy_cloudflare`
- 需要配置 Cloudflare API key
- 部署后永久在线, 不怕 sandbox 超时

### 6. Sandbox Dashboard 实时数据
- 当前 Dashboard 是静态数据
- 待确认: 是否还需要? Oracle booker 数据 → sandbox API → 手机查看

## Low Priority

### 7. sos 工具扩展
- deploy update, doctor 命令

### 8. ArrangeMe 逆向工程
- 继续 API 分析

### 9. VFS 备份增强
- system-prompt 槽位备份内容为 0, 需排查 (可能 API 字段名不同)
- AI Drive 上传方案 (Cloudflare 403 问题待解决)
- 备份差异对比 / ntfy 通知