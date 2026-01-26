# 工具快速参考 (67个工具)

## 调用格式
```
@TOOL:{"tool":"工具名","params":{"参数名":"参数值"}}
```

---

## 1. 文件系统 (14个)

| 工具 | 用途 | 必填参数 |
|------|------|----------|
| `read_file` | 读取文件内容 | `path` |
| `read_multiple_files` | 同时读取多个文件 | `paths` (数组) |
| `read_media_file` | 读取图片/音频 | `path` |
| `write_file` | 创建/覆盖文件 | `path`, `content` |
| `edit_file` | 行级编辑文件 | `path`, `edits` |
| `create_directory` | 创建目录 | `path` |
| `list_directory` | 列出目录内容 | `path` |
| `directory_tree` | 递归目录树 | `path` |
| `move_file` | 移动/重命名 | `source`, `destination` |
| `search_files` | 搜索文件名 | `path`, `pattern` |
| `get_file_info` | 获取文件元信息 | `path` |
| `list_allowed_directories` | 查看允许访问的目录 | 无 |

**示例:**
```
@TOOL:{"tool":"read_file","params":{"path":"/Users/yay/workspace/file.txt"}}
@TOOL:{"tool":"write_file","params":{"path":"/tmp/test.txt","content":"Hello World"}}
@TOOL:{"tool":"edit_file","params":{"path":"/tmp/test.txt","edits":[{"oldText":"Hello","newText":"Hi"}]}}
```

---

## 2. 浏览器自动化 (26个)

### 页面管理
| 工具 | 用途 | 必填参数 |
|------|------|----------|
| `new_page` | 新建页面 | 无 |
| `list_pages` | 列出所有页面 | 无 |
| `select_page` | 选择页面 | `pageId` |
| `close_page` | 关闭页面 | `pageId` |
| `navigate_page` | 导航到URL | `url` |
| `resize_page` | 调整窗口大小 | `width`, `height` |

### 交互操作
| 工具 | 用途 | 必填参数 |
|------|------|----------|
| `click` | 点击元素 | `uid` |
| `hover` | 悬停元素 | `uid` |
| `fill` | 填写输入框 | `uid`, `value` |
| `fill_form` | 批量填写表单 | `elements` |
| `press_key` | 按键 | `key` |
| `drag` | 拖拽元素 | `from_uid`, `to_uid` |
| `upload_file` | 上传文件 | `uid`, `filePath` |
| `handle_dialog` | 处理对话框 | `accept` |
| `wait_for` | 等待文本出现 | `text` |

### 截图与快照
| 工具 | 用途 | 必填参数 |
|------|------|----------|
| `take_screenshot` | 截图 | 无 |
| `take_snapshot` | 获取页面文本快照(a11y树) | 无 |

### 调试
| 工具 | 用途 | 必填参数 |
|------|------|----------|
| `evaluate_script` | 执行JS | `function` |
| `list_console_messages` | 控制台消息列表 | 无 |
| `get_console_message` | 获取单条消息 | `id` |
| `list_network_requests` | 网络请求列表 | 无 |
| `get_network_request` | 获取请求详情 | `reqid` |
| `emulate` | 模拟设备/网络 | 可选参数 |

### 性能分析
| 工具 | 用途 | 必填参数 |
|------|------|----------|
| `performance_start_trace` | 开始录制 | 无 |
| `performance_stop_trace` | 停止录制 | 无 |
| `performance_analyze_insight` | 分析结果 | `insightId` |

**示例:**
```
@TOOL:{"tool":"navigate_page","params":{"url":"https://example.com"}}
@TOOL:{"tool":"take_snapshot","params":{}}
@TOOL:{"tool":"click","params":{"uid":"1_5"}}
@TOOL:{"tool":"fill","params":{"uid":"1_10","value":"hello"}}
@TOOL:{"tool":"evaluate_script","params":{"function":"() => document.title"}}
```

---

## 3. 命令执行 (1个)

| 工具 | 用途 | 必填参数 |
|------|------|----------|
| `run_command` | 执行终端命令 | `command` |

**可选参数:** `workdir` (工作目录), `stdin` (标准输入)

**示例:**
```
@TOOL:{"tool":"run_command","params":{"command":"ls -la"}}
@TOOL:{"tool":"run_command","params":{"command":"cat /etc/hosts"}}
@TOOL:{"tool":"run_command","params":{"command":"python3 script.py","workdir":"/tmp"}}
```

---

## 4. 代码分析 (26个)

> ⚠️ 使用前必须先注册项目: `register_project_tool`

### 项目管理
| 工具 | 用途 | 必填参数 |
|------|------|----------|
| `register_project_tool` | 注册项目 | `path`, `name` |
| `list_projects_tool` | 列出已注册项目 | 无 |
| `remove_project_tool` | 移除项目 | `name` |

### 文件与AST
| 工具 | 用途 | 必填参数 |
|------|------|----------|
| `list_files` | 列出项目文件 | `project` |
| `get_file` | 获取文件内容 | `project`, `path` |
| `get_ast` | 获取语法树 | `project`, `path` |
| `get_node_at_position` | 定位AST节点 | `project`, `path`, `line`, `column` |

### 搜索与分析
| 工具 | 用途 | 必填参数 |
|------|------|----------|
| `find_text` | 搜索文本 | `project`, `pattern` |
| `get_symbols` | 提取符号 | `project`, `path` |
| `find_usage` | 查找符号引用 | `project`, `symbol` |
| `analyze_project` | 分析项目结构 | `project` |
| `analyze_complexity` | 分析代码复杂度 | `project`, `path` |
| `find_similar_code` | 查找相似代码 | `project`, `code` |
| `get_dependencies` | 查找依赖 | `project`, `path` |

### 查询
| 工具 | 用途 | 必填参数 |
|------|------|----------|
| `run_query` | 运行tree-sitter查询 | `project`, `query` |
| `build_query` | 构建查询 | `language`, `pattern` |
| `adapt_query` | 适配查询到其他语言 | `query`, `from_lang`, `to_lang` |
| `list_query_templates_tool` | 列出查询模板 | 无 |
| `get_query_template_tool` | 获取查询模板 | `language`, `template` |

### 其他
| 工具 | 用途 | 必填参数 |
|------|------|----------|
| `list_languages` | 列出支持的语言 | 无 |
| `check_language_available` | 检查语言支持 | `language` |
| `get_node_types` | 获取节点类型说明 | `language` |
| `clear_cache` | 清除缓存 | 无 |
| `diagnose_config` | 诊断配置 | 无 |
| `configure` | 配置服务器 | `config_path` |

**示例:**
```
@TOOL:{"tool":"register_project_tool","params":{"path":"/Users/yay/workspace/myproject","name":"myproject"}}
@TOOL:{"tool":"find_text","params":{"project":"myproject","pattern":"TODO"}}
@TOOL:{"tool":"get_symbols","params":{"project":"myproject","path":"src/main.js"}}
```

---

## 常用工作流

### 读取并修改文件
```
1. @TOOL:{"tool":"read_file","params":{"path":"/path/to/file"}}
2. @TOOL:{"tool":"edit_file","params":{"path":"/path/to/file","edits":[{"oldText":"旧内容","newText":"新内容"}]}}
```

### 浏览器自动化
```
1. @TOOL:{"tool":"navigate_page","params":{"url":"https://example.com"}}
2. @TOOL:{"tool":"take_snapshot","params":{}}
3. @TOOL:{"tool":"click","params":{"uid":"从快照中获取的uid"}}
```

### 代码分析
```
1. @TOOL:{"tool":"register_project_tool","params":{"path":"/path/to/project","name":"proj"}}
2. @TOOL:{"tool":"analyze_project","params":{"project":"proj"}}
3. @TOOL:{"tool":"find_usage","params":{"project":"proj","symbol":"functionName"}}
```
