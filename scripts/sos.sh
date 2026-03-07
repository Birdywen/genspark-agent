#!/bin/bash
# === Genspark Agent SOS 急救工具箱 ===
# 用法: source ~/.zshrc 后直接用 sos 命令
# Sandbox Config
SANDBOX_PROJECT_ID="a6e50804-320f-4f61-bcd6-93c57f8d6403"
SANDBOX_PREVIEW_URL="https://3000-isjad10r8glpogdbe5r7n-02b9cc79.sandbox.novita.ai"
SANDBOX_API="https://3000-isjad10r8glpogdbe5r7n-02b9cc79.sandbox.novita.ai/api"

# 1min.ai Config
ONEMIN_API_KEY="c81dc363907e8c1777e37fde4c6abd319135d71fa4a4a7c723c00ae6f4dc6da4"
ONEMIN_API="https://api.1min.ai/api/features"
ONEMIN_MODEL="${ONEMIN_MODEL:-gpt-4.1-mini}"
GENSPARK_COOKIE_FILE="$HOME/.genspark_cookie"

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
      curl -s -X POST http://localhost:8769/reply -H "Content-Type: application/json" -d "{\"text\":\"$MSG\"}" > /dev/null 2>&1 || echo "❌ 发送失败"
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
    help)
        echo ""
        echo -e "  \033[1;36m=== SOS 命令手册 ===\033[0m"
        echo ""
        echo -e "  \033[1;33m📊 状态 & 诊断\033[0m"
        echo "    status  (s)     Agent 健康检查"
        echo "    check   (ck)    全面系统检查"
        echo "    port    (p)     检查端口占用"
        echo "    disk    (d)     磁盘空间"
        echo "    info    (i)     基础设施总览"
        echo ""
        echo -e "  \033[1;33m🔄 服务器控制\033[0m"
        echo "    restart (r)     优雅重启"
        echo "    force-restart (fr)  强制重启"
        echo "    killport (kp)   杀端口进程"
        echo ""
        echo -e "  \033[1;33m📋 日志\033[0m"
        echo "    log     (l)     查看日志 (最后50行)"
        echo "    logf    (lf)    实时跟踪日志"
        echo ""
        echo -e "  \033[1;33m🔀 Git\033[0m"
        echo "    history (h)     最近 commit"
        echo "    rollback (rb)   回滚 commit"
        echo "    reset           重置到指定 commit"
        echo "    backup  (bk)    创建 git tag 备份"
        echo ""
        echo -e "  \033[1;33m🧹 维护\033[0m"
        echo "    clean   (c)     清理临时文件"
        echo ""
        echo -e "  \033[1;33m📱 手机 / Bridge\033[0m"
        echo "    bridge  (br)    启动 Bridge"
        echo "    bridge-stop (brs)  停止 Bridge"
        echo "    bridge-switch (bsw) 切换群组"
        echo "    say             发文字到手机"
        echo "    img             发图片到手机"
        echo ""
        echo -e "  \033[1;33m📦 Sandbox (4核 8GB, 0 credit)\033[0m"
        echo "    sandbox-exec (se)   执行 Bash"
        echo "    sandbox-push (sp)   推送文件"
        echo "    sandbox-list (sl)   列目录"
        echo "    sandbox-read (sr)   读文件"
        echo "    sandbox-status (ss) 服务状态"
        echo "    sandbox-url  (su)   预览 URL"
        echo ""
        echo -e "  \033[1;33m🦾 Oracle ARM (4核 24GB)\033[0m"
        echo "    oracle-exec (oe)    执行 Bash"
        echo "    oracle-status (os)  服务器状态"
        echo ""
        echo -e "  \033[1;33m🤖 AI (1min.ai, 31.5M credits)\033[0m"
        echo "    ask     (a)     AI 问答 (默认 gpt-4.1-mini)"
        echo "    ask2    (a2)    AI 问答 via 浏览器 (零credit, -c 连续对话)"
        echo "    delegate (td)   委派任务给 DeepSeek/Kimi 执行"
        echo "                    ONEMIN_MODEL=xxx sos ask 切换模型"
        echo ""
        echo -e "  \033[1;33m❓ 帮助\033[0m"
        echo "    help            显示此菜单"
        echo ""
    ;;
  sandbox-push|sp)
    # sos sandbox-push <local_file> [remote_path]
    local_file="$2"
    remote_path="${3:-/home/user/webapp/public/$(basename "$2")}"
    if [ ! -f "$local_file" ]; then
      echo "❌ File not found: $local_file"; exit 1
    fi
    response=$(curl -s -X PUT "$SANDBOX_API/file${remote_path}" \
      -H "Content-Type: application/json" \
      -d "$(jq -n --arg c "$(cat "$local_file")" '{content:$c}')")
    echo "$response"
    echo "🌐 $SANDBOX_PREVIEW_URL/$(basename "$local_file")"
    ;;
  sandbox-list|sl)
    spath="${2:-/home/user/webapp/public}"
    curl -s "$SANDBOX_API/ls${spath}" | python3 -m json.tool
    ;;
  sandbox-read|sr)
    curl -s "$SANDBOX_API/file${2}"
    ;;
  sandbox-status|ss)
    curl -s "$SANDBOX_API/status" | python3 -m json.tool
    ;;
  sandbox-url|su)
    echo "$SANDBOX_PREVIEW_URL"
    ;;

    oracle-exec|oe)
        shift
        cmd="$*"
        if [ -z "$cmd" ]; then
            echo "Usage: sos oracle-exec <command>"
            exit 1
        fi
        ssh -i ~/.ssh/oracle-cloud.key -o StrictHostKeyChecking=no -o ConnectTimeout=10 ubuntu@150.136.51.61 "curl -s -X POST http://localhost:3000/api/exec -H 'Content-Type: application/json' -d '$(python3 -c "import json,sys; print(json.dumps({\"command\": sys.argv[1]}))" "$cmd")'" 2>/dev/null | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin)
    if d.get('ok'):
        print(d.get('stdout','').rstrip())
    else:
        print('ERR:', d.get('stderr',''), file=sys.stderr)
        sys.exit(d.get('exitCode',1))
except Exception as e:
    print('Parse error:', e, file=sys.stderr)
"
        ;;
    oracle-status|os)
        ssh -i ~/.ssh/oracle-cloud.key -o StrictHostKeyChecking=no -o ConnectTimeout=10 ubuntu@150.136.51.61 'curl -s http://localhost:3000/api/status' 2>/dev/null | python3 -c 'import sys,json; d=json.load(sys.stdin); m=d["memory"]; print("Host: %s | Arch: %s | CPUs: %s" % (d["hostname"],d["arch"],d["cpus"])); print("Uptime: %.1fh | Mem: %.1fG / %.0fG" % (d["uptime"]/3600,m["used"]/1024/1024/1024,m["total"]/1024/1024/1024))'
        ;;
    info|i)
        echo "=== Genspark Agent Infrastructure ==="
        echo ""
        echo "🦾 Oracle ARM (Beast):  150.136.51.61  | 4 CPU / 24 GB | PM2: sandbox-keepalive"
        echo "🖥️  Oracle AMD (Light):  157.151.227.157 | 2 CPU / 1 GB  | PM2: racquetdesk-booker"
        echo "📦 Sandbox HP:          isjad10r8glpogdbe5r7n-02b9cc79     | 4 CPU / 8 GB"
        echo "📦 Sandbox Std:         i3tin0xbrjov9c7se6vov-8f57ffe2"
        echo "🌐 CF Workers:          agent-dashboard.woshipeiwenhao.workers.dev"
        echo "🤖 1min.ai:             ~31.5M credits | GPT-4.1/Claude Opus 4/o3"
        echo "🎮 Genspark:            ~8500 credits  | 10 models"
        echo ""
        echo "Commands: ask|se|sp|sl|sr|ss|su|say|oe|os|info"
        ;;
    ask2|a2)
        # Ask AI via Genspark browser session (zero credit, requires browser open)
        shift
        question="$*"
        if [ -z "$question" ]; then
            echo "Usage: sos ask2 <question>"
            echo "  env GENSPARK_MODEL=gpt-4.1 sos ask2 <question>"
            echo "  Requires: Genspark page open in browser + agent server running"
            exit 1
        fi
        node "$AGENT_DIR/scripts/sos-ask2.js" "$@"
        ;;
    ask|a)
        # Ask AI via 1min.ai API - direct curl, no browser needed
        shift
        question="$*"
        if [ -z "$question" ]; then
            echo "Usage: sos ask <question>"
            echo "  env ONEMIN_MODEL=claude-opus-4-20250514 sos ask <question>"
            exit 1
        fi
        json_body=$(python3 -c 'import json,sys;print(json.dumps({"type":"CHAT_WITH_AI","model":"'"${ONEMIN_MODEL}"'","promptObject":{"prompt":sys.argv[1]}}))' "$question")
        curl -s -X POST "${ONEMIN_API}" \
            -H "Content-Type: application/json" \
            -H "API-KEY: ${ONEMIN_API_KEY}" \
            -d "$json_body" | python3 -c '
import sys,json
try:
    d=json.load(sys.stdin)
    rec=d.get("aiRecord",{})
    detail=rec.get("aiRecordDetail",{})
    result=detail.get("resultObject",[""])
    print(result[0] if result else "No response")
except Exception as e:
    print("Error:",e)
'
        ;;
    delegate|td)
        shift
        # 委派任务给 Kimi/DeepSeek 通过原生 function calling + MCP 工具执行
        delegate_args=""
        delegate_model="kimi"
        while [[ "$1" == --* ]]; do
          if [ "$1" = "--model" ] && [ -n "$2" ]; then
            delegate_model="$2"; shift 2
          elif [ "$1" = "--max-turns" ] && [ -n "$2" ]; then
            delegate_args="$delegate_args --max-turns $2"; shift 2
          else
            shift
          fi
        done
        task_desc="$*"
        if [ -z "$task_desc" ]; then
            echo "Usage: sos delegate <任务描述>"
            echo "  sos td \"创建 /tmp/test.txt 内容为 hello\""
            echo "  sos td --model deepseek \"任务描述\""
            echo "  模型: kimi (默认), deepseek"
            exit 1
        fi
        node "$AGENT_DIR/scripts/task-delegate.js" --model "$delegate_model" $delegate_args "$task_desc"
        ;;
    sandbox-exec|se)
        shift
        cmd="$*"
        if [ -z "$cmd" ]; then
            echo "Usage: sos sandbox-exec <command>"
            exit 1
        fi
        json_body=$(python3 -c 'import json,sys;print(json.dumps({"command":sys.argv[1],"timeout":30000}))' "$cmd")
        curl -s -X POST "${SANDBOX_API}/exec" \
            -H "Content-Type: application/json" \
            -d "$json_body" | python3 -c '
import sys,json
try:
    d=json.load(sys.stdin)
    if d.get("ok"):
        print(d.get("stdout","").rstrip())
    else:
        print("STDERR:",d.get("stderr",""),file=sys.stderr)
        sys.exit(d.get("exitCode",1))
except Exception as e:
    print("Error:",e,file=sys.stderr)
'
        ;;
  # === 一键重试最后一条命令 ===
  replay|rp)
    HISTORY_FILE="$AGENT_DIR/server-v2/command-history.json"
    if [ ! -f "$HISTORY_FILE" ]; then
      echo "❌ 找不到命令历史文件"
      exit 1
    fi
    # 可选参数: sos replay [ID]
    TARGET_ID="${2:-}"
    
    SCRIPT_CONTENT=$(python3 -c "
import json, sys, os, tempfile
hf = '$HISTORY_FILE'
target = '${TARGET_ID}'
with open(hf) as f:
    data = json.load(f)
history = data.get('history', [])
if not history:
    print('ERROR:历史为空', file=sys.stderr)
    sys.exit(1)

if target:
    entry = next((h for h in history if str(h['id']) == target), None)
    if not entry:
        print(f'ERROR:找不到 #{target}', file=sys.stderr)
        # 显示最近5条
        print('最近命令:', file=sys.stderr)
        for h in history[-5:]:
            tool = h.get('tool','?')
            preview = (h.get('resultPreview','') or '')[:60]
            status = '✅' if h.get('success') else '❌'
            print(f'  #{h[\"id\"]} {status} {tool} | {preview}', file=sys.stderr)
        sys.exit(1)
else:
    # 取最后一条 run_process / bg_run 命令（跳过 replay 自身和 bg_status 等查询命令）
    skip_tools = {'bg_status', 'bg_kill', 'replay', 'delay_run'}
    candidates = [h for h in history if h.get('tool') not in skip_tools]
    if not candidates:
        print('ERROR:没有可重放的命令', file=sys.stderr)
        sys.exit(1)
    entry = candidates[-1]

tool = entry.get('tool', '')
params = entry.get('params', {})
eid = entry['id']

# 还原 bash 脚本
if tool == 'run_process' and params.get('stdin'):
    print(f'ID:{eid}')
    print(f'TOOL:{tool}')
    print('STDIN:' + params['stdin'])
elif tool in ('bg_run',) and params.get('command'):
    print(f'ID:{eid}')
    print(f'TOOL:{tool}')
    print('CMD:' + params['command'])
else:
    print(f'ERROR:不支持重放 {tool}', file=sys.stderr)
    sys.exit(1)
")
    
    if [ $? -ne 0 ]; then
      echo "$SCRIPT_CONTENT"
      exit 1
    fi
    
    REPLAY_ID=$(echo "$SCRIPT_CONTENT" | head -1 | sed 's/^ID://')
    REPLAY_TOOL=$(echo "$SCRIPT_CONTENT" | sed -n '2p' | sed 's/^TOOL://')
    
    echo "🔄 重放命令 #$REPLAY_ID ($REPLAY_TOOL)"
    
    if echo "$SCRIPT_CONTENT" | grep -q "^STDIN:"; then
      # 有 stdin 的命令，提取脚本内容执行
      BASH_SCRIPT=$(echo "$SCRIPT_CONTENT" | sed -n '/^STDIN:/,$p' | sed '1s/^STDIN://')
      echo "━━━ 脚本内容 ━━━"
      echo "$BASH_SCRIPT" | head -5
      LINES=$(echo "$BASH_SCRIPT" | wc -l | tr -d ' ')
      [ "$LINES" -gt 5 ] && echo "... (共 $LINES 行)"
      echo "━━━━━━━━━━━━━━━"
      read -p "执行? [Y/n] " confirm
      confirm=${confirm:-Y}
      if [[ "$confirm" =~ ^[Yy]$ ]]; then
        echo "$BASH_SCRIPT" | bash
      else
        echo "已取消"
      fi
    elif echo "$SCRIPT_CONTENT" | grep -q "^CMD:"; then
      CMD_LINE=$(echo "$SCRIPT_CONTENT" | sed -n '/^CMD:/,$p' | sed '1s/^CMD://')
      echo "━━━ 命令 ━━━"
      echo "$CMD_LINE"
      echo "━━━━━━━━━━━"
      read -p "执行? [Y/n] " confirm
      confirm=${confirm:-Y}
      if [[ "$confirm" =~ ^[Yy]$ ]]; then
        eval "$CMD_LINE"
      else
        echo "已取消"
      fi
    fi
    ;;

  *)
    show_help
    ;;
esac
