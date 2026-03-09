# Evolve System Status (Session 6-8, 2026-03-09)

## Architecture Complete
- **evolve v4**: AI generate + self-test + auto-fix (2 rounds) + validate
- **chain**: multi-module orchestration with topo-sort
- **scheduler**: periodic tick + AI-discovered opportunities (moonshot-v1-8k)
- **constitution**: protected modules list, daily budget (5/day), code review
- **resilient-ask v2**: queue + rate-limit + 429 backoff + Kimi fallback
- **watcher**: 60s health check daemon, 6 rules
- **bus wiring**: evolve events broadcast through vfs.bus
- **flow/bus/deps**: infrastructure modules (debounce/throttle/retry, eventbus, dependency tracking)
- **vfs-remote**: Browser→Sandbox bridge, dual-write support (NEW Session 8)
- **Sandbox VFS KV API**: SQLite-backed REST API on Sandbox (NEW Session 8)

## Key Configs
- evolve default model: gpt-5-4 (changed from claude-opus-4-6)
- AI opportunities: moonshot-v1-8k (fast, ~7s) with system prompt for JSON-only
- Kimi API: sk-EB4UEHdVBmfvqjPJB8WIu6UJ9E1cplgtyByFvmG56E9BLAEe @ api.moonshot.ai
- askSandbox pid: 86a200ed-5230-455b-9e6d-a3ba2d95ae3c
- Sandbox VFS URL: https://3000-isjad10r8glpogdbe5r7n-02b9cc79.sandbox.novita.ai

## Sandbox VFS KV API (Session 8)
- Express + better-sqlite3 on Sandbox (4-core 8GB)
- Tables: vfs_slots (name/content/description) + vfs_messages (slot/key/value)
- Endpoints: /vfs/ls, /vfs/read/:name, /vfs/write/:name, /vfs/append/:name
- Messages: /vfs/msg/:slot, /vfs/msg/:slot/:key (GET/POST/DELETE)
- Bulk: /vfs/bulk-read, /vfs/full/:name, /vfs/backup, /vfs/restore
- Stats: /vfs/stats → {slots, messages, slotSizeBytes, msgSizeBytes}
- CORS enabled, 10MB JSON limit
- Data synced: 8 slots (28.9KB) + 297 messages (327.9KB)

## vfsRemote Bridge (Session 8)
- window.vfsRemote: 19 methods matching VFS API
- ls/read/write/append/deleteSlot
- listMsg/readMsg/writeMsg/deleteMsg
- bulkRead/full/stats/backup/restore
- syncSlot/syncMsg/syncAll (VFS→Sandbox)
- dualWrite/dualWriteMsg (write both simultaneously)

## fn Modules (38+)
Core: header, genspark-api, dom-helper, file-ops, format, hash, template
VFS: vfs-query, vfs-search, vfs-loader, vfs-meta, vfs-exec-file, vfs-dashboard, vfs-health
Evolve: vfs-self-evolve, vfs-validate, vfs-evolve-scheduler, vfs-evolve-log, vfs-evolve-stats
Infra: vfs-constitution, vfs-ai-opportunities, vfs-bus-wiring, vfs-flow-control, vfs-eventbus, vfs-deps
AI-generated: vfs-uptime, vfs-slotsize, vfs-math, vfs-dice, vfs-cache(pending)
Bridge: vfs-remote (NEW)
Sandbox: resilient-ask

## Next Steps
1. Sandbox-side sync endpoint (/vfs/sync-verify) for diff-based sync
2. Auto-sync daemon (periodic VFS→Sandbox backup)
3. Evolve → Kimi direct path (bypass askSandbox)
4. Scheduler auto-start on page load
5. VFS Dashboard on Sandbox (web UI for data management)
6. ntfy push notifications for evolve events
7. Consider: can evolve improve evolve itself? (with constitution protection)

## Known Issues
- askSandbox through Genspark API is slow (60-90s), Kimi direct fetch is faster (~5-10s)
- vfs.evolve default model changed to gpt-5-4 but still goes through askSandbox
- Page slows down after ~400+ messages (DOM node count, not content size)
- deleteMsg may not work reliably (ghost modules reappear)
- vfs-exec.sh 45s often hits SIGTERM on large sync batches
- fn slot batch 62-93 had 9 failed msgs (likely empty/ghost modules)
