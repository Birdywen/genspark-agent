#!/bin/bash
# compress-prepare.sh - 生成压缩总结模板
# 用法: bash compress-prepare.sh [since_hours]
# 输出: /private/tmp/compress-summary.md（AI 补充后通过 eval_js 设置到浏览器）

SINCE=${1:-8}
HISTORY="/Users/yay/workspace/genspark-agent/server-v2/command-history.json"
COMPRESSOR="/Users/yay/workspace/.agent_memory/history_compressor.js"
OUTPUT="/private/tmp/compress-summary.md"

# 生成操作摘要
CONTEXT=$(node "$COMPRESSOR" context "$HISTORY" --since "$SINCE" 2>/dev/null)

cat > "$OUTPUT" << 'TEMPLATE'
[上下文压缩总结 - DATE_PLACEHOLDER]

## 项目/任务
<!-- AI 补充：当前在做什么项目/任务 -->

## 环境
<!-- AI 补充：关键路径、服务器、端口等 -->

## 已完成
TEMPLATE

# 插入 history_compressor 的输出
echo "$CONTEXT" >> "$OUTPUT"

cat >> "$OUTPUT" << 'TEMPLATE'

## 关键发现
<!-- AI 补充：重要的技术发现、踩坑经验 -->

## TODO
<!-- AI 补充：接下来要做的事 -->

## 关键信息
<!-- AI 补充：project ID、API key、重要配置等硬信息 -->
TEMPLATE

# 替换日期
sed -i '' "s/DATE_PLACEHOLDER/$(date '+%Y-%m-%d')/" "$OUTPUT"

echo "✅ 模板已生成: $OUTPUT"
echo "📏 长度: $(wc -c < "$OUTPUT") 字符"
echo ""
echo "--- 预览 ---"
cat "$OUTPUT"