#!/bin/bash

# 安全重启脚本

echo "🔄 开始安全重启服务器..."

# 1. 查找并杀死旧进程
echo "📍 查找旧进程..."
OLD_PID=$(lsof -ti :8765)
if [ -n "$OLD_PID" ]; then
  echo "🔪 杀死旧进程: $OLD_PID"
  kill -9 $OLD_PID
  echo "⏳ 等待端口释放..."
  sleep 2
else
  echo "✅ 没有旧进程"
fi

# 2. 确认端口已释放
for i in {1..5}; do
  PORT_CHECK=$(lsof -ti :8765)
  if [ -z "$PORT_CHECK" ]; then
    echo "✅ 端口 8765 已释放"
    break
  else
    echo "⏳ 等待端口释放... ($i/5)"
    sleep 1
  fi
done

# 3. 启动新服务器
echo "🚀 启动新服务器..."
cd /Users/yay/workspace/genspark-agent/server-v2
nohup node index.js > /tmp/agent-server.log 2>&1 &
NEW_PID=$!

echo "⏳ 等待服务器启动..."
sleep 3

# 4. 验证启动
if ps -p $NEW_PID > /dev/null; then
  echo "✅ 服务器启动成功 (PID: $NEW_PID)"
  echo "📋 查看日志: tail -f /tmp/agent-server.log"
else
  echo "❌ 服务器启动失败"
  echo "📋 查看错误: cat /tmp/agent-server.log"
  exit 1
fi

echo "🎉 重启完成！"
