---
name: demucs-vocal
description: AI 音频分离工具，基于 Meta Demucs (Hybrid Transformer)，支持人声/伴奏分离、多音轨分离
---

# Demucs Vocal Separation Skill

基于 Meta 的 Hybrid Transformer Demucs 模型，高质量分离音频中的人声和伴奏。

## 环境要求

- Python 3.11（3.14 不兼容）
- 虚拟环境路径：`/private/tmp/demucs_env`

## 首次安装

```bash
# 创建虚拟环境（必须用 Python 3.11）
python3.11 -m venv /private/tmp/demucs_env

# 安装 demucs 和依赖
/private/tmp/demucs_env/bin/pip install --upgrade pip
/private/tmp/demucs_env/bin/pip install demucs torchcodec
```

> **注意**: 首次安装需要下载 PyTorch (~80MB)，建议后台执行 (`nohup ... &`)。
> `torchcodec` 是必须的，否则保存文件时会报 ImportError。

## 使用方法

### 人声/伴奏分离（最常用）

```bash
/private/tmp/demucs_env/bin/python3 -m demucs --two-stems vocals -o /private/tmp/demucs_output "输入音频.mp3"
```

输出：
- `vocals.wav` — 纯人声
- `no_vocals.wav` — 纯伴奏

输出目录结构：`/private/tmp/demucs_output/htdemucs/文件名/`

### 完整四轨分离

```bash
/private/tmp/demucs_env/bin/python3 -m demucs -o /private/tmp/demucs_output "输入音频.mp3"
```

输出四个轨道：
- `vocals.wav` — 人声
- `drums.wav` — 鼓
- `bass.wav` — 贝斯
- `other.wav` — 其他乐器

### 使用其他模型

```bash
# 默认模型 htdemucs（推荐）
/private/tmp/demucs_env/bin/python3 -m demucs -n htdemucs "输入音频.mp3"

# 旧模型 mdx_extra_q（某些场景可能更好）
/private/tmp/demucs_env/bin/python3 -m demucs -n mdx_extra_q "输入音频.mp3"

# 精细模型 htdemucs_ft（更慢但可能更好）
/private/tmp/demucs_env/bin/python3 -m demucs -n htdemucs_ft "输入音频.mp3"
```

### 指定输出格式为 MP3

```bash
/private/tmp/demucs_env/bin/python3 -m demucs --two-stems vocals --mp3 -o /private/tmp/demucs_output "输入音频.mp3"
```

## 执行建议

- 处理一首 3-4 分钟的歌大约需要 **2 分钟**（Apple Silicon）
- 首次运行会下载模型文件 (~80MB)，之后会缓存在 `~/.cache/torch/hub/checkpoints/`
- 建议用 `nohup ... &` 后台执行，用 `ps -p PID` 检查状态
- 日志用 `tail -1 logfile` 查看进度百分比

## 后续处理（人声转乐器）

分离出人声后，可以进一步做音色转换：

### 方案 A：MIDI 中转
1. 用 `basic-pitch` 把人声转 MIDI
2. 用 `fluidsynth` + SoundFont 渲染成目标乐器

```bash
# 安装
/private/tmp/demucs_env/bin/pip install basic-pitch
brew install fluid-synth

# 人声转 MIDI（需要在 Python 中调用）
from basic_pitch.inference import predict_and_save, Model
predict_and_save(
    audio_path_list=['vocals.wav'],
    output_directory='./midi_output',
    save_midi=True,
    sonify_midi=False,
    save_model_outputs=False,
    save_notes=False,
    model_or_model_path=Model.ICASSP_2022,  # 检查可用模型: dir(Model)
)

# MIDI 渲染为乐器
fluidsynth -ni soundfont.sf2 vocals_basic_pitch.mid -F output_flute.wav
```

本机可用的 SoundFont 文件：
- `/Users/yay/Documents/capella-soundfonts/GeneralUser GS 1.471/GeneralUser GS v1.471.sf2`
- `/Users/yay/Documents/Sion Software/VST Plugins/VintageDreamsWaves-v2.sf2`

### 方案 B：DDSP 音色转换
- Google Magenta DDSP — 直接转换音色，保留表现力
- 需要额外安装 `ddsp` 包

### 方案 C：在线工具
- Google Tone Transfer (https://sites.research.google/tonetransfer)

## 混合最终结果

```bash
# 把转换后的乐器声和原始伴奏混合
ffmpeg -i instrument_track.wav -i no_vocals.wav -filter_complex amix=inputs=2:duration=longest output_final.wav
```
