# 已加载的 Skills

以下 Skills 已安装并可用。在执行相关任务时，请参考对应的 Skill 指南。

---

## chart-visualization

**描述**: 智能图表生成技能，支持 26+ 种图表类型

**使用场景**: 当用户需要数据可视化时

### 图表选择指南

根据数据特征选择最合适的图表：

| 数据类型 | 推荐图表 | 工具名 |
|---------|---------|--------|
| 时间趋势 | 折线图/面积图 | `generate_line_chart` / `generate_area_chart` |
| 分类对比 | 柱状图/条形图 | `generate_column_chart` / `generate_bar_chart` |
| 占比分布 | 饼图/树图 | `generate_pie_chart` / `generate_treemap_chart` |
| 相关性 | 散点图 | `generate_scatter_chart` |
| 流程/流向 | 桑基图/流程图 | `generate_sankey_chart` / `generate_flow_diagram` |
| 多维对比 | 雷达图 | `generate_radar_chart` |
| 漏斗转化 | 漏斗图 | `generate_funnel_chart` |
| 层级关系 | 组织图/思维导图 | `generate_organization_chart` / `generate_mind_map` |
| 统计分布 | 箱线图/小提琴图 | `generate_boxplot_chart` / `generate_violin_chart` |
| 地理数据 | 地图 | `generate_district_map` / `generate_pin_map` |
| 文本频率 | 词云 | `generate_word_cloud_chart` |
| 进度/比例 | 水球图 | `generate_liquid_chart` |
| 集合关系 | 韦恩图 | `generate_venn_chart` |
| 因果分析 | 鱼骨图 | `generate_fishbone_diagram` |
| 表格数据 | 电子表格 | `generate_spreadsheet` |

### 通用参数格式

大多数图表工具使用以下字段名：

- **折线图/面积图**: `{ time: string, value: number, group?: string }`
- **柱状图/条形图**: `{ category: string, value: number, group?: string }`
- **饼图**: `{ name: string, value: number }`
- **雷达图**: `{ name: string, value: number }`
- **散点图**: `{ x: number, y: number, group?: string }`

### 可选样式参数

```json
{
  "title": "图表标题",
  "description": "图表描述",
  "theme": "default|academy|dark",
  "width": 600,
  "height": 400
}
```

### 使用流程

1. **分析数据特征** - 判断是时序、分类、占比还是关系数据
2. **选择图表类型** - 参考上表选择最合适的图表
3. **查阅参数规范** - 如需详细参数，读取 `skills/chart-visualization/references/` 下对应文件
4. **调用工具生成** - 使用正确的字段名调用 MCP 工具
5. **返回结果** - 提供图表 URL 给用户

---

## 如何添加更多 Skills

如果需要添加新的 Skill，可以：

1. 在 `/Users/yay/workspace/genspark-agent/skills/` 下创建新目录
2. 添加 `SKILL.md` 描述文件
3. 更新 `skills.json` 索引
4. 重新加载系统提示
