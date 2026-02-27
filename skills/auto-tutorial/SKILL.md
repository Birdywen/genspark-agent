# Auto Tutorial — 全自动教程视频生成器

AI 驱动的浏览器教程视频录制工具，自动操控浏览器、截图、配音、合成视频。

## 位置

`/Users/yay/workspace/auto-tutorial-v2/`

## 快速使用

### 工具: tutorial_generate

一条命令生成完整教程视频。

**前提**: Brave 浏览器已打开目标网站，genspark-agent server 运行中。

```bash
cd /Users/yay/workspace/auto-tutorial-v2

# 1. 创建项目
PROJECT="projects/my_tutorial"
mkdir -p "$PROJECT/screenshots" "$PROJECT/audio" "$PROJECT/output"

# 2. 编写 plan.json（见下方格式）
cat > "$PROJECT/plan.json" << 'EOF'
{
  "title": "教程标题",
  "voice": "zh-CN-XiaoxiaoNeural",
  "steps": [
    {"action": "overview", "narration": "欢迎..."},
    {"action": "spotlight", "selector": "#search", "label": "搜索框", "narration": "这是搜索框"},
    {"action": "summary", "narration": "总结..."}
  ]
}
EOF

# 3. 执行录制（截图 + spotlight）
node runner.js "$PROJECT" --url=目标域名 --no-synth

# 4. 合成视频（TTS + ffmpeg）
python3 lib/synthesize-v2.py "$PROJECT"

# 5. 播放
open -a IINA "$PROJECT/output/tutorial.mp4"

runner.js 命令行
node runner.js <projectDir> [options]

选项:
  --url=keyword     目标浏览器 tab 的 URL 关键词（如 google.com）
  --from=N          从第 N 步开始
  --no-synth        只截图不合成
  --dry-run         只打印步骤不执行
  --screencapture   使用 screencapture 截图（会弹窗口，默认用扩展后台截图）

plan.json 格式
Copy
{
  "title": "教程标题",
  "description": "描述（可选）",
  "voice": "zh-CN-XiaoxiaoNeural",
  "steps": [...]
}

支持的 action 类型
Action	必填参数	可选参数	说明
overview	narration	—	开场白，截取当前页面
spotlight	selector, narration	color, label, pulse, badge, arrow, tooltip, tooltipPosition, padding	高亮指定元素，暗色遮罩 + 动画
type	selector, text, narration	—	在输入框中输入文字
click	selector, narration	screenshotDelay	点击元素
hover	selector, narration	subSelector, screenshotDelay	强制展开下拉菜单（CSS :hover 替代）
scroll	narration	selector	滚动页面，可指定滚动到某元素
goto	url, narration	screenshotDelay	导航到指定 URL
explore	selector, narration	childSelector, maxItems, visibleOnly, narrateItems, narrationPrefix, narrationSuffix, exploreDelay, exploreArrow	扫描容器内子元素，逐个 spotlight + 截图
click_and_explore	selector, narration	clickDelay, waitFor, waitTimeout, scanSelector, childSelector, maxItems, narrateItems, narrationPrefix, narrationSuffix, exploreDelay, iframeSelector	点击展开 → 扫描新元素 → 逐个 spotlight（支持跨域 iframe）
summary	narration	—	结束语
spotlight 参数详解
color: 高亮边框颜色，默认 #4285f4
label: 元素上方的文字标签
pulse: true 开启脉冲动画
badge: 左上角数字标记（如 "1"）
arrow: 箭头方向 top / bottom / left / right
tooltip: 气泡提示文字
tooltipPosition: 气泡位置 top / bottom / left / right
padding: 高亮框内边距，默认 8
explore 参数详解
childSelector: 子元素选择器，默认自动检测 a, button, [role=menuitem] 等
maxItems: 最多扫描多少个子元素，默认 12
visibleOnly: 只扫描可见元素，默认 true
narrateItems: 是否为每个子元素生成旁白，默认 false
narrationPrefix/Suffix: 子元素旁白的前缀/后缀
exploreDelay: 每个子元素之间的延迟（ms），默认 800
click_and_explore 特殊能力
跨域 iframe 支持: 当主页面扫描为空时，自动 fallback 到 allFrames 模式扫描 iframe 内元素
坐标偏移 spotlight: iframe 内元素通过 iframe 偏移 + 元素坐标计算，在主页面画 overlay
iframeSelector: 指定 iframe 选择器，默认 iframe[name="app"], iframe[src*="widget"]
blur 参数（马赛克）

在任何 step 中加 blur 数组，可模糊指定区域：

Copy
{
  "action": "spotlight",
  "selector": "#search",
  "blur": [
    {"selector": "[aria-label='用户头像']"},
    {"x": 100, "y": 50, "w": 200, "h": 80}
  ]
}


支持 selector（自动获取坐标）和 x/y/w/h 坐标两种方式。

可用 TTS 语音
语音 ID	语言	性别
zh-CN-XiaoxiaoNeural	中文	女
zh-CN-YunxiNeural	中文	男
en-US-JennyNeural	英文	女
en-US-GuyNeural	英文	男

完整列表: edge-tts --list-voices

合成器
synthesize-v2.py（推荐）

字幕驱动合成，每段旁白单独生成音频，精确时间对齐：

Copy
python3 lib/synthesize-v2.py "projects/my_tutorial"


特点：

每段旁白独立 TTS，精确控制时长
静音 explore 子元素 0.8 秒快速切换
旁白之间 0.3 秒自然停顿
截图预处理到 1920x1080 RGB
synthesize.sh（旧版）

简单逐步合成，每个截图独立生成片段再拼接：

Copy
bash lib/synthesize.sh "projects/my_tutorial"

架构
runner.js
  ├── WebSocket (ws://localhost:8765)
  │     ├── browser_eval → eval_js（操控浏览器）
  │     ├── browser_list_tabs → 获取 tab 列表和 tabId
  │     └── browser_screenshot → captureVisibleTab（后台截图）
  ├── lib/overlay.js → 生成 spotlight/label/arrow/pulse/badge/tooltip SVG
  ├── lib/explorer.js → DOM 扫描、元素探索、DOM 变化检测
  └── lib/annotate.py → PIL 后处理（blur/arrow/circle）

synthesize-v2.py
  ├── edge-tts → 逐段生成 mp3
  ├── PIL → 截图预处理 1920x1080
  └── ffmpeg → 图片+音频合成 → concat 合并

扩展修改（已完成）

以下修改已应用到 genspark-agent 扩展：

server-v2/index.js: 新增 browser_list_tabs、browser_screenshot 消息类型，browser_eval 支持 allFrames 参数
extension/background.js: 新增 CAPTURE_TAB case（不 focus 窗口），EVAL_JS 支持 allFrames: true（多 frame 结果合并）
extension/content.js: browser_tool_call 的 eval_js 传递 allFrames，新增 screenshot tool 处理
extension/manifest.json: 添加 <all_urls> host permission
示例 plan.json
简单教程
Copy
{
  "title": "网站功能介绍",
  "voice": "zh-CN-XiaoxiaoNeural",
  "steps": [
    {"action": "overview", "narration": "欢迎来到本教程"},
    {"action": "spotlight", "selector": "nav", "label": "导航栏", "narration": "这是导航栏"},
    {"action": "spotlight", "selector": "#login", "label": "登录", "color": "#ea4335", "narration": "点击登录"},
    {"action": "summary", "narration": "教程结束"}
  ]
}

带菜单探索
Copy
{
  "title": "菜单功能探索",
  "voice": "zh-CN-XiaoxiaoNeural",
  "steps": [
    {"action": "overview", "narration": "探索菜单功能"},
    {"action": "hover", "selector": ".menu-parent", "subSelector": ".sub-menu", "narration": "展开菜单"},
    {"action": "explore", "selector": ".sub-menu", "childSelector": "a", "maxItems": 8, "narrateItems": false, "exploreDelay": 500, "narration": "菜单包含以下功能分类"},
    {"action": "summary", "narration": "以上是所有功能"}
  ]
}

带 iframe 探索（如 Google 应用菜单）
Copy
{
  "title": "跨域 iframe 探索",
  "voice": "zh-CN-XiaoxiaoNeural",
  "steps": [
    {"action": "overview", "narration": "探索应用菜单"},
    {"action": "click_and_explore", "selector": "[aria-label='应用']", "clickDelay": 2000, "childSelector": "a[href]", "maxItems": 9, "narration": "点击打开应用菜单"},
    {"action": "summary", "narration": "以上是所有应用"}
  ]
}

注意事项
eval_js 在 MAIN world 执行，IIFE (function(){})() 不会返回值，必须用 return (function(){})() 或直接 return
scrollIntoView 已内置在 overlay.js 中，spotlight 前自动滚动元素到视口中间
explore 完成后自动收回菜单（清除 .sub-menu style 和 active/open/show 等 class）
截图通过 captureVisibleTab 后台获取，不会弹窗口到前台
合成器预处理截图到 1920x1080 RGB，避免 ffmpeg 处理大尺寸 RGBA 图片卡住
文件结构
auto-tutorial-v2/
├── runner.js              # 主执行器
├── package.json           # ESM, ws 依赖
├── lib/
│   ├── overlay.js         # spotlight/label/arrow/pulse/badge/tooltip
│   ├── explorer.js        # DOM 扫描、元素探索
│   ├── annotate.py        # PIL 后处理
│   ├── synthesize-v2.py   # 字幕驱动合成器（推荐）
│   ├── synthesize.sh      # 旧版合成器
│   ├── analyzer.js        # 网页分析
│   ├── planner.js         # AI 教程规划
│   └── screenshot.sh      # screencapture 截图（备用）
├── projects/              # 项目目录
│   └── <project>/
│       ├── plan.json
│       ├── steps.json
│       ├── screenshots/
│       ├── audio/
│       └── output/
│           ├── tutorial.mp4
│           └── timeline.json
└── examples/
    └── google-search.json



---

## 踩坑经验 (Lessons Learned)

### ffmpeg concat 采样率必须一致
**问题**: narration clip 音频采样率 24000Hz（edge-tts 原始），silent clip 44100Hz（anullsrc 默认），`concat -c copy` 合并后音频流时长 145s 远超视频流 101s。
**根因**: concat demuxer 用 `-c copy` 不重编码，采样率混合导致音频时间戳计算错误。
**修复**: narration clip 的 ffmpeg 命令加 `-ar 44100 -ac 1` 统一采样率。

### -shortest 不可靠，用 -t 精确控制
**问题**: `-loop 1 -i image -i audio -shortest` 产生 12.88s 而音频只有 10.85s（多出 2s）。
**根因**: mp3 帧边界 + 图片无限循环流的交互导致 `-shortest` 判断不准。
**修复**: 用 ffprobe 获取音频精确时长，用 `-t {duration}` 替代 `-shortest`。

### edge-tts 音频实际时长获取
**正确做法**: 先生成 mp3，再用 `ffprobe -show_entries format=duration` 获取精确时长，不要依赖 VTT 字幕时间。

### hover 展开菜单后必须收回
**问题**: hover action 通过 JS 强制 display:block 展开子菜单，但后续步骤菜单仍然遮挡页面。
**修复**: explore 完成后执行清理代码，清除 `.sub-menu` 的 inline style 和 `active/open/show/hover` class。

### scrollIntoView 保证 spotlight 在视口内
**问题**: `captureVisibleTab` 只截取视口，但 overlay 坐标可能在视口外。
**修复**: overlay.js 中 `getBoundingClientRect` 前先调用 `el.scrollIntoView({block:'center'})`。

### iframe 内元素的 spotlight 需要坐标偏移
**问题**: 跨域 iframe 内元素的选择器在主页面不存在，无法用选择器定位。
**修复**: 获取 iframe 在主页面的 rect，加上元素在 iframe 内的坐标，用绝对坐标绘制 SVG overlay。

---

## Sandbox / 远程合成卸载方案 (WIP)

### 目标
将 TTS + ffmpeg 合成从本地卸载到 Sandbox 或猛兽，本地只负责截图和编排。

### Sandbox (Novita)
- **地址**: https://3000-isjad10r8glpogdbe5r7n-02b9cc79.sandbox.novita.ai
- **能力**: ffmpeg 5.1 ✓, Python 3.12 ✓, edge-tts 7.2.7 ✓, PIL ✓, 8GB RAM, 20GB disk
- **工具**: `sos se "命令"` 执行, `sos sp 文件` 推送
- **瓶颈**: `sos sp` 是覆盖式推送（所有文件推到同一路径），不支持批量推送多文件
- **解决思路**:
  1. tar 打包截图 → 分块推送 → sandbox 拼接解压（复杂但可行）
  2. 猛兽做 HTTP 中转站（需安装 ffmpeg）
  3. 改造 synthesize-v2.py 接受 URL 列表参数，截图存在公网可访问的地方

### 猛兽 (Oracle ARM 150.136.51.61)
- **能力**: 4核 24GB, Python3 ✓, ffmpeg ✗, edge-tts ✗
- **注意**: `ssh-oracle:exec` 连的是 AMD 轻量机(genspark 10.0.0.72)，非猛兽(genspark-arm 10.0.0.210)
- **SSH 直连**: `ssh -i ~/.ssh/oracle-cloud.key ubuntu@150.136.51.61`
- **待安装**: ffmpeg, edge-tts, pillow

### 推荐下一步
1. 在猛兽上安装 ffmpeg + edge-tts + pillow
2. SCP 截图到猛兽 → SSH 执行 synthesize-v2.py → SCP 回传 tutorial.mp4
3. 封装为 `sos synth-remote` 命令
