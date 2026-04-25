#!/usr/bin/env python3
"""Scan commands table, score reusability, mark high-value commands."""
import sqlite3, re, json

DB = '/Users/yay/workspace/genspark-agent/server-v2/data/agent.db'
db = sqlite3.connect(DB)

# Scoring criteria
def score_command(row):
    rid, tool, params, success, result, duration, session_id = row
    s = 0
    reasons = []
    
    if not success:
        return 0, ['failed']
    if not result or len(result.strip()) < 10:
        return 0, ['empty result']
    
    p = params or ''
    r = result or ''
    
    # === Tool-specific scoring ===
    
    # Scripts (python/node/bash) that produced real output
    if tool == 'run_process':
        if '.py ' in p or '.py\"' in p or '.py 2' in p:
            s += 3; reasons.append('python script')
        if '.cjs ' in p or '.cjs\"' in p:
            s += 3; reasons.append('node script')
        if '.sh ' in p or '.sh\"' in p:
            s += 2; reasons.append('bash script')
        # API patterns (diffbot, curl)
        if 'curl' in p and 'diffbot' in p:
            s += 4; reasons.append('diffbot API')
        if 'curl' in p and 'api' in p.lower():
            s += 3; reasons.append('API call')
        # DB operations
        if 'sqlite3' in p or 'agent.db' in p:
            s += 2; reasons.append('DB operation')
        # Git operations
        if 'git ' in p:
            s += 2; reasons.append('git operation')
        # Server/infra
        if 'ssh ' in p:
            s += 3; reasons.append('SSH')
        if 'nohup' in p or 'bg_run' in p:
            s += 2; reasons.append('background task')
        # Penalize one-off debug commands
        if p.startswith('{"command_line":"echo ') and '&&' not in p:
            s -= 2; reasons.append('simple echo')
        if 'cat ' in p and '|' not in p and '&&' not in p:
            s -= 1; reasons.append('simple cat')
        if 'ls ' in p and '|' not in p and '&&' not in p:
            s -= 1; reasons.append('simple ls')
    
    elif tool == 'db_query':
        if 'CREATE TABLE' in p or 'ALTER TABLE' in p:
            s += 5; reasons.append('schema change')
        elif 'PRAGMA' in p:
            s += 3; reasons.append('schema inspection')
        elif 'INSERT' in p or 'UPDATE' in p:
            s += 2; reasons.append('data write')
        elif 'SELECT' in p and ('JOIN' in p or 'GROUP BY' in p or 'CASE WHEN' in p):
            s += 3; reasons.append('complex query')
        else:
            s += 1; reasons.append('simple query')
    
    elif tool == 'vfs_local_write':
        if '.py' in p:
            s += 4; reasons.append('python script created')
        elif '.cjs' in p or '.js' in p:
            s += 4; reasons.append('node script created')
        elif '.sh' in p:
            s += 3; reasons.append('bash script created')
        elif '.md' in p:
            s += 2; reasons.append('doc created')
        elif '.json' in p:
            s += 2; reasons.append('config created')
        else:
            s += 1
    
    elif tool in ('git_commit',):
        s += 3; reasons.append('git commit')
    
    elif tool in ('memory', 'local_store'):
        s += 3; reasons.append('knowledge stored')
    
    elif tool == 'web_search':
        s += 1; reasons.append('search')
    
    elif tool == 'crawler':
        if len(r) > 200:
            s += 2; reasons.append('content fetched')
    
    elif tool in ('server_restart', 'server_status'):
        s += 2; reasons.append('infra')
    
    elif tool == 'ask_ai':
        if len(r) > 100:
            s += 2; reasons.append('AI response')
    
    # === Result quality bonus ===
    if len(r) > 500:
        s += 1; reasons.append('rich output')
    if len(r) > 2000:
        s += 1; reasons.append('very rich output')
    
    # === Duration bonus (complex work) ===
    if duration and duration > 5000:
        s += 1; reasons.append('long-running')
    
    return max(s, 0), reasons

# Scan all commands
rows = db.execute(
    'SELECT id, tool, params, success, result_preview, duration_ms, session_id FROM commands ORDER BY id'
).fetchall()

scored = []
for row in rows:
    sc, reasons = score_command(row)
    if sc >= 4:
        scored.append((row[0], row[1], sc, reasons))

# Sort by score desc
scored.sort(key=lambda x: -x[2])

print(f'Total commands: {len(rows)}')
print(f'Score >= 4 (reusable candidates): {len(scored)}')
print(f'Score >= 6 (high value): {sum(1 for _,_,s,_ in scored if s >= 6)}')
print(f'Score >= 8 (gold): {sum(1 for _,_,s,_ in scored if s >= 8)}')

# Show top 30
print(f'\n=== TOP 30 ===')
for rid, tool, sc, reasons in scored[:30]:
    print(f'  #{rid} [{tool}] score={sc} | {", ".join(reasons)}')

# Mark reusable (score >= 5)
marked = 0
for rid, tool, sc, reasons in scored:
    if sc >= 5:
        db.execute('UPDATE commands SET reusable=1 WHERE id=?', (rid,))
        marked += 1

db.commit()
db.close()
print(f'\n=== Marked {marked} commands as reusable ===')
