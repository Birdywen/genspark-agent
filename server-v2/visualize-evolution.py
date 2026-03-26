import subprocess, json, sqlite3
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from datetime import datetime

# 直连 DB
db = sqlite3.connect('data/agent.db')

# 1. 每日操作量 + 成功率趋势
daily = db.execute("""
SELECT date(timestamp) as day, 
  COUNT(*) as total,
  SUM(CASE WHEN success=1 THEN 1 ELSE 0 END) as ok,
  ROUND(100.0*SUM(success)/COUNT(*),1) as pct
FROM commands 
WHERE timestamp >= date('now','-30 days')
GROUP BY day ORDER BY day
""").fetchall()

days = [datetime.strptime(r[0], '%Y-%m-%d') for r in daily]
totals = [r[1] for r in daily]
pcts = [r[3] for r in daily]

fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(14, 10), gridspec_kw={'hspace': 0.3})
fig.patch.set_facecolor('#0d1117')

# 图1: 每日操作量
ax1.set_facecolor('#0d1117')
bars = ax1.bar(days, totals, color='#58a6ff', alpha=0.8, width=0.7)
ax1.set_title('Daily Operations Volume (30 Days)', color='white', fontsize=16, fontweight='bold', pad=15)
ax1.set_ylabel('Commands', color='white', fontsize=12)
ax1.tick_params(colors='white')
ax1.spines['bottom'].set_color('#30363d')
ax1.spines['left'].set_color('#30363d')
ax1.spines['top'].set_visible(False)
ax1.spines['right'].set_visible(False)
ax1.xaxis.set_major_formatter(mdates.DateFormatter('%m/%d'))
ax1.xaxis.set_major_locator(mdates.DayLocator(interval=3))
for bar, total in zip(bars, totals):
    if total > 1000:
        ax1.text(bar.get_x() + bar.get_width()/2., bar.get_height() + 20, 
                str(total), ha='center', va='bottom', color='#58a6ff', fontsize=8)

# 图2: 成功率趋势
ax2.set_facecolor('#0d1117')
ax2.plot(days, pcts, color='#3fb950', linewidth=2.5, marker='o', markersize=5, zorder=5)
ax2.fill_between(days, pcts, alpha=0.15, color='#3fb950')
ax2.axhline(y=95, color='#f0883e', linestyle='--', alpha=0.5, label='95% target')
ax2.set_title('Success Rate Trend', color='white', fontsize=16, fontweight='bold', pad=15)
ax2.set_ylabel('Success %', color='white', fontsize=12)
ax2.set_ylim(85, 100)
ax2.tick_params(colors='white')
ax2.spines['bottom'].set_color('#30363d')
ax2.spines['left'].set_color('#30363d')
ax2.spines['top'].set_visible(False)
ax2.spines['right'].set_visible(False)
ax2.xaxis.set_major_formatter(mdates.DateFormatter('%m/%d'))
ax2.xaxis.set_major_locator(mdates.DayLocator(interval=3))
ax2.legend(loc='lower right', facecolor='#0d1117', edgecolor='#30363d', labelcolor='white')

plt.savefig('/private/tmp/chart1_daily_ops.png', dpi=150, bbox_inches='tight', facecolor='#0d1117')
print('OK: chart1_daily_ops.png')
plt.close()

# 2. 工具可靠性排行 (Top 15)
tools = db.execute("""
SELECT tool, COUNT(*) as total, 
  ROUND(100.0*SUM(success)/COUNT(*),1) as pct
FROM commands 
GROUP BY tool HAVING total >= 10
ORDER BY total DESC LIMIT 15
""").fetchall()

fig, ax = plt.subplots(figsize=(14, 8))
fig.patch.set_facecolor('#0d1117')
ax.set_facecolor('#0d1117')

names = [r[0] for r in tools]
counts = [r[1] for r in tools]
rates = [r[2] for r in tools]

colors = ['#3fb950' if r >= 98 else '#58a6ff' if r >= 95 else '#f0883e' if r >= 90 else '#f85149' for r in rates]

y_pos = range(len(names))
bars = ax.barh(y_pos, counts, color=colors, alpha=0.85, height=0.6)
ax.set_yticks(y_pos)
ax.set_yticklabels(names, color='white', fontsize=11)
ax.invert_yaxis()
ax.set_title('Tool Reliability & Usage (33,000+ commands)', color='white', fontsize=16, fontweight='bold', pad=15)
ax.set_xlabel('Total Commands', color='white', fontsize=12)
ax.tick_params(colors='white')
ax.spines['bottom'].set_color('#30363d')
ax.spines['left'].set_color('#30363d')
ax.spines['top'].set_visible(False)
ax.spines['right'].set_visible(False)

for bar, rate, count in zip(bars, rates, counts):
    ax.text(bar.get_width() + max(counts)*0.01, bar.get_y() + bar.get_height()/2.,
            f'{rate}% ({count:,})', ha='left', va='center', color='white', fontsize=10)

# 图例
from matplotlib.patches import Patch
legend_elements = [
    Patch(facecolor='#3fb950', label='98%+ (Perfect)'),
    Patch(facecolor='#58a6ff', label='95-98% (Reliable)'),
    Patch(facecolor='#f0883e', label='90-95% (Needs attention)'),
    Patch(facecolor='#f85149', label='<90% (Avoid)')
]
ax.legend(handles=legend_elements, loc='lower right', facecolor='#0d1117', edgecolor='#30363d', labelcolor='white')

plt.savefig('/private/tmp/chart2_tool_reliability.png', dpi=150, bbox_inches='tight', facecolor='#0d1117')
print('OK: chart2_tool_reliability.png')
plt.close()

# 3. 系统进化时间线 - 累计操作数 + 里程碑
cumulative = db.execute("""
SELECT date(timestamp) as day, COUNT(*) as daily_total
FROM commands
GROUP BY day ORDER BY day
""").fetchall()

cum_days = [datetime.strptime(r[0], '%Y-%m-%d') for r in cumulative]
cum_totals = []
running = 0
for r in cumulative:
    running += r[1]
    cum_totals.append(running)

fig, ax = plt.subplots(figsize=(14, 7))
fig.patch.set_facecolor('#0d1117')
ax.set_facecolor('#0d1117')

ax.fill_between(cum_days, cum_totals, alpha=0.2, color='#bc8cff')
ax.plot(cum_days, cum_totals, color='#bc8cff', linewidth=2.5)

# 里程碑标注
milestones = {
    10000: '10K ops',
    20000: '20K ops', 
    30000: '30K ops',
}
for target, label in milestones.items():
    for i, total in enumerate(cum_totals):
        if total >= target:
            ax.annotate(label, xy=(cum_days[i], total), 
                       xytext=(15, 15), textcoords='offset points',
                       color='#f0883e', fontsize=11, fontweight='bold',
                       arrowprops=dict(arrowstyle='->', color='#f0883e', lw=1.5))
            break

ax.set_title('System Evolution: Cumulative Operations', color='white', fontsize=16, fontweight='bold', pad=15)
ax.set_ylabel('Total Commands', color='white', fontsize=12)
ax.tick_params(colors='white')
ax.spines['bottom'].set_color('#30363d')
ax.spines['left'].set_color('#30363d')
ax.spines['top'].set_visible(False)
ax.spines['right'].set_visible(False)
ax.xaxis.set_major_formatter(mdates.DateFormatter('%m/%d'))
ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda x, p: f'{x/1000:.0f}K'))

plt.savefig('/private/tmp/chart3_evolution.png', dpi=150, bbox_inches='tight', facecolor='#0d1117')
print('OK: chart3_evolution.png')
plt.close()

# 4. 错误模式分布 (Donut chart)
errors = db.execute("""
SELECT CASE 
  WHEN error LIKE '%timeout%' OR error LIKE '%Timeout%' THEN 'TIMEOUT'
  WHEN error LIKE '%ENOENT%' THEN 'FILE_NOT_FOUND'
  WHEN error LIKE '%Cannot find module%' THEN 'MODULE_NOT_FOUND'  
  WHEN error LIKE '%exact match%' THEN 'EDIT_MISMATCH'
  WHEN error LIKE '%参数损坏%' THEN 'PARAM_CORRUPT'
  WHEN error LIKE '%429%' THEN 'RATE_LIMIT'
  WHEN error LIKE '%工具未找到%' THEN 'TOOL_NOT_FOUND'
  ELSE 'OTHER'
END as pattern, COUNT(*) as cnt
FROM commands WHERE success=0 AND error != ''
GROUP BY pattern ORDER BY cnt DESC
""").fetchall()

fig, ax = plt.subplots(figsize=(10, 10))
fig.patch.set_facecolor('#0d1117')

labels = [r[0] for r in errors]
sizes = [r[1] for r in errors]
colors_pie = ['#f85149', '#f0883e', '#d2a8ff', '#58a6ff', '#3fb950', '#79c0ff', '#7ee787', '#8b949e']

wedges, texts, autotexts = ax.pie(sizes, labels=labels, autopct='%1.0f%%', 
    colors=colors_pie[:len(labels)], pctdistance=0.8,
    textprops={'color': 'white', 'fontsize': 11},
    wedgeprops=dict(width=0.5, edgecolor='#0d1117', linewidth=2))

for t in autotexts:
    t.set_fontsize(10)
    t.set_color('white')

centre_circle = plt.Circle((0,0), 0.35, fc='#0d1117')
ax.add_artist(centre_circle)
ax.text(0, 0, f'{sum(sizes)}\nerrors', ha='center', va='center', color='white', fontsize=16, fontweight='bold')

ax.set_title('Error Pattern Distribution (All Time)', color='white', fontsize=16, fontweight='bold', pad=20)

plt.savefig('/private/tmp/chart4_error_patterns.png', dpi=150, bbox_inches='tight', facecolor='#0d1117')
print('OK: chart4_error_patterns.png')
plt.close()

print('\nAll 4 charts saved to /private/tmp/')
print('Total commands analyzed: ' + str(cum_totals[-1]))

db.close()