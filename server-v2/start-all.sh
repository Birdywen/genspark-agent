#!/bin/bash
# 启动 Watchdog 和主服务器

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# 加载敏感环境变量（如果存在）
if [ -f ~/.agent_secrets ]; then
  echo "Loading secrets from ~/.agent_secrets"
  set -a
  source ~/.agent_secrets
  set +a
fi

echo "=== Genspark Agent Startup ==="
echo "Directory: $SCRIPT_DIR"

# 杀掉现有进程
echo "Stopping existing processes..."
pkill -f "node.*watchdog.js" 2>/dev/null
pkill -f "node.*index.js" 2>/dev/null
sleep 1

# 启动 Watchdog（后台）
echo "Starting watchdog on port 8766..."
nohup node watchdog.js > logs/watchdog.log 2>&1 &
WATCHDOG_PID=$!
echo "Watchdog PID: $WATCHDOG_PID"

# 等待 watchdog 启动
sleep 2

# 启动主服务器
echo "Starting main server on port 8765..."
nohup node index.js > logs/main.log 2>&1 &
MAIN_PID=$!
echo "Main server PID: $MAIN_PID"

# 保存 PID
echo $WATCHDOG_PID > watchdog_pid.txt
echo $MAIN_PID > main_pid.txt

echo ""
echo "=== Started ==="
echo "Watchdog: http://localhost:8766 (PID: $WATCHDOG_PID)"
echo "Main:     http://localhost:8765 (PID: $MAIN_PID)"
echo ""
echo "To restart main server:"
echo "  curl http://localhost:8766/restart"
echo "  OR touch /tmp/genspark-restart-trigger"
echo ""
echo "Logs:"
echo "  tail -f logs/watchdog.log"
echo "  tail -f logs/main.log"
