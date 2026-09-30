# omega_flow — JSON 微运行时 v1

新增一个 MCP 工具，组合调用已有 omega 实现；旧工具名称、参数和文本响应保持不变。
新增 `omega-flow.mjs`，注册于 `server.mjs`。无需 npm 依赖。

## 最小示例：输入 → 读取 → 验收 → 输出

```json
{
  "vars": { "file": "/absolute/path/example.txt", "token": "READY" },
  "steps": [
    { "id": "read", "tool": "omega_read", "args": { "path": { "$ref": "vars.file" } } },
    { "id": "check", "assert": { "left": { "$ref": "steps.read.text" }, "op": "contains", "right": { "$ref": "vars.token" } } }
  ],
  "outputs": { "evidence": { "$ref": "steps.read.text" } },
  "waitMs": 20000
}
```

返回 JSON：`id/state/done/total/results/outputs`。`state` 是 `running/success/failed/cancelled`；
参数错误在执行前返回 `rejected`。`done` 为已尝试执行的步骤数量，不包括条件跳过或停止后的步骤。
`success` 只证明所写的步骤/断言通过；发起 batch 并不证明 batch 已完成。

## 数据和控制流

- 每步必须有唯一 `id`，且恰好选择一种：`tool + args`、`set`、`assert`。
- `vars` 是只读输入；`set` 把 JSON 值存为 `steps.<id>.data`，不隐式覆盖其它变量。
- `{"$ref":"vars.foo"}` 与 `{"$ref":"steps.read.text"}` 保留数值/布尔/数组/对象类型。
  路径使用点分隔，可用数组索引；不支持包含点的键。缺失引用是错误，不插入空字符串。
- `{"$literal":{"$ref":"just text"}}` 可转义引用对象。普通字符串不进行 `${...}` 插值。
- 工具结果统一为 `steps.<id>.status/isError/text`，有结构化数据时另有 `.data`。
  `parseJson:true` 明确把工具返回文本解析为 `.data`，失败即该步失败。
- 每步可带 `when:{left,op,right}`；断言使用同样结构。运算符：
  `eq/ne/contains/gt/gte/lt/lte`。布尔和数字不做隐式类型转换。
- 默认失败停止；`stopOnError:false` 会继续独立步骤，但整条 flow 仍返回失败。
- 不支持循环、递归 flow、并行、任意代码、隐式重试或自动回滚。
- 全计划先做结构、工具白名单与前向引用检查。工具具体参数由原工具校验；
  后续运行时失败不会撤销前面已经完成的操作。

## batch → 状态 → 断言

需先由管理员在 MCP 进程环境显式设置 `OMEGA_FLOW_ALLOW_EFFECTS=1`，然后重启。

```json
{
  "allowEffects": ["omega_batch"],
  "steps": [
    { "id": "launch", "tool": "omega_batch", "args": { "steps": [
      { "label": "syntax", "command_line": "node --check server.mjs", "cwd": "/absolute/mcp", "timeout": "30s" }
    ] } },
    { "id": "wait", "tool": "omega_batch_status", "args": {
      "id": { "$ref": "steps.launch.data.jobId" }, "waitMs": 20000, "format": "json"
    }, "parseJson": true },
    { "id": "accept", "assert": { "left": { "$ref": "steps.wait.data.state" }, "op": "eq", "right": "success" } }
  ],
  "outputs": { "batchId": { "$ref": "steps.launch.data.jobId" } }
}
```

如果 batch 仍 running，上述显式验收将失败，不会伪报通过。用 flow 的 `verbose:true` 查询取得
原 batch ID 后继续查询原 batch，不要重新提交命令。flow 取消不取消已发起的 batch。

## 编辑与撤销

`omega_edit` 内部结果新增 `.data:{batchId,dryRun,applied}`；dry-run 的 `batchId` 为 null。
`omega_batch` 内部结果新增 `.data:{jobId}`。现有 MCP 调用仍返回原文本；结构化字段供 flow 使用。

开启服务端效果权限且请求包含 `allowEffects:["omega_edit","omega_undo"]` 后，
后续步骤可以把 `{"$ref":"steps.edit.data.batchId"}` 直接传给 `omega_undo.args.batchId`。
原编辑唯一匹配、断言、两阶段提交和 undo 语义照常执行。

## 权限边界

默认仅允许 read/grep/guard_check/health/quota/sqlite、batch_status、artifact_read/search。
编辑、撤销、batch 和 batch_cancel 必须同时满足服务端环境开关和请求 allowEffects 清单。
`db_query`、`vfs_local_write`、`run_process` 不在 v1 白名单内。

**MCP host 只对 `omega_flow` 这个入口授权，不会重新对内部工具逐项授权。**
这是聚合权限，不是自动继承调用者的 `edit:deny`。如果开启效果工具，必须限制哪些 agent
可以调用 omega_flow；只读 subagent 不应获准调用已启用效果权限的入口。
请求里的 allowEffects 只是显式意图，不替代 host 授权。
原工具内建的命令 guard/SQL 只读/编辑断言仍保留，但不能把 guard 当作完整 shell 沙箱。

## 异步、资源限制与加载

- `{"action":"status","id":"flow-...","waitMs":20000,"verbose":true}` 查询。
- `{"action":"cancel","id":"flow-..."}` 请求取消，仅阻止后续步骤，不杀当前工具。
- 默认等待 20 秒、最多 50 秒；到时返回 running 和真实 ID。进程内顺序执行，等待不忙轮询。
- 每条最多 32 步；输入、保留结果和单次变量展开分别限制 256 KB；JSON 深度最多 24。
  超限可能发生在底层操作完成后，应查看实际文件或 batch，不能当作自动撤销。
- 最多保留 16 条 flow，完成后 30 分钟过期。结果仅在 MCP 进程内存；重启后无法恢复。
  默认返回摘要；`verbose:true` 返回保留的完整步骤结果。工具自己截断的文本不会被恢复。
- 修改已在磁盘，**重启 OpenCode/MCP 后才会出现工具**。先确保没有运行中的 flow/batch。
  本轮未默认打开效果权限，也没有自动重启当前 MCP。

验收：`node --test mcp/omega-flow.test.mjs`，并运行原 `node mcp/tools-ext.test.mjs`。
测试使用临时文件、模拟 batch 执行器及独立 stdio MCP 子进程，不触碰业务数据。
