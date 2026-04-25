#!/bin/bash
# Build content.js from content-src modules
cd "$(dirname "$0")"
cat content-src/00-header.js \
    content-src/10-utils.js \
    content-src/20-prompt.js \
    content-src/30-dom-galaxy.js \
    content-src/40-parser.js \
    content-src/50-executor.js \
    content-src/60-scanner.js \
    content-src/70-ui.js \
    content-src/80-comm.js \
    content-src/90-init.js \
    content-src/99-footer.js > content.js
echo "Built content.js ($(wc -l < content.js) lines)"
