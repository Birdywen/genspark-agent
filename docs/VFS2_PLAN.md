# VFS 2.0 — 基于 project/update API 的架构升级

> Created: 2026-03-08
> Status: Phase 1-4 Complete

## 背景

发现 `/api/project/update` 不仅能写 `name` 字段（VFS 1.0 的存储方式），
还能直接写 `session_state.messages[]`，支持增删改。这意味着：

- **name**: 单字符串通道，~2MB（当前 VFS 存储方式）
- **session_state.messages[]**: 结构化数组，每条有 id/role/content（新发现）
- **JSON.stringify 原生序列化**: 零转义问题

## 现状（VFS 1.0）

### 存储层
- `writeSlot(id, text)` → fetch update `{name: text}` → 只用 name 字段
- `readSlot(id)` → fetch update `{id}` → 读 `d.data.name`
- 每个槽位 = 一个 Genspark conversation 的 name 字段
- 7 槽位: context, registry, boot-prompt, ref-guide, system-prompt, toolkit, fn

### 写入通道（当前的噩梦）
1. eval_js 直接写 → 大小限制 + 转义问题
2. ΩCODE SSE 通道 → UTF-8 多字节截断
3. base64 pipeline → 可靠但繁琐（run_command base64 → eval_js atob → vfs.write）
4. vfs.write → 底层就是 writeSlot → 受 name 字段限制

### 痛点
- 大内容写入经常失败或截断
- 非 ASCII 内容（中文/emoji）需要 base64 中转
- eval_js 有字符串大小限制
- 无法存储结构化数据（只有一个 name 字符串）

---

## VFS 2.0 设计

### Phase 1: 增强 writeSlot/readSlot（最小改动，最大收益）

**目标**: 让 messages[] 作为第二存储通道可用

**改动文件**: `extension/content.js`

#### 1a. writeSlot2 — 写入 messages 通道
```js
async function writeSlotMessages(slotId, key, value) {
  // 读取当前 session_state
  const resp = await fetch('/api/project/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ id: slotId, request_not_update_permission: true })
  });
  const data = await resp.json();
  const ss = data.data.session_state || { messages: [] };
  
  // 找到已有的同 key 消息或创建新的
  const existing = ss.messages.findIndex(m => m.id === key);
  if (existing >= 0) {
    ss.messages[existing].content = value;
  } else {
    ss.messages.push({ id: key, role: 'user', content: value });
  }
  
  // 写回
  const resp2 = await fetch('/api/project/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ id: slotId, session_state: ss, request_not_update_permission: true })
  });
  const data2 = await resp2.json();
  return data2.data.session_state.messages.length;
}
```

#### 1b. readSlotMessages — 读取 messages 通道
```js
async function readSlotMessages(slotId, key) {
  const resp = await fetch('/api/project/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ id: slotId, request_not_update_permission: true })
  });
  const data = await resp.json();
  const msgs = (data.data.session_state || {}).messages || [];
  if (key) {
    const found = msgs.find(m => m.id === key);
    return found ? found.content : '';
  }
  return msgs; // 返回全部
}
```

#### 1c. VFS API扩展
```js
// vfs.writeMsg(slotName, key, value) — 写入 messages 子通道
// vfs.readMsg(slotName, key) — 读取 messages 子通道  
// vfs.listMsg(slotName) — 列出所有 messages keys
// vfs.deleteMsg(slotName, key) — 删除一条 message
```

**收益**:
- 每个槽位从 1 个存储通道变成 N+1 个（name + N 条 messages）
- messages 可以当 key-value store 用（id=key, content=value）
- 容量大幅扩展

---

### Phase 2: 大内容直写通道

**目标**: 绕过 eval_js 限制，AI 直接调 update API 写大内容

**方案**: 新增 server-v2 工具 `vfs_write`

```js
// server-v2 新工具: vfs_write
// AI 调用: ΩHERE vfs_write @slot=toolkit @content<<EOF ... EOF 
实际最简方案: eval_js 里直接调 fetch update API，
内容通过 ΩHERE heredoc → server-v2 → eval_js → fetch。
ΩHERE 的零转义 + JSON.stringify 的原生序列化 = 完美通道。

**收益**: 大文件（10K+）直接写入，不需要 base64/分块

---

### Phase 3: 对话历史管理

**目标**: 利用 messages[] 可编辑能力，优化对话管理

**功能**:
- `vfs.cleanup(slotName)` — 清理 VFS 槽位里的废弃消息
- `vfs.inject(conversationId, messages)` — 向对话注入上下文
- `vfs.export(conversationId)` — 完整导出对话 JSON
- `vfs.clone(fromId, toId)` — 克隆对话

**应用场景**:
- 新对话开始时注入前序上下文（替代 boot-prompt 的文本注入）
- 长对话清理无用轮次，节省 token 预算
- 对话备份/恢复一步到位

---

### Phase 4: 备份系统升级

**目标**: 利用 update API 简化备份流程

**改进**:
- 猛兽备份脚本直接用 update API 读取（已在用）
- 恢复时直接 update API 写入（不需要 CDP websocket）
- 支持跨账号迁移（读出 JSON → 换 cookie → 写入）

---

## 实施优先级

| Phase | 改动量 | 收益 | 建议 |
|-------|--------|------|------|
| 1a-1c | content.js ~80行 | 结构化存储，容量翻倍 | **立即开始** |
| 2 | 无需改代码，改习惯 | 大内容直写 | **立即可用** |
| 3 | content.js ~60行 | 对话管理 | 第二步 |
| 4 | 猛兽脚本 ~30行 | 备份简化 | 第三步 |

## 风险

1. **API 稳定性**: Genspark 可能修改 update API 行为（加验证、限制字段）
2. **messages 大小限制**: 未测试单个 conversation 的 messages 上限
3. **并发写入**: 两个 tab 同时写同一个槽位可能冲突（当前也存在）
4. **session_state 覆盖**: 写 session_state 时是全量替换，需要先读后写

## 下一步

1. 测试 messages 大小上限（写入 100 条/1000 条试试）
2. 实现 Phase 1a-1c，修改 content.js
3. 更新 boot-prompt 适配新 API

## 压力测试结果 (2026-03-08)

Messages 通道无硬性大小限制，已验证到 20MB+ (20000条x1KB) 和单条 10MB。
瓶颈是网络传输时间（线性增长，约 1.5s/MB）。
eval_js 有 10s 超时限制，大写入需要 fire-and-forget 模式（先写入不等结果，后查状态）。

| 数据量 | 条数 | 耗时 | 结果 |
|--------|------|------|------|
| ~100KB | 100x1KB | 0.8s | OK |
| ~1MB | 1000x1KB | 3.4s | OK |
| ~5MB | 5000x1KB | 6.6s | OK |
| ~10MB | 10000x1KB | >10s | OK |
| ~20MB | 20000x1KB | >60s | OK |
| 10MB | 1条 | 12.4s | OK |

实际建议：单槽位 messages 保持在 5MB 以内（<6s 读写），可靠且高效。
