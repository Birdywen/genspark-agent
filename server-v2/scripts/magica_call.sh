#!/bin/bash
# magica_call.sh — Magica API 异步 LLM 调用
# 用法:
#   bash magica_call.sh <model> <prompt>                       # 单次调用 (默认参数)
#   bash magica_call.sh <model> -f file.txt                     # 从文件读 prompt
#   echo text | bash magica_call.sh <model>                     # 管道输入
#   bash magica_call.sh <model> <prompt> --system "你是X"       # 带 system prompt
#   bash magica_call.sh <model> <prompt> --max 8192             # 控制 max_tokens (默认 4096)
#   bash magica_call.sh <model> <prompt> --temp 0.7             # 控制 temperature (默认 0.2)
#   bash magica_call.sh <model> <prompt> --reasoning            # 启用 reasoning 模式
#   bash magica_call.sh <model> <prompt> --raw                  # 只输出文本 (默认)
#   bash magica_call.sh <model> <prompt> --full                 # 输出完整 JSON (含 usage/cost)
#   bash magica_call.sh <model> <prompt> --json-out file.json   # 保存完整响应到文件
#   bash magica_call.sh --models                                # 列出常用模型
#   bash magica_call.sh --key                                   # 显示当前 API key
#
# 已验证模型 (2026-07-05):
#   gemini_3_1_pro_preview   — Gemini 3.1 Pro (8小节和声 100%, 整页 100%)
#   gemini_3_5_flash         — Gemini 3.5 Flash (8小节 100%, 5s, 性价比王)
#
# 异步流程:
#   POST /v1/nodes/{model}/run  → 202 + {runId}
#   GET  /v1/nodes/runs/{runId} → 轮询直到 status=COMPLETED
#
# 成本估算 (Magica credit 体系):
#   gemini_3_1_pro_preview  = 100 credits/次  (= 0.0001 用户积分, 0 USD)
#   gemini_3_5_flash        = ? (待测, 应该更低)

set -e

API_KEY='gx_V5jLRcLeiG6RbgLs9BDo9f'
BASE_URL='https://api.magica.com/api'

MODELS=(
  "gemini_3_1_pro_preview|Gemini 3.1 Pro|google|100cr|reasoning+精确"
  "gemini_3_5_flash|Gemini 3.5 Flash|google|~50cr?|快+省"
)

if [ "$1" = "--models" ]; then
  echo "=== Magica 可用模型 ==="
  printf "%-30s %-25s %-12s %-10s %s\n" "MODEL_ID" "NAME" "PROVIDER" "CREDITS" "NOTES"
  printf "%-30s %-25s %-12s %-10s %s\n" "--------" "----" "--------" "-------" "-----"
  for m in "${MODELS[@]}"; do
    IFS='|' read -r id name prov cr note <<< "$m"
    printf "%-30s %-25s %-12s %-10s %s\n" "$id" "$name" "$prov" "$cr" "$note"
  done
  exit 0
fi

if [ "$1" = "--key" ]; then
  echo "$API_KEY"
  exit 0
fi

if [ $# -lt 1 ]; then
  echo "Usage: bash magica_call.sh <model> <prompt> [options]" >&2
  echo "       bash magica_call.sh --models  (列出模型)" >&2
  echo "       bash magica_call.sh --key     (显示 API key)" >&2
  exit 1
fi

MODEL="$1"
shift

RAW_MODE=1
MAX_TOKENS=4096
TEMPERATURE=0.2
REASONING=false
SYSTEM=""
PROMPT=""
JSON_OUT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --raw)        RAW_MODE=1; shift ;;
    --full)       RAW_MODE=0; shift ;;
    --max)        MAX_TOKENS="$2"; shift 2 ;;
    --temp)       TEMPERATURE="$2"; shift 2 ;;
    --reasoning)  REASONING=true; shift ;;
    --system)     SYSTEM="$2"; shift 2 ;;
    --json-out)   JSON_OUT="$2"; shift 2 ;;
    -f)           PROMPT=$(cat "$2"); shift 2 ;;
    *)            PROMPT="$1"; shift ;;
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

# 构造 payload
PAYLOAD=$(python3 -c "
import json,sys
print(json.dumps({
  'nodeType': sys.argv[1],
  'input': {
    'prompt': sys.argv[2],
    'system_prompt': sys.argv[3],
    'image_urls': [],
    'video_urls': [],
    'audio_urls': [],
    'temperature': float(sys.argv[4]),
    'max_tokens': int(sys.argv[5]),
    'reasoning': sys.argv[6] == 'true',
    'top_p': 1,
    'top_k': 0,
    'frequency_penalty': 0,
    'presence_penalty': 0,
    'repetition_penalty': 1,
    'min_p': 0,
    'top_a': 0,
    'seed': 0,
    'stop': '',
    'response_format': False
  }
}))
" "$MODEL" "$PROMPT" "$SYSTEM" "$TEMPERATURE" "$MAX_TOKENS" "$REASONING")

echo "[START] model=$MODEL max=$MAX_TOKENS temp=$TEMPERATURE reasoning=$REASONING" >&2
T0=$(python3 -c 'import time;print(time.time())')

# 启动 run
RESP=$(curl -s -w '\n__HTTP:%{http_code}__' \
  -X POST "$BASE_URL/v1/nodes/$MODEL/run" \
  -H "Authorization: Bearer $API_KEY" \
  -H 'Content-Type: application/json' \
  -d "$PAYLOAD")

HTTP_CODE=$(echo "$RESP" | grep -oE '__HTTP:[0-9]+__' | grep -oE '[0-9]+')
BODY=$(echo "$RESP" | sed 's/__HTTP:[0-9]*__$//')

if [ "$HTTP_CODE" != "200" ] && [ "$HTTP_CODE" != "202" ]; then
  echo "ERROR HTTP $HTTP_CODE starting run" >&2
  echo "$BODY" >&2
  exit 1
fi

RUN_ID=$(echo "$BODY" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d.get("runId") or d.get("run_id") or d.get("id"))')
echo "[QUEUED] runId=$RUN_ID" >&2

# 轮询
for i in $(seq 1 100); do
  sleep 3
  POLL=$(curl -s "$BASE_URL/v1/nodes/runs/$RUN_ID" \
    -H "Authorization: Bearer $API_KEY")
  STATUS=$(echo "$POLL" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d.get("status","UNKNOWN"))')
  ELAPSED=$(python3 -c "import time; print(f'{time.time()-float($T0):.1f}')")
  echo "[poll $i ${ELAPSED}s] status=$STATUS" >&2

  if [ "$STATUS" = "COMPLETED" ]; then
    if [ -n "$JSON_OUT" ]; then
      echo "$POLL" > "$JSON_OUT"
      echo "[saved full JSON to $JSON_OUT]" >&2
    fi
    if [ "$RAW_MODE" = "1" ]; then
      echo "$POLL" | python3 -c 'import json,sys;d=json.load(sys.stdin);out=d.get("output",{});print(out.get("output","") if isinstance(out,dict) else out)'
    else
      echo "$POLL" | python3 -m json.tool
    fi
    # 输出 cost/usage 到 stderr
    echo "$POLL" | python3 -c 'import json,sys
d=json.load(sys.stdin);out=d.get("output",{})
if isinstance(out,dict):
  u=out.get("usage",{});c=out.get("cost_usd","?");cr=out.get("creditUsed","?")
  print(f"[usage] tokens={u} cost_usd={c} creditUsed={cr}",file=sys.stderr)' 2>&1 | grep -v '^$' >&2 || true
    exit 0
  elif [ "$STATUS" = "FAILED" ] || [ "$STATUS" = "ERROR" ] || [ "$STATUS" = "CANCELLED" ]; then
    echo "FAILED: $POLL" >&2
    exit 1
  fi
done
echo "TIMEOUT after 100 polls (300s)" >&2
exit 1
