#!/usr/bin/env python3
"""Reusable commands v2: categorize and mark by real utility patterns."""
import sqlite3, re, json

DB = '/Users/yay/workspace/genspark-agent/server-v2/data/agent.db'
db = sqlite3.connect(DB)

# Reset all
db.execute('UPDATE commands SET reusable=0')

categories = {
    'script_create': [],    # vfs_local_write creating .py/.cjs/.sh
    'diffbot_api': [],      # diffbot API calls (keep 1 template per type)
    'db_schema': [],        # CREATE/ALTER/PRAGMA
    'db_complex_query': [], # complex SELECT with JOIN/GROUP/CASE
    'git_ops': [],          # git commit/push
    'ssh_ops': [],          # SSH to oracle
    'memory_store': [],     # memory/local_store writes
    'server_ops': [],       # restart/status/nohup
    'newzik_toolkit': [],   # newzik-specific tools
    'web_scrape': [],       # crawler/web_search patterns
    'proxy_service': [],    # proxy.py and similar services
    'pipeline': [],         # multi-step data pipelines
}

rows = db.execute(
    'SELECT id, tool, params, success, result_preview, duration_ms FROM commands WHERE success=1 AND (result_preview IS NOT NULL AND length(result_preview) > 10) ORDER BY id'
).fetchall()

for rid, tool, params, success, result, dur in rows:
    p = params or ''
    r = result or ''
    
    # --- Script Creation ---
    if tool == 'vfs_local_write':
        if any(ext in p for ext in ['.py"', '.cjs"', '.sh"']):
            # Skip one-off update scripts (UPDATE ... WHERE id=specific)
            if 'UPDATE' in p and 'WHERE id=' in p and p.count('UPDATE') <= 2:
                continue
            categories['script_create'].append(rid)
    
    # --- Diffbot API (keep unique patterns only) ---
    if tool == 'run_process' and 'diffbot' in p:
        # Extract the API endpoint pattern
        if 'kg.diffbot' in p:
            pattern = 'knowledge_graph'
        elif 'api.diffbot' in p and 'analyze' in p:
            pattern = 'analyze'
        elif 'api.diffbot' in p and 'article' in p:
            pattern = 'article'
        else:
            pattern = 'other'
        # Only keep first of each pattern
        existing_patterns = []
        for eid in categories['diffbot_api']:
            ep = db.execute('SELECT params FROM commands WHERE id=?', (eid,)).fetchone()[0]
            if 'kg.diffbot' in ep: existing_patterns.append('knowledge_graph')
            elif 'analyze' in ep: existing_patterns.append('analyze')
            elif 'article' in ep: existing_patterns.append('article')
            else: existing_patterns.append('other')
        if pattern not in existing_patterns:
            categories['diffbot_api'].append(rid)
    
    # --- DB Schema ---
    if tool == 'db_query':
        if any(kw in p.upper() for kw in ['CREATE TABLE', 'ALTER TABLE', 'PRAGMA TABLE_INFO']):
            categories['db_schema'].append(rid)
        elif any(kw in p.upper() for kw in ['JOIN', 'GROUP BY', 'CASE WHEN', 'HAVING', 'UNION']):
            categories['db_complex_query'].append(rid)
    
    # --- Git Operations ---
    if tool == 'run_process' and 'git commit' in p:
        categories['git_ops'].append(rid)
    if tool == 'git_commit':
        categories['git_ops'].append(rid)
    
    # --- SSH Operations ---
    if tool == 'run_process' and ('ssh ' in p and ('oracle' in p or '150.136' in p)):
        categories['ssh_ops'].append(rid)
    if tool == 'oracle_run':
        categories['ssh_ops'].append(rid)
    
    # --- Memory/Store ---
    if tool in ('memory', 'local_store') and 'set' in p:
        categories['memory_store'].append(rid)
    
    # --- Server Ops ---
    if tool in ('server_restart', 'server_status'):
        categories['server_ops'].append(rid)
    if tool == 'run_process' and ('nohup' in p or 'lsof -ti:' in p):
        categories['server_ops'].append(rid)
    
    # --- Newzik ---
    if tool == 'run_process' and ('newzik' in p or 'annotation' in p or 'fingering' in p or 'smart_annotator' in p):
        if len(r) > 30:
            categories['newzik_toolkit'].append(rid)
    
    # --- Pipeline scripts (python with DB + API) ---
    if tool == 'run_process' and '.py' in p and ('sqlite3' in p or 'agent.db' in p or 'diffbot' in p):
        categories['pipeline'].append(rid)
    
    # --- Proxy/Service ---
    if tool == 'run_process' and ('proxy.py' in p or 'localhost:3001' in p):
        categories['proxy_service'].append(rid)

# Print summary
print('=== REUSABLE COMMAND INVENTORY ===')
total_marked = 0
for cat, ids in categories.items():
    if not ids:
        continue
    # For categories with many entries, keep latest N
    if cat == 'git_ops':
        keep = ids[-10:]  # last 10 commits
    elif cat == 'script_create':
        keep = ids[-30:]  # last 30 scripts
    elif cat == 'newzik_toolkit':
        keep = ids[-15:]
    elif cat == 'memory_store':
        keep = ids[-10:]
    elif cat == 'server_ops':
        keep = ids[-5:]
    elif cat in ('diffbot_api', 'db_schema'):
        keep = ids  # all (already deduped)
    elif cat == 'db_complex_query':
        keep = ids[-15:]
    elif cat == 'ssh_ops':
        keep = ids[-5:]
    elif cat == 'proxy_service':
        keep = ids[-3:]
    elif cat == 'pipeline':
        keep = ids[-10:]
    else:
        keep = ids[-10:]
    
    print(f'\n[{cat}] {len(ids)} found, marking {len(keep)}')
    for kid in keep[:5]:  # show first 5
        row = db.execute('SELECT substr(params,1,100), substr(result_preview,1,60) FROM commands WHERE id=?', (kid,)).fetchone()
        print(f'  #{kid}: {row[0][:80]}... → {row[1][:50]}')
    if len(keep) > 5:
        print(f'  ... and {len(keep)-5} more')
    
    for kid in keep:
        db.execute('UPDATE commands SET reusable=1 WHERE id=?', (kid,))
        total_marked += 1

db.commit()
db.close()
print(f'\n=== TOTAL MARKED REUSABLE: {total_marked} ===')
