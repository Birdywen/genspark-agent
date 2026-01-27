# 经验教训库

> 持续更新，避免重复踩坑

---

## 零、黄金法则（必读）

**长内容写入规则：**
- 短内容(<500字符) → edit_file/write_file
- 长内容写入 → run_command+stdin 或 safe_write.js
- 长内容替换 → safe_edit.js（自动.bak）

**避免误执行：** 示例中不写真实前缀，用 TOOL: 代替

---

## 一、工具使用技巧

### ✅ 有效的做法

1. **长代码修改用 Node 脚本**
   - 先 `write_file` 写脚本到 `/private/tmp/xxx.js`
   - 再 `run_command` 执行 `node /private/tmp/xxx.js`
   - 原因：直接用 edit_file 长内容经常匹配失败

2. **edit_file 适合小范围修改**
   - 改几行代码时比 write_file 更安全
   - 不会意外覆盖整个文件

3. **浏览器操作前先 take_snapshot**
   - 获取页面元素的 uid
   - 然后用 uid 进行 click、fill 等操作

4. **调试 DOM 选择器**
   - 用 `evaluate_script` 执行 JS 测试选择器
   - 比反复修改 content.js 更快

5. **批量文件操作用 shell**
   - `grep`、`sed`、`find` 等比多次调用工具更高效
   - 但复杂逻辑还是用 node 脚本

### ❌ 要避免的坑

1. **heredoc 在 run_command 中不稳定**
   - `<< 'EOF'` 语法经常失败
   - 改用 write_file + node 执行

2. **特殊字符导致 JSON 解析失败**
   - 反引号、`${}` 模板字符串、转义符
   - 写入文件时要特别注意

3. **路径问题**
   - `/tmp` 不在允许目录内，要用 `/private/tmp`
   - 文件路径必须是绝对路径

4. **for 循环不在白名单**
   - shell 的 `for` 命令被禁止
   - 改用 node 脚本遍历

5. **edit_file 的 oldText 必须精确匹配**
   - 包括空格、换行、缩进
   - 不确定时先用 `sed -n 'Np'` 查看原文

---

## 二、Extension 开发经验

### DOM 选择器调试流程

1. 用 DevTools 或 `take_snapshot` 查看页面结构
2. 用 `evaluate_script` 测试选择器
3. 确认后再修改 content.js

### 各网站选择器参考

| 网站 | 消息容器 | 输入框 | 发送按钮 |
|------|----------|--------|----------|
| genspark.ai | `.conversation-statement.assistant` | `textarea` | `button[type=submit]` |
| vear.com | `.chata` | `textarea.queryContent` | `button.sendQBtn` |
| chat.galaxy.ai | `main [data-testid="message-content"]` | `textarea[placeholder="Send a message..."]` | `button[type="submit"]` |

### 新增 Extension 流程

1. 复制现有 extension 目录
2. 修改 `manifest.json` 的 matches 域名
3. 修改 `background.js` 的 URL 匹配
4. 修改 `content.js` 的 DOM 选择器
5. 测试：输入框、发送、消息获取、工具调用

---

## 三、多 Agent 协作

### 跨 Tab 通信

```
@SEND:agent_id:消息内容
```

### 任务队列（持久化）

```bash
node /Users/yay/workspace/.agent_hub/task_manager.js check YOUR_AGENT_ID
node /Users/yay/workspace/.agent_hub/task_manager.js agents
```

---

## 四、Context 管理

### 对话轮次预警机制 ⚠️

**规则：每 30 轮对话后发出预警（可调整）

**数据收集目的：**
- 观察多少轮对话后开始卡顿
- 分析 token 量与响应速度的关系
- 找到最佳的对话轮次阈值

预警内容：
```
⚠️ 【Context 预警】当前对话已超过 30 轮
- 历史消息可能造成 context 挤压
- 建议：总结当前进度，考虑开启新对话
- 如需继续，请确认重要上下文已记录到经验库
```

### 踩坑自动记录机制 📝

**触发条件：**
- 工具执行失败超过 2 次
- 发现新的坑点或解决方案
- 用户反馈某方法无效

**记录格式：**
```markdown
### [日期] 问题简述
- **现象**：发生了什么
- **原因**：为什么会这样
- **解决**：如何修复
- **预防**：以后怎么避免
```

### 进度总结机制 📊

**何时总结：**
- 复杂任务完成一个阶段
- 对话即将结束
- 收到预警时

**总结写入位置：** `/Users/yay/workspace/TODO.md` 或本文件

### 问题
- 长对话导致 context 过大
- 不得不截断丢失上下文

### 解决方案
1. 定期写入总结到此文件
2. 新对话开头读取此文件恢复上下文
3. 复杂任务拆分到多个对话

---

## 五、常用命令速查

```bash
# 查看文件特定行
sed -n '100,120p' file.js

# 搜索内容
grep -n 'pattern' file.js

# 替换内容
sed -i '' 's/old/new/g' file.js

# Git 操作
git add -A && git commit -m 'msg' && git push origin main
git log --oneline -10
git stash && git stash pop
```

---

*最后更新: 2026-01-26*

---

## 六、工具执行失败日志

**日志位置**: `/Users/yay/workspace/genspark-agent/logs/tool_failures.log`

**触发记录的关键词**:
- "不执行" / "没执行"
- "没反应" / "没有反应"
- "failed" / "失败"

**记录内容**:
- 时间（对话轮次）
- 调用的工具和参数
- 用户反馈的现象
- 可能原因
- 解决方案

**用途**: 分析哪些工具调用模式容易失败，优化调用策略

---

## 七、新对话启动清单

**每次新对话开始时，执行以下步骤：**

1. 读取经验库：`read_file /Users/yay/workspace/genspark-agent/docs/LESSONS_LEARNED.md`
2. 检查待办事项：`cat /Users/yay/workspace/TODO.md`
3. 查看失败日志（可选）：`tail -30 /Users/yay/workspace/genspark-agent/logs/tool_failures.log`
4. 初始化轮次计数：`echo '{"session":"'$(date +%Y%m%d_%H%M%S)'","round":0}' > /private/tmp/session_counter.json`

**快速启动命令（一键执行）：**
```bash
cat /Users/yay/workspace/genspark-agent/docs/LESSONS_LEARNED.md && echo '---SESSION START---' && cat /Users/yay/workspace/TODO.md 2>/dev/null || echo 'No TODO' && echo '{"session":"'$(date +%Y%m%d_%H%M%S)'","round":0}' > /private/tmp/session_counter.json
```

---

## 八、轮次计数与日志工具

### 轮次计数器

**脚本位置**: `/Users/yay/workspace/genspark-agent/scripts/session_counter.js`

**用法**:
```bash
# 查看当前状态
node /Users/yay/workspace/genspark-agent/scripts/session_counter.js status

# 增加轮次（每轮对话后调用）
node /Users/yay/workspace/genspark-agent/scripts/session_counter.js inc

# 重置（新对话开始时）
node /Users/yay/workspace/genspark-agent/scripts/session_counter.js reset
```

### 结构化失败日志

**位置**: `/Users/yay/workspace/genspark-agent/logs/tool_failures.json`

**记录新失败**:
```bash
node -e 'const fs=require("fs");const f="/Users/yay/workspace/genspark-agent/logs/tool_failures.json";const d=JSON.parse(fs.readFileSync(f));d.push({id:d.length+1,date:"日期",round:轮次,tool:"工具名",error_type:"类型",symptom:"现象",cause:"原因",solution:"方案"});fs.writeFileSync(f,JSON.stringify(d,null,2));'
```

**错误类型枚举**: param_error, no_execute, rate_limit, timeout, unknown

---

## 九、长内容写入最佳实践

### 问题根源
JSON 参数中的长字符串容易触发解析错误，特别是包含：换行符、引号、反斜杠、模板字符串

### 稳定性排序（从高到低）
1. **node -e + 短脚本** - 最稳定，适合生成文件
2. **heredoc (cat << 'EOF')** - 较稳定，注意用单引号 EOF 防止变量展开
3. **run_command + stdin** - 新发现，待验证
4. **write_file** - 短内容OK，长内容易失败
5. **edit_file** - 最不稳定，长内容几乎必失败

### Helper 脚本

**位置**: `/Users/yay/workspace/genspark-agent/scripts/`

| 脚本 | 用途 | 用法 |
|------|------|------|
| safe_write.js | 安全写入 | `echo "内容" \| node safe_write.js /path` |
| safe_edit.js | 安全编辑 | `node safe_edit.js file old.txt new.txt` |

### 推荐工作流

```bash
# 1. 先写内容到临时文件
cat > /private/tmp/content.txt << 'EOF'
长内容...


---

---

## 十、已知问题与待优化

### 跨 Tab 消息打断输出
- **现象**：正在生成回复时，其他 Agent 消息插入导致输出截断
- **原因**：跨 Tab 通信异步，消息到达时机不可控
- **状态**：已有消息队列方案，运行中

---

*最后更新: 2026-01-26*

## 十一、跨Tab消息队列机制详解

### 架构概述（2026-01-26 分析）

**三层防护机制：**

1. **消息队列 (messageQueue)** - content.js 第37-38行
   - 跨Tab消息通过 `enqueueMessage()` 入队
   - FIFO 顺序处理，间隔 3 秒

2. **AI生成状态检测 (isAIGenerating)** - 第49-57行
   - 检测停止按钮、typing indicator 等
   - 多种选择器兼容不同网站

3. **安全发送 (sendMessageSafe)** - 第399-406行
   - 等待 AI 输出完成（最长30秒）
   - 双重确认：500ms 后二次检查

### 消息流转路径

```
发送方 @SEND:target:msg
  ↓
content.js sendToAgent()
  ↓
background.js CROSS_TAB_SEND → sendCrossTabMessage()
  ↓
目标Tab content.js CROSS_TAB_MESSAGE
  ↓
enqueueMessage() → processMessageQueue() → sendMessageSafe()
```

### 已知限制

- 无发送失败重试
- 无队列长度上限
- 依赖 DOM 选择器检测 AI 状态



### [2026-01-26] SSE 拦截导致工具不执行
- **现象**：添加 fetch/XHR/WebSocket 拦截后，工具调用频繁不执行
- **原因**：拦截代码可能破坏了页面原有的请求流程
- **解决**：回滚到 d27a394
- **预防**：
  - 拦截网络请求需要更谨慎
  - 应该先在独立环境测试
  - 使用 response.clone() 避免消费原始 response

### SSE 拦截失败记录 (2026-01-26 补充)

**尝试 v2**：使用 `response.clone()` + 只读处理
**结果**：仍然导致工具不执行
**结论**：在 content script 中覆盖 `window.fetch` 是不安全的，可能被页面检测或干扰页面功能

**最终决定**：放弃 SSE 拦截，保持 DOM 观察方案

---

## 记忆系统 (2026-01-27)

### 新对话开始时加载上下文

```bash
node /Users/yay/workspace/.agent_memory/load_context.js
```

### 记录里程碑

```bash
node /Users/yay/workspace/.agent_memory/memory_manager.js milestone "完成XX功能"
```

### 设置当前任务

```bash
node /Users/yay/workspace/.agent_memory/memory_manager.js task "任务描述"
```

### 生成会话摘要

```bash
node /Users/yay/workspace/.agent_memory/memory_manager.js summary
```

### 开启新会话（归档旧会话）

```bash
node /Users/yay/workspace/.agent_memory/memory_manager.js new
```

### 文件位置

- 会话数据: `/Users/yay/workspace/.agent_memory/current_session.json`
- 会话摘要: `/Users/yay/workspace/.agent_memory/session_summary.md`
- 命令历史: `/Users/yay/workspace/.agent_memory/command_history.json`
- 详细输出: `/Users/yay/workspace/.agent_memory/outputs/`

---

## 新对话启动流程 (重要!)

每次新对话开始时，先执行以下命令了解当前状态：

```bash
# 1. 查看所有项目和当前进度
node /Users/yay/workspace/.agent_memory/memory_manager_v2.js projects

# 2. 如果用户提到某个项目，切换并加载
node /Users/yay/workspace/.agent_memory/memory_manager_v2.js switch <project_name>
node /Users/yay/workspace/.agent_memory/memory_manager_v2.js load
```

### 项目名称映射

| 用户可能说的 | 实际项目名 |
|-------------|------------|
| youtube/英语频道/视频 | english_youtube_channel |
| agent/genspark/插件 | genspark-agent |

### 里程碑记录

完成重要功能时主动记录：
```bash
node /Users/yay/workspace/.agent_memory/memory_manager_v2.js milestone "完成XX功能"
```
