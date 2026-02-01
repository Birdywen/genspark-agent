#!/bin/bash
# 重启触发器 - 通过文件标记触发重启

TRIGGER_FILE="/tmp/agent-restart-trigger"
PID_FILE="/tmp/agent-server.pid"

echo "🔄 启动重启监控器..."
echo "创建触发文件来重启: touch $TRIGGER_FILE"

while true; do
  # 检查触发文件
  if [ -f "$TRIGGER_FILE" ]; then
    echo "🔔 检测到重启触发！"
    rm -f "$TRIGGER_FILE"
    
    # 执行重启
    echo "📍 杀死旧进程..."
    if [ -f "$PID_FILE" ]; then
      OLD_PID=$(cat "$PID_FILE")
      kill -9 "$OLD_PID" 2>/dev/null || true
    fi
    lsof -ti :8765 | xargs kill -9 2>/dev/null || true
    
    # 等待端口释放
    echo "⏳ 等待端口释放..."
    for i in {1..10}; do
      if ! lsof -i :8765 >/dev/null 2>&1; then
        break
      fi
      sleep 0.5
    done
    
    # 启动新服务器
    echo "🚀 启动新服务器..."
    cd /Users/yay/workspace/genspark-agent/server-v2
    nohup node index.js > /tmp/agent-server.log 2>&1 &
    echo $! > "$PID_FILE"
    
    echo "✅ 重启完成！新 PID: $(cat $PID_FILE)"
    echo "📋 日志: tail -f /tmp/agent-server.log"
  fi
  
  sleep 1
done
