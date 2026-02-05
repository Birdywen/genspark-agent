# Newzik OMR Skill

将 PDF 乐谱转换为 MusicXML 格式，使用 Newzik 云端 OMR (光学音乐识别) 服务。

## 快速开始

```bash
# 1. 进入工作目录（或复制工具到新目录）
cd /Users/yay/workspace/popular-classics-split

# 2. 把 PDF 文件放入 songs/ 目录
mkdir -p songs
cp /path/to/*.pdf songs/

# 3. 一键完成全流程（上传 → OMR → 下载）
node newzik-manager.js auto ./songs

# 或分步执行：
node newzik-manager.js upload ./songs   # 上传
node newzik-manager.js submit 10        # 提交 OMR
node newzik-manager.js status           # 查看进度
node newzik-manager.js download         # 下载结果

# 4. 实时监控进度
node watch.js 15

# 5. 结果在 converted/ 目录
ls converted/*.musicxml
```

## 概述

此 Skill 提供完整的 PDF 乐谱处理流程：
1. PDF 拆分 - 将乐谱集按目录拆分为单曲（使用 Ghostscript）
2. 上传到 Newzik - 支持多页 PDF（自动检测页数）
3. OMR 转换 - 云端识别乐谱（有速率限制，建议每批 5-8 个）
4. 下载 MusicXML - 获取转换结果

## 工具文件

| 文件 | 说明 |
|------|------|
| `newzik-manager.js` | 主管理工具，支持所有操作 |
| `newzik-auth.js` | 登录认证，Token 过期时使用 |
| `watch.js` | 实时监控 OMR 进度 |
| `state.json` | 处理状态（自动生成） |
| `songs/` | PDF 源文件目录 |
| `converted/` | MusicXML 输出目录 |

## 命令速查

| 命令 | 说明 |
|------|------|
| `node newzik-manager.js status` | 查看状态和 OMR 进度 |
| `node newzik-manager.js upload ./songs` | 上传 PDF（跳过已存在） |
| `node newzik-manager.js submit 10` | 提交 10 个 OMR 任务 |
| `node newzik-manager.js download` | 下载已完成的 MusicXML |
| `node newzik-manager.js auto ./songs` | 自动完成全流程 |
| `node newzik-manager.js cleanup` | 删除重复曲目 |
| `node newzik-manager.js purge` | 清空回收站 |
| `node newzik-manager.js delete "关键字"` | 删除匹配的曲目 |
| `node watch.js 15` | 每 15 秒刷新的实时监控 |

## 认证配置

凭证存储在 `~/.agent_secrets`:

```
NEWZIK_USERNAME=your@email.com
NEWZIK_PASSWORD=yourpassword
NEWZIK_ACCESS_TOKEN=eyJ...
NEWZIK_USER_UUID=XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX
NEWZIK_REFRESH_TOKEN=eyJ...
```

Token 过期时运行 `node newzik-auth.js` 会打开浏览器自动登录并更新。

## PDF 拆分（可选）

如果需要从乐谱集中提取单曲，使用 Ghostscript：

```bash
# 提取第 4-5 页为一首曲目
gs -sDEVICE=pdfwrite -dNOPAUSE -dBATCH -dQUIET \
   -dFirstPage=4 -dLastPage=5 \
   -sOutputFile="songs/01-Song_Name.pdf" "source.pdf"
```

## 状态管理

`state.json` 自动跟踪处理进度：

```json
{
  "completed": ["曲目1", "曲目2"],
  "processing": {
    "曲目3": "part-uuid-xxx"
  }
}
```

## 注意事项

1. **速率限制**: Newzik 限制并发 OMR 任务，遇到 429 错误等待几分钟
2. **多页 PDF**: 自动检测页数（需要 ImageMagick）
3. **重复上传**: 如果上传时报错但实际成功了，用 `cleanup` 清理重复
4. **Token 过期**: 401 错误时运行 `newzik-auth.js`

## API 端点参考

| 功能 | 端点 | 方法 |
|------|------|------|
| 曲目列表 | `/ws4/musicians/{uuid}/pieces` | GET |
| 删除曲目 | `/ws4/musicians/{uuid}/pieces` | DELETE |
| 上传文件 | `/ws3/file/data/{fileUuid}` | POST |
| 创建元数据 | `/ws3/song/{pieceUuid}` | PUT |
| 提交 OMR | `/ws4/omr/part/{partUuid}/submit` | POST |
| OMR 状态 | `/ws4/omr/part/{partUuid}/jobs/latest` | GET |
| 下载 XML | `/ws4/omr/part/{partUuid}/jobs/latest/output/xml` | GET |
| 回收站 | `/ws4/recently-deleted` | GET |
| 彻底删除 | `/ws4/recently-deleted/{uuid}/purge` | DELETE |

## 依赖

- Node.js 18+
- ImageMagick（检测 PDF 页数）
- Ghostscript（拆分 PDF，可选）
- Playwright（自动登录，可选）
