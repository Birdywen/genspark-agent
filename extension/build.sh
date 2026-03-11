#!/bin/bash
# build.sh — 合并 content-src/*.js → content.js
set -e
cd "$(dirname "$0")"

SRC_DIR="content-src"
OUT="content.js"

# 按文件名排序合并
cat "$SRC_DIR"/??-*.js > "$OUT"

LINES=$(wc -l < "$OUT")
echo "Built $OUT ($LINES lines) from $(ls $SRC_DIR/??-*.js | wc -l) modules"
