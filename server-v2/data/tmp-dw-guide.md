# Datawrapper 终极参数手册 v3

## 1. sys-tool Actions
create|upload_data|publish|update|list|delete|fork|get|river
- create: {action:create, title:..., type:...}
- upload_data: {action:upload_data, id:ID, data:"CSV字符串"}
- update: {action:update, id:ID, patch:{title:..., metadata:{...}}}
- publish: {action:publish, id:ID}
- get: {action:get, id:ID} — 获取完整metadata(逆向学习用)
- fork: {action:fork, id:ID} — 复制别人图表含全部配置
- river: {action:river, search:"keyword"} — 搜索公共样板

## 2. 图表类型 ID
d3-bars(横条) | d3-bars-stacked | d3-bars-split
column-chart(纵柱) | grouped-column-chart | stacked-column-chart
d3-lines(折线) | d3-area(面积) | d3-scatter-plot(散点)
d3-pies(饼) | d3-donuts(甜甜圈) | d3-dot-plot | d3-range-plot | d3-arrow-plot
tables(表格) | d3-maps-choropleth(区域地图) | d3-maps-symbols(符号地图) | locator-map

## 3. metadata 结构
```
metadata: {
  data: {transpose, vertical-header, horizontal-header}
  describe: {intro, source-name, source-url, byline, aria-description}
  visualize: { ★所有视觉配置★ }
  axes: { ★列映射★ }
  annotate: {notes}
  publish: {embed-width, embed-height, blocks:{logo,embed,download-*,get-the-data}}
  custom: {}
}
```

## 4. visualize 字段速查 (API字段名用连字符)

### 4.1 Bar Chart (d3-bars)
base-color: "#hex"或调色板索引(0-9)
custom-colors: {"系列名":"#hex"}
thick: true — 加粗条
bar-padding: 60 — 条间距
sort-bars: true/false | sort-by: "first"
reverse-order: true
show-color-key: true
show-values: true — 数值标签
value-label-alignment: "left"/"right"
label-alignment: "left"/"right"
block-labels: true — 标签单独行
swap-labels: true — 交换标签和值
rules: true — 分隔线
background: true — 背景色条
force-grid: true — x网格
negativeColor: "#hex" — 负值变色
highlighted-series: ["系列名"]
custom-grid-lines: [值]
groups-column: "列名" — 分组
color-column: "列名" — 颜色映射列

### 4.2 Column Chart (column-chart)
base-color, custom-colors — 同bar
bar-padding: 30 — 柱间距(%)
negative-color: "#hex"
show-values: "hover"/"always"/"off"
value-label-format: "0.0"/"0%"/"0,0"
value-labels-placement: "inside"/"outside"/"below"
plot-height-fixed: 300 (px)
x-grid: "off"/"on"/"ticks"
y-grid: "on"/"off"
y-grid-format: "0"(整数)/"0.0"/"0%"
y-grid-label-align: "left"/"right"
custom-range-y: [min, max]
custom-ticks-x/y: [值列表]
range-annotations: [{x0,x1,color,opacity,type:"x"/"y"}]
text-annotations: [{text,x,y,dx,dy,align,size,color,bold,connector-line:{color,type}}]

### 4.3 Line Chart (d3-lines)
base-color, custom-colors — 同上
lines: {"Series A":{width:"style1"/"style2"/"style3",symbols:{size:2,enabled:true},directLabel:false}}
  width: style1(细) style2(中) style3(粗) invisible(隐藏)
  interpolation: linear/step/curved
connector-lines: true — 标签连接线
label-colors: true — 标签跟线色
label-margin: 0(自动)
plot-height-fixed: 300
custom-range-y/x: [min,max]
scale-y: "linear"/"log"
x-grid/y-grid
y-grid-format: "0"
tooltip-number-format: "00.00"
tooltip-x-format: "YYYY"
area-fills: [{from-column,to-column,color,opacity}] — 置信区间

### 4.4 Scatter Plot (d3-scatter-plot) — 信息密度最高
axes: {x:"列",y:"列",size:"列",color:"列",shape:"列",label:"列"}
5维映射!
base-color: "#afafaf"
custom-colors: {"China":"#ae000b"}
opacity: 0.65
outlines: true — 轮廓线
color-outline: "#000"
size: "fixed"/"dynamic"
fixed-size: 5 | max-size: 25
fixed-shape: "symbolCircle"/"symbolSquare"/"symbolDiamond"
shape: "fixed"/列名
x-log/y-log: true — 对数刻度
x-range/y-range: [min,max]
regression: true | regression-method: "linear"/"quadratic"/"cubic"
auto-labels: true/false
add-labels: ["重要项"] — 只标注关键点
show-color-key: true
show-size-legend: true
size-legend-position: "above"/"below"/"inside-left-top"等
size-legend-values: [100,1000,10000]
plot-height-fixed: 581
custom-lines: "x1,y1,x2,y2 @color:#hex @opacity:1" — 自定义连线/框
highlight-labeled: true
responsive-symbol-size: true — 手机缩小

Tooltip(散点):
  tooltip-title: '<big>{{ country }}</big> in {{ FORMAT(year,"YYYY") }}'
  tooltip-body: '<table><tr><td>Life:</td><td><b>{{ health }} yrs</b></td></tr></table>'
  tooltip-sticky: true

### 4.5 Symbol Map (d3-maps-symbols) — ★数据列名有硬性要求★

#### CSV列名规则(必须严格遵守!):
lat — 纬度
lon 或 lng — 经度  
title — 标签(显示在气泡旁)
其他列自由命名(用于size/color)

#### axes层:
{lat:"lat", lon:"lon", area:"Employees", address:"title"}
注意: size映射的key是"area"不是"size"!

#### visualize层:
basemap: "world-2019"/"us-states"/"us-states-continental"/"europe-sovereign-states"
map-type-set: true
symbol-shape: "circle"/"square"/"diamond"/"hexagon"/"triangle-up"/"triangle-down"/"marker"
symbol-size-by: "列名"
show-labels: true
symbol-color-by: "列名" — 数值=渐变, 分类=离散色
symbol-opacity: 0.8
symbol-outline: true
symbol-multiply: true — 重叠混合
symbol-max-size: 50
symbol-min-size: 5
crop-to-data: true — 裁剪到数据范围
padding: 20
hide-region-borders: false
zoom-button: true
zoom-button-position: "tr"
inset-map: false
tooltip: {enabled:true, sticky:true, title:"{{ title }}", body:"..."}
legends: {size:{type:"stacked"}, color:{labels:"ranges",orientation:"horizontal"}}
dark-mode-invert: false (地图常用亮色)

### 4.6 Choropleth Map (d3-maps-choropleth)
axes: {keys:"地区ID列", values:"数值列"}
basemap: "world-2019"等
map-key-attr: "DW_STATE_CODE"等
labels: {type:"places", places:[{x,y,text,align:"mc",visible:true}]}
自定义标签精确到经纬度

## 5. Tooltip 语法(所有图表通用)
{{ column_name }} — 显示列值
{{ FORMAT(col,"0,0") }} — 格式化数字
{{ FORMAT(col,"YYYY") }} — 格式化日期
{{ FORMAT(col,"MMM DD") }} — Mar 15
{{ field ? 'show' : 'hide' }} — 条件渲染
{{ CONCAT('<a href="',url,'">',text,'</a>') }} — 链接
{{ image ? CONCAT('<img src="',image,'" width="100%">') : '' }} — 图片
<b>粗体</b> <big>大字</big> — 支持HTML
<table><tr><td>表格布局</td></tr></table>

## 6. 注释系统

### text-annotations:
{text, x, y, dx, dy, align:"tl/tc/tr/ml/mc/mr/bl/bc/br", size:14, color, bold:true, outline:false}
connector-line: {color, type:"straight"/"curveRight"/"curveLeft"}

### range-annotations:
{x0, x1, color, opacity:10, type:"x"(竖条)/"y"(横条)}

### bar overlays (仅bar chart):
{from-column, to-column, color, opacity, pattern:"diagonal-up", title, type:"range", show-in-color-key:true}

## 7. 数字格式
"0"=整数 "0.0"=1位小数 "0.00"=2位 "0,0"=千分位
"0a"=缩写(1k,1M) "0%"=百分比 "0.0%"=百分比1位
"$0,0"=美元 "00.00"=tooltip专用

## 8. 配色最佳实践(逆向工程7个专业图表)
1. base-color选中性色(#afafaf/#CCCCCC), custom-colors只高亮关键项
2. 同系列用同色族, 对比用互补色
3. 散点opacity=0.63-1.0防重叠
4. 负值用negativeColor单独标识
5. 色盲友好: Okabe-Ito调色板

## 9. 血泪经验
1. upload_data的data是CSV字符串，不是JSON
2. symbol map CSV列必须用lat/lon/title，不能用Latitude/Longitude
3. symbol map axes的size key是"area"不是"size"!
4. update用patch参数, patch里不能放data(上传数据只能用upload_data)
5. 修改配置后必须republish
6. Python属性名用下划线, API字段名用连字符: base_color→base-color
7. fork是学习配置最快方式: fork高质量图→get看metadata
8. tooltip是讲故事核心 — 条件渲染+HTML+图片
9. 少即是多: auto-labels:false + add-labels:['关键项']
10. source-name+byline增加可信度, intro一句话说清图表含义

## 10. 高质量样板(River)
CmFS5(scatter,93forks) T2eVM(scatter,50forks) YPI33(scatter,59forks) Q0XpZ(map,6forks)
用法: {action:fork, id:"CmFS5"} → get看配置 → 改数据和标题

## 11. dw-clone脚本
存在 local_store script dw-clone
用法: bash dw-clone.sh <template-id> <csv-path> [title]
自动: 读模板配置→创建同类型新图→复制visualize/axes→上传数据→发布
