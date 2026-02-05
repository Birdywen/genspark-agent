#!/bin/bash
# 停止所有服务

echo "Stopping all genspark-agent processes..."

pkill -f "node.*watchdog.js" 2>/dev/null && echo "Watchdog stopped" || echo "Watchdog not running"
pkill -f "node.*index.js" 2>/dev/null && echo "Main server stopped" || echo "Main server not running"

rm -f watchdog_pid.txt main_pid.txt 2>/dev/null

echo "Done."
