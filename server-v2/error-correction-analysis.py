import subprocess, json, re
from collections import defaultdict

# 查最近30天的失败->成功序列
result = subprocess.run(['sqlite3', '-json', 'data/agent.db', """
SELECT id, timestamp, tool, success, 
  substr(params,1,300) as params,
  substr(CASE WHEN success=0 THEN error ELSE result END, 1,200) as detail
FROM commands 
WHERE timestamp >= date('now','-30 days')
  AND tool IN ('run_process','edit_file','vfs_local_write','write_file','ssh-oracle:exec')
ORDER BY id
"""], capture_output=True, text=True, cwd='/Users/yay/workspace/genspark-agent/server-v2')

rows = json.loads(result.stdout)
print(f"分析 {len(rows)} 条记录...\n")

# 找纠错序列：同工具连续失败后成功
sequences = []
i = 0
while i < len(rows):
    if rows[i]['success'] == 0:
        # 开始一个失败序列
        seq_start = i
        tool = rows[i]['tool']
        fails = []
        while i < len(rows) and rows[i]['success'] == 0 and rows[i]['tool'] == tool:
            fails.append(rows[i])
            i += 1
        # 看后面5条内有没有同工具的成功
        success = None
        for j in range(i, min(i+5, len(rows))):
            if rows[j]['tool'] == tool and rows[j]['success'] == 1:
                success = rows[j]
                break
        if success and len(fails) >= 2:
            sequences.append({'fails': fails, 'success': success, 'attempts': len(fails)})
    else:
        i += 1

print(f"=== 找到 {len(sequences)} 个纠错序列 (2次+失败后成功) ===\n")

# 按尝试次数排序，最艰难的在前
sequences.sort(key=lambda x: -x['attempts'])

# 分析纠错模式
patterns = defaultdict(list)
for seq in sequences[:30]:  # top 30
    first_err = seq['fails'][0]['detail']
    last_err = seq['fails'][-1]['detail']
    fix = seq['success']['params']
    
    # 归类错误模式
    if 'ENOENT' in first_err:
        cat = 'PATH_FIX(路径修复)'
    elif 'Cannot find module' in first_err:
        cat = 'MODULE_FIX(模块路径)'
    elif 'exact match' in first_err:
        cat = 'EDIT_RETRY(编辑重试)'
    elif 'permission' in first_err.lower() or 'EACCES' in first_err:
        cat = 'PERMISSION_FIX'
    elif 'syntax' in first_err.lower():
        cat = 'SYNTAX_FIX(语法修复)'
    elif '参数损坏' in first_err:
        cat = 'PARAM_FIX(参数修复)'
    elif 'timeout' in first_err.lower():
        cat = 'TIMEOUT_RETRY'
    else:
        cat = 'OTHER'
    patterns[cat].append(seq)

print("=== 纠错模式分类 ===\n")
for cat, seqs in sorted(patterns.items(), key=lambda x: -len(x[1])):
    print(f"[{cat}] {len(seqs)}次")
    # 展示最典型的案例（尝试次数最多的）
    worst = max(seqs, key=lambda x: x['attempts'])
    print(f"  最艰难案例: {worst['attempts']}次失败后成功")
    print(f"  首次错误: {worst['fails'][0]['detail'][:100]}")
    print(f"  最终错误: {worst['fails'][-1]['detail'][:100]}")
    print(f"  成功方案: {worst['success']['params'][:120]}")
    print()

print("=== 最艰难的 Top 10 纠错 ===\n")
for i, seq in enumerate(sequences[:10]):
    print(f"#{i+1} [{seq['attempts']}次失败] {seq['fails'][0]['tool']}")
    print(f"  时间: {seq['fails'][0]['timestamp']}")
    print(f"  首错: {seq['fails'][0]['detail'][:100]}")
    print(f"  末错: {seq['fails'][-1]['detail'][:100]}")
    print(f"  修复: {seq['success']['params'][:150]}")
    print()