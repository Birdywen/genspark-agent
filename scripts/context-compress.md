# Context Compress - 上下文压缩工具

## 用途
当 Genspark Agent 对话过长时（消息数 > 50），压缩上下文：
1. 存档当前进度到文件
2. 把第 N 条用户消息编辑为精炼总结
3. Save 后，后续对话全部清除，AI 从总结重新开始

## 触发条件
- 消息数 > 50 条（可配置）
- 或总字符数 > 50000（可配置）
- 需用户确认后执行

## 流程
1. AI 检测到阈值 → 提醒用户
2. 用户确认 → AI 执行以下步骤：
   a. 收集当前对话所有消息内容
   b. 生成压缩总结（包含：任务目标、已完成步骤、当前进度、待办事项、关键决策）
   c. 将总结 + TODO 写入 /Users/yay/workspace/context-archives/YYYY-MM-DD-HH-MM-agentId.md
   d. 在浏览器中执行一键编辑操作（编辑第 4 条用户消息为总结，Save）

## 存档文件格式
```markdown
# Context Archive - [日期时间]
## Agent ID: xxx
## 任务目标: xxx
## 已完成:
- ...
## 当前进度:
- ...
## TODO:
- ...
## 关键上下文:
- ...
## 压缩总结（已写入对话）:
[实际写入的总结内容]

回滚/恢复

如果操作失败或网页崩溃：

读取 /Users/yay/workspace/context-archives/ 下最新存档
手动在对话中粘贴总结内容
或开新对话，把存档作为初始上下文 CONTENT 