import json, sys, subprocess

result = subprocess.run(['node', 'dbfile.cjs', 'get', 'memory', 'toolkit', '_forged:experience-dialogues'], capture_output=True, text=True)
msgs = json.loads(result.stdout)
content = msgs[1]['content']

checks = [
    ('BATCH语法', 'HEREBATCH'),
    ('写文件规则', 'vfs_local_write'),
    ('工具可靠性', 'run_command'),
    ('node模块陷阱', 'require()'),
    ('编码问题', 'base64'),
    ('edit_file规则', 'edit_file'),
    ('server重启', 'watchdog'),
    ('dbfile.cjs', 'dbfile.cjs'),
    ('端口表', '8767'),
    ('压缩规则', 'COMPRESS'),
    ('参数损坏', 'PARAM_CORRUPT'),
    ('RATE_LIMIT', '429'),
    ('TIMEOUT', 'timeout'),
]

print("=== Forged 覆盖度审计 ===\n")

# 错误模式
r2 = subprocess.run(['sqlite3', 'data/agent.db',
    "SELECT CASE WHEN error LIKE '%参数损坏%' THEN 'PARAM_CORRUPT' WHEN error LIKE '%ENOENT%' THEN 'ENOENT' WHEN error LIKE '%Cannot find module%' THEN 'MODULE_NOT_FOUND' WHEN error LIKE '%exact match%' THEN 'EDIT_MISMATCH' WHEN error LIKE '%timeout%' OR error LIKE '%Timeout%' THEN 'TIMEOUT' WHEN error LIKE '%429%' THEN 'RATE_LIMIT' WHEN error LIKE '%工具未找到%' THEN 'TOOL_NOT_FOUND' ELSE 'OTHER' END as p, COUNT(*) as c FROM commands WHERE success=0 AND error!='' AND timestamp>=date('now','-30 days') GROUP BY p ORDER BY c DESC"
], capture_output=True, text=True)
print("--- 30天 Top 错误模式 ---")
print(r2.stdout)

print("--- Forged 覆盖检查 ---")
covered = 0
for name, keyword in checks:
    has = keyword.lower() in content.lower()
    covered += int(has)
    mark = 'Y' if has else 'X'
    print(f"  [{mark}] {name} ({keyword})")

pct = round(100 * covered / len(checks))
print(f"\n覆盖率: {covered}/{len(checks)} ({pct}%)")
missing = [name for name, kw in checks if kw.lower() not in content.lower()]
if missing:
    print(f"建议补充: {', '.join(missing)}")