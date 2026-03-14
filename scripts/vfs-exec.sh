#!/bin/bash
# vfs-exec: 本地文件 → 浏览器直接执行（零转义跨世界传输）
# 用法: vfs-exec <file.js> [timeout_ms]
# 代码中用 return 返回结果（自带语法验证）

FILE="$1"
TIMEOUT="${2:-15000}"

if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "Usage: vfs-exec <file.js> [timeout_ms]"
  exit 1
fi

# 语法验证（包装成函数体检查）
node -e "new Function(require('fs').readFileSync('$FILE','utf8'))" 2>/dev/null
if [ $? -ne 0 ]; then
  echo "SYNTAX ERROR in $FILE:"
  node -e "try{new Function(require('fs').readFileSync('$FILE','utf8'))}catch(e){console.error(e.message)}"
  exit 2
fi

node -e "
var WebSocket = require('ws');
var code = require('fs').readFileSync(process.argv[1], 'utf8');
var ws = new WebSocket('ws://localhost:8765');
var done = false;
ws.on('open', function() {
  ws.send(JSON.stringify({
    type: 'browser_eval',
    id: 'vfs-exec-' + Date.now(),
    code: code,
    timeout: parseInt(process.argv[2]) || 15000
  }));
});
ws.on('message', function(data) {
  var msg = JSON.parse(data.toString());
  if (msg.type === 'browser_eval_result' && !done) {
    done = true;
    if (msg.success) {
      var r = msg.result;
      console.log(typeof r === 'string' ? r : JSON.stringify(r, null, 2));
    } else {
      console.error('ERROR:', msg.error);
      process.exitCode = 1;
    }
    ws.close();
  }
});
ws.on('close', function() { process.exit(); });
setTimeout(function() {
  if (!done) { console.error('TIMEOUT'); process.exit(1); }
}, parseInt(process.argv[2]) || 15000);
" "$FILE" "$TIMEOUT"
