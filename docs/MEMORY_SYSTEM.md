# 多项目记忆系统 v2

## 概述

记忆系统支持按项目分离上下文，每个项目有独立的：
- 当前任务
- 里程碑
- 命令历史
- 会话摘要

## 快速开始

### 新对话开始时

```bash
# 查看所有项目
node /Users/yay/workspace/.agent_memory/memory_manager_v2.js projects

# 切换到目标项目
node /Users/yay/workspace/.agent_memory/memory_manager_v2.js switch <project_name>

# 加载项目上下文
node /Users/yay/workspace/.agent_memory/memory_manager_v2.js load
```

### 日常使用

```bash
# 设置当前任务
node memory_manager_v2.js task "任务描述"

# 添加里程碑
node memory_manager_v2.js milestone "完成了XX功能"

# 查看当前状态
node memory_manager_v2.js status

# 生成摘要
node memory_manager_v2.js summary
```

## 命令参考

| 命令 | 说明 |
|------|------|
| `switch <project>` | 切换/创建项目 |
| `projects` | 列出所有项目 |
| `task <desc>` | 设置当前任务 |
| `milestone <text>` | 添加里程碑 |
| `summary [proj]` | 生成项目摘要 |
| `load [proj]` | 同 summary |
| `status` | 查看当前状态 |

## 文件结构

```
/Users/yay/workspace/.agent_memory/
├── active_project.txt      # 当前活跃项目
├── memory_manager_v2.js    # 管理脚本
└── projects/
    ├── english_youtube_channel/
    │   ├── session.json
    │   └── summary.md
    ├── genspark-agent/
    │   ├── session.json
    │   └── summary.md
    └── ...
```

## 已有项目

1. **english_youtube_channel** - YouTube英语频道自动化
2. **genspark-agent** - Agent系统开发

## 工作流程示例

```bash
# 1. 开始新对话，先看有哪些项目
node memory_manager_v2.js projects

# 2. 切换到要处理的项目
node memory_manager_v2.js switch english_youtube_channel

# 3. 加载上下文，了解之前做到哪里
node memory_manager_v2.js load

# 4. 工作中添加里程碑
node memory_manager_v2.js milestone "完成视频生成功能"

# 5. 结束前生成摘要
node memory_manager_v2.js summary
```
