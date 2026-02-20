#!/bin/bash
# API Server - quick model switch
# Usage: bash start-api.sh [kimi|deepseek|kimi-think]

set -a
source "$(dirname "$0")/.env.api"
set +a

MODEL="${1:-kimi}"

case "$MODEL" in
  kimi)
    export LLM_API_KEY="$KIMI_API_KEY"
    export LLM_BASE_URL="https://api.moonshot.ai/v1"
    export LLM_MODEL="kimi-k2.5"
    ;;
  kimi-think)
    export LLM_API_KEY="$KIMI_API_KEY"
    export LLM_BASE_URL="https://api.moonshot.ai/v1"
    export LLM_MODEL="kimi-k2-thinking"
    ;;
  deepseek)
    export LLM_API_KEY="$DEEPSEEK_API_KEY"
    export LLM_BASE_URL="https://api.deepseek.com/v1"
    export LLM_MODEL="deepseek-chat"
    ;;
  *)
    echo "Unknown model: $MODEL"
    echo "Available: kimi, kimi-think, deepseek"
    exit 1
    ;;
esac

export LLM_FORMAT="openai"
echo "Starting API Server with $LLM_MODEL ($MODEL)"
exec node "$(dirname "$0")/api-server.js"
