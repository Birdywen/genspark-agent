
## gizChat AI 生成内容与文稿不匹配
**问题**: 新闻视频流水线中，step5(图片)、step5(缩略图)、step8(标题) 调用 gizChat 生成内容时，AI 模型忽略传入的文稿内容，输出了与文稿无关的话题（如文稿讲两会，标题却是"AI决定战争"）
**原因**: giz.ai 模型可能受对话上下文污染，或对 prompt 中的文稿内容关注度不够
**解决**: 在所有 gizChat 调用的 system prompt 和 user prompt 中强调 "STRICTLY based on the provided script content"、"NEVER invent topics not in the script"、"Do NOT use topics from other conversations"

## 新闻视频主题按天轮转导致重复
**问题**: defaultTopics 6个主题用 getDate()%6 轮转，同一天内多次运行选同一个主题；7天窗口内主题很快用完后 fallback 也是固定的
**解决**: 改为统计最近48h每个主题使用次数，先shuffle再按使用次数升序排序，选最少使用的。同时在 step3 prompt 中注入最近72h已做视频标题（最多15条），要求AI避免重复角度

## SSH 命令超时导致重复启动
**问题**: 用 run_command + ssh 启动 nohup 远程进程时，SSH连接可能超时但进程已启动，重试导致重复实例
**解决**: 优先使用 ssh-oracle:exec 工具（不走本地SSH超时），启动后立即用 ps aux 检查是否有重复进程
