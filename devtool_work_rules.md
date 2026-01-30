# DevTool 工作规则（浏览器自动化：控制返回体大小，避免重复输出）

> 目标：控制 Snapshot / Console / Network 的返回体大小，避免重复大输出。

## 总原则（必须遵守）
1. 禁止高频 full dump：take_snapshot / list_console_messages / list_network_requests 只能在首次定位或深度排障时用。
2. 优先页面端过滤：用 evaluate_script 做筛选/裁剪/截断后再返回。
3. 两段式：Index(list) -> Detail(get)，只对少量 id/reqid 拉详情。
4. 默认限额：TEXT_LIMIT=1200，K=10，ERROR_TEXT_LIMIT=500，BODY_LIMIT=2000。

## A) Snapshot（a11y 树）
- 仅在：首次找 uid / 重大结构变化 / 深度排障 才调用 take_snapshot。
- 替代：evaluate_script 抽 main 或指定 selector 的 innerText，并截断。

## B) Console（增量 + 限量）
- list_console_messages 只拿索引；只取最后 K 条 id；逐条 get_console_message。
- 调用端保存 last_console_id，下一轮只处理新增。

## C) Network（过滤 + 限量）
- list_network_requests 只拿索引；按 type(fetch/xhr)/url关键词/status>=400 过滤；只取最新 K 个 reqid；逐条 get_network_request。
- 默认不输出 body；必须看时截断到 BODY_LIMIT，JSON 优先摘 error/message/code。

---

## D) 工具稳定性与长内容写入

### 优先级
1. 短内容 → edit_file
2. 长内容写入 → run_command + stdin 或 safe_write.js
3. 长内容替换 → safe_edit.js（自动 .bak 回滚）

### 推荐写法（稳定）
- 原则：工具调用 JSON 保持短小；长内容一律走 stdin。

safe_write（stdin 写入文件，自动创建目录）：
- echo "内容" | node /Users/yay/workspace/genspark-agent/scripts/safe_write.js /目标路径

safe_edit（基于 old/new 文本替换，自动备份 .bak，匹配不到直接报错退出）：
- node /Users/yay/workspace/genspark-agent/scripts/safe_edit.js 目标文件 old.txt new.txt

### 避免
- write_file / edit_file 的 content/newText 过长（易触发 JSON parse error）
- 在聊天内容里展示可能被系统误识别的执行前缀（例如以 TOOL: 或 SEND: 开头的示例）
