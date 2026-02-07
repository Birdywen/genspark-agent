# 🎬 YouTube 自动化视频内容运营计划

> 生成时间: 2026-02-07
> 频道: 不争即是争
> 平台: YouTube Shorts
> 工具链: Agent System → Opus Pro API → viaSocket → YouTube

---

## 一、架构概览

```
[内容调度器] → [Opus Pro API] → [轮询等待] → [viaSocket Webhook] → [YouTube 上传]
     ↑                                              ↓
[内容计划表]                                   [发布记录表]
[素材源: RSS/Trends]                        [防重复检查]
```

### 执行流程

1. **内容调度器** 根据计划表选择今日类别 + 从素材源获取话题
2. **Agent 面板一键触发**（浏览器内，实时获取 opus.pro token）
3. 调用 Opus Pro API 创建视频项目
4. 轮询等待视频生成完成（约 3-10 分钟）
5. 获取 resultVideo URL
6. 调用 viaSocket Webhook，传入 video_url + title + description + tags
7. viaSocket 自动上传到 YouTube（Private → 手动改 Public 或定时发布）
8. 记录到发布历史，防止重复

---

## 二、YouTube 2025 政策合规 ⚠️ 重要

### 2025年7月新规要点

YouTube 于 2025-07-15 更新了变现政策，针对 AI 生成内容：

- **必须包含原创价值**：评论、叙事、教育性见解
- **禁止大量生产**：近似重复的批量上传会被取消变现
- **必须披露 AI 使用**：上传时勾选 AI disclosure toggle
- **禁止纯 AI 配音 + 幻灯片**：无人声评论的纯 TTS 内容会被标记
- **禁止模板化批量内容**：相同脚本模板 + AI 配音 = 取消变现

### 合规策略

- 每个视频必须有**独特的叙事角度**，不能用同一模板
- **内容多样化**：不同类别、不同风格、不同来源
- **上传频率适中**：每 12 小时 1 个，不要批量上传
- **AI 披露**：viaSocket 上传时 Video Status 设为 Private，手动审核后再公开
- **描述中注明**："Created with AI assistance" 或类似声明
- 未来考虑加入**真人配音**或**个人评论音轨**以增强合规性

---

## 三、内容分类与排期

### 类别定义（7 大类，按星期轮换）

| 星期 | 类别 ID | 类别名称 | 内容类型 | 目标受众 |
|------|---------|----------|----------|----------|
| Mon | tech | 科技前沿 | News to Video | 科技爱好者 18-35 |
| Tue | people | 人物故事 | Post to Video | 传记/历史爱好者 |
| Wed | society | 社会洞察 | News to Video | 关注时事的年轻人 |
| Thu | science | 科学解读 | Article to Video | 好奇心驱动的学习者 |
| Fri | business | 商业分析 | News to Video | 创业者/职场人 |
| Sat | culture | 文化现象 | Post to Video | 泛文化爱好者 |
| Sun | wildcard | 热门话题 | Trending to Video | 大众 |

### 内容类型说明

#### News to Video（新闻转视频）
- **来源**: 当日热门新闻（Google News, Reddit, Hacker News）
- **特点**: 时效性强，话题自带流量
- **Prompt 要点**: 强调事实准确性，引用来源，提供独特视角
- **适用类别**: tech, society, business

#### Post to Video（帖子/文章转视频）
- **来源**: Reddit 热帖、Medium 文章、维基百科
- **特点**: 故事性强，不受时效限制
- **Prompt 要点**: 叙事驱动，情感共鸣，故事弧线
- **适用类别**: people, culture

#### Article to Video（深度文章转视频）
- **来源**: 学术论文摘要、科普文章、专业博客
- **特点**: 知识密度高，教育价值大
- **Prompt 要点**: 简化复杂概念，用类比解释，结构清晰
- **适用类别**: science

#### Trending to Video（热门趋势转视频）
- **来源**: Google Trends, Twitter/X 热搜, YouTube 热门
- **特点**: 高流量潜力，竞争也大
- **Prompt 要点**: 快速切入，独特角度，强 hook
- **适用类别**: wildcard（周日特别节目）

---

## 四、视频规格与格式要求

### YouTube Shorts 规格

| 项目 | 规格 | 备注 |
|------|------|------|
| 时长 | 30-60 秒 | 30-60 秒发现效果最佳 |
| 画幅 | 9:16 竖屏 | Opus Pro 默认 |
| 分辨率 | 1080x1920 | Opus Pro 默认 |

### Title 标题规则

- **最大**: 100 字符
- **推荐**: 55-60 字符（避免截断）
- **关键词在前 3-5 个词**
- **格式**: `[Hook] — [Topic] #Shorts`
- **禁止**: 全大写、点击诱饵、误导性标题

#### 标题模板示例

```
tech:     "[Discovery/Tool] Is Changing [Industry] Forever #Shorts #Tech"
people:   "The Untold Story of [Person] #Shorts #History"
society:  "Why [Phenomenon] Matters More Than You Think #Shorts"
science:  "[Concept] Explained in 60 Seconds #Shorts #Science"
business: "How [Company/Trend] Is Disrupting [Industry] #Shorts"
culture:  "The Hidden Meaning Behind [Topic] #Shorts #Culture"
wildcard: "[Trending Topic] — What You Need to Know #Shorts"
```

### Description 描述规则

- **最大**: 5000 字符
- **结构**:
  1. 第一行: 强 hook（搜索中可见）
  2. 第二段: 视频简述 2-3 句
  3. 第三段: 来源引用（如适用）
  4. 最后: 3-5 个 Hashtags
  5. 末尾: AI 披露声明

#### 描述模板

```
[Hook sentence that grabs attention]

[2-3 sentence summary of the video content]

Source: [URL if applicable]

#Topic1 #Topic2 #Topic3 #Shorts #CategoryTag

---
This video was created with AI assistance. All facts have been verified.
```

### Tags 标签规则

- **最大**: 500 字符总计
- **数量**: 5-8 个标签
- **结构**: 2 个宽泛 + 3 个具体 + 2 个长尾
- **示例**: `AI technology, tech news, [specific topic], [person name], Shorts, [category]`

### Hashtags 规则

- 描述中 3-5 个
- 必含: `#Shorts`
- 类别标签: `#Tech` `#Science` `#Business` `#Culture` `#History`
- 话题标签: 1-2 个与具体内容相关的

---

## 五、Prompt 模板系统

### 通用 Prompt 框架

```
Create a {duration} second engaging video about: {topic}

Requirements:
- Hook the viewer in the first 3 seconds with a surprising fact or question
- Maintain a {tone} tone throughout
- Target audience: {audience}
- Include source citations where applicable: {source_url}
- End with a thought-provoking statement or call to action
- Language: English
- Style: {style}
```

### 按类别的 Prompt 模板

#### tech (科技前沿)
```
Create a 45 second engaging video about this tech news: [{topic}]

Requirements:
- Hook: Start with the most surprising implication of this technology
- Tone: Informative yet exciting, like explaining to a smart friend
- Audience: Tech enthusiasts aged 18-35
- Reference: {source_url}
- Style: Fast-paced, data-driven, future-oriented
- End with: What this means for the average person
```

#### people (人物故事)
```
Create a 50 second compelling video about: [{topic}]

Requirements:
- Hook: Start with the most unexpected fact about this person
- Tone: Storytelling, narrative-driven, emotionally engaging
- Audience: Biography and history enthusiasts
- Reference: {source_url}
- Style: Cinematic narration, dramatic arc (struggle → triumph or revelation)
- End with: A lasting legacy or lesson
```

#### society (社会洞察)
```
Create a 45 second thought-provoking video about: [{topic}]

Requirements:
- Hook: Start with a statistic or contrast that challenges assumptions
- Tone: Balanced, analytical, empathetic
- Audience: Socially aware young adults 20-40
- Reference: {source_url}
- Style: Investigative, present multiple perspectives
- End with: A question that makes viewers think
```

#### science (科学解读)
```
Create a 50 second educational video explaining: [{topic}]

Requirements:
- Hook: Start with "What if..." or a mind-blowing fact
- Tone: Curious, wonder-driven, accessible
- Audience: Curious learners of all ages
- Reference: {source_url}
- Style: Use analogies and everyday examples to explain complex concepts
- End with: Why this matters or what comes next
```

#### business (商业分析)
```
Create a 45 second insightful video about: [{topic}]

Requirements:
- Hook: Start with the money/impact number
- Tone: Sharp, analytical, slightly provocative
- Audience: Entrepreneurs, professionals, business-minded viewers
- Reference: {source_url}
- Style: Case-study format, cause-and-effect, actionable insights
- End with: The key takeaway or prediction
```

#### culture (文化现象)
```
Create a 50 second engaging video about: [{topic}]

Requirements:
- Hook: Start with a cultural reference everyone recognizes
- Tone: Conversational, insightful, slightly witty
- Audience: Culture enthusiasts, trend followers
- Reference: {source_url}
- Style: Connect pop culture to deeper meaning, find the unexpected angle
- End with: Why this cultural moment matters
```

#### wildcard (热门话题)
```
Create a 45 second viral-worthy video about: [{topic}]

Requirements:
- Hook: The most shareable, jaw-dropping angle
- Tone: Energetic, direct, bold
- Audience: General public, broad appeal
- Reference: {source_url}
- Style: Fast facts, emotional punch, meme-worthy moments
- End with: Something viewers will want to share
```

---

## 六、防重复与内容记录

### content_history.json 结构

```json
{
  "published": [
    {
      "id": "20260207-tech-001",
      "date": "2026-02-07",
      "category": "tech",
      "topic": "AI agents hiring humans via Rent-a-Human platform",
      "source_url": "https://...",
      "opus_project_id": "02071123-kuq",
      "video_url": "https://...",
      "youtube_title": "AI Agents Can Now Hire Humans #Shorts #Tech",
      "youtube_id": "...",
      "status": "published"
    }
  ],
  "topics_used": [
    "AI agents hiring humans",
    "Luigi Mangione court protest"
  ]
}
```

### 防重复规则

1. 发布前检查 topics_used 列表，避免相同或高度相似的话题
2. 同一新闻源不在 7 天内重复使用
3. 同一人物不在 30 天内重复出现
4. 关键词重叠度 > 60% 视为重复

---

## 七、素材来源配置

### 新闻源 (News Sources)

```json
{
  "tech": [
    "https://news.ycombinator.com/rss",
    "https://www.theverge.com/rss/index.xml",
    "https://techcrunch.com/feed/"
  ],
  "society": [
    "https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRFZxYUdjU0FtVnVHZ0pWVXlnQVAB",
    "https://www.reddit.com/r/worldnews/.rss"
  ],
  "business": [
    "https://www.bloomberg.com/feed/podcast",
    "https://www.reddit.com/r/business/.rss"
  ],
  "science": [
    "https://www.reddit.com/r/science/.rss",
    "https://phys.org/rss-feed/"
  ],
  "culture": [
    "https://www.reddit.com/r/todayilearned/.rss",
    "https://www.reddit.com/r/explainlikeimfive/.rss"
  ]
}
```

### 热门趋势 (Trending)

- Google Trends API
- Reddit r/popular
- Twitter/X Trending Topics
- YouTube Trending

---

## 八、viaSocket Webhook 配置

### Webhook URL

```
https://flow.sokt.io/func/scri42hM0QuZ
```

### Payload 格式

```json
{
  "video_url": "https://cdn.opus.pro/...",
  "youtube_title": "AI Agents Can Now Hire Humans #Shorts #Tech",
  "youtube_description": "What if AI could hire you for a job?\n\nThe new Rent-a-Human platform connects AI agents with human workers for tasks AI can't handle alone.\n\nSource: https://www.businessinsider.com/...\n\n#AI #Technology #FutureOfWork #Shorts #Tech\n\n---\nThis video was created with AI assistance.",
  "youtube_tags": ["AI", "technology", "future of work", "automation", "Shorts"]
}
```

### viaSocket Flow 配置

- **Trigger**: Webhook
- **Step 1**: Upload Video to YouTube
  - Channel: 不争即是争
  - Video URL: `body."video_url"`
  - Title: `body."youtube_title"`
  - Description: `body."youtube_description"`
  - Category: Entertainment (或按类别动态设置)
  - Status: **Private**（先私有，审核后公开）
- **Response**: 同步返回 `{success: true, flowHitId: "..."}`

---

## 九、一键执行流程（Agent 面板按钮）

### 用户操作

1. 打开 Agent 面板
2. 点击 "🎬 生成视频" 按钮
3. 弹出表单：选择类别 / 输入话题 / 或 "自动选题"
4. 确认后自动执行全流程
5. 面板日志实时显示进度

### 自动执行步骤

```
[1] 📋 选题: 根据今日类别从素材源获取话题
[2] ✍️ 构建 Prompt: 使用类别对应的模板
[3] 🎬 创建视频: 调用 Opus Pro API (POST /api/project)
[4] ⏳ 等待生成: 轮询 /api/project/{id} 直到 stage=COMPLETE
[5] 📥 获取视频: 提取 resultVideo URL
[6] 📝 生成元数据: 标题(≤100字符) + 描述 + Tags + Hashtags
[7] 🚀 上传 YouTube: 调用 viaSocket Webhook
[8] 💾 记录历史: 写入 content_history.json
[9] ✅ 完成: 显示结果和 YouTube 链接
```

---

## 十、关键约束与注意事项

### Opus Pro 限制

- 免费版: 每天 2 次视频生成（每 12 小时刷新）
- Token 有效期: 5 分钟（必须从浏览器实时获取）
- 视频生成时间: 约 3-10 分钟

### YouTube 限制

- Shorts 标题: ≤ 100 字符（推荐 55-60）
- 描述: ≤ 5000 字符
- Tags: ≤ 500 字符，5-8 个
- Hashtags: 3-5 个（描述内）
- AI 内容必须勾选 disclosure toggle
- 避免批量上传（每天最多 1-2 个）

### 合规红线

- ❌ 不使用 deepfake 或模拟真人声音
- ❌ 不批量使用同一模板
- ❌ 不编造新闻或虚假信息
- ❌ 不使用未经授权的他人内容
- ✅ 每个视频必须有独特角度和叙事
- ✅ 必须披露 AI 使用
- ✅ 必须引用信息来源

---

## 十一、文件结构

```
genspark-agent/
├── skills/
│   └── opus-video/
│       └── SKILL.md              # Opus Pro API 文档
├── scripts/
│   └── video-automation/
│       ├── content-scheduler.js   # 内容调度器
│       ├── topic-fetcher.js       # 素材抓取
│       ├── prompt-builder.js      # Prompt 构建器
│       ├── youtube-metadata.js    # 元数据生成（标题/描述/标签）
│       └── publish-recorder.js    # 发布记录
├── data/
│   └── video-automation/
│       ├── content-plan.json      # 内容计划配置
│       ├── content-history.json   # 发布历史记录
│       ├── prompt-templates.json  # Prompt 模板库
│       └── sources.json           # 素材源配置
└── docs/
    └── VIDEO_CONTENT_PLAN.md      # 本文档
```

---

## 十二、下一步行动

1. [ ] 创建 content-plan.json 配置文件
2. [ ] 创建 prompt-templates.json 模板库
3. [ ] 实现 Agent 面板 "🎬 生成视频" 按钮
4. [ ] 实现 content-scheduler.js 调度逻辑
5. [ ] 实现 topic-fetcher.js 素材抓取
6. [ ] 实现 youtube-metadata.js 元数据生成
7. [ ] 端到端测试完整流程
8. [ ] 配置 viaSocket flow Go Live
9. [ ] 第一个视频正式发布
10. [ ] 建立内容审核机制（Private → Public）
