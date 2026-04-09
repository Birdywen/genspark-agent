#!/bin/bash
# backup-db.sh - 一键备份 agent.db 到 AI Drive
# 用法: bash backup-db.sh

set -e
cd "$(dirname "$0")"

DATE=$(date +%Y%m%d-%H%M)
FILE="agent-${DATE}.db"
TMP="/tmp/${FILE}"

echo "[1/3] Copying agent.db..."
cp data/agent.db "$TMP"

echo "[2/3] Uploading ${FILE} ($(du -h "$TMP" | cut -f1))..."
URL=$(gsk upload "$TMP" 2>&1 | grep -o 'https://www.genspark.ai/api/files/s/[^ "]*')
if [ -z "$URL" ]; then echo 'Upload failed!'; exit 1; fi
echo "  → $URL"

echo "[3/3] Saving to AI Drive /agent-backup/..."
API_KEY=$(python3 -c "import json,os;print(json.load(open(os.path.expanduser('~/.genspark-tool-cli/config.json')))['api_key'])")
RESULT=$(curl -s -X POST 'https://www.genspark.ai/api/tool_cli/aidrive' \
  -H 'Content-Type: application/json' \
  -H "X-Api-Key: $API_KEY" \
  -d "{\"action\":\"download_file\",\"file_url\":\"$URL\",\"target_folder\":\"/agent-backup\"}" 2>&1)

if echo "$RESULT" | grep -q '"status": "ok"\|"success"'; then
  echo "Done! /agent-backup/${FILE}"
  rm -f "$TMP"
else
  echo "AI Drive save failed:"
  echo "$RESULT" | tail -5
  exit 1
fi
