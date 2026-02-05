# auto-tutorial - 全自动教程视频生成器

## 描述
无需人工介入，AI 自动生成带配音的教程视频。

## 位置
/Users/yay/workspace/auto-tutorial-video/

## 使用方法

### 运行内置示例（Google 搜索教程）
```bash
cd /Users/yay/workspace/auto-tutorial-video
node generate-tutorial.js
```

### 使用自定义教程
```bash
node generate-tutorial.js ./examples/your-tutorial.json
```

## 教程脚本格式

```json
{
  "title": "教程标题",
  "voice": "zh-CN-XiaoxiaoNeural",
  "steps": [
    { "action": "goto", "url": "https://...", "narration": "旁白" },
    { "action": "click", "selector": "CSS选择器", "narration": "旁白" },
    { "action": "type", "selector": "选择器", "text": "内容", "narration": "旁白" },
    { "action": "wait", "narration": "旁白" }
  ]
}
```

## 可用声音

- zh-CN-XiaoxiaoNeural（中文女声）
- zh-CN-YunxiNeural（中文男声）
- en-US-JennyNeural（英文女声）
