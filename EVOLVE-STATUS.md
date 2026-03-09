# Evolve System Status (Session 6-8, 2026-03-09)

## ✅ E2E 验证通过 (2026-03-09 14:30)
- evolve("create vfs-hello") → 15s 完成 → 模块可用 ✓
- AI 发现 + evolve + deploy 全链路通过

## Architecture
- **evolve v4**: AI generate + self-test + auto-fix (2 rounds) + validate + code length check (>10 chars)
- **scheduler v5**: tick + AI-discovered opportunities + 120s timeout protection + resetBusy()
- **resilient-ask v3**: ask_proxy (无需 sandbox pid!) + Kimi fallback
- **constitution**: protected modules list, daily budget (5/day), code review
- **watcher**: 60s health check daemon, 6 rules
- **bus wiring**: evolve events broadcast through vfs.bus
- **ntfy**: evolve 成功/失败推送到手机
- **flow/bus/deps**: infrastructure modules

## AI API（核心，不需要 sandbox pid）
- **ask_proxy**: `/api/agent/ask_proxy` + project_id `1876348b-72a6-405c-823d-29ffc5be35b2`
- **Kimi**: `api.moonshot.ai` + `sk-EB4UEHdVBmfvqjPJB8WIu6UJ9E1cplgtyByFvmG56E9BLAEe`
- 速度: Kimi 1s | gpt-5-4 3s | claude-opus-4-6 9s
- 接口: `__tk.ask(prompt)` / `__tk.askKimi(prompt)` / `__tk.askProxy(prompt, model)`

## 新对话启动（一步到位！）

### Step 1: 加载全部模块
```js
vfs.exec('fn')   // → 加载 __tk (25+ 函数) + vfs.* 扩展 + watcher + bus
```

### Step 2: 加载 evolve 关键模块（exec 不会自动加载的）
```js
// 这些模块注册到 vfs.* 和 __tk.*，需要显式加载
['vfs-self-evolve','vfs-validate','vfs-evolve-scheduler','vfs-evolve-log',
 'vfs-evolve-stats','vfs-constitution','vfs-ai-opportunities','vfs-bus-wiring',
 'vfs-resilient-ask','vfs-ntfy-evolve'].forEach(k => {
  vfs.readMsg('fn', k).then(code => { try { new Function(code)(); } catch(e) {} });
});
```

### Step 3: 验证
```js
JSON.stringify({
  tk: Object.keys(__tk).length,
  ask: typeof __tk.ask,
  evolve: typeof vfs.evolve,
  scheduler: vfs.scheduler ? vfs.scheduler.status() : 'missing',
  constitution: typeof vfs.constitution
})
```

### Step 4: 手动 tick（可选）
```js
vfs.scheduler.tick()  // AI 发现机会 → evolve → deploy → ntfy
```

## fn Modules (40+)
Core: header, genspark-api, dom-helper, file-ops, format, hash, template
VFS: vfs-query, vfs-search, vfs-loader, vfs-meta, vfs-exec-file, vfs-dashboard, vfs-health
Evolve: vfs-self-evolve, vfs-validate, vfs-evolve-scheduler, vfs-evolve-log, vfs-evolve-stats
Infra: vfs-constitution, vfs-ai-opportunities, vfs-bus-wiring, vfs-flow-control, vfs-eventbus, vfs-deps
AI: vfs-resilient-ask (v3, ask_proxy + Kimi), vfs-ntfy-evolve
AI-generated: vfs-uptime, vfs-slotsize, vfs-math, vfs-dice, vfs-hello

## 踩坑总结（血泪教训）

### 1. sandbox pid 已废弃 ❌
- 旧方案: SANDBOX_PID 对话ID → 删除对话后 evolve 永久卡死 90s+
- 新方案: ask_proxy + project_id → 无状态，永不失效 ✅

### 2. scheduler auto-start 导致 busy 死锁
- 问题: 多次部署 scheduler，旧闭包的 setTimeout/setInterval 仍在执行，覆盖 vfs.scheduler
- 解决: v5 去掉 auto-start，加 120s timeout 保护 + resetBusy() 安全阀
- 硬刷新浏览器是清除旧净方式

### 3. vfs.exec('fn') 不加载 messages 里的模块
- vfs.exec 执行 name 通道代码（bootloader），name 里的 loadExtensions() 加载 messages
- 如果 name 通道是注释不是 JS，exec 会报错
- 关键模块需要显式 readMsg + new Function 加载

### 4. evolve 代码验证
- AI 可能生成空代码（如 `;`），persist 前必须检查 codeLen > 10
- evolve v4 已加入此验证

### 5. 模型选择
- 发现机会: Kimi (1s) | 代码生成: gpt-5-4 (3s) | 复杂架构: opus-4-6 (9s)
- evolve 默认用 gpt-5-4（性价比最高）

## Known Issues
- Page slows down after ~400+ messages (DOM node count)
- deleteMsg may not work reliably (ghost modules reappear)
- scheduler auto-start 已移除，需手动 start() 或由 AI 在新对话中触发