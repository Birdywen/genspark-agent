#!/bin/bash
# 触发重启（不等待）
touch /tmp/agent-restart-trigger
echo "✅ 重启已触发"
echo "⏳ 服务器将在 1-2 秒内重启"
echo "🔄 请等待 Extension 自动重连..."
exit 0
