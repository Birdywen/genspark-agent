---
name: supabase
description: Supabase 后端即服务 (BaaS)，提供 PostgreSQL 数据库、身份认证、实时订阅、存储等，免费套餐适合小项目
---

# Supabase

Supabase 是开源的 Firebase 替代品，提供 PostgreSQL 数据库 + RESTful API + 实时订阅 + 身份认证 + 文件存储。

## 已有项目

| 项目 | Ref ID | 用途 |
|------|--------|------|
| cny-website | gqzkywxxdtmwrcmvsrnr | 农历新年网站祝福留言板 |

## 凭据

```
项目 URL: https://gqzkywxxdtmwrcmvsrnr.supabase.co
Anon Key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdxemt5d3h4ZHRtd3JjbXZzcm5yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE0MzcxNzksImV4cCI6MjA4NzAxMzE3OX0.G_VEfkhrGC4ncEIV7xTBjKYBDJAjDCATC-ZPivaSnD0
控制台: https://supabase.com/dashboard
```

## API 操作 (curl)

Supabase 的 REST API 基于 PostgREST，所有操作都可以用 curl 完成。

### 通用 Header

```bash
-H 'apikey: <ANON_KEY>' \
-H 'Authorization: Bearer <ANON_KEY>' \
-H 'Content-Type: application/json'
```

### 查询数据 (SELECT)

```bash
# 查询所有记录
curl -s '<URL>/rest/v1/<表名>?select=*' \
  -H 'apikey: <KEY>' -H 'Authorization: Bearer <KEY>'

# 带条件、排序、分页
curl -s '<URL>/rest/v1/<表名>?select=*&order=created_at.desc&limit=50' \
  -H 'apikey: <KEY>' -H 'Authorization: Bearer <KEY>'

# 过滤条件
?name=eq.test          # 等于
?age=gt.18             # 大于
?name=like.*test*      # 模糊匹配
?id=in.(1,2,3)         # IN 查询
```

### 插入数据 (INSERT)

```bash
curl -s -X POST '<URL>/rest/v1/<表名>' \
  -H 'apikey: <KEY>' -H 'Authorization: Bearer <KEY>' \
  -H 'Content-Type: application/json' \
  -H 'Prefer: return=representation' \
  -d '{"name":"value","message":"hello"}'
```

### 更新数据 (UPDATE)

```bash
curl -s -X PATCH '<URL>/rest/v1/<表名>?id=eq.1' \
  -H 'apikey: <KEY>' -H 'Authorization: Bearer <KEY>' \
  -H 'Content-Type: application/json' \
  -H 'Prefer: return=representation' \
  -d '{"message":"updated"}'
```

### 删除数据 (DELETE)

```bash
curl -s -X DELETE '<URL>/rest/v1/<表名>?id=eq.1' \
  -H 'apikey: <KEY>' -H 'Authorization: Bearer <KEY>'
```

## 前端 JS SDK

```html
<!-- UMD 方式引入 -->
<script src="supabase.js"></script>
<!-- 或 CDN -->
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>

<script>
var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// 查询
sb.from('表名').select('*').order('created_at', {ascending: false}).limit(50)
  .then(function(res) { console.log(res.data); });

// 插入
sb.from('表名').insert([{name: 'test', message: 'hello'}])
  .then(function(res) { console.log(res); });
</script>
```

## 踩坑记录

1. **anon key 的 RLS 权限**：anon 角色默认受 Row Level Security 限制。DELETE 返回 204 但不实际删除说明 anon 没有 DELETE 权限，需通过 Supabase 控制台或 service_role key 操作
2. **CDN 引入建议用本地文件**：避免 CDN 加载失败导致整个功能不可用，可 curl -o supabase.js 下载到本地引用
3. **UMD 全局变量**：v2 的 UMD 版本暴露 window.supabase，createClient 在 window.supabase.createClient
4. **CORS**：Supabase 默认允许所有 Origin 的 CORS 请求，前端直接调用 REST API 没问题
限制**：500MB 数据库、1GB 文件存储、50000 月活用户、每日 500MB 带宽（对小项目完全够用）
