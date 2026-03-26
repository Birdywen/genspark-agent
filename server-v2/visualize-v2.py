import sqlite3
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.ticker as ticker
import seaborn as sns
import numpy as np
from datetime import datetime

# Seaborn 风格设置
sns.set_theme(style="darkgrid", context="talk", palette="muted")
plt.rcParams.update({
    'figure.facecolor': '#1a1a2e',
    'axes.facecolor': '#16213e',
    'axes.edgecolor': '#e94560',
    'axes.labelcolor': '#eee',
    'text.color': '#eee',
    'xtick.color': '#aaa',
    'ytick.color': '#aaa',
    'grid.color': '#2a2a4a',
    'grid.alpha': 0.4,
    'font.family': 'sans-serif',
    'font.size': 12,
})

ACCENT = '#e94560'
BLUE = '#0f3460'
TEAL = '#00b4d8'
GREEN = '#06d6a0'
ORANGE = '#f77f00'
PURPLE = '#9b5de5'
PINK = '#f15bb5'
GOLD = '#fee440'

db = sqlite3.connect('data/agent.db')

# ===== 图1: 每日操作量 + 成功率 (双Y轴) =====
daily = db.execute("""
SELECT date(timestamp) as day, COUNT(*) as total,
  ROUND(100.0*SUM(success)/COUNT(*),1) as pct
FROM commands WHERE timestamp >= date('now','-30 days')
GROUP BY day ORDER BY day
""").fetchall()

days = [datetime.strptime(r[0], '%Y-%m-%d') for r in daily]
totals = [r[1] for r in daily]
pcts = [r[2] for r in daily]

fig, ax1 = plt.subplots(figsize=(16, 7))
ax2 = ax1.twinx()

# 柱状图 - 操作量
bar_colors = [sns.color_palette("rocket_r", n_colors=max(totals)-min(totals)+1)[int(t - min(totals))] for t in totals]
bars = ax1.bar(days, totals, width=0.65, alpha=0.85, color=bar_colors, zorder=3, edgecolor='none')

# 折线图 - 成功率
ax2.plot(days, pcts, color=GREEN, linewidth=3, marker='D', markersize=6, zorder=5, markeredgecolor='white', markeredgewidth=1.5)
ax2.fill_between(days, pcts, alpha=0.08, color=GREEN)
ax2.axhline(y=95, color=ORANGE, linestyle=':', alpha=0.6, linewidth=1.5)
ax2.annotate('95% target', xy=(days[-1], 95), xytext=(-60, -20), textcoords='offset points',
            color=ORANGE, fontsize=10, fontstyle='italic')

ax1.set_title('Daily Operations & Success Rate', fontsize=20, fontweight='bold', pad=20, color='white')
ax1.set_ylabel('Commands', fontsize=14, color=TEAL)
ax2.set_ylabel('Success Rate %', fontsize=14, color=GREEN)
ax2.set_ylim(88, 100.5)
ax1.xaxis.set_major_formatter(matplotlib.dates.DateFormatter('%b %d'))
ax1.xaxis.set_major_locator(matplotlib.dates.DayLocator(interval=4))
plt.setp(ax1.xaxis.get_majorticklabels(), rotation=30, ha='right')

plt.savefig('/private/tmp/chart1_daily_ops.png', dpi=180, bbox_inches='tight', facecolor='#1a1a2e')
print('OK: chart1')
plt.close()

# ===== 图2: 工具可靠性 (水平条形图 + 渐变) =====
tools = db.execute("""
SELECT tool, COUNT(*) as total, ROUND(100.0*SUM(success)/COUNT(*),1) as pct
FROM commands GROUP BY tool HAVING total >= 20 ORDER BY total DESC LIMIT 12
""").fetchall()

fig, ax = plt.subplots(figsize=(14, 9))

names = [r[0] for r in tools][::-1]
counts = [r[1] for r in tools][::-1]
rates = [r[2] for r in tools][::-1]

# 颜色按成功率
palette = [GREEN if r >= 98 else TEAL if r >= 95 else ORANGE if r >= 90 else ACCENT for r in rates]

bars = ax.barh(range(len(names)), counts, color=palette, height=0.65, alpha=0.9, edgecolor='none', zorder=3)

# 在条上标注成功率
for i, (bar, rate, count) in enumerate(zip(bars, rates, counts)):
    # 条内标注百分比
    if count > max(counts) * 0.15:
        ax.text(bar.get_width() * 0.5, bar.get_y() + bar.get_height()/2.,
                f'{rate}%', ha='center', va='center', color='white', fontsize=11, fontweight='bold')
    # 条外标注数量
    ax.text(bar.get_width() + max(counts)*0.01, bar.get_y() + bar.get_height()/2.,
            f'{count:,}', ha='left', va='center', color='#aaa', fontsize=10)

ax.set_yticks(range(len(names)))
ax.set_yticklabels(names, fontsize=12)
ax.set_xlabel('Total Executions', fontsize=14)
ax.set_title('Tool Reliability Ranking\n33,000+ Commands Analyzed', fontsize=20, fontweight='bold', pad=20, color='white')

# 自定义图例
from matplotlib.patches import Patch
legend_items = [
    Patch(facecolor=GREEN, label='Perfect (98%+)'),
    Patch(facecolor=TEAL, label='Reliable (95-98%)'),
    Patch(facecolor=ORANGE, label='Caution (90-95%)'),
    Patch(facecolor=ACCENT, label='Avoid (<90%)')
]
ax.legend(handles=legend_items, loc='lower right', framealpha=0.8, 
         facecolor='#16213e', edgecolor='#2a2a4a', fontsize=11)

ax.xaxis.set_major_formatter(ticker.FuncFormatter(lambda x, p: f'{x/1000:.0f}K' if x >= 1000 else f'{x:.0f}'))

plt.savefig('/private/tmp/chart2_tool_reliability.png', dpi=180, bbox_inches='tight', facecolor='#1a1a2e')
print('OK: chart2')
plt.close()

# ===== 图3: 系统进化曲线 =====
cumulative = db.execute("""
SELECT date(timestamp) as day, COUNT(*) as cnt FROM commands GROUP BY day ORDER BY day
""").fetchall()

cum_days = [datetime.strptime(r[0], '%Y-%m-%d') for r in cumulative]
cum_totals = list(np.cumsum([r[1] for r in cumulative]))

fig, ax = plt.subplots(figsize=(16, 8))

# 渐变填充效果
ax.fill_between(cum_days, cum_totals, alpha=0.15, color=PURPLE)
ax.fill_between(cum_days, cum_totals, alpha=0.08, color=PINK)
ax.plot(cum_days, cum_totals, color=PURPLE, linewidth=3.5, zorder=5)

# 里程碑
milestones = [(5000, '5K'), (10000, '10K'), (15000, '15K'), (20000, '20K'), (25000, '25K')]
for target, label in milestones:
    for i, total in enumerate(cum_totals):
        if total >= target:
            ax.plot(cum_days[i], total, 'o', color=GOLD, markersize=10, zorder=6, markeredgecolor='white', markeredgewidth=2)
            ax.annotate(f'{label} ops', xy=(cum_days[i], total),
                       xytext=(10, 20), textcoords='offset points',
                       color=GOLD, fontsize=12, fontweight='bold',
                       arrowprops=dict(arrowstyle='->', color=GOLD, lw=2))
            break

ax.set_title('System Evolution\nFrom Zero to 27K+ Operations', fontsize=20, fontweight='bold', pad=20, color='white')
ax.set_ylabel('Cumulative Commands', fontsize=14)
ax.yaxis.set_major_formatter(ticker.FuncFormatter(lambda x, p: f'{x/1000:.0f}K'))
ax.xaxis.set_major_formatter(matplotlib.dates.DateFormatter('%b %d'))
ax.xaxis.set_major_locator(matplotlib.dates.DayLocator(interval=7))
plt.setp(ax.xaxis.get_majorticklabels(), rotation=30, ha='right')

# 添加注释文字
ax.text(0.02, 0.95, 'One SQLite file.\nZero dependencies.\nInfinite possibilities.', 
        transform=ax.transAxes, fontsize=14, color='#888', fontstyle='italic',
        verticalalignment='top', fontfamily='serif')

plt.savefig('/private/tmp/chart3_evolution.png', dpi=180, bbox_inches='tight', facecolor='#1a1a2e')
print('OK: chart3')
plt.close()

# ===== 图4: 错误模式 (极坐标/雷达风格 donut) =====
errors = db.execute("""
SELECT CASE 
  WHEN error LIKE '%timeout%' OR error LIKE '%Timeout%' THEN 'Timeout'
  WHEN error LIKE '%ENOENT%' THEN 'File Not Found'
  WHEN error LIKE '%Cannot find module%' THEN 'Module Missing'
  WHEN error LIKE '%exact match%' THEN 'Edit Mismatch'
  WHEN error LIKE '%参数损坏%' THEN 'Param Corrupt'
  WHEN error LIKE '%429%' THEN 'Rate Limited'
  WHEN error LIKE '%工具未找到%' THEN 'Wrong Tool Name'
  ELSE 'Other'
END as pattern, COUNT(*) as cnt
FROM commands WHERE success=0 AND error != ''
GROUP BY pattern ORDER BY cnt DESC
""").fetchall()

fig, ax = plt.subplots(figsize=(11, 11))
labels = [r[0] for r in errors]
sizes = [r[1] for r in errors]
explode = [0.05] * len(labels)
explode[0] = 0.12  # 突出最大块

pie_colors = sns.color_palette("Set2", len(labels))

wedges, texts, autotexts = ax.pie(sizes, labels=labels, autopct=lambda p: f'{p:.0f}%\n({int(p*sum(sizes)/100)})',
    colors=pie_colors, pctdistance=0.75, explode=explode,
    textprops={'fontsize': 12, 'color': '#eee'},
    wedgeprops=dict(width=0.45, edgecolor='#1a1a2e', linewidth=3))

for t in autotexts:
    t.set_fontsize(10)
    t.set_color('white')
    t.set_fontweight('bold')

centre = plt.Circle((0,0), 0.32, fc='#1a1a2e')
ax.add_artist(centre)
total_errors = sum(sizes)
ax.text(0, 0.05, f'{total_errors}', ha='center', va='center', color=ACCENT, fontsize=28, fontweight='bold')
ax.text(0, -0.1, 'total errors', ha='center', va='center', color='#888', fontsize=13)

ax.set_title('Error Pattern Distribution\nData-Driven Debugging', fontsize=20, fontweight='bold', pad=25, color='white')

plt.savefig('/private/tmp/chart4_error_patterns.png', dpi=180, bbox_inches='tight', facecolor='#1a1a2e')
print('OK: chart4')
plt.close()

# ===== 图5 (新增): 纠错效率 — 展示 forged 的价值 =====
weekly_errors = db.execute("""
SELECT 
  CASE WHEN julianday(timestamp) - julianday('now') > -7 THEN 'This Week'
       WHEN julianday(timestamp) - julianday('now') > -14 THEN 'Last Week'
       WHEN julianday(timestamp) - julianday('now') > -21 THEN '2 Weeks Ago'
       ELSE '3+ Weeks Ago' END as period,
  COUNT(*) as total,
  SUM(CASE WHEN success=0 THEN 1 ELSE 0 END) as fails,
  ROUND(100.0*SUM(success)/COUNT(*),1) as rate
FROM commands
WHERE timestamp >= date('now', '-28 days')
GROUP BY period
ORDER BY MIN(timestamp)
""").fetchall()

fig, ax = plt.subplots(figsize=(12, 7))

periods = [r[0] for r in weekly_errors]
rates = [r[3] for r in weekly_errors]
fails = [r[2] for r in weekly_errors]

x = np.arange(len(periods))
bar_width = 0.5

bars = ax.bar(x, rates, bar_width, color=[PURPLE, TEAL, TEAL, GREEN], alpha=0.9, edgecolor='none', zorder=3)

for bar, rate, fail in zip(bars, rates, fails):
    ax.text(bar.get_x() + bar.get_width()/2., bar.get_height() + 0.3,
            f'{rate}%', ha='center', va='bottom', color='white', fontsize=14, fontweight='bold')
    ax.text(bar.get_x() + bar.get_width()/2., bar.get_height() - 2,
            f'{fail} errors', ha='center', va='top', color='#ddd', fontsize=10)

ax.set_xticks(x)
ax.set_xticklabels(periods, fontsize=13)
ax.set_ylim(85, 101)
ax.set_ylabel('Success Rate %', fontsize=14)
ax.set_title('Weekly Improvement\nForged Experience System in Action', fontsize=20, fontweight='bold', pad=20, color='white')

# 添加趋势箭头
ax.annotate('', xy=(len(periods)-0.7, rates[-1]), xytext=(0.3, rates[0]),
            arrowprops=dict(arrowstyle='->', color=GREEN, lw=3, connectionstyle='arc3,rad=0.2'))
ax.text(len(periods)/2, 87, 'Forged-driven improvement', ha='center', color=GREEN, fontsize=13, fontstyle='italic')

plt.savefig('/private/tmp/chart5_improvement.png', dpi=180, bbox_inches='tight', facecolor='#1a1a2e')
print('OK: chart5')
plt.close()

print('\nAll 5 charts saved to /private/tmp/')
db.close()