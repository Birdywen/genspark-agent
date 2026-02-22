# Reverse Engineering Skill

## 首要步骤（每次新对话必做）

开始逆向前，先查数据库获取所有可用工历史经验：

```sql
-- 查看所有逆向工具
SELECT name, category, description, inject_method, usage_example, depends_on, output_location
FROM reverse_engineering_tools ORDER BY category, id;

-- 查看逆向相关踩坑经验
SELECT title, problem, solution FROM lessons_learned WHERE category='reverse-engineering';
```

新工具随时可加：
```sql
INSERT OR REPLACE INTO reverse_engineering_tools
(name, file_path, category, description, inject_method, usage_example, depends_on, output_location)
VALUES ('工具名', '文件路径', '分类', '描述', '注入方式', '使用示例', '依赖', '输出位置');
```

数据库路径: `/Users/yay/workspace/.agent_memory/project_knowledge.db`

## 概述

Web 平台 API 逆向工程工具集。通过浏览器请求拦截、认证提取、endpoint 探测和响应分析，快速发现和验证未公开的 API。预置可复用的代码模板，避免重复编写和转义问题。

## 工具分类

- **interceptor**: 请求拦截（xhr_interceptor, fetch_interceptor, dual_interceptor）
- **auth**: 认证提取（token_extractor）
- **analysis**: 日志与响应分析（log_reader, log_filter, response_analyzer）
- **verification**: 端点验证（endpoint_tester）

## 标准逆向流程

1. 打开目标网站 tab，用 `list_tabs` 获取 tabId
2. 注入 `dual_interceptor.js`（推荐首选，同时拦截 XHR 和 Fetch）
3. 在网站上执行操作，触发 API 调用
4. 用 `log_reader.js` 读取拦截日志，`log_filter.js` 按关键词过滤
5. 用 `token_extractor.js` 提取认证 token
6. 用 `endpoint_tester.py` 在终端批量验证发现的 API
7. 用 `response_analyzer.py` 分析返回结构
8. 记录到目标 skill 的 API_REFERENCE.md
9. 新发现的工具/经验写入数据库

## 模板文件

```
templates/
  xhr_interceptor.js      XHR 请求拦截器（兼容 Service Worker）
  fetch_interceptor.js    Fetch 请求拦截器
  dual_interceptor.js     XHR + Fetch 双重拦截（推荐首选）
  token_extractor.js      扫描 cookie/localStorage/sessionStorage/meta/全局变量
  log_reader.js           格式化输出拦截日志
  log_filter.js           按关键词过滤日志（可自定义 window._filterKeywords）
  endpoint_tester.py      curl 批量端点验证
  response_analyzer.py    JSON 响应结构分析（识别 pagination/error/auth 模式）
```

## 快速开始

### 1. 注入拦截器
```
read_file 读取 dual_interceptor.js → HERE eval_js @tabId=xxx . 提取 Token
```
read_file 读取 token_extractor.js → HERE eval_js 执行 → 返回所有认证信息
```

### 3. 读取和过滤日志
```
read_file 读取 log_reader.js → HERE eval_js → 格式化请求列表
read_file 读取 log_filter.js → HERE eval_js → 按关键词过滤
```

### 4. 验证 API
```
echo '/api/users GET\n/api/data POST' | python3 endpoint_tester.py https://base-url /tmp/token.txt
```

### 5. 分析响应
```
curl -s https://api.example.com/data | python3 response_analyzer.py
```

## 经验总结

- 优先用 dual_interceptor（XHR + Fetch 同时拦截），覆盖最全
- Service Worker 可能绕过 fetch patch，XHR patch 更可靠
- Token 常见位置：cookie（prod、token、session）、localStorage、Authorization header
- 官方 API 文档路径经常与实际不同，以抓包结果为准
- 所有 eval_js 注入必须用 HERE 格式，避免括号/引号/正则丢失
- 新发现的 pattern 及时写入 lessons_learned 和 reverse_engineering_tools 表