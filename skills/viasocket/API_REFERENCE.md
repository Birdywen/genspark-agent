# Viasocket Flow API 参考文档

> 基于 2026-02-21 实际浏览器抓包验证，所有 endpoint 均经过真实请求确认。

## Authentication

所有请求需要 `proxy_auth_token` header，值为 `flow.viasocket.com` 页面的 `prod` cookie（base64 编码 session token，长度 256 字符）。

```
Header: proxy_auth_token: <prod_cookie_value>
```

Token 过期时间由 `expire_at` cookie 控制（Unix timestamp）。
当前 token 存放于: `/private/tmp/viasocket_token.txt`

## Base URLs

| 用途 | Base URL |
|------|----------|
| 管理 API（CRUD） | `https://flow-api.viasocket.com` |
| 执行 API（运行 flow） | `https://flow.sokt.io` |

## ID 格式与前缀

| 类型 | 前缀 | 示例 |
|------|------|------|
| Project ID | `proj` | `proj54490`, `projWkXVDm0k` |
| Script ID | `scri` | `scri42hM0QuZ`, `scri0r5ob8Xz` |
| Step ID | `func` | `funcAT1uB8lP`, `func6IVN49dJ` |
| Plugin ID | `row` | `rowqm5xi2`（Google Sheets） |
| Action ID | `row` | `rowlpijbo5k1`（List Sheet Rows） |
| Auth ID | `auth` | `auth2HvM1Tij` |
| Auth Version | `row` | `rowinjz4a5rt` |
| Org ID | 纯数字 | `54490` |
| User ID | 纯数字 | `78404` |

---

## 一、Organization / Project

### 获取项目列表（含 flows）
```
GET /orgs/{orgId}/projects?type=flow&bringflows=true
```
返回所有项目，每个项目包含其下的 flow 列表（id, title, status, updated_at）。

### 获取用户组织详情
```
GET /orgs/user-org/details
```

### 获取组织所有 Auth
```
GET /authtoken/org/{orgId}/auth
```

---

## 二、Scripts（Flow 容器）

### 创建 Script
```
POST /projects/{projectId}/scripts
Content-Type: application/json

Body: {"title": "Flow名称", "type": "flow"}
```
**已验证**: 返回 `{"success": true, "data": {"id": "scri0r5ob8Xz", ...}}`

### 获取所有 Scripts
```
GET /projects/{projectId}/scripts
```

### 获取单个 Script（含完整 flow 定义）
```
GET /projects/{projectId}/scripts/{scriptId}?type=flow
```
返回 `json_script`（步骤定义）、`used_variables`（变量绑定）、`title`、`description` 等。

### 更新 Script
```
PUT /projects/{projectId}/scripts/{scriptId}
```

### 修改 Script 状态
```scripts/{scriptId}/status
```
Status 值: 1=active, 3=draft/inactive

### 发布 Script
```
PUT /projects/{projectId}/scripts/{scriptId}/publish
```
**已验证**: 返回 201 `"Flow published successfully"`

### 删除 Script
```
DELETE /projects/{projectId}/scripts/{scriptId}
```

---

## 三、Steps（Flow 步骤）

> ⚠️ **路径注意**: Create 和 Update 的路径结构不同！

### 创建 Step

```
POST /scripts/{projectId}/{scriptId}/stepv2
Content-Type: application/json
```

**JS Code 类型（type: function）:**
```json
{
  "type": "function",
  "title": "JS_Code",
  "orderGroup": "root",
  "position": 0,
  "stepId": "funcuwdWpIHH"
}
```

**Plugin 类型（type: plugin）:**
```json
{
  "type": "plugin",
  "title": "List_Sheet_Rows",
  "orderGroup": "root",
  "position": 0,
  "stepId": "func6IVN49dJ",
  "actionId": "rowlpijbo5k1",
  "iconUrl": "https://stuff.thingsofbrand.com/google.com/images/img4_googlesheet.png",
  "configurationJson": "",
  "configurationJsonEncrypted": ""
}
```

**字段说明:**
- `type`: `"function"`（JS 代码）| `"plugin"`（第三方 app）| `"api"`（HTTP 请求）| `"ifBlock"`（条件）| `"delay"`（延迟）
- `stepId`: 客户端生成，格式 `"func"` + 8-10 位随机字母数字
- `actionId`: 仅 plugin 类型需要，从 DbDash 查询获得
- `orderGroup`: `"root"` 表示主流程，条件分支时用其他值
- `position`: 在 orderGroup 中的位置索引（从 0 开始）

### 更新 Step（写入代码/配置）

```
PUT /scripts/{scriptId}/stepv2/{stepTitle}
Content-Type: application/json
```

> ⚠️ 注意：路径中 **没有 projectId**，且用 **stepTitle**（不是 stepId）！

**Plugin 类型 Update Body:**
```json
{
  "type": "plugin",
  "code": {
    "type": "action",
    "source": "完整的 JS 执行代码..."
  }
}
```

### 删除 Step
```
DELETE /scripts/{scriptId}/stepv2/{stepTitle}
```

---

## 四、Plugin Auth 绑定链路

当添加 plugin step 后，需要绑定用户的 OAuth 授权。完整链路：

### 1. 查询 flow 中该 plugin 的 auth 绑定状态
```
GET /authtoken/orgid/{orgId}/projectid/{projectId}/scriptid/{scriptId}/serviceid/{pluginId}/version/{authVersion}
```
示例: `GET /authtoken/orgid/54490/projectid/proj54490/scriptid/scri0r5ob8Xz/serviceid/rowqm5xi2/version/rowinjz4a5rt`

### 2. 获取 auth 配置详情
```
GET /dbdash/getpluginbyplugid/auth?pluginrecordid={pluginId}&rowid={authVersion}&addRandomId=true
```

### 3. 验证现有 auth 是否有效
```
GET /authtoken/authvalid/{authId}_{pluginId}
```
示例: `GET /authtoken/authvalid/auth2HvM1Tij_rowqm5xi2`

**已知已授权的 auth:**
- Google 账号: authId = `auth2HvM1Tij`, 绑定 pluginId = `rowqm5xi2`（Google Sheets）

---

## 五、DbDash（插件/Action 发现）

### 搜索 Plugin（按关键词）
```
GET /dbdash/getplugin?orgId={orgId}&type[]=action,custom_action&query={搜索词}
```

### 获取内置 Plugin 列表
```
GET /dbdash/getplugin?categoryFilter=isbuiltinplugin=true&fields[]=iconurl&fields[]=rowid&fields[]=name&fields[]=domain&fields[]=description&fields[]=preferedauthtype&fields[]=preferedauthversion&fields[]=istriggeravailable
```

### 按 inId 过滤
```
GET /dbdash/getplugin?&pluginFilter=["{pluginId}"]
```

### 获取 Plugin 的所有 Actions
```
GET /dbdash/getpluginbyplugid/action?pluginrecordid={pluginId}&type=action&status=published
```

### 获取特定 Action 详情（含代码模板）
```
GET /dbdash/getpluginbyplugid/action?rowid={actionId}
```
返回 action 的完整信息，包括预置的 JS 代码模板。

### 获取多个 Plugin 详情
```
GET /dbdash/getpluginbyplugid/action?rowid={actionId1},{actionId2},{actionId3}
```

### 获取 Plugin 的所有 Actions（带详细字段）
```
GET /dbdash/getpluginbyplugid/action?orgId={orgId}&fields=type,rowid,name,pluginrecordid,pluginname,iconurl,description,category,authidlookup,authtype,sub_category,used_count&type=action,custom_action&pluginrecordid={pluginId}
```

### 获取所有 Plugins with Events
```
GET /dbdash/getpluginsWithEvents
```

### 推荐下一步 Action
```
GET /dbdash/getplugin?orgId={orgId}&type[]=action,custom_action&actions=["{actionRowId}"]
```

---

## 六、执行 Script

### Run Script（GET - Webhook 触发）
```
GET https://flow.sokt.io/func/{scriptId}
Headers: Proxy-auth-token: <token>
```

### Run Script（POST）
```
POST https://flow.sokt.io/scripts/{scriptId}/functions/test
Content-Type: application/json
Headers: Proxy_auth_token: <token>

Body: { webhook payload }
```

### Dry Run
```
POST https://flow.sokt.io/func/{scriptId}/test
Content-Type: application/json
Headers: Proxy_auth_token: <token>
```

---

## 七、Logs

### 获取 Script 执行日志
```
GET /logs/projectid/{projectId}/scriptid/{scriptId}?page=1&limit=40&key=&search=scriptId&advanced=false&filter={}&inProject=false&getCount=false
```

---

## 八、其他

### Scripts Analytics
```
GET /steps_data/{orgId}/scripts-analytics
```

### Chatbot 会话
```
GET /chatbot/getSubThreadConversation/{threadId}/{projectId}/{scriptId}?versionId={versionId}
GET /chatbot/getAllSubThreads/{projectId}
```

### 获取示例提示
```
GET /utility/script/run/SAMPLE_USECASE_PROMPTS?workspaceName={name}
```

### 获取 DocStar Token
```
GET /utility/getDocstarToken
```

### RTLayer Token
```
GET /rtlayer/token?mode=general
```

---

## Flow JSON 结构（json_script）

```json
{
  "version": "6.1.0",
  "identifier": "scriXXXXX",
  "trigger": {
    "type": "published",
    "triggerType": "webhook",
    "userId": 78404
  },
  "order": {
    "root": ["Step1_Title", "Step2_Title"]
  },
  "blocks": {
    "Step1_Title": {
      "type": "plugin",
      "status": "ACTIVE",
      "iconUrl": "...",
      "service": {
        "eventId": "row...",
        "serviceId": "row...",
        "authVersionId": "auth...",
        "actionVersionId": "row..."
      },
      "identifier": "funcXXXXX"
    },
    "response": {
      "type": "response",
      "status": "DRAFTED",
      "responseType": "default"
    }
  }
}
```

## used_variables 结构

```json
{
  "plugin": {
    "StepTitle": {
      "fieldName": "${context.req.body?.['input_name']}",
      "_fieldName-Type": "string"
    }
  }
}
```

引用其他步骤输出: `${context.res.PreviousStepTitle?.data?.fieldName}`

---

## 已知 Plugin IDs

| App | Plugin ID | Auth Version |
|-----|-----------|-------------|
| Google Sheets | `rowqm5xi2` | `rowinjz4a5rt` |
| YouTube | `row40ifjqhqf` | - |
| viaSocket Table | `rowe71n93` | - |

### YouTube Action IDs
- Upload Video: `row80imzgdul`
- Update Thumbnail: `rowllex9dja4`
- Add to Playlist: `row3dem94p5s`

### Google Sheets Action IDs
- List Sheet Rows: `rowlpijbo5k1`

---

## 当前环境

| 项目 | 值 |
|------|-----|
| Org ID | `54490` |
| Main Project | `proj54490` |
| Draft Project | `projWkXVDm0k` |
| User ID | `78404` |
| Token 文件 | `/private/tmp/viasocket_token.txt` |

---

## Agent 创建 Flow 完整链路

1. **搜索 plugin** → `GET /dbdash/getplugin?orgId=54490&type[]=action,custom_action&query=gmail`
2. **获取 plugin 的 actions** → `GET /dbdash/getpluginbyplugid/action?pluginrecordid={pluginId}&type=action&status=published`
3. **获取 action 详情（含代码模板）** → `GET /dbdash/getpluginbyplugid/action?rowid={actionId}`
4. **创建 script** → `POST /projects/{projectId}/scripts` body: `{"title":"xxx","type":"flow"}`
5. **创建 step** → `POST /scripts/{projectId}/{scriptId}/stepv2` body: 含 type, title, stepId, actionId 等
6. **配置 step（写入代码）** → `PUT /scripts/{scriptId}/stepv2/{stepTitle}` body: 含 code.source
7. **查询 auth 绑定** → `GET /authtoken/orgid/{orgId}/projectid/{projectId}/scriptid/{scriptId}/serviceid/{pluginId}/version/{authVersion}`
8. **验证 auth** → `GET /authtoken/authvalid/{authId}_{pluginId}`
9. **发布** → `PUT /projects/{projectId}/scripts/{scriptId}/publish`
10. **执行** → `GET https://flow.sokt.io/func/{scriptId}` 或 POST dry-run
---

## 验证记录（2026-02-21）

### Update Step 关键细节（已验证）

**function 类型的 PUT body（JS Code step）：**
```json
{
  "type": "function",
  "code": "return 1;_Title",
  "org_id": "54490",
  "project_id": "proj54490",
  "calculateDetailedVariables": false,
  "auth_id": null,
  "action_id": null,
  "stepId": "funcXXXXXXXX",
  "dynamicVariables": {}
}
```

> ⚠️ **`code` 是纯字符串，不是对象！** plugin 类型才用 `{type, source}` 对象格式。

> ⚠️ **`stepId` 必须 ≤ 12 字符**（`func` 前缀 + 8 字符随机串）。超过会报 `value too long for type character varying(12)`。

### stepId 生成规则
- 前缀: `func`
- 随机部分: 8 字符，大小写字母+数字
- 示例: `funcL4y0XvAT`, `funcHello001`, `func6IVN49dJ`

### viasocket 使用 XHR 而非 Fetch
浏览器端的 API 请求通过 XMLHttpRequest 发出（非 fetch），拦截时需 patch XHR。

### 端到端验证通过的完整链路
1. `POST /projects/proj54490/scripts` → 创建 script ✅
2. `POST /scripts/proj54490/{scriptId}/stepv2` → 创建 step ✅
3. `PUT /scripts/{scriptId}/stepv2/{stepTitle}` → 写入代码 ✅
4. `PUT /projects/proj54490/scripts/{scriptId}/publish` → 发布 ✅
5. `POST https://flow.sokt.io/func/{scriptId}` → 执行 ✅
6. `GET /logs/projectid/proj54490/scriptid/{scriptId}` → 查日志 ✅

### 已知搜索 Plugin 的正确方式
```
GET /dbdash/getplugin?query=slack&fields[]=name&fields[]=rowid&fields[]=domain&fields[]=iconurl
```
需要带 `fields[]` 参数，否则 `query` 过滤不生效。

### 已发现的 Plugin IDs
| App | Plugin ID |
|-----|-----------|
| Google Sheets | `rowqm5xi2` |
| Slack | `rowbu58rc` |
| YouTube | `row40ifjqhqf` |
| HubSpot | `rowqfz6bv` |
| Airtable | `rowk7lb9w` |
| LeadConnector | `roworqclq7pi` |
| viaSocket Table | `rowe71n93` |

---

## 补充端点（2026-02-22 验证）

> 以下端点通过 techdoc.viasocket.com 文档发现，并经实际请求验证。

### 复制 ScriptDuplicate）
```
POST /projects/{projectId}/scripts/{scriptId}/duplicate
Content-Type: application/json
Body: {}
```
**已验证** ✅: 返回完整的新 flow 定义，包含新 scriptId、json_script、execution_script。
新 flow 的步骤 ID 会重新生成（与原 flow 不同），title 保持不变。
用途：快速复制现有 flow 作为模板，修改后发布为新 flow。

### 回滚 Script（Revert）
```
PUT /projects/{projectId}/scripts/{Type: application/json
Body: {}
```
**已验证** ✅: 返回 "successfully reverted the Flow"`，将 draft 回滚到上次发布的版本。
**注意**: 必须带空 JSON body `{}`，否则返回 411 Length Required。
用途：发布后发现问题，一键回滚到上一个稳定版本。

### 获取所有 Functions
```
GET /scripts/{scriptId}/functions/
```
**已验证** ✅: 返回该 script 内所有函数/步骤的详情，包含 id、title、code、type。
比 `GET /projects/{projectId}/scripts/{scriptId}?type=flow` 更直接获取代码内容。

### 获取单个 Function 详情
```
GET /scripts/{scriptId}/functions/{functionId}
```
**文档确认**: functionId 即 stepId，需为合法的 12 位标识符。
注意: stepId 小于 12 位时会报 `"identifier" length must be at least 12 characters long`。

### Dry Run（测试执行）
```
POST https://flow.sokt.io/func/{scriptId}/test
Content-Type: application/json
Body: {}（或自定义 payload）
```
**已验证** ✅: 在 flow.sokt.io（vm_baseUrl）上执行，不影响生产数据。
与普通 webhook 触发的区别: 日志中 `isDryRun=true`。

### RTLayer Token（实时层连接）
```
GET /rtlayer/token
```
**已验证** ✅: 返回 JWT token（约 292 字符），用于连接 viaSocket 实时通信层。
Token 包含 orgId、serviceId、uid、room 权限等信息。
用途：可用于实时监听 flow 执行状态（WebSocket 连接）。

### 移动 Script 到其他项目
```
POST /projects/{projectId}/scripts/{scriptId}/move
Content-Type: application/json
Body: {"projectId": "目标projectId"}
```
**文档确认**（未实测）: 将 flow 从当前项目迁移到另一个项目。

### AI 代码优化
```
POST /openai/dh/optimizeCode
Content-Type: application/json
Body: {"code": "代码", "scriptId": "xxx", "apiSlug": "optimizeCode", "pluginName": "xxx", "actionOrTriggerName": "xxx"}
```
**部分验证**: 端点存在，但需要多个必填参数（apiSlug、pluginName、actionOrTriggerName），实用性有限。

### Chatbot 子线程（页面内部使用）
```
GET /chatbot/getSubThreadConversation/{threadId}/{scriptId}/{stepId}?versionId={versionId}
```
**抓包发现**: 点击步骤时页面自动调用，获取该步骤关联的 AI 对话记录。

### 删除 Script（DELETE 方法）
```
DELETE /projects/{projectId}/scripts/{scriptId}/delete
```
**验证失败** ❌: 返回 "Route does not exist"。
实际删除方式仍为: 先 `PUT .../status` 设为 3（pause），再设为 0（delete）。

### 步骤重排序（Reorder）
```
POST /scripts/{scriptId}/reorder
Body: {"order": {"root": ["Step1", "Step2"]}}
```
**验证失败** ❌: 返回 "Route does not exist"（能仅限内部 UI 调存在 CORS 限制）。
替代方案: 创建 flow 时按正确顺序 add_step 即可。

### 步骤状态控制（Step Status）
```
PUT /scripts/{scriptId}/step/{stepId}/status
Body: {"status": 1}
```
**验证失败** ❌: 返回 "Route does not exist"。
替代方案: 通过 update_step 更新整个步骤配置时可设置 status。

### 新发现的 DbDash 端点
```
GET /dbdash/getplugin?pluginFilter=[null]&fields[]=whitelistDomains&fields[]=iconurl&fields[]=rowid&fields[]=name&fields[]=domain&fields[]=description&fields[]=preferedauthtype&fields[]=preferedauthversion&fields[]=istriggeravailable
```
**抓包发现**: 页面加载时自动调用，获取所有可用插件的完整信息，含白名单域名和认证类型偏好。

### 已验证端点完整列表

| 状态 | 方法 | 路径 | 用途 |
|------|------|------|------|
| ✅ | POST | /projects/{pId}/scripts | 创建 Script |
| ✅ | GET | /projects/{pId}/scripts | 获取所有 Scripts |
| ✅ | GET | /projects/{pId}/scripts/{sId}?type=flow | 获取单个 Script |
| ✅ | PUT | /projects/{pId}/scripts/{sId} | 更新 Script |
| ✅ | PUT | /scripts/{sId}/status | 修改状态 |
| ✅ | PUT | /projects/{pId}/scripts/{sId}/publish | 发布 |
| ✅ | PUT | /projects/{pId}/scripts/{sId}/revert | 回滚 |
| ✅ | POST | /projects/{pId}/scripts/{sId}/duplicate | 复制 |
| ✅ | POST | /projects/{pId}/scripts/{sId}/move | 迁移（文档确认） |
| ✅ | POST | /scripts/{pId}/{sId}/stepv2 | 创建步骤 |
| ✅ | PUT | /scripts/{sId}/stepv2/{stepTitle} | 更新步骤 |
| ✅ | DELETE | /scripts/{sId}/stepv2/{stepTitle} | 删除步骤 |
| ✅ | GET | /scripts/{sId}/functions/ | 获取所有函数 |
| ✅ | GET | /scripts/{sId}/functions/{fId} | 获取单个函数 |
| ✅ | GET/POST | flow.sokt.io/func/{sId} | Webhook 执行 |
| ✅ | POST | flow.sokt.io/func/{sId}/test | Dry Run |
| ✅ | GET | /logs/projectid/{pId}/scriptid/{sId} | 查看日志 |
| ✅ | GET | /orgs/{orgId}/projects?type=flow&bringflows=true | 项目列表 |
| ✅ | GET | /authtoken/org/{orgId}/auth | 已授权列表 |
| ✅ | GET | /rtlayer/token | 实时层 Token |
| ✅ | GET | /dbdash/getplugin?query=xxx | 搜索插件 |
| ❌ | DELETE | /projects/{pId}/scripts/{sId}/delete | 不存在 |
| ❌ | POST | /scripts/{sId}/reorder | CORS/路径问题 |
| ❌ | PUT | /scripts/{sId}/step/{stepId}/status | 不存在 |
