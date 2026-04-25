#!/usr/bin/env python3
"""Auto-tag reusable commands with semantic keywords for retrieval."""
import sqlite3, re, json

DB = '/Users/yay/workspace/genspark-agent/server-v2/data/agent.db'
db = sqlite3.connect(DB)

# Check if tags column exists
cols = [r[1] for r in db.execute('PRAGMA table_info(commands)').fetchall()]
if 'tags' not in cols:
    db.execute('ALTER TABLE commands ADD COLUMN tags TEXT')
    print('Added tags column')
else:
    print('tags column exists')

# Tag rules: extract semantic tags from params + result
def auto_tag(params, result, tool):
    p = (params or '').lower()
    r = (result or '').lower()
    tags = set()
    
    # Tool type
    tags.add(tool)
    
    # Domain
    if any(w in p for w in ['newzik', 'annotation', 'fingering', 'smart_annotator', 'omr', 'music']):
        tags.add('newzik')
    if any(w in p for w in ['intervention', 'gdmt', 'heart failure', 'hfref', 'abstract', 'article']):
        tags.add('research')
    if any(w in p for w in ['diffbot', 'crawler', 'scrape', 'fetch']):
        tags.add('scraping')
    if any(w in p for w in ['proxy.py', 'localhost:3001', 'bolt']):
        tags.add('proxy')
    if any(w in p for w in ['racquet', 'tennis', 'court']):
        tags.add('racquetdesk')
    
    # Action type
    if any(w in p for w in ['sqlite3', 'agent.db', 'db_query', '.db']):
        tags.add('database')
    if any(w in p for w in ['git commit', 'git push', 'git add']):
        tags.add('git')
    if any(w in p for w in ['ssh ', 'oracle', '150.136', '157.151']):
        tags.add('ssh')
    if any(w in p for w in ['nohup', 'lsof', 'kill -9', 'systemctl', 'pm2']):
        tags.add('process-mgmt')
    if any(w in p for w in ['curl ', 'api.', 'https://']):
        tags.add('api')
    if 'pragma' in p or 'create table' in p or 'alter table' in p:
        tags.add('schema')
    if any(w in p for w in ['group by', 'join ', 'case when', 'having', 'union']):
        tags.add('complex-query')
    
    # Tech
    if '.py' in p:
        tags.add('python')
    if '.cjs' in p or '.js' in p or 'node ' in p:
        tags.add('node')
    if '.sh' in p or 'bash ' in p:
        tags.add('bash')
    
    # Pattern
    if any(w in p for w in ['extract', 'parse', 'html.parser', 'beautifulsoup', 'regex']):
        tags.add('extract')
    if any(w in p for w in ['ingest', 'import', 'insert into', 'pipeline']):
        tags.add('ingest')
    if any(w in p for w in ['clean', 'fix', 'repair', 'update ', 'migrate']):
        tags.add('cleanup')
    if any(w in p for w in ['backup', 'dump', 'export']):
        tags.add('backup')
    if any(w in p for w in ['search', 'find', 'grep', 'locate']):
        tags.add('search')
    if tool == 'memory' or tool == 'local_store':
        tags.add('knowledge')
    if tool == 'vfs_local_write':
        tags.add('file-create')
    
    return ','.join(sorted(tags))

# Process all reusable commands
rows = db.execute('SELECT id, tool, params, result_preview FROM commands WHERE reusable=1').fetchall()
print(f'Tagging {len(rows)} reusable commands...')

tag_counts = {}
for rid, tool, params, result in rows:
    tags = auto_tag(params, result, tool)
    db.execute('UPDATE commands SET tags=? WHERE id=?', (tags, rid))
    for t in tags.split(','):
        tag_counts[t] = tag_counts.get(t, 0) + 1

db.commit()

# Print tag distribution
print(f'\n=== TAG DISTRIBUTION ===')
for tag, cnt in sorted(tag_counts.items(), key=lambda x: -x[1]):
    print(f'  {tag}: {cnt}')

# Build search index as JSON for compress injection
index = {}
rows2 = db.execute('SELECT id, tool, tags, substr(params,1,200), substr(result_preview,1,80) FROM commands WHERE reusable=1 ORDER BY id DESC').fetchall()
for rid, tool, tags, params, result in rows2:
    for tag in (tags or '').split(','):
        if tag not in index:
            index[tag] = []
        if len(index[tag]) < 5:  # max 5 per tag for compact index
            index[tag].append({'id': rid, 'tool': tool, 'hint': params[:80]})

# Save index to local_store
index_json = json.dumps(index, indent=2)
db.execute("INSERT OR REPLACE INTO local_store (slot, key, content, updated_at) VALUES ('index', 'reusable-commands', ?, datetime('now'))", (index_json,))
db.commit()
db.close()

print(f'\nSearch index saved to local_store[index/reusable-commands]')
print(f'Index size: {len(index_json)} chars, {len(index)} tags')
print(f'\n=== USAGE: db_query "SELECT id,tool,tags,params FROM commands WHERE reusable=1 AND tags LIKE \'%keyword%\'" ===')
