#!/bin/bash
# build.sh — 合并 content-src/*.js → content.js (Giz.AI 版)
set -e
cd "$(dirname "$0")"
SRC_DIR="content-src"
OUT="content.js"

cat "$SRC_DIR"/00-header.js \
    "$SRC_DIR"/10-utils.js \
    "$SRC_DIR"/20-ui.js \
    "$SRC_DIR"/30-dom-giz.js \
    "$SRC_DIR"/40-parser.js \
    "$SRC_DIR"/50-executor.js \
    "$SRC_DIR"/60-scanner.js \
    "$SRC_DIR"/70-comm.js \
    "$SRC_DIR"/80-init.js \
    "$SRC_DIR"/99-footer.js > "$OUT"

LINES=$(wc -l < "$OUT")
echo "Built $OUT ($LINES lines) for Giz.AI"
