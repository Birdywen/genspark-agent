# Genspark Agent 完整指南

本文档供 AI Agent 参考，包含工具使用、Skills 开发、错误处理等内容。

---

## 一、工具分类

系统提供 67 个工具，分为 4 大类：

| 分类 | 数量 | 用途 | 典型场景 |
|------|------|------|----------|
| filesystem | 14 | 文件读写、目录操作 | 读配置、写代码、查目录 |
| shell | 1 | 执行终端命令 | grep、git、运行脚本 |
| tree-sitter | 26 | 代码分析 | 查函数定义、找引用 |
| chrome-devtools | 26 | 浏览器自动化 | 截图、填表、调试网页 |

---

## 二、文件系统工具

### 读取文件

```
read_file           # 读取单个文件
  path: 绝对路径

read_multiple_files # 同时读多个文件
  paths: [路径数组]

read_media_file     # 读取图片/音频
  path: 绝对路径
```

### 写入/编辑文件

```
write_file          # 创建或完全覆盖
  path: 绝对路径
  content: 内容

edit_file           # 行级编辑（小范围修改推荐）
  path: 绝对路径
  edits: [{oldText, newText}]
```

### 目录操作

```
list_directory            # 列出目录内容
list_directory_with_sizes # 含文件大小
directory_tree            # 递归树形结构
create_directory          # 创建目录
move_file                 # 移动/重命名
search_files              # 搜索文件名
get_file_info             # 获取文件元信息
list_allowed_directories  # 查看允许访问的目录
```

---

## 三、命令执行

```
run_command         # 执行终端命令
  command: 命令字符串
```

### 命令组合方式

```bash
# 管道组合
cat file.txt | grep pattern | wc -l

# 顺序执行
cd project && npm install && npm run build

# 条件执行
test -f config.json && cat config.json || echo "不存在"
```

### 长时间任务处理

默认超时 30 秒。对于耗时任务，使用后台执行：

```bash
# 后台运行
nohup long_command > /private/tmp/output.log 2>&1 &
echo $!  # 输出 PID

# 检查状态
ps -p <PID> && echo "运行中" || echo "已结束"
tail -50 /private/tmp/output.log
```

---

## 四、代码分析工具 (tree-sitter)

> 使用前必须先注册项目：`register_project_tool`

### 项目管理

```
register_project_tool  # 注册项目
  path: 项目绝对路径
  name: 项目名称

list_projects_tool     # 列出已注册项目
remove_project_tool    # 移除项目
```

### 代码分析

```
get_ast             # 获取语法树
get_symbols         # 提取函数、类、变量
find_text           # 搜索文本（带上下文）
find_usage          # 查找符号引用
analyze_project     # 分析项目结构
analyze_complexity  # 分析代码复杂度
```

### 路径注意事项

| 工具来源 | 参数 | 路径类型 |
|----------|------|----------|
| filesystem | `path` | 绝对路径 |
| tree-sitter | `path` | 相对路径（相对项目根目录） |

---

## 五、浏览器自动化 (chrome-devtools)

### 页面管理

```
new_page       # 新建页面
list_pages     # 列出所有页面
select_page    # 选择页面
close_page     # 关闭页面
navigate_page  # 导航到 URL
```

### 交互操作

```
click          # 点击元素
fill           # 填写输入框
fill_form      # 批量填写表单
press_key      # 按键
upload_file    # 上传文件
wait_for       # 等待文本出现
```

### 截图与调试

```
take_screenshot       # 截图
take_snapshot         # 获取页面文本快照
evaluate_script       # 执行 JS
list_network_requests # 网络请求列表
```

---

## 六、权限与安全

### 允许访问的目录

- `/Users/yay/workspace`
- `/private/tmp`

### 屏蔽的危险命令

- `rm -rf /`, `rm -rf ~`
- `sudo rm`, `sudo su`
- `chmod 777`
- `shutdown`, `reboot`
- `curl | sh`, `wget | bash`

### 安全操作规范

```bash
# 删除前先列出目标
ls -la target_dir/
rm -r target_dir/

# 覆盖前检查
test -f file.txt && echo "将被覆盖"
```

---

## 七、错误处理

| 错误类型 | 处理方式 |
|----------|----------|
| 工具未找到 | 检查拼写，如 `readfile` → `read_file` |
| 参数错误 | 检查格式，修正后重试 |
| 路径不存在 | 先用 `list_directory` 确认 |
| 权限拒绝 | 检查是否在允许目录内 |
| 超时 | 拆分任务或后台执行 |

重试规则：同一操作最多重试 2 次，重试前分析失败原因。

---

## 八、Skills 系统

### 目录结构

```
skills/
├── skills.json          # 技能索引
└── my-skill/
    ├── SKILL.md         # 主文档（AI 读取）
    └── references/      # 详细参考文档
```

### skills.json 格式

```json
{
  "version": "1.0.0",
  "skills": [
    {
      "name": "my-skill",
      "description": "技能描述",
      "path": "./my-skill",
      "skillFile": "SKILL.md",
      "tools": ["tool1", "tool2"]
    }
  ]
}
```

### SKILL.md 模板

```markdown
# 技能名称

简短描述。

## 前置条件

- 需要安装的软件

## 可用命令

### command-name

**功能**: 做什么

**示例**:
```bash
command-name --flag value
```

## 注意事项

- 限制和约束
```

---

## 九、工具选择决策树

```
需要做什么？
│
├─ 读写文件
│   ├─ 单个文件 → read_file / write_file
│   ├─ 多个文件 → read_multiple_files
│   └─ 小范围修改 → edit_file
│
├─ 搜索内容
│   ├─ 代码项目 → find_text (需先注册项目)
│   ├─ 快速全文 → run_command + rg
│   └─ 找文件名 → search_files
│
├─ 分析代码
│   ├─ 语法树 → get_ast
│   ├─ 函数/类 → get_symbols
│   └─ 引用 → find_usage
│
├─ 执行命令 → run_command
│
└─ 浏览器操作
    ├─ 截图 → take_screenshot
    └─ 填表 → fill / fill_form
```

---

## 十、MCP 协议简介

MCP (Model Context Protocol) 提供三种能力：

| 特性 | 说明 | 示例 |
|------|------|------|
| Tools | AI 可调用的函数 | 搜索、发送消息 |
| Resources | 只读数据源 | 读取文档 |
| Prompts | 预构建指令模板 | 规划旅行 |

详见 [MCP 官方文档](https://modelcontextprotocol.io/docs)。
