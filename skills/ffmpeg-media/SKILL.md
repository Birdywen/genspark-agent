---
name: ffmpeg-media
description: 多媒体处理工具，支持视频/音频转换、剪辑、合并、提取、压缩等操作
---

# FFmpeg Media Skill

强大的多媒体处理工具，可处理几乎所有音视频格式。

## 常用命令

### 格式转换
| 命令 | 说明 |
|------|------|
| `ffmpeg -i input.mov output.mp4` | 视频格式转换 |
| `ffmpeg -i input.mp3 output.wav` | 音频格式转换 |
| `ffmpeg -i input.mp4 -vn output.mp3` | 提取音频 |
| `ffmpeg -i input.mp4 -an output.mp4` | 移除音频 |

### 视频剪辑
| 命令 | 说明 |
|------|------|
| `ffmpeg -i input.mp4 -ss 00:01:00 -t 00:00:30 output.mp4` | 剪切片段（从1分钟开始，截取30秒）|
| `ffmpeg -i input.mp4 -ss 00:00:05 -frames:v 1 output.jpg` | 截取帧为图片 |
| `ffmpeg -i input.mp4 -vf "fps=1" frames_%04d.jpg` | 每秒提取一帧 |

### 视频压缩
| 命令 | 说明 |
|------|------|
| `ffmpeg -i input.mp4 -crf 28 output.mp4` | 压缩视频（CRF 18-28，越大越小）|
| `ffmpeg -i input.mp4 -vf scale=1280:720 output.mp4` | 调整分辨率 |
| `ffmpeg -i input.mp4 -b:v 1M output.mp4` | 指定码率 |

### 音频处理
| 命令 | 说明 |
|------|------|
| `ffmpeg -i input.mp3 -af "volume=2.0" output.mp3` | 调整音量 |
| `ffmpeg -i input.mp3 -ar 44100 output.mp3` | 调整采样率 |
| `ffmpeg -i input.mp3 -ac 1 output.mp3` | 转为单声道 |

### 合并文件
```bash
# 创建文件列表
echo "file 'video1.mp4'" > list.txt
echo "file 'video2.mp4'" >> list.txt
# 合并
ffmpeg -f concat -safe 0 -i list.txt -c copy output.mp4
```

### GIF 制作
```bash
# 从视频制作 GIF
ffmpeg -i input.mp4 -vf "fps=10,scale=320:-1:flags=lanczos" -t 5 output.gif
```

### 添加水印
```bash
ffmpeg -i input.mp4 -i watermark.png -filter_complex "overlay=10:10" output.mp4
```

### 获取媒体信息
```bash
ffprobe -v quiet -print_format json -show_format -show_streams input.mp4
```

## 批量处理示例

```bash
# 批量转换目录下所有 MOV 为 MP4
for f in *.mov; do ffmpeg -i "$f" "${f%.mov}.mp4"; done
```

## 自动字幕流程（Whisper + ffmpeg）

完整管线：下载视频 → 提取音频 → Whisper API 生成 SRT → ffmpeg 烧录硬字幕

### 步骤 1：提取音频
```bash
ffmpeg -nostdin -i input.mp4 -vn -acodec pcm_s16le -ar 16000 -ac 1 output_audio.wav -y
```

### 步骤 2：Whisper API 生成字幕
```bash
curl -s https://api.openai.com/v1/audio/transcriptions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -F file="@output_audio.wav" \
  -F model="whisper-1" \
  -F response_format="srt" \
  -F language="en" \
  -o output.srt
```

### 步骤 3：烧录硬字幕
```bash
ffmpeg -nostdin -i input.mp4 \
  -vf "subtitles=output.srt:force_style='FontSize=32,FontName=Arial,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=3,Shadow=1,MarginV=30'" \
  -c:a copy output_subtitled.mp4 -y
```

> **注意**：ffmpeg 必须编译了 libass（`brew install homebrew-ffmpeg/ffmpeg/ffmpeg --build-from-source`）。用 `ffmpeg -filters | grep subtitles` 验证。
> **注意**：烧录时必须加 `-nostdin` 和 `</dev/null` 防止后台运行时 tty 挂起。

### 视频风格与字幕样式推荐

| 视频风格 | FontSize | FontName | PrimaryColour | OutlineColour | Outline | Shadow | MarginV | 说明 |
|----------|----------|----------|---------------|---------------|---------|--------|---------|------|
| **Pen&Ink / Halftone** | 32 | Arial | &H00FFFFFF (白) | &H00000000 (黑) | 3 | 1 | 30 | 经典白字黑边，适合深浅交替的手绘画面 |
| **2D Line / Animation** | 34 | Trebuchet MS | &H00FFFFFF (白) | &H00222222 (深灰) | 2 | 2 | 25 | 稍大字号，轻描边，活泼感 |
| **Watercolor** | 30 | Georgia | &H00F0F0F0 (米白) | &H00333333 (深灰) | 2 | 1 | 35 | 柔和色调配衬水彩风 |
| **Collage** | 36 | Impact | &H0000FFFF (黄) | &H00000000 (黑) | 3 | 2 | 20 | 大号醒目黄字，拼贴风格需要高对比 |
| **Claymation** | 34 | Comic Sans MS | &H00FFFFFF (白) | &H00003366 (深蓝) | 3 | 2 | 28 | 圆润字体配深色描边，童趣感 |
| **Blue Vox / Economic** | 30 | Helvetica | &H00FFFFFF (白) | &H00333333 (深灰) | 2 | 1 | 30 | 干净简约，新闻/数据风格 |
| **Cinematic / Dark** | 32 | Arial | &H0000CCFF (浅蓝) | &H00000000 (黑) | 3 | 2 | 25 | 浅蓝字配黑边，电影感暗色调 |
| **YouTube Shorts (竖屏)** | 40 | Arial Black | &H00FFFFFF (白) | &H00000000 (黑) | 4 | 2 | 50 | 超大字号+粗描边，手机竖屏必须醒目 |

### force_style 快速模板

```
# 通用（大多数风格适用）
force_style='FontSize=32,FontName=Arial,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=3,Shadow=1,MarginV=30'

# Shorts 竖屏
force_style='FontSize=40,FontName=Arial Black,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=4,Shadow=2,MarginV=50'

# 电影感
force_style='FontSize=32,FontName=Arial,PrimaryColour=&H0000CCFF,OutlineColour=&H00000000,Outline=3,Shadow=2,MarginV=25'

# 活泼动画
force_style='FontSize=34,FontName=Trebuchet MS,PrimaryColour=&H00FFFFFF,OutlineColour=&H00222222,Outline=2,Shadow=2,MarginV=25'
```

---

## 注意事项

1. 大文件处理耗时长，建议用 `nohup` 后台运行，脚本中加 `-nostdin` 和 `</dev/null`
2. 使用 `-y` 参数可自动覆盖输出文件
3. 转码时 `-c copy` 可以无损快速复制流
4. CRF 值：18 接近无损，23 默认，28 较高压缩
