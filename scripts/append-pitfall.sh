#!/bin/bash
# Usage: bash append-pitfall.sh <name> <user_msg> <assistant_msg> [user_msg2] [assistant_msg2]
# Appends a new _tpl: scenario to toolkit slot
set -e
cd /Users/yay/workspace/genspark-agent

NAME="$1"
shift

# Build messages array from pairs of arguments
MSGS="["
FIRST=true
while [ $# -ge 2 ]; do
  if [ "$FIRST" = true ]; then FIRST=false; else MSGS="$MSGS,"; fi
  MSGS="$MSGS{\"role\":\"user\",\"content\":$(node -e "process.stdout.write(JSON.stringify(process.argv[1]))" "$1")}"
  MSGS="$MSGS,{\"role\":\"assistant\",\"content\":$(node -e "process.stdout.write(JSON.stringify(process.argv[1]))" "$2")}"
  shift 2
done
MSGS="$MSGS]"

PAYLOAD=$(node -e "process.stdout.write(JSON.stringify({name:process.argv[1],messages:JSON.parse(process.argv[2])}))" "$NAME" "$MSGS")

node -e "
var script = 'return new Promise(function(r,j){vfs.writeMsg(\"toolkit\",\"_tpl:'+process.argv[1]+'\",'+JSON.stringify(process.argv[2])+').then(r).catch(j)})';
require('fs').writeFileSync('/private/tmp/prompt-v2/vx-tmp.js', script);
" "$NAME" "$PAYLOAD"

bash scripts/vx.sh "$(cat /private/tmp/prompt-v2/vx-tmp.js)"
echo "Appended: _tpl:$NAME"