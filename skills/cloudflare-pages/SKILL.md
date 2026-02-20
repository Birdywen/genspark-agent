---
name: cloudflare-pages
description: Cloudflare Pages 静态网站部署，支持命令行一键部署、API 部署、项目管理
---

# Cloudflare Pages 部署

通过 wrangler CLI 将静态网站部署到 Cloudflare Pages。

## 环境配置

已配置在 `~/.zshrc`:

```bash
export CLOUDFLARE_API_TOKEN="7lVFRUKBA-wK0I95hkgNBX8_cz-b9v4MjK777LCR"
export CLOUDFLARE_ACCOUNT_ID="686f72167174a0d1017c4a9fb4786ed6"
```

## 部署命令

```bash
# 部署静态网站到 Cloudflare Pages
cd <项目目录> && npx wrangler pages deploy . --project-name=<项目名>

# 带提交信息
npx wrangler pages deploy . --project-name=<项目名> --branch=main --commit-message='描述'
```

## 注意事项

- **必须设置 CLOUDFLARE_ACCOUNT_ID**：不设置的话 wrangler 会去调 `/user` API 导致 403 错误后中断
- wrangler 通过 npx 调用，不需要全局安装
- 每次部署会创建新版本，自动覆盖旧版本
- 免费套餐：无限带宽、每月500次构建、支持自定义域名和自动 HTTPS

## 已有项目

| 项目名 | 线上地址 | 本地目录 |
|--------|----------|----------|
| lunar-new-year | https://lunar-new-year-1ng.pages.dev | /Users/yay/workspace/cny-website |

## API 方式查询

```bash
# 列出所有 Pages 项目
curl -s 'https://api.cloudflare.com/client/v4/accounts/686f72167174a0d1017c4a9fb4786ed6/pages/projects' \
  -H 'Authorization: Bearer $CLOUDFLARE_API_TOKEN' | jq '.result[]?.name'
```

## 踩坑记录

1. **Global API Key 不能用于 wrangler**：必须创建 API Token（在 Profile > API Tokens 页面），权限需要 Account > Cloudflare Pages > Edit
2. **wrangler 调 /user 返回 403**：Token 没有 User > User Details > Read 权限时会出现，解决办法是设置 `CLOUDFLARE_ACCOUNT_ID` 环境变量绕过
3. **浏览器缓存**：部署后用户需要 Cmd+Shift+R 强制刷新才能看到最新版本
