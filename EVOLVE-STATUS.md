# Evolve System Status (Session 6-8, 2026-03-09)

## Architecture Complete ✅
- **evolve v4**: AI generate + self-test + auto-fix (2 rounds) + validate + code length check (>10)
- **chain**: multi-module orchestration with topo-sort
- **scheduler v5**: periodic tick + AI-discovered opportunities, no auto-start (manual start only)
- **constitution**: protected modules list, daily budget (5/day), code review
- **resilient-ask v3**: ask_proxy (主力) + Kimi (fallback), 不需要 sandbox pid
- **watcher**: 60s health check daemon, 6 rules
- **bus wiring**: evolve events broadcast through vfs.bus
- **flow/bus/deps**: infrastructure modules (debounce/throttle/retry, eventbus, dependency tracking)
- **ntfy-evolve**: evolve 事件推送到手机
- **vx.sh**: 14 个快捷命令封装，一行执行 VFS 操作

## E2E Verified ✅ (Session 8)
完整自治循环已验 AI发现机会 → evolve生成代码 → sandbox测试 → validate → persist → bus事件
- 单次 evolve 耗时: ~15-62s
- 生成并部署: vfs-hello, vfs-timestamp (手动验证OK)

## AI API (关键发现 2026-03-09)
**不需要 sandbox pid！** 直接用 ask_proxy API：
- POST /api/agent/ask_proxy (同源, credentials:include)
- 参数: {query, project_id, type, model}
- project_id: 1876348b-72a6-405c-823d-29ffc5be35b2

### 三条路径
| 路径 | 模型 | 速度 | 用途 |
|------|------|------|------|
| __tk.askProxy(prompt, model) | 任意 | 5-10s | 代码生成(主力) |
| __tk.askKimi(prompt) | moonshot-v1-8k | 1-5s | AI发现/简单任务 |
| __tk.askProxy(prompt, 'claude-opus-4-6') | opus-4-6 | 5-9s | 复杂代码(默认) |

### 模型对比 (同一任务)
- Kimi: 4s, 331字符 — 最快
- Opus 4.6: 5s, 606字符 — 又快又好 ← **evolve 默认**
- GPT-5-4: 10s, 856字符 — 最慢

## Quick Commands (vx.sh)
```bash
cd /Users/yay/workspace/genspark-agent
bash scripts/vx.sh status      # 系统状态
bash scripts/vx.sh boot        # 完整 bootstrap
bash scripts/vx.sh tick        # 调度器 tick (E2E)
bash scripts/vx.sh modules     # fn 模块列表
bash scripts/vx.sh compress    # 压缩对话
bash scripts/vx.sh ask "..."   # AI 问答
bash scripts/vx.sh 'return 1+1' # 执行 JS
```

## Bootstrap (新对话必读)
```
Step 1: vx boot (或 vx tick 自动包含 boot)
Step 2: vx status 确认所有组件加载
Step 3: vx tick 触发一次自治循环
```

## fn Modules (50+ real, 148 total with history)
Core: header, genspark-api, dom-helper, file-ops, format, hash, template
VFS: vfs-query, vfs-search, vfs-loader, vfs-meta, vfs-exec-file, vfs-dashboard, vfs-health
Evolve: vfs-self-evolve, vfs-validate, vfs-evolve-scheduler, vfs-evolve-log, vfs-evolve-stats
Infra: vfs-constitution, vfs-ai-opportunities, vfs-bus-wiring, vfs-flow-control, vfs-eventbus, vfs-deps
AI: vfs-resilient-ask, vfs-ntfy-evolve
AI-generated: vfs-hello, vfs-timestamp, vfs-uptime, vfs-slotsize, vfs-math, vfs-dice

## Known Issues (Session 8)
- scheduler v5 no auto-start: 需要 `vx tick` 或 `vfs.scheduler.start()` 手动启动
- evolve 生成的代码质量依赖 prompt，偶尔生成空代码（已加 >10字符检查）
- deleteMsg 可能不可靠（ghost modules reappear）
- 硬刷新后所有模块需重新 bootstrap
- Page slows after ~400+ messages (DOM node count)

## Session 8 踩坑总结
1. askSandbox 旧 API 需要 sandbox pid (对话ID)，删了对话就废了
2. ask_proxy 是正确路径，不需要任何 pid
3. scheduler auto-start 的 setTimeout 30s 会与手动操作冲突，导致 busy 死锁
4. 硬刷新清除所有 JS 上下文，需要完整 bootstrap
5. evolve 里 askAndClean 调的是 askSandbox (不存在)，已修复为 __tk.ask
6. vfs-exec.sh 后台执行(nohup)时浏览器模块可能未加载，需要在脚本内 bootstrap
7. eval_js 通道不稳定，复杂操作必须 vfs-exec.sh