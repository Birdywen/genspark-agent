#!/bin/bash
# vx.sh - VFS exec 快捷封装
# 用法:
#   vx "return typeof vfs"                    # 直接执行 JS 表达式
#   vx -f /path/to/file.js                    # 执行文件
#   vx -w /path/to/file.js                    # 写入+语法检查+执行（一步到位）
#   vx -fn "functionBody" arg1 arg2           # 执行函数体
#   vx -t 30000 "slow code"                   # 自定义超时
#   vx ls                                     # 快捷: vfs.ls()
#   vx status                                 # 快捷: 系统状态
#   vx modules                                # 快捷: fn 模块列表
#   vx tick                                   # 快捷: scheduler tick
#   vx ask "prompt"                           # 快捷: __tk.ask
#   vx boot                                   # 快捷: bootstrap all

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VFS_EXEC="$SCRIPT_DIR/vfs-exec.sh"
TMP="/private/tmp"
TIMEOUT=15000

# 解析参数
MODE="inline"
FILE=""
while [[ "$1" == -* ]]; do
  case "$1" in
    -f) MODE="file"; FILE="$2"; shift 2;;
    -w) MODE="write"; FILE="$2"; shift 2;;
    -t) TIMEOUT="$2"; shift 2;;
    -fn) MODE="fn"; shift; break;;
    *) shift;;
  esac
done

# 如果 MODE 已经被 -f/-w 设置，直接执行
if [ "$MODE" = "file" ] || [ "$MODE" = "write" ]; then
  if [ -z "$FILE" ]; then echo "ERROR: no file specified"; exit 1; fi
  if ! node -c "$FILE" 2>/dev/null; then
    echo "SYNTAX ERROR in $FILE:"
    node -c "$FILE"
    exit 1
  fi
  bash "$VFS_EXEC" "$FILE" "$TIMEOUT"
  exit $?
fi

# 快捷命令
case "$1" in
  ls)
    CODE='return new Promise(function(r){vfs.ls().then(function(v){r(JSON.stringify(v,null,2))}).catch(function(e){r("ERROR:"+e.message)})});'
    ;;
  status)
    CODE='return JSON.stringify({tk:window.__tk?Object.keys(__tk).length:0,ask:typeof(__tk||{}).ask,evolve:typeof vfs.evolve,scheduler:vfs.scheduler?vfs.scheduler.status():"N/A",constitution:typeof vfs.constitution,bus:vfs.bus?"alive":"dead",watcher:vfs.watchStart?"loaded":"N/A"},null,2);'
    ;;
  modules)
    CODE='return new Promise(function(r){vfs.listMsg("fn").then(function(m){var mods=m.filter(function(x){return x.key.indexOf("_")!==0}).map(function(x){return x.key+"("+x.size+")"});r(JSON.stringify({total:m.length,modules:mods.length,list:mods},null,2))}).catch(function(e){r("ERROR:"+e.message)})});'
    ;;
  tick)
    TIMEOUT=180000
    CODE='return new Promise(function(r,j){var keys=["vfs-self-evolve","vfs-validate","vfs-evolve-scheduler","vfs-evolve-log","vfs-evolve-stats","vfs-constitution","vfs-ai-opportunities","vfs-bus-wiring","vfs-resilient-ask","vfs-ntfy-evolve"];var i=0;function next(){if(i>=keys.length){doTick();return}vfs.readMsg("fn",keys[i]).then(function(c){if(c)try{new Function(c)()}catch(e){}i++;next()}).catch(function(){i++;next()})}function doTick(){if(!vfs.scheduler){r(JSON.stringify({error:"scheduler not loaded"}));return}var t0=Date.now();vfs.scheduler.tick().then(function(res){r(JSON.stringify({ok:true,sec:Math.round((Date.now()-t0)/1000),result:res},null,2))}).catch(function(e){r(JSON.stringify({error:e.message}))})}next()});'
    ;;
  boot)
    TIMEOUT=30000
    CODE='return new Promise(function(r){vfs.exec("fn").then(function(){var keys=["vfs-self-evolve","vfs-validate","vfs-evolve-scheduler","vfs-evolve-log","vfs-evolve-stats","vfs-constitution","vfs-ai-opportunities","vfs-bus-wiring","vfs-resilient-ask","vfs-ntfy-evolve"];var loaded=0,errors=[];function next(){if(loaded>=keys.length){r(JSON.stringify({ok:true,loaded:loaded,errors:errors,status:{tk:Object.keys(__tk).length,ask:typeof __tk.ask,evolve:typeof vfs.evolve,scheduler:vfs.scheduler?vfs.scheduler.status():"N/A"}},null,2));return}vfs.readMsg("fn",keys[loaded]).then(function(c){if(c)try{new Function(c)()}catch(e){errors.push(keys[loaded]+":"+e.message)}loaded++;next()}).catch(function(e){errors.push(keys[loaded]+":read_err");loaded++;next()})}next()}).catch(function(e){r(JSON.stringify({error:e.message}))})});'
    ;;
  ask)
    shift
    PROMPT="$*"
    TIMEOUT=60000
    ESCAPED=$(python3 -c "import json,sys;print(json.dumps(sys.argv[1]))" "$PROMPT")
    CODE="return new Promise(function(r){__tk.ask($ESCAPED).then(function(v){r(v)}).catch(function(e){r('ERROR:'+e.message)})});"
    ;;
  ask-opus)
    shift
    PROMPT="$*"
    TIMEOUT=60000
    ESCAPED=$(python3 -c "import json,sys;print(json.dumps(sys.argv[1]))" "$PROMPT")
    CODE="return new Promise(function(r){__tk.askProxy($ESCAPED,'claude-opus-4-6').then(function(v){r(v)}).catch(function(e){r('ERROR:'+e.message)})});"
    ;;
  ask-kimi)
    shift
    PROMPT="$*"
    TIMEOUT=30000
    ESCAPED=$(python3 -c "import json,sys;print(json.dumps(sys.argv[1]))" "$PROMPT")
    CODE="return new Promise(function(r){__tk.askKimi($ESCAPED).then(function(v){r(v)}).catch(function(e){r('ERROR:'+e.message)})});"
    ;;
  read)
    KEY="$2"
    CODE="return new Promise(function(r){vfs.readMsg('fn','$KEY').then(function(v){r(v||'null')}).catch(function(e){r('ERROR:'+e.message)})});"
    ;;
  evolve-log)
    CODE='return new Promise(function(r){vfs.readMsg("fn","_evolve_memory").then(function(v){r(v||"null")}).catch(function(e){r("ERROR:"+e.message)})});'
    ;;

  demands)
    CODE='return new Promise(function(r){vfs.demand.list().then(function(v){r(JSON.stringify(v,null,2))}).catch(function(e){r("ERROR:"+e.message)})});'
    ;;
  demand-add)
    shift
    DESC="$*"
    ESCAPED=$(python3 -c "import json,sys;print(json.dumps(sys.argv[1]))" "$DESC")
    CODE="return new Promise(function(r){vfs.demand.add($ESCAPED,{source:'user',priority:'normal'}).then(function(v){r(JSON.stringify(v,null,2))}).catch(function(e){r('ERROR:'+e.message)})});"
    ;;
  demand-stats)
    CODE='return new Promise(function(r){vfs.demand.stats().then(function(v){r(JSON.stringify(v,null,2))}).catch(function(e){r("ERROR:"+e.message)})});'
    ;;
  prs)
    CODE='return new Promise(function(r){vfs.pr.list().then(function(v){r(JSON.stringify(v,null,2))}).catch(function(e){r("ERROR:"+e.message)})});'
    ;;
  pr-stats)
    CODE='return new Promise(function(r){vfs.pr.stats().then(function(v){r(JSON.stringify(v,null,2))}).catch(function(e){r("ERROR:"+e.message)})});'
    ;;
  compress)
    TIMEOUT=90000
    CODE='return new Promise(function(r){vfs.execMsg("toolkit","compress-chat").then(function(v){r(JSON.stringify(v,null,2))}).catch(function(e){r("ERROR:"+e.message)})});'
    ;;
  chat-size)
    CODE='return new Promise(function(r){vfs.execMsg("toolkit","chat-size").then(function(v){r(JSON.stringify(v,null,2))}).catch(function(e){r("ERROR:"+e.message)})});'
    ;;
  "")
    echo "Usage: vx <command|js-code>"
    echo ""
    echo "Quick commands:"
    echo "  ls         - VFS slot list"
    echo "  status     - System status (__tk, evolve, scheduler, bus)"
    echo "  modules    - List fn modules"
    echo "  boot       - Full bootstrap (exec fn + load evolve modules)"
    echo "  tick       - Scheduler tick (boot + evolve cycle)"
    echo "  ask <q>    - Ask AI (gpt-5-4)"
    echo "  ask-opus   - Ask AI (claude-opus-4-6)"
    echo "  ask-kimi   - Ask AI (moonshot)"
    echo "  read <key> - Read fn module by key"
    echo "  evolve-log - Show evolve memory
  demands    - List all demands
  demand-add - Add user demand
  demand-stats - Demand statistics
  prs        - List all PRs
  pr-stats   - PR statistics"
    echo "  compress   - Compress chat"
    echo "  chat-size  - Check chat size"
    echo ""
    echo "Modes:"
    echo "  vx 'return 1+1'        - Inline JS"
    echo "  vx -f file.js          - Execute file"
    echo "  vx -w file.js          - Write+check+execute"
    echo "  vx -t 30000 'code'     - Custom timeout"
    exit 0
    ;;
  *)
    # 直接执行 JS
    CODE="$*"
    ;;
esac

# 写入模式: 先语法检查
if [ "$MODE" = "write" ]; then
  if ! node -c "$FILE" 2>/dev/null; then
    echo "SYNTAX ERROR in $FILE:"
    node -c "$FILE"
    exit 1
  fi
  bash "$VFS_EXEC" "$FILE" "$TIMEOUT"
  exit $?
fi

# 文件模式
if [ "$MODE" = "file" ]; then
  if ! node -c "$FILE" 2>/dev/null; then
    echo "SYNTAX ERROR in $FILE:"
    node -c "$FILE"
    exit 1
  fi
  bash "$VFS_EXEC" "$FILE" "$TIMEOUT"
  exit $?
fi

# Inline 模式: 写临时文件 + 语法检查 + 执行
TMPFILE="$TMP/vx-$(date +%s).js"
echo "$CODE" > "$TMPFILE"
if ! node -c "$TMPFILE" 2>/dev/null; then
  echo "SYNTAX ERROR:"
  node -c "$TMPFILE"
  rm -f "$TMPFILE"
  exit 1
fi
bash "$VFS_EXEC" "$TMPFILE" "$TIMEOUT"
rm -f "$TMPFILE"