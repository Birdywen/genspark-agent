#!/bin/bash
# Context Compress Smart v2.1 - 智能压缩整合脚本
# 
# 整合 history_compressor.js 自动提取 + AI 补充 = 高质量总结
#
# 用法:
#   bash context-compress-smart.sh <agent_id> [since_hours]
#
# 示例:
#   bash context-compress-smart.sh 5364caf1 24    # 最近24小时的历史

set -e

AGENT_ID="${1:-unknown}"
SINCE_HOURS="${2:-48}"
ARCHIVE_DIR="/Users/yay/workspace/context-archives"
HISTORY_FILE="/Users/yay/workspace/genspark-agent/server-v2/command-history.json"
COMPRESSOR="/Users/yay/workspace/.agent_memory/history_compressor.js"
TEMPLATE_FILE="/private/tmp/compress-template.md"
TIMESTAMP=$(date +"%Y-%m-%d-%H%M")

mkdir -p "$ARCHIVE_DIR"

echo "🔍 Smart Compress for agent: ${AGENT_ID:0:8}"
echo "📅 Analyzing history (last ${SINCE_HOURS}h)..."

# 导出环境变量给 Python 子进程使用
export COMPRESS_SINCE_HOURS="$SINCE_HOURS"
export COMPRESS_HISTORY_FILE="$HISTORY_FILE"

# Step 1: 用 history_compressor 生成操作摘要（带时间过滤）
AUTO_SUMMARY=$(node "$COMPRESSOR" context "$HISTORY_FILE" --since "$SINCE_HOURS" 2>/dev/null || echo "(auto summary failed)")
AUTO_STATS=$(node "$COMPRESSOR" analyze "$HISTORY_FILE" --since "$SINCE_HOURS" 2>/dev/null || echo "(stats failed)")

# Step 2: 从 history 提取涉及的关键文件路径（去重，带时间过滤）
KEY_FILES=$(python3 -c '
import json, re, os
from collections import Counter
from datetime import datetime, timedelta, timezone

hfile = os.environ["COMPRESS_HISTORY_FILE"]
since_hours = float(os.environ.get("COMPRESS_SINCE_HOURS", "48"))

data = json.load(open(hfile))
history = data.get("history", [])

if since_hours > 0:
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=since_hours)).isoformat()
    history = [c for c in history if c.get("timestamp", "") >= cutoff]

paths = Counter()
for cmd in history:
    params = cmd.get("params", {})
    p = params.get("path", "")
    if p: paths[p] += 1
    stdin = params.get("stdin", "") or params.get("command_line", "")
    for m in re.findall(r"/[\w/\-\.]+\.(?:js|ts|py|sh|md|json|html|css|yaml|yml)", stdin):
        if "/node_modules/" not in m and "/private/tmp" not in m:
            paths[m] += 1

for p, count in paths.most_common(20):
    print(f"  - {p} ({count}x)")
' 2>/dev/null || echo "  (extraction failed)")

# Step 3: 提取错误记录（带时间过滤）
ERRORS=$(python3 -c '
import json, os
from datetime import datetime, timedelta, timezone

hfile = os.environ["COMPRESS_HISTORY_FILE"]
since_hours = float(os.environ.get("COMPRESS_SINCE_HOURS", "48"))

data = json.load(open(hfile))
history = data.get("history", [])

if since_hours > 0:
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=since_hours)).isoformat()
    history = [c for c in history if c.get("timestamp", "") >= cutoff]

errors = []
for cmd in history:
    if not cmd.get("success", True):
        tool = cmd.get("tool", "unknown")
        error_msg = (cmd.get("error", "") or "")[:100]
        params = cmd.get("params", {})
        context = (params.get("stdin", "") or params.get("path", "") or params.get("command_line", "") or "")[:80]
        if context:
            errors.append(f"  - [{tool}] {error_msg} (doing: {context[:60]}...)")
        else:
            errors.append(f"  - [{tool}] {error_msg}")
if errors:
    for e in errors[-5:]:
        print(e)
else:
    print("  (无错误)")
' 2>/dev/null || echo "  (extraction failed)")

# Step 4: 获取命令总数
CMD_COUNT=$(python3 -c '
import json, os
from datetime import datetime, timedelta, timezone

hfile = os.environ["COMPRESS_HISTORY_FILE"]
since_hours = float(os.environ.get("COMPRESS_SINCE_HOURS", "48"))

data = json.load(open(hfile))
h = data.get("history", [])

if since_hours > 0:
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=since_hours)).isoformat()
    h = [c for c in h if c.get("timestamp", "") >= cutoff]
print(len(h))
' 2>/dev/null || echo "?")

# Step 5: 生成模板
cat > "$TEMPLATE_FILE" << TMPLEOF
# Context Archive - $TIMESTAMP
- **Agent ID**: $AGENT_ID
- **Generated**: $(date '+%Y-%m-%d %H:%M')
- **Time range**: last ${SINCE_HOURS}h
- **Auto-extracted from**: command-history.json ($CMD_COUNT commands in range)

## 自动提取的操作摘要
$AUTO_SUMMARY

## 涉及的关键文件
$KEY_FILES

## 遇到的错误
$ERRORS

## 统计
$AUTO_STATS

---
> 以下部分由 AI 补充（压缩时填入）

## 任务目标
[AI 填写：本次对话的主要任务是什么]

## 当前状态
[AI 填写：任务进行到哪一步了]

## TODO
- [ ] [AI 填写：还有什么没完成]

## 关键决策和踩坑
[AI 填写：重要的技术决策、踩过的坑]

## 压缩总结（注入到对话中的内容）
---
[AI 在此处生成最终的压缩总结文本]
TMPLEOF

# Step 6: 对模板做敏感信息脱敏
REDACTOR="/Users/yay/workspace/genspark-agent/scripts/redact-secrets.js"
if [ -f "$REDACTOR" ]; then
  node "$REDACTOR" "$TEMPLATE_FILE" > "${TEMPLATE_FILE}.clean"
  mv "${TEMPLATE_FILE}.clean" "$TEMPLATE_FILE"
  echo "🔒 敏感信息已脱敏"
fi

echo ""
echo "✅ Template generated: $TEMPLATE_FILE"
echo ""
echo "========== PREVIEW =========="
cat "$TEMPLATE_FILE"
echo ""
echo "============================="
echo ""
echo "📋 Next steps:"
echo "   1. AI reviews and fills in the [AI 填写] sections"
echo "   2. AI generates compression summary"
echo "   3. Copy archive to: $ARCHIVE_DIR/$TIMESTAMP-${AGENT_ID:0:8}.md"
echo "   4. Run browser script to inject summary (user clicks Save)"
