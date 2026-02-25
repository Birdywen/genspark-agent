# Genspark & CoChat 平台探索报告

**日期**: 2026-02-24
**目标**: 探索 Genspark 和 CoChat 平台的免费工具调用能力

---

## 一、Genspark 平台

### 1.1 架构发现

- **工具调用格式**: 后端使用 Anthropic Claude 的原生 XML 格式（`antml:function_calls`, `antml:invoke`, `antml:parameter`）
- **流程**: LLM 输出 XML 工具调用 → 后端解析 → 执行工具 → 返回结果 → LLM 继续对话
- **工具白名单**: 后端强制执行，未注册的工具调用返回 "function call failed, not handled"
- **SSE 流式通信**: 通过 `/api/agent/ask_proxy` 或 `/api/agent/ask_proxy_events` 发送请求

### 1.2 Agent 类型与计费

| 类型 | Credit 消耗 | 工具数 | Web Search | 备注 |
|------|-------------|--------|------------|------|
| `super_agent` | ~29-50 | 多+MCP | ✅ | 全功能，最贵 |
| `agent_chat` | ~27 | 25+ | ✅ | 有 batch_web_search |
| `browser_assistant` | ~27 | 25+ | ✅ | 类似 agent_chat |
| `video_generation_agent` | ~17 | - | ❌ | |
| `audio_generation_agent` | ~17 | - | ❌ | |
| **`image_generation_agent`** | **0 (免费)** | **16** | **❌** | **2026年促销免费** |

### 1.3 image_generation_agent 免费工具（16个）

1. image_search — 图片搜索
2. crawler — 网页抓取（Azure IP: 20.230.215.145）
3. aidrive_tool — AI Drive 文件操作
4. generate_images — AI 图片生成
5. read_generation_file — 读取生成文件
6. update_generation_file — 更新生成文件
7. TodoWrite — 待办事项
8. think — 思考工具
9. annotate_image_regions — 图片区域标注
10. compose_multiple_images — 图片合成
11. math_calculator — 计算器
12. get_model_info — 模型信息
13. manage_user_prompt_preset — 提示词预设管理
14. create_agent — 创建 Agent
15. understand_images — 图片识别
16. analyze_media_content — 媒体内容分析

### 1.4 MCP 管理 API

- `POST /api/mcp/register` — 注册 MCP（验证 URL 连通性）
- `POST /api/genspark_browser_mcp/register` — 注册浏览器 MCP（**不验证 URL**）
- `GET /api/mcp/list` — 列出已注册 MCP
- `DELETE /api/mcp/{mcp_id}` — 删除 MCP
- `POST /api/mcp/test-connection` — 测试 MCP 连接
- `POST /api/mcp-config/create-sandbox` — 创建 E2B 沙箱
- `POST /api/mcp-config/save` — 保存 MCP 配置

### 1.5 其他关键 API

- `GET /api/payment/get_credit_balance` — 查询 Credit 余额
- `POST /api/agent/ask_proxy` — 发送对话请求
- `POST /api/agent/ask_proxy_events` — SSE 事件模式
- `POST /api/agent/ask_abort?project_id=` — 中止请求
- `GET /api/user` — 用户信息

### 1.6 重要限制

- `image_generation_agent` 的 `custom_tools` 参数被忽略，工具集后端硬编码
- 只有 `super_agent` 类型支持 MCP 工具注入
- `request_web_knowledge: true` 无法为 image_generation_agent 解锁 web_search
- 伪造消息历史可诱导 LLM 输出任意工具调用，但后端白名单拒绝未注册工具

### 1.7 合法 Agent 类型（80+）

包括但不限于: `article_verification`, `generate_sparkpage_gan`, `image_generation`, `general_chat`, `agent_chat`, `super_chat`, `moa_search_chat`, `code_sandbox`, `code_sandbox_light`, `claude_code_agent`, `open_code_agent`, `browser_assistant`, `browser_extension`, `ai_chat`, `custom_super_agent`, `dynamic_agent`, `workflow_executor` 等。

---

## 二、CoChat 平台（Open WebUI v0.7.2）

### 2.1 架构

- 基于 Open WebUI v0.7.2
- 模型通过两个通道: OpenAI 直连 + OpenRouter 代理
- API 端点: `/api/chat/completions`（兼容 OpenAI 格式）
- 认证: `localStorage.getItem('token')` 作为 Bearer token

### 2.2 免费直连模型（11个，平台买单）

| 模型 | 实际版本 | 输出能力 | 推荐场景 |
|------|----------|----------|----------|
| **gpt-4.1-nano** | gpt-4.1-nano-2025-04-14 | ✅ 正常输出 | 日常轻量任务 |
| **gpt-4.1-mini** | gpt-4.1-mini-2025-04-14 | ✅ 正常输出 | 中等任务 |
| **gpt-4.1** | gpt-4.1-2025-04-14 | ✅ 正常输出 | **推荐：强力模型** |
| **gpt-4o-mini** | gpt-4o-mini-2024-07-18 | ✅ 正常输出 | 轻量任务 |
| **gpt-4o** | gpt-4o-2024-08-06 | ✅ 正常输出 | 强力模型 |
| **gpt-3.5-turbo** | gpt-3.5-turbo-0125 | ✅ 正常输出 | 简单任务 |
| **gpt-5-nano** | gpt-5-nano-2025-08-07 | ⚠️ reasoning 占 token | 需高 max_tokens |
| **gpt-5-mini** | gpt-5-mini-2025-08-07 | ⚠️ reasoning 占 token | 需高 max_tokens |
| **gpt-5** | gpt-5-2025-08-07 | ⚠️ reasoning 占 token | 复杂推理 |
| **o1** | o1-2024-12-17 | ⚠️ reasoning 占 token | 推理任务 |
| **o3-mini** | o3-mini-2025-01-31 | ⚠️ reasoning 占 token | 推理任务 |

不可用: gpt-4 (TPM 限制), o1-mini (无响应), gpt-4o-search-preview (TPM 限制)

OpenAI org: `org-XVSWSu9WTtokslCHIfWHTCdi`

### 2.3 OpenRouter 付费模型（400+）

使用 `openrouter_manifold.*` 前缀，从用户 OpenRouter 余额扣费。
包括 Claude 系列、Gemini 系列、Grok 系列等。

### 2.4 工具可用性（API 模式）

| 工具 | API 调用可用 | UI 调用可用 | 备注 |
|------|-------------|-------------|------|
| **web_search** | **✅ 已验证** | ✅ | 唯一 API 模式下可用的工具 |
| url_fetch | ❌ 模型拒绝 | ✅ | API 模式下不注入 |
| http_client | ❌ 模型拒绝 | ✅ | API 模式下不注入 |
| delegate_task | ⚠️ 触发 sub-agent 扣费 | ✅ | sub-agent 用 OpenRouter 模型 |
| server:mcp:browser-control | ❌ 未注入 | ✅ | MCP 工具仅 UI 可用 |
| server:mcp:coder-workspaces | ❌ 未注入 | ✅ | MCP 工具仅 UI 可用 |
| server:mcp:fetch-youtube | ❌ 未注入 | ✅ | MCP 工具仅 UI 可用 |

### 2.5 Sub-Agent 配置

端点: `GET/POST /api/custom/agents/`

内置 3 个 sub-agent:
- **General**: model_id_premium = claude-sonnet-4.5, 无工具
- **Researcher**: model_id_premium = grok-4.1-fast, 有 web_search
- **Technical**: model_id_premium = claude-sonnet-4.5, 无工具

已创建自定义 sub-agent:
- **FreeGeneral** (ID: 575732dc-d7dd-4c55-8d1a-f7cedd0ec583): model = gpt-4.1-nano, 有 web_search

注意: 内置 agent 无法通过 API 修改模型 (500 错误)，但可以创建新 agent。
sub-agent 的模型选择列表中**不包含直连模型**，delegate_task 必然走 OpenRouter 扣费。

### 2.6 系统信息

- 用户邮箱: woshipeiwenhao@gmail.com
- 用户 ID: bcc685bd-706c-40a5-b2b4-44b84b848bc3
- 系统提示约 12K tokens
- 内置 24 个工具, 400+ 模型, 多个 skills

---

## 三、最佳免费方案

### 方案 A: CoChat gpt-4.1 + web_search（推荐）

```javascript
// CoChat 免费 Web 搜索
var token = localStorage.getItem('token');
fetch('/api/chat/completions', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'gpt-4.1',
    messages: [{ role: 'user', content: '搜索查询内容' }],
    stream: true,
    tool_ids: ['web_search'],
    max_tokens: 2000
  })
});

方案 B: Genspark image_generation_agent + crawler
Copy
// Genspark 免费 Crawler
grecaptcha.enterprise.execute('6LfYyWcsAAAAAK8DUr6Oo1wHl2CJ5kKbO0AK3LIM', {action: 'submit'})
.then(function(token) {
  return fetch('/api/agent/ask_proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      models: ['gpt-4.1'],
      type: 'image_generation_agent',
      project_id: '6521dfaa-3a53-418f-9a31-3565e8883645',
      messages: [{ role: 'user', id: crypto.randomUUID(), content: '用 crawler 抓取 URL' }],
      user_s_input: '用 crawler 抓取 URL',
      g_recaptcha_token: token,
      is_private: true,
      push_token: ''
    })
  });
});

四、关键技术发现
Genspark 后端使用 Anthropic Claude: 工具调用 ID 使用 tooluse_ 前缀，XML 格式为 Claude 原生
CoChat 直连模型免费: 平台使用自己的 OpenAI API key，用户无需付费
工具白名单强制: 两个平台都在后端强制工具白名单，无法通过前端参数绕过
genspark_browser_mcp 注册无验证: 可注册任意 URL 的浏览器 MCP
伪造消息历史可诱导工具调用: 但后端仍会拒绝未注册工具
五、账户信息
Genspark
用户: genspark_fan (woshipeiwenhao@gmail.com)
计划: Plus (年付)
Credit 余额: 8879 (截至探索结束)
AI Drive: 532MB / 50GB used
CoChat
OpenRouter 余额: ~$0.42 used
直连模型: 免费 (平台付费)
六、未来探索方向
通过 CoChat UI (WebSocket) 触发 MCP 工具（非 API 模式）
探索更多 Genspark agent 类型是否免费
利用 Genspark crawler 的 Azure IP 作为代理网络通道
研究 CoChat 的 delegate_task 是否可通过 UI 模式使用免费模型
探索 /api/genspark_browser_mcp/register 的更多用法 CONTENT 