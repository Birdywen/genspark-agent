#!/bin/bash
# Daily dashboard data update + deploy
set -e
cd /Users/yay/workspace/genspark-agent

# 1. Generate fresh stats
node scripts/analyze-agent-log.js

# 2. Build site
cd /Users/yay/workspace/genspark-agent-site
npx next build 2>&1 | tail -3

# 3. Deploy
npx wrangler pages deploy out --project-name genspark-agent-site 2>&1 | tail -3

echo "[$(date)] Dashboard updated successfully"
