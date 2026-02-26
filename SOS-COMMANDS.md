# SOS 命令完整手册

> 一个终端，控制四台机器 + AI

## 📊 状态 & 诊断

| 命令 | 别名 | 说明 |
|------|------|------|
| `sos status` | `sos s` | Agent 进程 + 端口 + HTTP 健康检查 |
| `sos check` | `sos ck` | 全面系统检查 (进程/端口/HTTP/git/磁盘/node) |
| `sos port [N]` | `sos p` | 检查端口占用 (默认 8766) |
| `sos disk` | `sos d` | 磁盘空间概览 |
| `sos info` | `sos i` | 一览全部基础设施状态 |

## 🔄 服务器控制

| 命令 | 别名 | 说明 |
|------|------|------|
| `sos restart` | `sos r` | 优雅重启 Agent (HTTP) |
| `sos force-restart` | `sos fr` | 强制杀进程 + 重启 |
| `sos killport [N]` | `sos kp` | 杀掉占用指定端口的进程 |

## 📋 日志

| 命令 | 别名 | 说明 |
|------|------|------|
| `sos log [name]` | `sos l` | 最后 50 行日志 (main/agent/watchdog/bridge) |
| `sos logf [name]` | `sos lf` | 实时跟踪日志 (tail -f) |

## 🔀 Git 操作

| 命令 | 别名 | 说明 |
|------|------|------|
| `sos history [N]` | `sos h` | 最近 N 条 commit |
| `sos rollback [N]` | `sos rb` | 回滚 N 个 commit (自动 stash) |
| `sos reset <hash>` | — | 重置到指定 commit |
| `sos backup` | `sos bk` | 创建带时间戳的 git tag |

## 🧹 维护

| 命令 | 别名 | 说明 |
|------|------|------|
| `sos clean` | `sos c` | 清理临时文件 + 裁剪日志 |

## 📱 手机 / Team Chat Bridge

| 命令 | 别名 | 说明 |
|------|------|------|
| `sos bridge` | `sos br` | 启动 Team Chat Bridge |
| `sos bridge-stop` | `sos brs` | 停止 Bridge |
| `sos bridge-switch <id>` | `sos bsw` | 切换 Team Chat 群组 |
| `sos say "消息"` | — | 发送文字到手机 |
| `sos img <url>` | — | 发送图片到手机 |

## 📦 Sandbox (4核 8GB)

| 命令 | 别名 | 说明 | Credit |
|------|------|------|--------|
| `sos sandbox-exec "命令"` | `sos se` | 在 Sandbox 执行 Bash | 0 |
| `sos sandbox-push 文件` | `sos sp` | 推送文件到 Sandbox | 0 |
| `sos sandbox-list [路径]` | `sos sl` | 列出 Sandbox 目录 | 0 |
| `sos sandbox-read 路径` | `sos sr` | 读取 Sandbox 文件 | 0 |
| `sos sandbox-status` | `sos ss` | Sandbox 服务状态 | 0 |
| `sos sandbox-url` | `sos su` | Sandbox 预览 URL | 0 |

## 🦾 Oracle ARM 猛兽 (4核 24GB)

| 命令 | 别名 | 说明 |
|------|------|------|
| `sos oracle-exec "命令"` | `sos oe` | 在 ARM 服务器执行 Bash |
| `sos oracle-status` | `sos os` | ARM 服务器状态 |

## 🤖 AI 查询 (1min.ai)

| 命令 | 别名 | 说明 |
|------|------|------|
| `sos ask "问题"` | `sos a` | AI 问答 (默认 gpt-4.1-mini) |

切换模型: `ONEMIN_MODEL=claude-opus-4-20250514 sos ask "问题"`

可用模型: gpt-4.1, gpt-4o, gpt-4.1-mini, claude-opus-4-20250514, claude-sonnet-4-20250514, o3, o4-mini, mistral-large-latest, deepseek-chat

## ❓ 帮助

| 命令 | 说明 |
|------|------|
| `sos help` | 显示帮助信息 |

---

## 🗺️ 基础设施总览



Mac M2 (大脑) ├── sos ask → 1min.ai (10个AI模型, 31.5M credits) ├── sos se → Sandbox (4核 8GB, 零 credit) ├── sos oe → Oracle ARM (4核 24GB, 永久免费) ├── sos say → 手机 (ntfy 推送) └── Speakly → 语音控制以上所有


## 💡 常用场景

```bash
# 查看所有服务器状态
sos os && sos ss

# 在 ARM 上跑 Python
sos oe "python3 -c 'print(2**100)'"

# 在 Sandbox 装包
sos se "pip install numpy pandas"

# 问 AI
sos ask "用 Python 写一个快排"

# 用 Claude Opus 4 问
ONEMIN_MODEL=claude-opus-4-20250514 sos ask "分析这段代码的时间复杂度"

# 推文件到 Sandbox 并部署
sos sp ./index.html
sos se "cd /home/user/webapp && wrangler deploy"

# 发消息到手机
sos say "部署完成！"


