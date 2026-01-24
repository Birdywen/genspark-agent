# 工具使用指南

本系统提供 67 个工具，分为 4 大类。选择工具时请遵循以下原则。

---

## 工具分类总览

| 分类 | 数量 | 用途 | 典型场景 |
|------|------|------|----------|
| filesystem | 14 | 文件读写、目录操作 | 读配置、写代码、查目录 |
| shell | 1 | 执行终端命令 | grep搜索、git操作、运行脚本 |
| tree-sitter | 26 | 代码分析 | 查函数定义、找引用、分析结构 |
| chrome-devtools | 26 | 浏览器自动化 | 截图、填表、调试网页 |

---

## 一、文件系统 (filesystem)

### 读取文件
```
read_file          # 读取单个文件（推荐）
  path: 绝对路径

read_multiple_files # 同时读多个文件
  paths: [路径数组]

read_media_file    # 读取图片/音频
  path: 绝对路径
```

### 写入/编辑文件
```
write_file         # 创建或完全覆盖文件
  path: 绝对路径
  content: 文件内容

edit_file          # 行级编辑（小范围修改推荐）
  path: 绝对路径
  edits: [{oldText, newText}]
```

### 目录操作
```
list_directory           # 列出目录内容
list_directory_with_sizes # 含文件大小
directory_tree           # 递归树形结构（JSON）
create_directory         # 创建目录
move_file               # 移动/重命名
search_files            # 搜索文件名
get_file_info           # 获取文件元信息
list_allowed_directories # 查看允许访问的目录
```

---

## 二、命令执行 (shell)

```
run_command        # 执行终端命令
  command: 命令字符串
```

### 适用场景
- 快速文本搜索: `grep`, `rg`
- 版本控制: `git`
- 运行脚本: `python`, `node`
- 系统操作: `curl`, `tar`, `chmod`
- 复杂管道: 多命令组合

### 与其他工具的选择
| 任务 | 优先使用 | 备选 |
|------|----------|------|
| 读取文件 | `read_file` | `cat`(run_command) |
| 搜索文本 | `find_text`(代码) / `rg`(通用) | `grep` |
| 列出目录 | `list_directory` | `ls`(run_command) |

---

## 三、代码分析 (tree-sitter)

> ⚠️ 使用前必须先注册项目: `register_project_tool`

### 项目管理
```
register_project_tool  # 注册项目（必须先执行）
  path: 项目绝对路径
  name: 项目名称

list_projects_tool     # 列出已注册项目
remove_project_tool    # 移除项目
```

### 文件与AST
```
list_files      # 列出项目文件
  project: 项目名

get_file        # 获取文件内容
  project: 项目名
  path: 相对路径（相对于项目根目录）

get_ast         # 获取语法树
  project: 项目名
  path: 相对路径
  max_depth: 深度限制
```

### 搜索与分析
```
find_text        # 搜索文本（带上下文）
  project: 项目名
  pattern: 搜索模式

get_symbols      # 提取符号（函数、类、变量）⚠️目前有bug
  project: 项目名
  path: 相对路径

find_usage       # 查找符号引用
  project: 项目名
  symbol: 符号名

analyze_project  # 分析项目结构
  project: 项目名

analyze_complexity # 分析代码复杂度
  project: 项目名
  path: 相对路径
```

### tree-sitter vs shell 选择
| 任务 | tree-sitter | shell (grep/rg) |
|------|-------------|------------------|
| 搜索代码文本 | `find_text` ✓ 带上下文、结构化 | 快速但无结构 |
| 找函数定义 | `get_symbols` ✓ 精准 | 需正则，易误判 |
| 找符号引用 | `find_usage` ✓ 语义级 | 纯文本匹配 |
| 理解代码结构 | `get_ast` ✓ 语法树 | 无法做到 |
| 快速全文搜索 | 较慢 | `rg` ✓ 更快 |

---

## 四、浏览器自动化 (chrome-devtools)

### 页面管理
```
new_page         # 新建页面
list_pages       # 列出所有页面
select_page      # 选择页面
close_page       # 关闭页面
navigate_page    # 导航到URL
resize_page      # 调整窗口大小
```

### 交互操作
```
click            # 点击元素
hover            # 悬停
drag             # 拖拽
fill             # 填写输入框/选择下拉
fill_form        # 批量填写表单
press_key        # 按键
upload_file      # 上传文件
handle_dialog    # 处理对话框
wait_for         # 等待文本出现
```

### 截图与快照
```
take_screenshot  # 截图
take_snapshot    # 获取页面文本快照（a11y树）
```

### 调试
```
evaluate_script        # 执行JS
list_console_messages  # 控制台消息
get_console_message    # 获取单条消息
list_network_requests  # 网络请求列表
get_network_request    # 获取请求详情
emulate               # 模拟设备/环境
```

### 性能分析
```
performance_start_trace    # 开始录制
performance_stop_trace     # 停止录制
performance_analyze_insight # 分析结果
```

---

## 五、工具选择决策树

```
需要做什么？
│
├─ 读写文件
│   ├─ 单个文件 → read_file / write_file
│   ├─ 多个文件 → read_multiple_files
│   └─ 小范围修改 → edit_file
│
├─ 搜索内容
│   ├─ 代码项目中搜索 → find_text (需先注册项目)
│   ├─ 快速全文搜索 → run_command + rg
│   └─ 找文件名 → search_files 或 fd
│
├─ 分析代码
│   ├─ 查看结构 → get_ast
│   ├─ 找函数/类 → get_symbols
│   ├─ 找引用 → find_usage
│   └─ 复杂度 → analyze_complexity
│
├─ 执行命令
│   └─ run_command (git, curl, python, etc.)
│
└─ 浏览器操作
    ├─ 截图 → take_screenshot
    ├─ 填表 → fill / fill_form
    └─ 调试 → evaluate_script
```

---

## 六、常见混淆点

### 路径参数区别
| 工具来源 | 参数名 | 路径类型 |
|----------|--------|----------|
| filesystem | `path` | **绝对路径** |
| tree-sitter | `path` | **相对路径**（相对项目根目录） |
| tree-sitter | `project` | 项目名称（注册时指定） |

### 相似工具区分
| 工具A | 工具B | 区别 |
|-------|-------|------|
| `read_file` | `get_file` | read_file用绝对路径；get_file需项目名+相对路径 |
| `list_directory` | `list_files` | list_directory用绝对路径；list_files需项目名 |
| `search_files` | `find_text` | search_files搜文件名；find_text搜文件内容 |
