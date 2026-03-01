#!/bin/bash
# Context Compress - 存档脚本
# 用法: bash context-compress-archive.sh <agent_id> <archive_content_file>
# 
# 在压缩前调用，将当前进度保存到 /Users/yay/workspace/context-archives/

AGENT_ID="${1:-unknown}"
CONTENT_FILE="${2:-/dev/stdin}"
ARCHIVE_DIR="/Users/yay/workspace/context-archives"
TIMESTAMP=$(date +"%Y-%m-%d-%H%M")
FILENAME="${TIMESTAMP}-${AGENT_ID:0:8}.md"
FILEPATH="${ARCHIVE_DIR}/${FILENAME}"

mkdir -p "$ARCHIVE_DIR"

if [ -f "$CONTENT_FILE" ]; then
    cp "$CONTENT_FILE" "$FILEPATH"
else
    cat > "$FILEPATH" <<'ARCHIVE_EOF'
# Context Archive
## Error: No content provided
ARCHIVE_EOF
fi

echo "Archive saved: $FILEPATH"