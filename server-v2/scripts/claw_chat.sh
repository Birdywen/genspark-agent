#!/bin/bash
# claw_chat.sh — Genspark Claw LLM 一键调用
# 用法:
#   bash claw_chat.sh <model> <prompt>          # 单次调用
#   bash claw_chat.sh <model> -f file.txt        # 从文件读 prompt
#   echo text | bash claw_chat.sh <model>        # 管道输入
#   bash claw_chat.sh <model> <prompt> --system "你是X"  # 带 system prompt
#   bash claw_chat.sh <model> <prompt> --raw     # 只输出 content (默认)
#   bash claw_chat.sh <model> <prompt> --full    # 输出完整 JSON
#   bash claw_chat.sh <model> <prompt> --max 200 # 控制 max_tokens (默认 4096)
#   bash claw_chat.sh --list                     # 列出可用模型
#   bash claw_chat.sh --key                      # 显示当前 API key

set -e

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
AUTH_PATH="$HOME/Library/Application Support/Genspark Claw/users/94abdf9e-04cd-40ce-883d-fdc8b445d132/agents/main/agent/auth-profiles.json"
BASE_URL="https://www.genspark.ai/api/llm_proxy/v1/chat/completions"

# 自动发现 auth-profiles.json (路径可能因用户ID变化)
if [ ! -f "$AUTH_PATH" ]; then
  AUTH_PATH=$(find ~/Library/Application\ Support/Genspark\ Claw -name 'auth-profiles.json' 2>/dev/null | head -1)
fi

load_key() {
  if [ -z "$AUTH_PATH" ] || [ ! -f "$AUTH_PATH" ]; then
    echo "ERROR: auth-profiles.json not found" >&2
    exit 1
  fi
  python3 -c "import json;d=json.load(open('$AUTH_PATH'));print(d['profiles']['genspark-llm-proxy']['key'])"
}

# 模型列表 (2026-07-05 v0.1.723)
MODELS=(
  "claude-fable-5|Claude Fable 5|anthropic|5x"
  "claude-opus-4-8|Claude Opus 4.8|anthropic|5x"
  "claude-opus-4-7|Claude Opus 4.7|anthropic|5x"
  "claude-opus-4-6-1m|Claude Opus 4.6 (1M)|anthropic|5x"
  "claude-sonnet-4-6-1m|Claude Sonnet 4.6 (1M)|anthropic|3x"
  "claude-opus-4-6|Claude Opus 4.6|anthropic|5x"
  "claude-sonnet-4-6|Claude Sonnet 4.6|anthropic|3x"
  "claude-haiku-4-5|Claude Haiku 4.5|anthropic|1x"
  "gpt-5.2|GPT-5.2|openai|2x"
  "gpt-5.4|GPT-5.4|openai|3x"
  "gpt-5.5|GPT-5.5|openai|5x"
  "gpt-5.4-mini|GPT-5.4 Mini|openai|1x"
  "gpt-5.4-nano|GPT-5.4 Nano|openai|0.2x"
  "gemini-3.1-pro-preview|Gemini 3.1 Pro|google|3x"
  "gemini-3-flash-preview|Gemini 3 Flash|google|1x"
  "gemini-3.5-flash|Gemini 3.5 Flash|google|1x"
  "gemini-3.1-flash-lite-preview|Gemini 3.1 Flash Lite|google|0.5x"
  "kimi-k2p6|Kimi K2.6|fireworks|1x"
  "minimax-m2p7|MiniMax M2.7|fireworks|1x"
  "deep-seek-v4-pro-baseten|DeepSeek V4 Pro|baseten|2x"
  "trinity-large-thinking|Trinity Large Thinking|arcee|1x"
)

if [ "$1" = "--list" ]; then
  echo "=== Genspark Claw 可用模型 (v0.1.723) ==="
  printf "%-35s %-25s %-12s %s\n" "MODEL_ID" "NAME" "PROVIDER" "COST"
  printf "%-35s %-25s %-12s %s\n" "--------" "----" "--------" "----"
  for m in "${MODELS[@]}"; do
    IFS='|' read -r id name prov cost <<< "$m"
    printf "%-35s %-25s %-12s %s\n" "$id" "$name" "$prov" "$cost"
  done
  exit 0
fi

if [ "$1" = "--key" ]; then
  load_key
  exit 0
fi

if [ $# -lt 1 ]; then
  echo "Usage: bash claw_chat.sh <model> <prompt> [options]" >&2
  echo "       bash claw_chat.sh --list   (列出模型)" >&2
  echo "       bash claw_chat.sh --key    (显示 API key)" >&2
  exit 1
fi

MODEL="$1"
shift

RAW_MODE=1
MAX_TOKENS=4096
SYSTEM=""
PROMPT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --raw)  RAW_MODE=1; shift ;;
    --full) RAW_MODE=0; shift ;;
    --max)  MAX_TOKENS="$2"; shift 2 ;;
    --system) SYSTEM="$2"; shift 2 ;;
    -f)    PROMPT=$(cat "$2"); shift 2 ;;
    *)     PROMPT="$1"; shift ;;
  esac
done

# 管道输入 (stdin 有数据且 PROMPT 为空时)
if [ -z "$PROMPT" ] && [ ! -t 0 ]; then
  PROMPT=$(cat)
fi

if [ -z "$PROMPT" ]; then
  echo "ERROR: prompt is empty" >&2
  exit 1
fi

KEY=$(load_key)

# 构造 messages
if [ -n "$SYSTEM" ]; then
  PAYLOAD=$(python3 -c "
import json,sys
print(json.dumps({
  'model': '$MODEL',
  'messages': [
    {'role':'system','content':sys.argv[1]},
    {'role':'user','content':sys.argv[2]}
  ],
  'max_tokens': $MAX_TOKENS
}))
" "$SYSTEM" "$PROMPT")
else
  PAYLOAD=$(python3 -c "
import json,sys
print(json.dumps({
  'model': '$MODEL',
  'messages': [{'role':'user','content':sys.argv[1]}],
  'max_tokens': $MAX_TOKENS
}))
" "$PROMPT")
fi

RESP=$(curl -s -w '\n__HTTP:%{http_code}__' "$BASE_URL" \
  -H "Authorization: Bearer $KEY" \
  -H 'Content-Type: application/json' \
  -d "$PAYLOAD")

HTTP_CODE=$(echo "$RESP" | grep -oE '__HTTP:[0-9]+__' | grep -oE '[0-9]+')
BODY=$(echo "$RESP" | sed 's/__HTTP:[0-9]*__$//')

if [ "$HTTP_CODE" != "200" ]; then
  echo "ERROR HTTP $HTTP_CODE" >&2
  echo "$BODY" >&2
  exit 1
fi

if [ "$RAW_MODE" = "1" ]; then
  echo "$BODY" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d["choices"][0]["message"]["content"])'
else
  echo "$BODY" | python3 -m json.tool
fi
