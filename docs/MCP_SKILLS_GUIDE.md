# MCP Skills 开发指南

本指南基于 MCP (Model Context Protocol) 官方规范，帮助你理解和扩展 Skills 系统。

---

## 一、MCP 核心概念

MCP 是连接 AI 应用与外部系统的开放标准。它提供三种核心能力：

| 特性 | 说明 | 控制者 | 示例 |
|------|------|--------|------|
| **Tools** | AI 可主动调用的函数 | 模型决定何时使用 | 搜索航班、发送消息、创建日历 |
| **Resources** | 被动数据源，提供只读上下文 | 应用决定如何使用 | 读取文档、访问数据库 |
| **Prompts** | 预构建的指令模板 | 用户显式触发 | 规划旅行、总结会议 |

---

## 二、Tools 详解

### 工具定义结构

```json
{
  "name": "searchFlights",
  "title": "Flight Search",
  "description": "Search for available flights",
  "inputSchema": {
    "type": "object",
    "properties": {
      "origin": { "type": "string", "description": "Departure city" },
      "destination": { "type": "string", "description": "Arrival city" },
      "date": { "type": "string", "format": "date" }
    },
    "required": ["origin", "destination", "date"]
  },
  "outputSchema": {
    "type": "array",
    "items": {
      "type": "object",
      "properties": {
        "flightNumber": { "type": "string" },
        "price": { "type": "number" }
      }
    }
  }
}
```

### 工具命名规范

- 长度：1-128 字符
- 允许字符：A-Z, a-z, 0-9, _, -, .
- 区分大小写
- 服务器内唯一
- 示例：`getUser`, `DATA_EXPORT_v2`, `admin.tools.list`

### 错误处理

工具有两种错误类型：

1. **协议错误** - JSON-RPC 标准错误（工具不存在、请求格式错误）
2. **执行错误** - 工具返回 `isError: true`（API 失败、输入验证错误）

```json
{
  "content": [{
    "type": "text",
    "text": "Invalid date: must be in the future"
  }],
  "isError": true
}
```

---

## 三、Resources 详解

### 资源类型

**直接资源** - 固定 URI
```
calendar://events/2024
file:///project/README.md
```

**资源模板** - 参数化 URI
```
weather://forecast/{city}/{date}
travel://flights/{origin}/{destination}
```

### URI 方案

| 方案 | 用途 | 示例 |
|------|------|------|
| `file://` | 文件系统资源 | `file:///project/src/main.rs` |
| `https://` | Web 资源 | `https://api.example.com/data` |
| `git://` | Git 仓库 | `git://repo/branch/file` |
| 自定义 | 应用特定 | `calendar://`, `travel://` |

### 资源注解

```json
{
  "uri": "file:///project/README.md",
  "annotations": {
    "audience": ["user", "assistant"],
    "priority": 0.8,
    "lastModified": "2025-01-12T15:00:58Z"
  }
}
```

---

## 四、Prompts 详解

### Prompt 定义

```json
{
  "name": "plan-vacation",
  "title": "Plan a vacation",
  "description": "Guide through vacation planning",
  "arguments": [
    { "name": "destination", "type": "string", "required": true },
    { "name": "duration", "type": "number", "description": "days" },
    { "name": "budget", "type": "number", "required": false },
    { "name": "interests", "type": "array", "items": { "type": "string" } }
  ]
}
```

### Prompt 消息类型

- **文本**: `{ "type": "text", "text": "..." }`
- **图片**: `{ "type": "image", "data": "base64...", "mimeType": "image/png" }`
- **音频**: `{ "type": "audio", "data": "base64...", "mimeType": "audio/wav" }`
- **嵌入资源**: `{ "type": "resource", "resource": { "uri": "..." } }`

---

## 五、创建自定义 Skill

### 目录结构

```
skills/
├── skills.json              # Skill 索引
└── my-skill/
    ├── SKILL.md             # 主文档（AI 读取）
    └── references/          # 详细参考文档
        ├── api.md
        └── examples.md
```

### skills.json 格式

```json
{
  "version": "1.0.0",
  "skills": [
    {
      "name": "my-skill",
      "description": "技能描述",
      "source": "local",
      "path": "./my-skill",
      "skillFile": "SKILL.md",
      "references": "references/",
      "requiredMcp": ["shell", "filesystem"],
      "tools": ["tool1", "tool2"]
    }
  ]
}
```

### SKILL.md 模板

```markdown
# Skill 名称

简短描述这个 Skill 能做什么。

## 前置条件

- 需要安装的软件
- 需要的配置

## 可用命令

### command-name

**功能**: 做什么

**用法**:
```bash
command-name [options] <args>
```

**示例**:
```bash
command-name --flag value
```

## 常见用例

1. 用例一：...
2. 用例二：...

## 注意事项

- 限制和约束
- 安全考虑
```

---

## 六、Skill 最佳实践

### 1. 文档编写

- **简洁**: SKILL.md 应简短，详细内容放 references/
- **示例丰富**: 每个命令都要有实际可用的示例
- **错误处理**: 说明常见错误和解决方法

### 2. 工具设计

- **单一职责**: 每个工具只做一件事
- **清晰输入**: 使用 JSON Schema 严格定义参数
- **有意义的输出**: 返回结构化、易于理解的结果

### 3. 安全考虑

- 验证所有输入
- 实现访问控制
- 对敏感操作添加确认
- 限制速率和资源使用

---

## 七、现有 Skills 扩展建议

基于当前系统，以下 Skills 可以增强 AI 能力：

### 高价值扩展

| Skill | 描述 | 依赖 MCP |
|-------|------|----------|
| **database** | SQLite/PostgreSQL 查询 | shell |
| **docker** | 容器管理 | shell |
| **api-client** | HTTP 请求封装 | shell |
| **image-gen** | AI 图片生成 | shell, filesystem |
| **pdf-tools** | PDF 生成/解析 | shell, filesystem |
| **git-advanced** | Git 高级操作 | shell |
| **cron-tasks** | 定时任务管理 | shell |

### 示例：Database Skill

```json
{
  "name": "database",
  "description": "SQLite 数据库操作",
  "tools": [
    "db-query",
    "db-schema",
    "db-insert",
    "db-export"
  ]
}
```

SKILL.md:
```markdown
# Database Skill

本地 SQLite 数据库操作。

## 查询数据

```bash
sqlite3 /path/to/db.sqlite "SELECT * FROM users LIMIT 10"
```

## 查看表结构

```bash
sqlite3 /path/to/db.sqlite ".schema tablename"
```

## 导出 CSV

```bash
sqlite3 -header -csv /path/to/db.sqlite "SELECT * FROM users" > users.csv
```
```

---

## 八、调试与测试

### 查看已加载 Skills

服务器启动时会打印已加载的 Skills：
```
✅ 已加载 2 个 Skills
   - megacmd: MEGA 云存储命令行工具
   - chart-visualization: 图表可视化
```

### 测试 Skill

1. 在 SKILL.md 中添加示例命令
2. 通过 `run_command` 执行测试
3. 验证输出是否符合预期

### MCP Inspector

官方提供的调试工具，可用于测试 MCP 服务器：
```bash
npx @anthropic-ai/mcp-inspector
```

---

## 参考链接

- [MCP 官方文档](https://modelcontextprotocol.io/docs)
- [MCP 规范](https://modelcontextprotocol.io/specification/2025-11-25)
- [MCP GitHub](https://github.com/modelcontextprotocol)
