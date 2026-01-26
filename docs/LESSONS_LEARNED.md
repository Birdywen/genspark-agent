# 经验教训库

> 持续更新，避免重复踩坑

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
