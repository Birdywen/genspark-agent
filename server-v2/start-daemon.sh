#!/bin/bash
# 启动守护服务器

echo "🛡️  启动守护服务器..."
cd /Users/yay/workspace/genspark-agent/server-v2

# 检查是否已运行
if lsof -i :8766 >/dev/null 2>&1; then
  echo "⚠️  守护服务器已在运行"
  lsof -i :8766
  exit 1
fi

# 启动
nohup node daemon-server.js > /tmp/agent-daemon-output.log 2>&1 &
DAEMON_PID=$!

echo "✅ 守护服务器已启动 (PID: $DAEMON_PID)"
echo "📋 日志文件: /tmp/agent-daemon.log"
echo "📋 输出文件: /tmp/agent-daemon-output.log"
echo ""
echo "测试命令:"
echo "  node daemon-client.js status"
echo "  node daemon-client.js restart"
