#!/bin/bash
DB=/Users/yay/workspace/genspark-agent/server-v2/data/agent.db
DATE=${1:-$(date -u +%Y-%m-%d)}
echo "=== SESSION RECOVERY: $DATE ==="
echo "--- SUMMARY ---"
sqlite3 -header -column "$DB" "SELECT tool, COUNT(*) as cnt, SUM(success) as ok FROM commands WHERE date(timestamp)='$DATE' GROUP BY tool ORDER BY cnt DESC"
echo "--- LAST 30 OPS ---"
sqlite3 -header -column "$DB" "SELECT id, substr(timestamp,12,8) as time, tool, substr(params,1,100) as params, success FROM commands WHERE date(timestamp)='$DATE' ORDER BY id DESC LIMIT 30"
echo "--- ERRORS ---"
sqlite3 -header -column "$DB" "SELECT id, substr(timestamp,12,8) as time, tool, substr(coalesce(error,result_preview),1,120) as err FROM commands WHERE date(timestamp)='$DATE' AND success=0 ORDER BY id DESC LIMIT 15"