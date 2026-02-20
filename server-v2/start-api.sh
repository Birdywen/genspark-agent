#!/bin/bash
set -a
source "$(dirname "$0")/.env.api"
set +a
exec node "$(dirname "$0")/api-server.js"