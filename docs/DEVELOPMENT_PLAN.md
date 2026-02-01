# Genspark Agent 系统优化开发计划

> 版本: 1.0
> 创建日期: 2026-02-01
> 状态: 规划中

---

## 一、项目背景与目标

### 1.1 当前系统现状

Genspark Agent 是一个基于 MCP (Model Context Protocol) 的 AI Agent 运行时系统，包含：

| 组件 | 位置 | 职责 |
|------|------|------|
| server-v2 | `/server-v2/index.js` | WebSocket Hub、MCP 聚合、命令历史、安全检查 |
| extension | `/extension/` | Chrome 扩展、Ω{...} 解析、UI 面板、跨 Tab 通信 |
| skills | `/skills/` | 可扩展技能模块（megacmd、chart-visualization） |
| memory | `/.agent_memory/` | 多项目上下文管理 |

### 1.2 核心问题

1. **单工具限制**：每次只能调用一个工具，交互次数多，效率低
2. **缺乏闭环**：系统无法自我验证、自我修复
3. **稳定性不足**：工具列表不同步、健康检查缺失、错误处理不完善
4. **录制/回放缺失**：无法将自动化过程变成可复用资产

### 1.3 优化目标

**核心原则：稳定是基石，在稳定基础上逐步实现功能**

| 优先级 | 目标 | 预期收益 |
|--------|------|----------|
| P0 | 系统稳定性 | 减少报错、提升可靠性 |
| P1 | 闭环自验证 | 系统能自我检测、自我修复 |
| P2 | 批量执行 | 减少交互次数、提升效率 |
| P3 | 录制回放 | 自动化资产可复用 |

---

## 二、架构设计

### 2.1 整体架构演进

```
┌─────────────────────────────────────────────────────────────┐
│                      Extension (前端)                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ Ω{} 解析器  │  │  UI 面板    │  │ 录制/回放   │         │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘         │
│         └────────────────┴────────────────┘                 │
│                    WebSocket                                │
└──────────────────────────┼──────────────────────────────────┘
                           │
┌──────────────────────────┼──────────────────────────────────┐
│                    server-v2 (后端)                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │  任务引擎   │  │ 健康检查器  │  │ 状态机管理  │         │
│  │  (Batch)    │  │             │  │             │         │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘         │
│         └────────────────┴────────────────┘                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │  MCP Hub    │  │ Safety Gate │  │  History    │         │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘         │
└─────────┴────────────────┴────────────────┴─────────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
    ┌────┴────┐      ┌────┴────┐      ┌────┴────┐
    │filesystem│      │playwright│      │  shell  │
    └─────────┘      └─────────┘      └─────────┘
```

### 2.2 核心模块设计

#### 2.2.1 任务引擎 (Task Engine)

**位置**: `server-v2/task-engine.js` (新增)

**职责**:
- 支持批量工具调用 (tool_batch)
- 顺序执行、条件分支
- 变量存储与模板注入
- 错误策略（stopOnError、retry）

**数据结构**:
```javascript
{
  "type": "tool_batch",
  "id": "batch-001",
  "steps": [
    { "id": "step1", "tool": "read_file", "params": {"path":"/a.json"}, "saveAs": "fileA" },
    { "id": "step2", "tool": "run_command", "params": {"command":"echo {{fileA.result}}"}, "when": "{{fileA.success}}" }
  ],
  "options": {
    "stopOnError": true,
    "timeout": 120000
  }
}
```

#### 2.2.2 健康检查器 (Health Checker)

**位置**: `server-v2/health-checker.js` (新增)

**职责**:
- MCP Server 连接状态检测
- Playwright 浏览器安装检测
- 自动修复与用户提示

**检查项**:
| 检查项 | 检测方法 | 修复策略 |
|--------|----------|----------|
| MCP 连接 | ping/pong | 自动重连 |
| Playwright 浏览器 | 检查缓存目录 | 提示安装命令 |
| 工具列表同步 | 对比 hash | 自动刷新 |

#### 2.2.3 状态机管理 (State Manager)

**位置**: `server-v2/state-manager.js` (新增)

**职责**:
- 任务状态追踪
- 错误分类与决策
- 恢复点管理

**状态枚举**:
```javascript
const TaskState = {
  PENDING: 'pending',
  RUNNING: 'running',
  SUCCESS: 'success',
  FAILED: 'failed',
  RETRYING: 'retrying',
  NEED_USER: 'need_user',
  RECOVERABLE: 'recoverable'
};
```

---

## 三、分阶段开发计划

### 阶段 1：稳定性基础 (P0)

**目标**: 确保系统核心流程稳定可靠
**时间预估**: 2-3 天

#### 1.1 工具列表同步机制

**问题**: 新增/移除 MCP server 后，客户端工具列表不同步

**技术方案**:
1. server-v2 新增 `reload_tools` 消息类型
2. 工具列表变更时主动推送给所有客户端
3. 客户端收到后覆盖本地工具清单

**改动文件**:
- `server-v2/index.js`: 新增 reload_tools handler
- `extension/background.js`: 监听并广播工具更新
- `extension/content.js`: 更新 state.availableTools

**验收标准**:
- [ ] 修改 config.json 后，发送 reload_tools 能刷新工具列表
- [ ] 所有已连接客户端都收到更新
- [ ] 日志显示工具数量变化

#### 1.2 健康检查机制

**问题**: Playwright 浏览器未安装时报错不明确

**技术方案**:
1. server-v2 启动时执行健康检查
2. 检测 Playwright 浏览器缓存目录
3. 缺失时给出明确安装指令

**改动文件**:
- `server-v2/health-checker.js` (新增)
- `server-v2/index.js`: 启动时调用健康检查

**验收标准**:
- [ ] 启动时检测 Playwright 浏览器状态
- [ ] 缺失时在控制台显示明确的安装命令
- [ ] 提供 health_check WS 消息供客户端主动查询

#### 1.3 错误分类与提示优化

**问题**: 错误信息不明确，用户不知道如何处理

**错误分类表**:
| 错误类型 | 识别特征 | 修复策略 | 可自动恢复 |
|----------|----------|----------|------------|
| TIMEOUT | 'timeout' | 重试/拆分/后台执行 | 是 |
| NOT_FOUND | 'not found', 'enoent' | 检查路径 | 否 |
| PERMISSION | 'permission denied' | 检查权限 | 否 |
| BROWSER_MISSING | 'browser.*not.*install' | 安装浏览器 | 是 |
| PAGE_CLOSED | 'page.*closed' | 重建 context | 是 |
| ELEMENT_NOT_FOUND | 'element.*not.*found' | 重新 snapshot | 是 |

**改动文件**:
- `server-v2/error-classifier.js` (新增)
- `server-v2/index.js`: 包装错误返回

**验收标准**:
- [ ] 所有错误都返回 errorType 字段
- [ ] 每个错误都有 suggestion 修复建议
- [ ] 可自动恢复的错误标记 recoverable: true

---

### 阶段 2：闭环自验证 (P1)

**目标**: 系统能自我检测、自我修复
**时间预估**: 3-4 天

#### 2.1 自动重试机制

**重试策略**:
```javascript
const retryStrategies = {
  TIMEOUT: { maxRetries: 2, delay: 1000, action: 'extend_timeout' },
  PAGE_CLOSED: { maxRetries: 1, delay: 500, action: 'rebuild_context' },
  ELEMENT_NOT_FOUND: { maxRetries: 1, delay: 500, action: 'refresh_snapshot' },
  NETWORK: { maxRetries: 3, delay: 2000, action: null }
};
```

**改动文件**:
- `server-v2/retry-manager.js` (新增)
- `server-v2/index.js`: 集成重试逻辑

**验收标准**:
- [ ] TIMEOUT 错误自动重试 2 次
- [ ] PAGE_CLOSED 自动重建 context 后重试
- [ ] 重试次数和结果记录到 history

#### 2.2 状态机与恢复点

**数据结构**:
```javascript
{
  taskId: 'task-001',
  state: 'running',
  currentStep: 2,
  totalSteps: 5,
  checkpoints: [
    { step: 1, result: {...}, timestamp: '...' }
  ],
  variables: { fileA: {...} }
}
```

**改动文件**:
- `server-v2/state-manager.js` (新增)
- `server-v2/index.js`: 集成状态管理

**验收标准**:
- [ ] 任务执行过程中状态实时更新
- [ ] 任务失败后可通过 resume_task 从断点继续
- [ ] 状态持久化到文件（可选）

#### 2.3 MCP 热刷新

**技术方案**:
1. 监听 config.json 文件变更
2. 变更时热重载 MCP 连接
3. 广播工具列表更新

**验收标准**:
- [ ] 修改 config.json 后自动检测变更
- [ ] 10 秒内完成 MCP 重连
- [ ] 所有客户端收到工具更新

---

### 阶段 3：批量执行引擎 (P2)

**目标**: 减少交互次数，提升执行效率
**时间预估**: 4-5 天

#### 3.1 tool_batch 基础实现

**协议定义**:
```javascript
// 请求
{
  type: 'tool_batch',
  id: 'batch-001',
  steps: [
    { tool: 'read_file', params: { path: '/a.json' } },
    { tool: 'run_command', params: { command: 'echo done' } }
  ],
  options: { stopOnError: true }
}

// 响应（每步）
{
  type: 'batch_step_result',
  batchId: 'batch-001',
  stepIndex: 0,
  tool: 'read_file',
  success: true,
  result: '...'
}

// 响应（完成）
{
  type: 'batch_complete',
  batchId: 'batch-001',
  success: true,
  stepsCompleted: 2,
  totalSteps: 2
}
```

**改动文件**:
- `server-v2/task-engine.js` (新增)
- `server-v2/index.js`: 新增 handler
- `extension/content.js`: 支持解析批量调用

**验收标准**:
- [ ] 支持 tool_batch 消息类型
- [ ] 每步结果实时返回
- [ ] stopOnError=true 时遇错停止

#### 3.2 变量存储与模板注入

**示例**:
```javascript
{
  steps: [
    { tool: 'read_file', params: { path: '/config.json' }, saveAs: 'config' },
    { tool: 'run_command', params: { command: 'echo {{config.result}}' } }
  ]
}
```

**验收标准**:
- [ ] saveAs 正确保存结果
- [ ] {{var.result}} 正确替换
- [ ] 变量不存在时报明确错误

#### 3.3 条件执行

**条件语法**:
```javascript
// 简单条件：上一步成功
{ when: 'success' }

// 变量条件：指定变量成功
{ when: { var: 'step1', success: true } }

// 包含检查
{ when: { var: 'step1', contains: 'OK' } }

// 正则匹配
{ when: { var: 'step1', regex: 'version\\s+\\d+' } }
```

**验收标准**:
- [ ] when: 'success' 正确判断
- [ ] when.contains 正确判断
- [ ] 条件不满足时跳过步骤并记录原因

---

### 阶段 4：录制与回放 (P3)

**目标**: 将自动化过程变成可复用资产
**时间预估**: 3-4 天

#### 4.1 执行录制

**录制数据结构**:
```javascript
{
  recordingId: 'rec-001',
  name: '登录测试',
  createdAt: '2026-02-01T10:00:00Z',
  steps: [
    {
      index: 0,
      tool: 'navigate_page',
      params: { url: 'https://example.com' },
      result: { success: true },
      screenshot: '/recordings/rec-001/step-0.png',
      duration: 1500
    }
  ],
  metadata: {
    totalDuration: 5000,
    successRate: 1.0
  }
}
```

**验收标准**:
- [ ] 开启录制模式后，所有操作被记录
- [ ] 录制包含截图（可选）
- [ ] 导出为 JSON 文件

#### 4.2 回放执行

**验收标准**:
- [ ] 支持加载 JSON 录制文件
- [ ] 回放执行所有步骤
- [ ] 对比并报告差异

---

## 四、技术细节指南

### 4.1 WebSocket 消息协议扩展

| 消息类型 | 方向 | 用途 |
|----------|------|------|
| reload_tools | C→S | 请求刷新工具列表 |
| tools_updated | S→C | 工具列表已更新 |
| health_check | C→S | 请求健康检查 |
| health_status | S→C | 健康检查结果 |
| tool_batch | C→S | 批量工具调用 |
| batch_step_result | S→C | 批量调用单步结果 |
| batch_complete | S→C | 批量调用完成 |
| start_recording | C→S | 开始录制 |
| stop_recording | C→S | 停止录制 |
| replay_recording | C→S | 回放录制 |
| resume_task | C→S | 从断点继续任务 |

### 4.2 文件结构规划

```
server-v2/
├── index.js              # 主入口（现有，需修改）
├── config.json           # 配置文件（现有）
├── safety.js             # 安全模块（现有）
├── skills.js             # Skills 模块（现有）
├── logger.js             # 日志模块（现有）
├── health-checker.js     # 健康检查器（新增）
├── error-classifier.js   # 错误分类器（新增）
├── retry-manager.js      # 重试管理器（新增）
├── state-manager.js      # 状态机管理（新增）
├── task-engine.js        # 任务执行引擎（新增）
├── condition-evaluator.js # 条件评估器（新增）
├── recorder.js           # 录制模块（新增）
├── replayer.js           # 回放模块（新增）
└── recordings/           # 录制文件存储（新增目录）
```

### 4.3 配置项扩展

```json
{
  "taskEngine": {
    "defaultTimeout": 60000,
    "maxRetries": 3,
    "retryDelay": 1000
  },
  "healthCheck": {
    "enabled": true,
    "interval": 30000,
    "autoFix": true
  },
  "recording": {
    "enabled": true,
    "screenshotOnStep": false,
    "storagePath": "./recordings"
  }
}
```

---

## 五、风险与应对

| 风险 | 可能性 | 影响 | 应对措施 |
|------|--------|------|----------|
| 批量执行导致连锁错误 | 中 | 高 | 默认 stopOnError=true |
| 变量注入安全问题 | 低 | 高 | 限制模板语法 |
| MCP 热刷新导致状态丢失 | 中 | 中 | 刷新前保存 pending 任务 |
| 录制文件过大 | 低 | 低 | 限制截图大小和频率 |

---

## 六、预期收益

### 6.1 效率提升

| 场景 | 当前交互次数 | 优化后 | 提升 |
|------|--------------|--------|------|
| 读取+修改+验证文件 | 3 | 1 | 66% |
| 部署流程 | 5+ | 1 | 80%+ |
| 网页自动化 | 4+ | 1 | 75%+ |

### 6.2 稳定性提升

| 指标 | 当前 | 优化后 |
|------|------|--------|
| 错误自动恢复率 | 0% | 60%+ |
| 健康检查覆盖 | 0 | 3 项 |
| 工具同步一致性 | 手动 | 自动 |

---

## 七、实施建议

### 7.1 开发顺序

```
阶段 1 (P0): 稳定性基础
  └── 1.1 工具列表同步 → 1.2 健康检查 → 1.3 错误分类

阶段 2 (P1): 闭环自验证  
  └── 2.1 自动重试 → 2.2 状态机 → 2.3 MCP热刷新

阶段 3 (P2): 批量执行
  └── 3.1 tool_batch → 3.2 变量注入 → 3.3 条件执行

阶段 4 (P3): 录制回放
  └── 4.1 录制 → 4.2 回放
```

### 7.2 测试策略

每个阶段完成后：
1. 单元测试：核心函数逻辑
2. 集成测试：WS 消息流转
3. 端到端测试：完整场景验证

### 7.3 回滚方案

- 每个阶段独立分支开发
- 通过 config 开关控制新功能
- 保留原有逻辑作为 fallback

---

## 八、总结

本计划从**稳定性**出发，逐步构建**闭环自验证**能力，最终实现**批量执行**和**录制回放**。

核心理念：
- **中心化决策**：server-v2 负责闭环逻辑
- **前端负责交互**：extension 负责展示和采集
- **渐进式实现**：每个阶段独立可用

**预计总工时：12-16 天**

---

*文档版本: 1.0*
*最后更新: 2026-02-01*