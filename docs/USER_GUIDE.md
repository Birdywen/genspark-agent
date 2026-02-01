# Genspark Agent 使用指南

> 版本: 1.0.35 | 更新日期: 2026-02-01

## 目录

1. [系统概述](#1-系统概述)
2. [快速开始](#2-快速开始)
3. [基础工具使用](#3-基础工具使用)
4. [批量执行引擎](#4-批量执行引擎)
5. [录制与回放](#5-录制与回放)
6. [健康检查与错误处理](#6-健康检查与错误处理)
7. [Skills 技能系统](#7-skills-技能系统)
8. [高级功能](#8-高级功能)
9. [常见问题](#9-常见问题)

---

## 1. 系统概述

### 1.1 什么是 Genspark Agent

Genspark Agent 是一个基于 MCP (Model Context Protocol) 的 AI Agent 运行时系统，它将 Genspark 聊天窗口转变为强大的自动化工具执行平台。

### 1.2 核心组件

```
┌─────────────────────────────────────────────────────────┐
│                    Genspark 网页                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │           Chrome Extension (content.js)          │   │
│  │   • Ω{} 格式解析      • UI 面板                  │   │
│  │   • 消息拦截          • 状态显示                 │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                            │ WebSocket
                            ▼
┌─────────────────────────────────────────────────────────┐
│                 Server-v2 (Node.js)                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│  │ MCP Hub  │ │ TaskEngine│ │ Recorder │ │HealthChk │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘  │
└─────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
   ┌─────────┐        ┌─────────┐        ┌─────────┐
   │filesystem│        │playwright│        │  shell  │
   │ 14 tools │        │ 26 tools │        │ 1 tool  │
   └─────────┘        └─────────┘        └─────────┘
```

### 1.3 工具统计

| 类别 | 工具数 | 说明 |
|------|--------|------|
| filesystem | 14 | 文件读写、目录操作 |
| playwright | 26 | 浏览器自动化 |
| tree-sitter | 26 | 代码分析 |
| shell | 1 | 命令执行 |
| **总计** | **67** | |

---

## 2. 快速开始

### 2.1 启动服务

```bash
# 进入服务目录
cd /Users/yay/workspace/genspark-agent/server-v2

# 启动服务
node index.js
```

启动成功后会显示：
```
[Main] Genspark Agent Server v2 启动中...
[Main] 已加载 X 个 MCP 服务器
[Main] 健康检查: X/Y 项正常
[Main] WebSocket 服务器已启动，端口: 8765
```

### 2.2 连接 Extension

1. 打开 Chrome，进入 `chrome://extensions/`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `/Users/yay/workspace/genspark-agent/extension` 目录
5. 访问 https://www.genspark.ai/ 开始使用

### 2.3 验证连接

在 Genspark 聊天中输入：
```
请列出当前目录的文件
```

AI 会调用工具并返回结果。

---

## 3. 基础工具使用

### 3.1 工具调用格式

所有工具调用使用 Ω{} 格式：

```
Ω{"tool":"工具名","params":{"参数名":"参数值"}}
```

### 3.2 文件系统操作

#### 读取文件
```
Ω{"tool":"read_file","params":{"path":"/Users/yay/workspace/example.txt"}}
```

#### 写入文件
```
Ω{"tool":"write_file","params":{"path":"/Users/yay/workspace/test.txt","content":"Hello World"}}
```

#### 列出目录
```
Ω{"tool":"list_directory","params":{"path":"/Users/yay/workspace"}}
```

#### 搜索文件
```
Ω{"tool":"search_files","params":{"path":"/Users/yay/workspace","pattern":"*.js"}}
```

#### 编辑文件（精确替换）
```
Ω{"tool":"edit_file","params":{"path":"/path/to/file.js","edits":[{"oldText":"原文本","newText":"新文本"}]}}
```

### 3.3 命令执行

#### 执行 Shell 命令
```
Ω{"tool":"run_command","params":{"command":"ls -la /Users/yay/workspace"}}
```

#### 常用命令示例
```bash
# 搜索文件内容
grep -rn 'keyword' /path/to/search

# 查看进程
ps aux | grep node

# Git 操作
cd /path/to/repo && git status
```

### 3.4 浏览器自动化 (Playwright)

#### 导航到页面
```
Ω{"tool":"browser_navigate","params":{"url":"https://example.com"}}
```

#### 获取页面快照
```
Ω{"tool":"browser_snapshot","params":{}}
```

#### 点击元素
```
Ω{"tool":"browser_click","params":{"element":"button[type=submit]","ref":"e123"}}
```

#### 输入文本
```
Ω{"tool":"browser_type","params":{"element":"input[name=search]","ref":"e456","text":"搜索内容"}}
```

#### 截图
```
Ω{"tool":"browser_screenshot","params":{}}
```

### 3.5 代码分析 (Tree-sitter)

#### 注册项目
```
Ω{"tool":"register_project_tool","params":{"path":"/Users/yay/workspace/my-project"}}
```

#### 获取符号列表
```
Ω{"tool":"get_symbols","params":{"path":"/path/to/file.js"}}
```

#### 查找引用
```
Ω{"tool":"find_usage","params":{"name":"functionName","path":"/path/to/project"}}
```

---

## 4. 批量执行引擎

### 4.1 概述

批量执行引擎允许在一次请求中执行多个工具调用，支持：
- 顺序执行
- 变量保存与引用
- 条件执行
- 错误处理策略

### 4.2 基本用法

通过 Extension 发送 `TOOL_BATCH` 消息：

```javascript
chrome.runtime.sendMessage({
  type: 'TOOL_BATCH',
  batchId: 'my-batch-001',
  steps: [
    { tool: 'read_file', params: { path: '/path/to/config.json' }, saveAs: 'config' },
    { tool: 'run_command', params: { command: 'echo "Config loaded"' } }
  ],
  options: {
    stopOnError: true,
    timeout: 120000
  }
});
```

### 4.3 变量保存与引用

使用 `saveAs` 保存步骤结果，使用 `{{变量名}}` 引用：

```javascript
steps: [
  { 
    tool: 'read_file', 
    params: { path: '/config.json' }, 
    saveAs: 'configData'  // 保存结果
  },
  { 
    tool: 'run_command', 
    params: { command: 'echo "{{configData}}"' }  // 引用变量
  }
]
```

### 4.4 条件执行

使用 `when` 控制步骤是否执行：

```javascript
steps: [
  { tool: 'read_file', params: { path: '/test.txt' }, saveAs: 'file1' },
  { 
    tool: 'write_file', 
    params: { path: '/backup.txt', content: '{{file1}}' },
    when: '{{file1.success}}'  // 仅当上一步成功时执行
  },
  {
    tool: 'run_command',
    params: { command: 'echo "Error occurred"' },
    when: { var: 'file1', success: false }  // 仅当失败时执行
  }
]
```

### 4.5 错误处理选项

```javascript
options: {
  stopOnError: true,    // 遇错停止（默认）
  stopOnError: false,   // 遇错继续
  timeout: 120000       // 总超时时间（毫秒）
}
```

### 4.6 任务恢复

如果任务中断，可以恢复执行：

```javascript
chrome.runtime.sendMessage({
  type: 'RESUME_TASK',
  taskId: 'my-batch-001'
});
```

### 4.7 查询任务状态

```javascript
chrome.runtime.sendMessage({
  type: 'TASK_STATUS',
  taskId: 'my-batch-001'
});
```

---

## 5. 录制与回放

### 5.1 概述

录制功能可以记录工具调用序列，并支持回放，适用于：
- 重复性任务自动化
- 调试与问题复现
- 创建可复用的工作流

### 5.2 开始录制

```javascript
chrome.runtime.sendMessage({
  type: 'START_RECORDING',
  recordingId: 'my-recording-001',
  name: '部署流程'  // 可选，录制名称
});
```

开始录制后，所有工具调用都会被自动记录。

### 5.3 停止录制

```javascript
chrome.runtime.sendMessage({
  type: 'STOP_RECORDING',
  recordingId: 'my-recording-001'
});
```

停止后会返回摘要信息：
```javascript
{
  success: true,
  recordingId: 'my-recording-001',
  summary: {
    totalSteps: 15,
    successSteps: 14,
    totalDuration: 45000
  }
}
```

### 5.4 列出所有录制

```javascript
chrome.runtime.sendMessage({
  type: 'LIST_RECORDINGS'
});
```

返回：
```javascript
{
  recordings: [
    { id: 'my-recording-001', name: '部署流程', totalSteps: 15, createdAt: '...' },
    { id: 'my-recording-002', name: '数据备份', totalSteps: 8, createdAt: '...' }
  ]
}
```

### 5.5 回放录制

```javascript
chrome.runtime.sendMessage({
  type: 'REPLAY_RECORDING',
  recordingId: 'my-recording-001'
});
```

回放过程中会实时返回每一步的执行结果。

### 5.6 录制文件存储

录制文件保存在：
```
/Users/yay/workspace/genspark-agent/server-v2/recordings/
```

文件格式为 JSON，可以手动编辑或导入。

---

## 6. 健康检查与错误处理

### 6.1 健康检查

系统启动时自动执行健康检查，检测项包括：
- MCP 连接状态
- Playwright 浏览器安装
- 工具列表完整性

手动触发健康检查：
```javascript
// 通过 WebSocket 发送
{ type: 'health_check' }
```

### 6.2 错误分类

系统会自动分类错误并提供修复建议：

| 错误类型 | 可恢复 | 修复建议 |
|----------|--------|----------|
| TIMEOUT | ✓ | 重试、拆分任务、后台执行 |
| NOT_FOUND | ✗ | 检查路径是否存在 |
| PERMISSION_DENIED | ✗ | 检查文件权限 |
| BROWSER_MISSING | ✓ | npx playwright install chromium |
| PAGE_CLOSED | ✓ | 重新打开页面 |
| ELEMENT_NOT_FOUND | ✓ | 刷新页面快照 |
| NETWORK_ERROR | ✓ | 检查网络连接 |
| TOOL_NOT_FOUND | ✓ | 刷新工具列表 |

### 6.3 自动重试

可恢复的错误会自动重试：
- 默认最多重试 2 次
- 重试间隔根据错误类型调整
- 某些错误会触发预处理动作（如刷新工具列表）

### 6.4 工具列表刷新

如果遇到工具不存在的错误，可以刷新工具列表：

1. 点击 UI 面板中的 🔧 按钮
2. 或发送消息：
```javascript
chrome.runtime.sendMessage({ type: 'RELOAD_TOOLS' });
```

---

## 7. Skills 技能系统

### 7.1 概述

Skills 是预定义的工具组合和工作流，提供更高级的功能封装。

### 7.2 已集成的 Skills

#### Megacmd - MEGA 云存储操作

```bash
# 登录
mega-login user@email.com password

# 列出文件
mega-ls /

# 上传文件
mega-put /local/file.txt /remote/path/

# 下载文件
mega-get /remote/file.txt /local/path/

# 生成分享链接
mega-export /path/to/file
```

#### Chart Visualization - 图表生成

支持 26 种图表类型：
- 折线图、柱状图、饼图
- 散点图、箱线图、热力图
- 桑基图、网络图、思维导图
- 等等...

使用示例：
```javascript
{
  tool: 'generate_line_chart',
  args: {
    data: [...],
    title: '销售趋势',
    xField: 'month',
    yField: 'sales'
  }
}
```

### 7.3 查看 Skill 文档

```bash
# 查看 megacmd 技能文档
cat /Users/yay/workspace/genspark-agent/skills/megacmd/SKILL.md

# 查看图表技能文档
cat /Users/yay/workspace/genspark-agent/skills/chart-visualization/SKILL.md
```

---

## 8. 高级功能

### 8.1 SSH 远程操作

#### Oracle Cloud
```
Ω{"tool":"ssh-oracle:exec","params":{"command":"hostname && uptime"}}
Ω{"tool":"ssh-oracle:sudo-exec","params":{"command":"systemctl status nginx"}}
```

#### cPanel
```
Ω{"tool":"ssh-cpanel:exec","params":{"command":"pwd && ls -la"}}
```

### 8.2 多项目记忆系统

```bash
# 切换项目
node /Users/yay/workspace/.agent_memory/memory_manager_v2.js switch <project-name>

# 记录里程碑
node /Users/yay/workspace/.agent_memory/memory_manager_v2.js milestone "完成功能 X"

# 查看项目摘要
node /Users/yay/workspace/.agent_memory/memory_manager_v2.js digest
```

### 8.3 长内容写入

对于超长内容，使用 heredoc 方式：

```bash
cat > /path/to/file.txt << 'EOF'
这里是很长的内容...
EOF
```

### 8.4 UI 面板功能

| 按钮 | 功能 |
|------|------|
| 📋 | 复制系统提示词 |
| 🗑️ | 清除日志 |
| 🔄 | 重连服务器 |
| 🔧 | 刷新工具列表 |
| 🌐 | 切换本地/云端服务器 |
| 👥 | 查看在线 Agent |
| ➖ | 最小化面板 |

---

## 9. 常见问题

### Q1: 工具调用没有响应

**排查步骤：**
1. 检查 server-v2 是否正在运行
2. 检查 Extension 是否已加载
3. 点击 🔄 重连服务器
4. 查看浏览器控制台日志

### Q2: 出现「工具未找到」错误

**解决方案：**
1. 点击 🔧 刷新工具列表
2. 检查 config.json 中的 MCP 服务器配置
3. 重启 server-v2

### Q3: Playwright 浏览器操作失败

**解决方案：**
```bash
# 安装 Chromium
npx playwright install chromium
```

### Q4: 文件操作被拒绝

**检查项：**
1. 路径是否在允许列表中（/Users/yay/workspace, /private/tmp）
2. 命令是否在黑名单中

### Q5: 如何查看命令历史

```javascript
// 发送消息获取历史
{ type: 'list_history', count: 20 }
```

或查看文件：
```
/Users/yay/workspace/genspark-agent/server-v2/command-history.json
```

### Q6: 如何重试失败的命令

```javascript
// 使用 historyId 重试
{ type: 'retry', historyId: 'xxx' }
```

---

## 附录

### A. 配置文件路径

| 文件 | 路径 |
|------|------|
| 服务器配置 | /Users/yay/workspace/genspark-agent/server-v2/config.json |
| 命令历史 | /Users/yay/workspace/genspark-agent/server-v2/command-history.json |
| 录制文件 | /Users/yay/workspace/genspark-agent/server-v2/recordings/ |
| 技能配置 | /Users/yay/workspace/genspark-agent/skills/skills.json |
| 项目记忆 | /Users/yay/workspace/.agent_memory/ |

### B. 安全限制

**允许访问的目录：**
- /Users/yay/workspace
- /Users/yay/Documents
- /Users/yay/Downloads
- /Users/yay/Desktop
- /tmp, /private/tmp

**禁止的危险命令：**
- 递归强制删除根目录或用户目录
- sudo 删除操作
- 全局权限修改
- 系统关机重启
- 管道执行远程脚本

### C. 相关文档

- [工具快速参考](./TOOLS_QUICK_REFERENCE.md)
- [高级指南](./ADVANCED_GUIDE.md)
- [开发计划](./DEVELOPMENT_PLAN.md)
- [经验教训](./LESSONS_LEARNED.md)

---

*文档版本: 1.0 | 最后更新: 2026-02-01*