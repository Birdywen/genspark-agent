# Opus Pro (Agent Opus) API Notes

## 认证
- JWT Token，5 分钟有效期，无法自动刷新
- 需要手动登录 opus.pro 获取新 token
- Token 存储在 localStorage: `atom:user:access-token`
- Org ID: `atom:user:org-id`
- User ID: `atom:user:org-user-id`

## 创建项目 API
```
POST https://api.opus.pro/api/project
```

### Headers
- Authorization: Bearer {token}
- Content-Type: application/json
- X-OPUS-ORG-ID: {orgId}
- X-OPUS-USER-ID: {userId}
- X-OPUS-SHARED-ID: (empty)

### Body
```json
{
  "initialText": "话题描述，简洁自然即可",
  "voice": {
    "labels": ["English (US)", "Female", "Entertainment", "Engaging"],
    "name": "Lily",
    "provider": "minimax",
    "type": "voice-over",
    "voiceId": "moss_audio_c12a59b9-7115-11f0-a447-9613c873494c"
  },
  "hookTemplateName": "hook_slidecut_down",
  "enableCaption": true
}
```

### Prompt 最佳实践
- 保持简短自然，不要塞指令
- Opus 的 AI 团队（Scriptwriter、Research Agent、Asset Manager 等）会自动处理
- 好的例子：`Why Do People Watch Others Eat? The Strange Rise of Mukbang Culture`
- 差的例子：`Create a 45-second video about... IMPORTANT FIRST FRAME... Rules:...`（太长，可能导致失败）
- 可选：加来源 URL 让 Opus 参考

### Hook 模板名称
| UI 名称 | API 参数 |
|---------|----------|
| Intelligent pick | (不传或 null) |
| Slide down fast | `hook_slidecut_down` |
| Fast cut | `hook_fast_cut` (待确认) |
| Article highlight | `hook_article_highlight` (待确认) |
| Slide left | `hook_slide_left` (待确认) |
| Glide layout | `hook_glide_layout` (待确认) |
| Wipe cut | `hook_wipe_cut` (待确认) |
| Grid reveal | `hook_grid_reveal` (待确认) |
| Slide left fast | `hook_slide_left_fast` (待确认) |

### 图片引用
- 格式：`@img[filename.jpeg](fileId)`
- fileId 需要先通过页面上传获取，API 暂无公开上传接口
- 示例：`@img[5MvZeqvR.jpeg](5MvZeqvR.jpeg-4a8dae0fea62dcf875c3a30b3a1e96e0)`

## 查询项目状态
```
GET https://api.opus.pro/api/project/{projectId}
```

### 项目阶段
- INITIALIZING → SCRIPTING → GENERATING → EDITOR（完成）
- resultVideo: 完成后的视频 URL
- previewThumbnail: 缩略图 URL

## 查询项目资产
```
GET https://api.opus.pro/api/project/{projectId}/assets
```

## 查询场景
```
GET https://api.opus.pro/api/project/{projectId}/scene
```

## 查询历史
```
GET https://api.opus.pro/api/history/{projectId}?page=1&pageSize=5
```

## 注意事项
- 免费账户有每日配额限制
- 视频生成时间 3-30 分钟不等
- Agent Opus 官方说没有公开 API（我们用的是内部 API）
- 生成完成后会发邮件通知
