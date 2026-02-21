---
name: api-server
description: API Server - DeepSeek/Kimi 多模型 Agent，131个MCP工具，支持 tool calling 自动循环
---

# API Server - 多模型 Agent Loop

## 概览

独立 HTTP API 服务器，用 DeepSeek/Kimi 等模型 + 131个MCP工具执行复杂任务。
Claude 做大脑规划，API Server 做执行层。

## 快速启动

```bash
# 默认 Kimi K2.5
bash /Users/yay/workspace/genspark-agent/server-v2/start-api.sh

# 指定模型
bash start-api.sh kimi        # Kimi K2.5 (推荐，3轮完成，格式好)
bash start-api.sh deepseek    # DeepSeek Chat (稳定，4轮完成)
bash start-api.sh kimi-think  # Kimi K2 Thinking (推理增强)
```

## 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| / | GET | 健康检查，返回模型名、工具数 |
| /tools | GET | 列出所有可用工具 |
| /v1/agent | POST | Agent Loop：发 prompt，自动调工具，返回结果 |
| /v1/tool | POST | 直接调用单个工具 |

## 调用示例

### 基本任务
```bash
curl -s -X POST http://localhost:8780/v1/agent \
  -H "Content-Type: application/json" \
  -d '{"prompt":"List directories in /Users/yay/workspace"}'
```

### 指定工具子集（节省 token）
```bash
curl -s -X POST http://localhost:8780/v1/agent \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Read TODO.md", "tools":["read_text_file","write_file","list_directory"]}'
```

### 直接调工具
```bash
curl -s -X POST http://localhost:8780/v1/tool \
  -H "Content-Type: application/json" \
  -d '{"tool":"list_directory","params":{"path":"/Users/yay/workspace"}}'
```

## 模型对比

| 指标 | Kimi K2.5 | DeepSeek Chat |
|------|-----------|---------------|
| 轮次效率 | 3轮 | 4轮 |
| 工具调用 | 精准 | 精准 |
| 计数准确 | 较好 | 偏差大 |
| 输出格式 | 表格+结构化 | 纯文本 |
| 思维链 | 有 reasoning_content | 无 |
| 适合场景 | 精准任务、报告 | 大量输出、批量 |

## 配置文env.api` 位于 `/Users/yay/workspace/genspark-agent/server-v2/.env.api`:
```
DEEPSEEK_API_KEY=sk-xxx
KIMI_API_KEY=sk-xxx
LLM_FORMAT=openai
API_PORT=8780
```

## 架构

```
Claude (SSE/浏览器)          API Server (HTTP)
  |                            |
  | 规划、判断、审查            | 执行、工具调用
  |                            |
  +--- curl POST /v1/agent --> LLM API (Kimi/DeepSeek)
                                |
                                +-- tool_calls --> MCP Hub (131工具)
                                |                    |
                                |                    +-- filesystem (14)
                                |                    +-- playwright (22)
                                |                    +-- shell (1)
                                |                    +-- tree-sitter (26)
                                |                    +-- fetch (1)
                                |                    +-- memory (9)
                                |                    +-- ssh-oracle (7)
                                |                    +-- ssh-cpanel (7)
                                |                    +-- github (26)
                                |                    +-- chrome-devtools (26)
                                |                    +7 (2)
                                |
                                +-- tool_result --> 下一轮 LLM
                                |
                                +-- 最终文本 --> 返回给 Claude
```

## 常见用法

### 1. 让 Kimi/DeepSeek 执行文件操作
```bash
curl -s -X POST http://localhost:8780/v1/agent \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Read /path/to/file and summarize it"}'
```

### 2. 批量数据收集
```bash
curl -s -X POST http://localhost:8780/v1/agent \
  -H "Content-Type: application/json" \
  -d '{"prompt":"List all JS files in genspark-agent/server-v2, count lines in each, write a report to /private/tmp/report.md"}'
```

### 3. 代码生成与写入
```bash
curl -s -X POST http://localhost:8780/v1/agent \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Write a Node.js script at /private/tmp/hello.js that fetches https://api.github.com and prints the response"}'
```

### 4. SSH 远程操作
```bash
curl -s -X POST http://localhost:8780/v1/agent \
  -H "Content-Type: application/json" \
  -d '{"prompt":"SSH to oracle server and check disk usage and running processes"}'
```

## Payload Upload (防 SSE 损坏)

watchdog (port 8766) 提供 /upload-payload 端点:
- content.js 自动将 >200字符的内容通过 HTTP POST 上传
- 服务器从临时文件读取，避免 WebSocket JSON 序列化损坏
- 对 API Server 透明，无需额外配置

## 注意事项

- 启动需 40-50 秒加载 131 个 MCP 工具
- 工具名中的冒号 : 被替换为 __ (DeepSeek 要求工具名只含 a-z0-9_-)_rounds 默30，可在 .env.api 设置 MAX_TOOL_ROUNDS
- API key 不要提交到 git (.env.api 已加入 .gitignore)
