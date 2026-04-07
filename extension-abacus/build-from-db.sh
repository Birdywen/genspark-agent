#!/bin/bash
# build-from-db.sh — 从 project.db 导出源码并构建 content.js
set -e
cd "$(dirname "$0")"

echo '=== Step 1: Export from project.db ==='
cd ../server-v2 && node export-project.cjs extension

echo ''
echo '=== Step 2: Build content.js ==='
cd ../extension
cat content-src/??-*.js > content.js
node -c content.js

LINES=$(wc -l < content.js)
MODULES=$(ls content-src/??-*.js | wc -l)
echo "Built content.js ($LINES lines) from $MODULES modules — syntax OK"
