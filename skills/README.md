# Genspark Agent Skills System

这是一个本地 Skill 系统，用于扩展 AI Agent 的能力。

## 什么是 Skill？

Skill 是一组结构化的知识和工作流程，让 AI 能够：
1. 遵循预定义的最佳实践
2. 了解工具的详细参数规范
3. 智能选择合适的工具完成任务

## 工作原理

```
┌─────────────────────────────────────────────────────────────┐
│                    Genspark Agent Server                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │  MCP Hub    │    │   Safety    │    │   Skills    │     │
│  │  (工具)     │    │   (安全)    │    │   Manager   │     │
│  └─────────────┘    └─────────────┘    └──────┬──────┘     │
│                                               │             │
│                                               ▼             │
│                                        ┌─────────────┐     │
│                                        │ skills.json │     │
│                                        └──────┬──────┘     │
│                                               │             │
│         ┌─────────────────────────────────────┼─────┐      │
│         │              skills/                │     │      │
│         │  ┌──────────────────────────────────┴──┐  │      │
│         │  │  chart-visualization/               │  │      │
│         │  │  ├── SKILL.md                       │  │      │
│         │  │  └── references/                    │  │      │
│         │  │      ├── generate_line_chart.md     │  │      │
│         │  │      ├── generate_pie_chart.md      │  │      │
│         │  │      └── ...                        │  │      │
│         │  └─────────────────────────────────────┘  │      │
│         │                                           │      │
│         │  ┌─────────────────────────────────────┐  │      │
│         │  │  your-new-skill/  (可扩展)          │  │      │
│         │  │  ├── SKILL.md                       │  │      │
│         │  │  └── references/                    │  │      │
│         │  └─────────────────────────────────────┘  │      │
│         └───────────────────────────────────────────┘      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │   AI Client     │
                    │  (Claude etc.)  │
                    │                 │
                    │ 收到 skills 和   │
                    │ skillsPrompt    │
                    └─────────────────┘
```

## 目录结构

```
skills/
├── README.md                    # 本文件
├── skills.json                  # Skill 索引文件
├── SYSTEM_PROMPT_SKILLS.md      # 系统提示（自动注入给 AI）
└── <skill-name>/                # 每个 Skill 一个目录
    ├── SKILL.md                 # Skill 描述和工作流程
    └── references/              # 参考文档（可选）
        └── *.md
```

## 已安装的 Skills

| Skill | 描述 | 来源 |
|-------|------|------|
| chart-visualization | 智能图表生成，支持 26+ 种图表类型 | antvis/chart-visualization-skills |

## WebSocket API

服务器在客户端连接时自动发送 Skills 信息：

```json
{
  "type": "connected",
  "tools": [...],
  "skills": [
    {
      "name": "chart-visualization",
      "description": "智能图表生成技能...",
      "tools": ["generate_line_chart", ...]
    }
  ],
  "skillsPrompt": "# 已加载的 Skills...."
}
```

### 新增的消息类型

| 类型 | 描述 | 参数 |
|------|------|------|
| `list_skills` | 获取所有 Skills 列表 | - |
| `get_skills_prompt` | 获取 Skills 系统提示 | - |
| `get_skill_reference` | 获取特定参考文档 | `skill`, `reference` |
| `list_skill_references` | 列出 Skill 的所有参考文档 | `skill` |

## 如何添加新 Skill

### 步骤 1: 创建 Skill 目录

```bash
mkdir -p skills/my-new-skill/references
```

### 步骤 2: 创建 SKILL.md

```markdown
---
name: my-new-skill
description: 这个 Skill 的简短描述
---

# My New Skill

## 功能概述
描述这个 Skill 能做什么...

## 工作流程
1. 步骤一
2. 步骤二

## 可用工具
- tool_1: 描述
- tool_2: 描述
```

### 步骤 3: 添加参考文档（可选）

在 `references/` 目录下为每个工具创建详细说明：

```markdown
# tool_name — 工具名称

## 功能概述
简要说明...

## 输入字段
### 必填
- `field1`: 类型，说明

### 可选
- `field2`: 类型，默认值，说明

## 使用示例
...
```

### 步骤 4: 更新 skills.json

```json
{
  "skills": [
    {
      "name": "my-new-skill",
      "description": "这个 Skill 的描述",
      "source": "local",
      "path": "./my-new-skill",
      "skillFile": "SKILL.md",
      "references": "references/",
      "requiredMcp": ["some-mcp-server"],
      "tools": ["tool_1", "tool_2"]
    }
  ]
}
```

### 步骤 5: 更新 SYSTEM_PROMPT_SKILLS.md

添加新 Skill 的使用指南到系统提示中。

### 步骤 6: 重启服务器

```bash
node server-v2/index.js
```

## Skill 示例想法

- **web-scraping**: 网页抓取最佳实践
- **code-review**: 代码审查工作流程  
- **data-analysis**: 数据分析指南
- **document-writing**: 文档撰写规范
- **api-testing**: API 测试流程

## License

MIT
