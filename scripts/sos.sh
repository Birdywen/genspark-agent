#!/bin/bash
# === Genspark Agent SOS 急救工具箱 ===
# 用法: source ~/.zshrc 后直接用 sos 命令
# 或者: bash ~/workspace/genspark-agent/scripts/sos.sh [命令]

CMD="${1:-help}"
AGENT_DIR="$HOME/workspace/genspark-agent"
SERVER_PORT=8766

case "$CMD" in

  # === 状态检查 ===
  status|s)
    echo "🔍 Agent 状态检查..."
    echo "--- 进程 ---"
    ps aux | grep -v grep | grep -E "node.*(index|watchdog)\.js" | grep -v Genspark || echo "❌ Agent 进程未运行"
    echo "--- 端口 $SERVER_PORT ---"
    lsof -i :$SERVER_PORT 2>/dev/null || echo "❌ 端口 $SERVER_PORT 无监听"
    echo "--- HTTP 状态 ---"
    curl -s --max-time 3 http://localhost:$SERVER_PORT/status || echo "❌ HTTP 无响应"
    ;;

  # === 重启 Agent ===
  restart|r)
    echo "🔄 重启 Agent..."
    curl -s --max-time 5 http://localhost:$SERVER_PORT/restart && echo "✅ 重启信号已发送" || {
      echo "⚠️ HTTP 重启失败，尝试文件触发..."
      touch /tmp/genspark-restart-trigger
      echo "✅ 已创建触发文件，等待 watchdog..."
    }
    ;;

  # === 强制重启（杀进程 + 重新启动）===
  force-restart|fr)
    echo "💀 强制重启 Agent..."
    pkill -f "node.*server-v2/index" 2>/dev/null
    sleep 1
    echo "启动 Agent..."
    cd "$AGENT_DIR/server-v2" && nohup node index.js > /dev/null 2>&1 &
    sleep 2
    curl -s --max-time 3 http://localhost:$SERVER_PORT/status && echo "✅ Agent 已启动" || echo "❌ 启动失败"
    ;;

  # === 查看日志 ===
  log|l)
    LOGFILE="${2:-main}"
    tail -50 "$AGENT_DIR/server-v2/logs/${LOGFILE}.log"
    ;;

  # === 实时日志 ===
  logf|lf)
    LOGFILE="${2:-main}"
    tail -f "$AGENT_DIR/server-v2/logs/${LOGFILE}.log"
    ;;

  # === 端口占用排查 ===
  port|p)
    PORT="${2:-$SERVER_PORT}"
    echo "🔍 端口 $PORT 占用:"
    lsof -i :$PORT
    ;;

  # === 杀端口 ===
  killport|kp)
    PORT="${2:-$SERVER_PORT}"
    echo "💀 杀掉端口 $PORT 上的进程..."
    lsof -ti :$PORT | xargs kill -9 2>/dev/null && echo "✅ 已杀掉" || echo "无进程占用"
    ;;

  # === Git 回退 ===
  rollback|rb)
    STEPS="${2:-1}"
    cd "$AGENT_DIR"
    echo "📦 当前 HEAD:"
    git log --oneline -1
    echo "⏪ 回退 $STEPS 个 commit..."
    git stash
    git reset --hard HEAD~$STEPS
    echo "📦 回退后 HEAD:"
    git log --oneline -1
    ;;

  # === Git 查看最近 commits ===
  history|h)
    N="${2:-10}"
    cd "$AGENT_DIR" && git log --oneline -$N
    ;;

  # === Git 回退到指定 commit ===
  reset)
    HASH="$2"
    if [ -z "$HASH" ]; then
      echo "用法: sos reset <commit-hash>"
      echo "最近 commits:"
      cd "$AGENT_DIR" && git log --oneline -10
      exit 1
    fi
    cd "$AGENT_DIR"
    git stash
    git reset --hard "$HASH"
    echo "✅ 已回退到 $HASH"
    git log --oneline -1
    ;;

  # === 备份当前状态 ===
  backup|bk)
    TAG="backup-$(date +%Y%m%d-%H%M%S)"
    cd "$AGENT_DIR"
    git add -A && git stash
    git tag "$TAG"
    echo "✅ 已创建备份标签: $TAG"
    git stash pop 2>/dev/null
    ;;

  # === 磁盘空间 ===
  disk|d)
    echo "💾 磁盘空间:"
    df -h / | tail -1
    echo "--- workspace 大小 ---"
    du -sh "$HOME/workspace" 2>/dev/null
    du -sh "$AGENT_DIR" 2>/dev/null
    ;;

  # === 清理临时文件 ===
  clean|c)
    echo "🧹 清理临时文件..."
    rm -rf /private/tmp/ppt_images /private/tmp/*.py /private/tmp/*.sh 2>/dev/null
    echo "清理 agent 日志 (保留最后 1000 行)..."
    for f in "$AGENT_DIR/server-v2/logs/"*.log; do
      [ -f "$f" ] && tail -1000 "$f" > "${f}.tmp" && mv "${f}.tmp" "$f"
    done
    echo "✅ 清理完成"
    ;;

  # === 检查所有 ===
  check|ck)
    echo "🏥 全面体检..."
    echo ""
    echo "=== 进程 ==="
    ps aux | grep -v grep | grep "node\|Genspark" | head -5
    echo ""
    echo "=== 端口 ==="
    lsof -i :8766 2>/dev/null | head -3
    echo ""
    echo "=== HTTP ==="
    curl -s --max-time 3 http://localhost:8766/status 2>/dev/null || echo "❌ 无响应"
    echo ""
    echo "=== Git ==="
    cd "$AGENT_DIR" && git status -s | head -5
    echo "HEAD: $(git log --oneline -1)"
    echo ""
    echo "=== 磁盘 ==="
    df -h / | tail -1
    echo ""
    echo "=== Node ==="
    node -v
    ;;

  # === Team Chat Bridge ===
  bridge|br)
    echo "🌉 启动 Team Chat Bridge..."
    if [ -f /tmp/team-chat-bridge.pid ]; then
      PID=$(cat /tmp/team-chat-bridge.pid)
      if kill -0 "$PID" 2>/dev/null; then
        echo "⚠️ Bridge 已在运行 (PID $PID)"
        exit 0
      fi
    fi
    nohup node "$AGENT_DIR/scripts/team-chat-bridge.js" > /dev/null 2>&1 &
    sleep 1
    if [ -f /tmp/team-chat-bridge.pid ]; then
      echo "✅ Bridge 已启动 (PID $(cat /tmp/team-chat-bridge.pid))"
    else
      echo "❌ 启动失败"
    fi
    ;;

  bridge-stop|brs)
    echo "🛑 停止 Team Chat Bridge..."
    node "$AGENT_DIR/scripts/team-chat-bridge.js" --stop
    ;;

  bridge-status|brs?)
    if [ -f /tmp/team-chat-bridge.pid ]; then
      PID=$(cat /tmp/team-chat-bridge.pid)
      if kill -0 "$PID" 2>/dev/null; then
        echo "🟢 Bridge 运行中 (PID $PID)"
      else
        echo "🔴 Bridge 已停止 (stale PID file)"
        rm -f /tmp/team-chat-bridge.pid
      fi
    else
      echo "🔴 Bridge 未运行"
    fi
    ;;

  bridge-switch|bsw)
    NEW_ID="${2}"
    if [ -z "$NEW_ID" ]; then
      echo "用法: sos bridge-switch <agent-id>"
      CURRENT=$(grep "GROUP_ID:" ~/workspace/genspark-agent/scripts/team-chat-bridge.js | head -1)
      echo "当前: $CURRENT"
    else
      sed -i "" "s|GROUP_ID: 'project_[^']*'|GROUP_ID: 'project_${NEW_ID}'|" ~/workspace/genspark-agent/scripts/team-chat-bridge.js
      echo "✅ GROUP_ID 已切换到 project_${NEW_ID}"
      echo "重启生效: sos bridge-stop && sos bridge"
    fi
    ;;

  say|s)
    MSG="${@:2}"
    if [ -z "$MSG" ]; then
      echo "用法: sos say <消息>"
    else
      curl -s -X POST http://localhost:8769/reply -H "Content-Type: application/json" -d "{\"text\":\"$MSG\"}" > /dev/null && echo "📱 已发送" || echo "❌ 发送失败"
    fi
    ;;

  img)
    URL="${2}"
    NAME="${3:-image}"
    if [ -z "$URL" ]; then
      echo "用法: sos img <图片URL> [文件名]"
    else
      curl -s -X POST http://localhost:8769/image -H "Content-Type: application/json" -d "{\"url\":\"$URL\",\"name\":\"$NAME\"}" > /dev/null && echo "🖼️ 图片已发送" || echo "❌ 发送失败"
    fi
    ;;

  # === 帮助 ===
  help|*)
    cat << 'HELP'
🆘 Genspark Agent SOS 急救工具箱

用法: sos <命令> [参数]

状态:
  sos status (s)        - 检查 Agent 状态
  sos check (ck)        - 全面体检
  sos port [端口] (p)   - 查端口占用
  sos disk (d)          - 查磁盘空间

重启:
  sos restart (r)       - 正常重启
  sos force-restart (fr)- 强制杀进程重启
  sos killport [端口]   - 杀端口进程

日志:
  sos log [名称] (l)    - 查日志 (main/agent/watchdog)
  sos logf [名称] (lf)  - 实时跟踪日志

Git:
  sos history [N] (h)   - 最近 N 个 commit
  sos rollback [N] (rb) - 回退 N 个 commit
  sos reset <hash>      - 回退到指定 commit
  sos backup (bk)       - 创建备份标签

维护:
  sos clean (c)         - 清理临时文件

远程:
  sos bridge (br)       - 启动 Team Chat Bridge
  sos bridge-stop (brs) - 停止 Bridge
  sos bridge-status     - 查看 Bridge 状态
  sos bridge-switch <id>- 切换 Team Chat (bsw)
  sos say "消息" (s)    - 发文字到手机
  sos img <url>         - 发图片到手机
HELP
    ;;
esac