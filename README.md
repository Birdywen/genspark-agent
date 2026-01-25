# Genspark Agent Bridge

将 Genspark.ai 聊天窗口转变为 AI Agent 运行时，支持本地工具调用和自主任务执行。

## 架构

```
Genspark 网页 <---> Chrome Extension <---> WebSocket <---> Local Server <---> 工具执行
```

## 项目结构

```
genspark-agent/
├── extension/          # Chrome 扩展
│   ├── manifest.json   # 扩展配置
│   ├── background.js   # WebSocket 客户端
│   └── content.js      # 页面交互、UI 控制面板
├── server-v2/          # 本地服务器
│   ├── index.js        # 主入口（WebSocket 服务）
│   ├── safety.js       # 安全检查（路径、命令白名单）
│   ├── skills.js       # Skills 加载器
│   ├── logger.js       # 日志模块
│   └── config.json     # 配置文件
├── mcp-servers/        # MCP 服务（可选）
│   ├── mcp-server.js   # MCP 协议服务
│   └── webhook-server.js
├── skills/             # 技能模块
│   ├── skills.json     # 技能索引
│   └── */SKILL.md      # 各技能文档
├── docs/               # 文档
└── logs/               # 运行日志
```

## 快速开始

### 1. 启动本地服务器

```bash
cd /Users/yay/workspace/genspark-agent/server-v2
npm install
npm start
```

服务器启动后会显示「WebSocket 服务已启动」。

### 2. 安装 Chrome 扩展

1. 打开 Chrome，访问 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择目录：`/Users/yay/workspace/genspark-agent/extension`

### 3. 使用

1. 打开 Genspark.ai 对话页面
2. 页面右下角出现「Agent Bridge」控制面板
3. 面板显示「已连接」即可开始使用

## 工具调用格式

AI 通过以下格式调用工具：

```
@TOOL:{"tool":"工具名","params":{"参数":"值"}}
```

### 常用工具

| 工具 | 用途 | 参数 |
|------|------|------|
| `read_file` | 读取文件 | `path`: 文件路径 |
| `write_file` | 写入文件 | `path`, `content` |
| `edit_file` | 编辑文件 | `path`, `edits` |
| `list_directory` | 列出目录 | `path`: 目录路径 |
| `run_command` | 执行命令 | `command`: 命令字符串 |

完整工具列表见 [docs/GUIDE.md](docs/GUIDE.md)。

## 安全机制

- **路径限制**：只能访问 `/Users/yay/workspace` 和 `/private/tmp`
- **命令过滤**：屏蔽危险命令（`sudo`, `rm -rf /` 等）
- **操作日志**：所有操作记录在 `logs/` 目录

## 配置

编辑 `server-v2/config.json` 可修改：

- `allowedPaths`: 允许访问的目录
- `blockedCommands`: 屏蔽的危险命令
- `logLevel`: 日志级别

## 故障排除

| 问题 | 解决方法 |
|------|----------|
| 扩展显示「断开」 | 确保服务器已启动，检查终端错误 |
| 工具调用无响应 | 刷新页面，检查控制面板日志 |
| 权限被拒绝 | 检查路径是否在 allowedPaths 中 |

## 许可

MIT License
