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

## 注意事项

1. 大文件处理耗时长，建议用 `nohup` 后台运行
2. 使用 `-y` 参数可自动覆盖输出文件
3. 转码时 `-c copy` 可以无损快速复制流
4. CRF 值：18 接近无损，23 默认，28 较高压缩
