#!/bin/bash
# vx.sh - vfs-exec.sh 快捷方式
# 用法: vx.sh "return typeof vfs"  (直接执行代码字符串)
# 或:   vx.sh /path/to/file.js     (执行文件)
# 或:   vx.sh /path/to/file.js 30000  (执行文件+超时)

SCRIPTS_DIR="/Users/yay/workspace/genspark-agent/scripts"

if [ -z "$1" ]; then
  echo "Usage: vx.sh <code_or_file> [timeout_ms]"
  exit 1
fi

# 判断是文件还是代码字符串
if [ -f "$1" ]; then
  # 文件模式
  exec "$SCRIPTS_DIR/vfs-exec.sh" "$@"
else
  # 代码字符串模式: 写临时文件再执行
  TMPFILE=$(mktemp /private/tmp/vx_XXXXXX.js)
  echo "$1" > "$TMPFILE"
  TIMEOUT="${2:-15000}"
  "$SCRIPTS_DIR/vfs-exec.sh" "$TMPFILE" "$TIMEOUT"
  EXIT=$?
  rm -f "$TMPFILE"
  exit $EXIT
fi
