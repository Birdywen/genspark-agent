# Genspark Agent Bridge

将 Genspark.ai 聊天窗口转变为 AI Agent 运行时，实现类似 Claude Code 的自主规划和执行能力。

## 架构

Genspark 网页 <---> Chrome Extension <---> WebSocket <---> Local Server <---> 工具执行

## 安装步骤

### 1. 启动本地服务器

cd /Users/yay/workspace/genspark-agent/server
npm start

### 2. 安装 Chrome 扩展

1. 打开 Chrome，访问 chrome://extensions/
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择目录：/Users/yay/workspace/genspark-agent/extension
5. 扩展安装成功后会显示「Genspark Agent Bridge」

### 3. 使用方法

1. 确保本地服务器已启动（终端显示「等待 Chrome 扩展连接...」）
2. 打开 Genspark.ai 对话页面
3. 页面右下角会出现「Agent Bridge」控制面板
4. 面板显示「已连接」表示准备就绪

### 4. 与 Claude 对话启动任务

在 Genspark 聊天窗口告诉 Claude：

---
我已安装 Agent Bridge 扩展，你可以通过以下格式调用工具：

[[TOOL:工具名:{"参数":"值"}]]

可用工具：
1. read_file - 读取文件，参数：{"path": "文件路径"}
2. write_file - 写入文件，参数：{"path": "文件路径", "content": "内容"}
3. list_directory - 列出目录，参数：{"path": "目录路径"}
4. create_directory - 创建目录，参数：{"path": "目录路径"}
5. execute_shell - 执行命令，参数：{"command": "命令"}
6. http_get - GET请求，参数：{"url": "地址"}
7. http_post - POST请求，参数：{"url": "地址", "body": {}}

任务完成时使用：[[TASK_COMPLETE:总结]]
需要询问我时使用：[[ASK_USER:问题]]

现在请帮我：[描述你的任务]
---

## 安全机制

1. 路径限制：只能访问 /Users/yay/workspace 目录
2. 命令白名单：仅允许 ls, cat, python, node 等安全命令
3. 危险操作确认：写入、删除文件需要手动确认
4. 完整日志：所有操作记录在 logs/agent-operations.log

## 文件结构

genspark-agent/
├── extension/          # Chrome 扩展
│   ├── manifest.json
│   ├── background.js   # WebSocket 客户端
│   ├── content.js      # 页面交互
│   └── styles.css      # UI 样式
├── server/             # 本地服务器
│   ├── index.js        # 主入口
│   ├── tools.js        # 工具实现
│   ├── safety.js       # 安全检查
│   ├── logger.js       # 日志模块
│   └── config.json     # 配置文件
├── logs/               # 操作日志
└── README.md

## 配置修改

编辑 server/config.json 可以：
- 修改允许访问的路径
- 添加或移除白名单命令
- 开启或关闭确认弹窗
- 调整日志设置

## 故障排除

问题：扩展显示「断开」
解决：确保服务器已启动，检查终端是否有错误

问题：工具调用没有响应
解决：刷新 Genspark 页面，检查控制面板日志

问题：权限被拒绝
解决：检查路径是否在 allowedPaths 中，命令是否在白名单中

## 停止服务

在终端按 Ctrl+C 停止服务器
