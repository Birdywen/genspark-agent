#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
export TZ="${TZ:-America/New_York}"
export NTFY_TOPIC="${NTFY_TOPIC:-yay-agent}"
export DAILY_RATING_OUT="${DAILY_RATING_OUT:-$DIR/out}"
mkdir -p "$DAILY_RATING_OUT"
LOG="$DAILY_RATING_OUT/cron.log"
{
  echo "==== $(date '+%Y-%m-%d %H:%M:%S %Z') ===="
  /usr/bin/env python3 "$DIR/daily_rating_push.py" --symbols-file "$DIR/symbols.txt" "$@"
} >>"$LOG" 2>&1
