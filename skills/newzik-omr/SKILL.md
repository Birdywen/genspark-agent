# Newzik OMR MusicXML → ABC 乐谱处理 Skill

## 概述

Newzik/Maestria OMR v2.7.2 引擎将 PDF 乐谱转为 MusicXML，再通过 `xml2abc_plus.py` 自动修复常见错误并转为 ABC 格式。ABC 格式是纯文本，AI 可直接读取、理解、修正。

## 快速上手

### 1. 查看状态
```bash
cd /Users/yay/workspace/genspark-agent/skills/newzik-omr
node newzik-manager.js status

2. 完整流程（上传 → OMR → 等待 → 下载 → 转 ABC）
Copy
node newzik-manager.js auto ./songs    # 全自动（上传→提交→等待→下载）
# 或分步:
node newzik-manager.js upload ./songs  # 上传 PDF（支持目录或单个文件）
node newzik-manager.js submit          # 提交 OMR
node newzik-manager.js wait            # 等待 OMR 完成（每10秒轮询）
node newzik-manager.js wait --notify & # 后台等待，完成推送手机通知
node newzik-manager.js download        # 下载 MusicXML
python3 xml2abc_plus.py converted/     # 批量转 ABC（含自动修复）

3. Token 过期处理

已自动化 — manager.js 检测到 401/403 会自动用 refresh_token 刷新，新 token 自动写回 ~/.agent_secrets，无需手动操作。

如需手动刷新：

Copy
curl -s -X POST https://prod.newzik.com/uaa/oauth/token \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'grant_type=refresh_token&client_id=newzik&refresh_token=XXX'

xml2abc_plus.py 自动修复项
#	修复类型	说明	示例
1	和弦从 direction 转 harmony	OMR 把和弦放在文本标注里	"Am" direction → Am harmony
2	Garbled 后缀清理	OCR 乱码	"E?" → E, "Am®" → Am
3	复合和弦拆分	两个和弦连写	"AmE" → Am + E
4	斜杠和弦识别	两字母大写	"CE" → C + E
5	Copyright 删除	版权文本混入乐谱	直接移除
6	元数据修正	OCR 拼错的作曲家名等	"ROLF Dowland" → "Rolf Lovland"
7	Key mode 补全	OMR 缺少调式	fifths=0 → minor
8	排练标记修复	方括号/截断	"[Al" → [A], "El" → [E]
xml2abc_plus.py 用法
Copy
# 单个文件
python3 xml2abc_plus.py input.musicxml                # 输出到 stdout
python3 xml2abc_plus.py input.musicxml -o output.abc  # 输出到文件

# 批量转换
python3 xml2abc_plus.py converted/                    # 整个目录
python3 xml2abc_plus.py converted/ -v                 # 显示修复详情

# 只修复 XML，不转 ABC
python3 xml2abc_plus.py input.musicxml --fix-only

# 跳过自动修复（原样转换）
python3 xml2abc_plus.py input.musicxml --no-fix

AI 人工修正流程（自动修复后剩余的问题）

自动修复处理不了的问题：

完全缺失的和弦（OMR 根本没识别到的）
斜杠和弦的低音（Dm 应该是 Dm/A）
错误的音符（需对照 PDF 原谱）

修正方法：

读取 .abc 文件（纯文本，几十行）
对照 PDF 原谱（转 PNG: magick -density 200 input.pdf output_%02d.png）
直接编辑 .abc 文本：和弦用 "Am" 标注，音符用 ABC 记谱法
保存即完成
manager.js 命令参考
命令	说明
status	查看服务器曲目和 OMR 状态
upload <dir|file>	上传 PDF（支持目录或单个文件路径）
submit [n]	提交 n 个 OMR 任务（默认 5）
wait [timeout] [--notify]	等待 OMR 完成（默认 600 秒，--notify 完成后推送手机）
download	下载已完成的 MusicXML
delete <pattern>	删除匹配的曲目（同步清理本地状态）
cleanup	删除重复曲目
trash	查看回收站
purge	清空回收站
auto [dir]	全自动流程：清理→上传→提交→等待→下载
特性
Token 自动刷新 — 401/403 自动用 refresh_token 刷新并重试，新 token 写回 ~/.agent_secrets
详细错误信息 — 上传/提交/下载失败显示 HTTP 状态码和响应内容
智能等待 — wait 命令每 10 秒轮询，只在状态变化时输出，--notify 完成后 ntfy 推送手机
单文件上传 — upload 支持直接传单个 PDF 路径，如 upload ./songs/my-song.pdf
删除同步 — delete 命令同时清理服务器和本地 state.json
API 端点
操作	端点
列曲目	GET /ws4/musicians/{UUID}/pieces
曲目详情	GET /ws3/song/full/full-subentities/{pieceUuid}
上传文件	POST /ws3/file/data/{fileUuid}
提交 OMR	POST /ws4/omr/part/{partUuid}/submit
OMR 状态	GET /ws4/omr/part/{partUuid}/jobs/latest
下载 XML	GET /ws4/omr/part/{partUuid}/jobs/latest/output/xml
Token 刷新	POST /uaa/oauth/token grant_type=refresh_token&client_id=newzik
文件结构
newzik-omr/
├── SKILL.md              # 本文件
├── newzik-manager.js     # 管理器 CLI
├── newzik-auth.js        # 登录认证（Playwright）
├── xml2abc_plus.py       # 增强版转换器（自动修复+转ABC）
├── xml2abc_patched.js    # 原版 xml2abc（浏览器端，已弃用）
├── watch.js              # 文件监听器
├── state.json            # 进度状态
├── songs/                # PDF 上传目录
└── converted/            # 输出目录（.musicxml + .abc）

统计
已完成: 130 首
自动修复: 平均每首 ~7 处
ABC 格式: 平均 ~45 行/首（vs MusicXML ~500 行/首，节省 90% token） EOF 