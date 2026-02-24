# CoChat (app.cochat.ai) API 参考

## 认证
- JWT Bearer Token (存于 localStorage.token)
- Header: Authorization: Bearer <token>

## 核心 API

### 模型
- GET /api/v1/models — 获取所有模型 (400+)
- 免费模型 (9个): Llama 3.3 70B, Gemma 3 27B, Mistral Small 3.1, Qwen3 4B/80B, NVIDIA Nemotron 9B, OpenAI gpt-oss-120B, Arcee Trinity Mini, GLM 4.5 Air
- 付费: DeepSeek V3/V3.1/V3.2/R1全系列, Kimi K2/K2.5, Claude Sonnet 4.5, Grok 4.1 Fast

### 聊天
- POST /api/v1/chats/new — 创建聊天 {chat: {name, models, messages}}
- POST /api/chat/completions — 发消息 (OpenAI 兼容格式) {model, messages, stream, max_tokens, chat_id}

### Agents
- GET /api/custom/agents/ — 获取所有 agent
- POST /api/custom/agents/ — 创建 agent (需 name + system_prompt)
- 内置: General (Claude Sonnet 4.5), Researcher (Grok 4.1 + web_search), Technical (Claude Sonnet 4.5 + Bridge)

### Tools (24个)
- GET /api/v1/tools/ — 获取所有工具
- 核心: delegate_task, delegate_tasks, web_search, url_fetch, http_client
- Google: google_drive, google_sheets, google_calendar
- 文档: markdown_document, html_document, python_document
- 管理: automations_tools, activity_tools, chats_tools
- 其他: memory_recall, query_documents, search_conversation_history, send_email, request_tool_access, skill_resources, ui_highlight
- MCP: coder-workspaces (VS Code), browser-control (Chrome 自动化), fetch-youtube

### Skills
- GET /api/custom/skills/?tier=toggleable — 获取可切换 skills
- Creative: Algorithmic Art, Canvas Design, Frontend Design
- Enterprise: Brand Guidelines, Doc Coauthoring, Internal Comms
- Marketing: Competitor Alternatives, Content Strategy, Copywriting, Email Sequence, Launch Strategy, Marketing Ideas, Marketing Psychology, Paid Ads, Pricing Strategy, SEO Audit, Social Content, Copy Editing
- Productivity: Brainstorming, Systematic Debugging
- Tools: Browser Control

### Functions
- GET /api/v1/functions/ — 获取过滤器链
- Filters: adaptive_memory_v2, base_system_prompt_filter, billing_filter, collaborative_context_filter, conversation_context_filter, integration_suggester_filter, message_attribution_filter, moderation_filter, onboarding_filter, skills_context_filter
- Pipe: openrouter_manifold (模型路由)

### Automations
- GET /api/v1/automations/ — 获取自动化任务
- 支持: 一次性提醒, 定期任务, AI 驱动的工作流

### 其他
- GET /api/config — 平台配置
- GET /api/v1/knowledge/ — 知识库
- GET /api/v1/prompts/ — 提示词模板

## 注意事项
- 免费模型走 OpenRouter 共享额度, 高峰期 429 限流
- MCP 工具 (coder-workspaces, browser-control) 为外部服务, 无内置代码
- 所有内置工具为 Python 实现, 可查看完整源码
- 基于 OpenWebUI (SvelteKit), API 结构标准化
