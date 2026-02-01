#!/bin/bash
# 快速重启脚本（强化版）

set -e

echo "🔄 开始重启服务器..."

# 1. 强制杀死所有相关进程
echo "📍 查找所有相关进程..."

# 方法1: 通过端口
PORT_PIDS=$(lsof -ti :8765 2>/dev/null || true)
if [ -n "$PORT_PIDS" ]; then
  echo "🔪 杀死端口占用进程: $PORT_PIDS"
  echo "$PORT_PIDS" | xargs kill -9 2>/dev/null || true
fi

# 方法2: 通过进程名
PROCESS_PIDS=$(pgrep -f 'genspark-agent/server-v2.*node.*index.js' 2>/dev/null || true)
if [ -n "$PROCESS_PIDS" ]; then
  echo "🔪 杀死匹配进程: $PROCESS_PIDS"
  echo "$PROCESS_PIDS" | xargs kill -9 2>/dev/null || true
fi

echo "⏳ 等待进程完全终止..."
sleep 2

# 2. 彻底确认端口释放
echo "🔍 检查端口状态..."
for i in {1..15}; do
  PORT_CHECK=$(lsof -ti :8765 2>/dev/null || true)
  if [ -z "$PORT_CHECK" ]; then
    echo "✅ 端口 8765 已完全释放"
    break
  fi
  if [ $i -eq 15 ]; then
    echo "❌ 端口仍被占用:"
    lsof -i :8765 2>/dev/null || true
    echo ""
    echo "请手动处理: lsof -ti :8765 | xargs kill -9"
    exit 1
  fi
  echo "  等待... ($i/15)"
  sleep 0.5
done

# 3. 启动新服务器
echo "🚀 启动新服务器..."
cd /Users/yay/workspace/genspark-agent/server-v2

# 使用 setsid 完全脱离当前会话
setsid nohup node index.js > /tmp/agent-server.log 2>&1 < /dev/null &
NEW_PID=$!

echo "✅ 新服务器已启动 (PID: $NEW_PID)"
echo "📋 查看日志: tail -f /tmp/agent-server.log"
echo "🔍 检查状态: lsof -i :8765"
echo "🎉 重启完成！"

exit 0
