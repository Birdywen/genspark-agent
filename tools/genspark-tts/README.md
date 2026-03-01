# Genspark TTS - 语音合成工具

通过逆向 Genspark Audio API 实现的 TTS 语音合成工具。

## 逆向发现

### 可用模型 (6个)
| 模型 | 标签 | Voices 数量 |
|------|------|-------------|
| google/gemini-2.5-pro-preview-tts | Gemini TTS Pro | 673 |
| google/gemini-2.5-flash-preview-tts | Gemini TTS Flash | 673 |
| fal-ai/minimax/speech-2.8-hd | MiniMax TTS | 450 |
| elevenlabs/v3-tts | ElevenLabs V3 TTS | 100 |
| fal-ai/elevenlabs/tts/multilingual-v2 | ElevenLabs TTS V2 | 80 |
| fal-ai/vibevoice/7b | VibeVoice TTS | 24 |

### 支持语言: 24+
英/中/日/韩/法/德/西/葡/俄/阿/荷/波/泰/土/越/罗/乌/孟/马/泰/泰/印尼 等

### API 调用流程



POST /api/agent/ask_proxy

type: "audio_generation_agent"
model_params.model: "google/gemini-2.5-pro-preview-tts"
model_params.voices: ["Kore"]
SSE 返回: project_id + task_id

等待后台异步生成...

POST /api/project/save_agent_multiple_outputs

project_id + file_url
file_url 格式: https://www.genspark.ai/api/files/s/{fileId}

GET /api/files/s/{fileId} → 下载 MP3


### 关键 API

- `GET /api/voice_config` — 获取所有 2000 个 voice 配置
- `GET /api/music_genres` — 获取音乐流派列表
- `POST /api/agent/ask_proxy` — 核心生成 API (SSE)
- `POST /api/project/save-assets-gallery` — 保存生成资源
- `POST /api/project/save_agent_multiple_outputs` — 保存多输出结果
- `GET /api/files/s/{id}` — 下载生成的文件
- `GET /api/is_login` — 检查登录状态
- `GET /api/user/project_bookmark` — 项目书签

### Voice 配置结构
```json
{
  "id": "gemini-kore-chinese",
  "name": "Kore",
  "model": "google/gemini-2.5-pro-preview-tts",
  "gender": "female",
  "age": "adult",
  "style": "firm",
  "language": "chinese",
  "description": "Energetic, youthful female voice conveying confidence",
  "preview_url": "https://cdn1.genspark.ai/..."
}

ask_proxy 请求体
Copy
{
  "models": ["gpt-4.1"],
  "model_params": {
    "type": "audio",
    "model": "google/gemini-2.5-pro-preview-tts",
    "voices": ["Kore"],
    "dialogue": false,
    "background_mode": true
  },
  "type": "audio_generation_agent",
  "messages": [{"role": "user", "content": "要转换的文本"}],
  "user_s_input": "要转换的文本"
}

特殊功能
MiniMax 支持停顿标记: <#0.5#> (0.01-99.99秒)
MiniMax 支持语气词: (laughs), (sighs), (coughs) 等
MiniMax 支持 emotion 参数: happy/sad/angry/neutral 等
MiniMax 支持语速/音量/音调调节
文件说明
voices.csv — 2000 个 voice 完整列表
voice_config_full.json — voice_config API 完整响应 (如有)
genspark-tts.js — 命令行工具 (列表/生成)
tts-generate.js — eval_js 代码生成器
.cookies — 认证 cookie (定期更新)
使用方式
列出中文女声
Copy
node genspark-tts.js --list --lang chinese --gender f

通过 Agent 生成语音

在 Agent 对话中:

eval_js 发起 ask_proxy 请求 (异步)
async_task 轮询页面等待音频出现
提取 /api/files/s/{id} URL
curl 下载 MP3
注意
Cookie 会过期，需要定期从浏览器更新
Cloudflare 会拦截直接的 API 调用，需要通过浏览器 eval_js 绕过
每次生成约消耗 4 个积分
积分到期日: 2026-03-04 CODE 