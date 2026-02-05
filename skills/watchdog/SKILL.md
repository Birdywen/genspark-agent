---
name: watchdog
description: 守护进程控制，用于重启 genspark-agent 主服务器
---

# Watchdog Skill

独立的守护服务，用于监控和重启主服务器。

## 触发重启的方式

### 方式一：HTTP 请求（推荐）
```bash
curl http://localhost:8766/restart
```

### 方式二：文件触发
```bash
touch /tmp/genspark-restart-trigger
```

Watchdog 每秒检查这个文件，发现后自动触发重启并删除文件。

## 状态检查

```bash
# 查看状态
curl http://localhost:8766/status

# 健康检查
curl http://localhost:8766/health
```

## 启动服务

```bash
cd /Users/yay/workspace/genspark-agent/server-v2
./start-all.sh
```

这会同时启动：
- Watchdog (端口 8766)
- 主服务器 (端口 8765)

## 停止服务

```bash
./stop-all.sh
```

## 日志位置

- Watchdog: `logs/watchdog.log`
- 主服务器: `logs/main.log`

## AI 使用说明

当需要重启主服务器时（例如更新了 config.json），执行：

```bash
curl -s http://localhost:8766/restart
```

**注意**：有 5 秒冷却时间，防止频繁重启。
