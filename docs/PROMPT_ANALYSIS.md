# 系统提示词分析报告

## 当前提示词结构

提示词由多个部分组成，按顺序拼接：

```
1. content.js generateSystemPrompt() - 基础框架
   ├── 调用格式说明
   ├── 工具概览 (4大类)
   ├── 规则 (7条)
   ├── Agent 协作系统
   └── 系统架构说明

2. skills.js _generateSystemPrompt() - 附加内容
   ├── .ai-env.md - 本地环境信息
   ├── Skills 列表
   ├── TOOLS_GUIDE.md - 工具使用指南
   └── ADVANCED_GUIDE.md - 详细工具参考
```

---

## 问题分析

### 1. 重复内容 ❌

| 位置 | 内容 | 问题 |
|------|------|------|
| content.js | 工具概览 (4大类, 67个) | 与 TOOLS_GUIDE.md 重复 |
| content.js | 文件路径引用 | 与 skills.js 加载的内容重复 |
| TOOLS_GUIDE.md | 完整工具列表 | 与 ADVANCED_GUIDE.md 部分重复 |

### 2. 缺失内容 ❌

| 应该有 | 当前状态 | 重要性 |
|--------|----------|--------|
| 记忆系统使用说明 | 缺失 | ⭐⭐⭐ 高 |
| 新对话启动流程 | 缺失 | ⭐⭐⭐ 高 |
| digest 命令介绍 | 缺失 | ⭐⭐⭐ 高 |
| 经验教训库路径 | 缺失 | ⭐⭐ 中 |
| 常见错误处理 | 零散 | ⭐⭐ 中 |
| Helper 脚本说明 | 在小贴士里 | ⭐ 低 |

### 3. 不清晰的地方 ❌

| 问题 | 说明 |
|------|------|
| YOUR_AGENT_ID | 没说明怎么获取自己的 agent_id |
| 工具文档路径 | 提到 TOOLS_QUICK_REFERENCE.md 但现在文件名可能不同 |
| MCP 配置 | 普通用户不需要知道这些细节 |
| Skills 目录 | 路径写死了，不够通用 |

### 4. 可以压缩的内容 ✂️

| 内容 | 建议 |
|------|------|
| Agent 协作系统 | 太详细，大多数场景用不到，可精简 |
| 任务队列命令 | 可移到文档，提示词只保留关键命令 |
| MCP 架构说明 | 可删除或极简化 |
| ADVANCED_GUIDE.md 全文 | 太长，应按需加载 |

---

## 改进建议

### 新的提示词结构

```
1. 核心指令（必须，~500字）
   ├── 调用格式（精简版）
   ├── 关键规则（5条）
   └── 完成标记 @DONE

2. 记忆系统（新增，~300字）⭐
   ├── 新对话启动：digest 命令
   ├── 记录里程碑
   └── 经验库路径

3. 本地环境（.ai-env.md，~200字）
   ├── 可用工具
   └── 工作规范

4. 工具速查（精简版，~300字）
   ├── 4大类概览
   └── 详细文档链接

5. 协作系统（精简版，~200字）
   ├── @SEND 跨Tab通信
   └── 检查任务命令

6. Skills（动态，按需）
```

### 具体改动

#### A. content.js generateSystemPrompt() 重写

**删除：**
- MCP 架构说明（用户不需要）
- 详细的任务队列命令（移到文档）
- 重复的工具列表

**新增：**
- 记忆系统核心命令
- 新对话启动流程
- 经验库链接

**精简：**
- Agent 协作：只保留 @SEND 和检查任务
- 规则：从7条精简到5条核心规则

#### B. 文档路径更新

```
TOOLS_QUICK_REFERENCE.md  → 保持（速查）
TOOLS_GUIDE.md           → 保持（指南）
ADVANCED_GUIDE.md        → 按需加载，不放入提示词
LESSONS_LEARNED.md       → 在提示词中提供路径
```

#### C. 新增提示词段落

```markdown
## 记忆系统

**新对话开始时，恢复上下文：**
```bash
node /Users/yay/workspace/.agent_memory/memory_manager_v2.js digest <project> /path/to/command-history.json
```

**完成重要功能时，记录里程碑：**
```bash
node /Users/yay/workspace/.agent_memory/memory_manager_v2.js milestone "完成XX功能"
```

**遇到问题时，查阅经验库：**
- 路径：/Users/yay/workspace/genspark-agent/docs/LESSONS_LEARNED.md
- 包含：踩坑记录、最佳实践、常用命令
```

---

## 预期效果

| 指标 | 当前 | 改进后 |
|------|------|--------|
| 提示词长度 | ~4000字 | ~2000字 |
| 记忆系统覆盖 | 0% | 100% |
| 新对话启动指引 | 无 | 有 |
| 重复内容 | 多 | 无 |
| 按需加载 | 无 | 有 |

---

## 实施计划

1. [ ] 重写 content.js generateSystemPrompt()
2. [ ] 更新 .ai-env.md 添加记忆系统
3. [ ] 确认文档路径正确
4. [ ] 测试新提示词
5. [ ] 提交代码
