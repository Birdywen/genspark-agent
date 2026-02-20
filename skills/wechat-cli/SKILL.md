---
name: wechat-cli
description: 微信桌面版命令行控制工具，通过 macOS Accessibility API 读取聊天列表、消息内容，搜索联系人，发送消息
---

# WeChat CLI Skill

通过 macOS Accessibility API 控制微信桌面版（需要老版本微信，持 UI 元素识别）。

## 前提条件

- macOS 微信桌面版（已验证 3.8.x 版本）
- 微信已登录并打开主窗口
- Terminal / Python 已获得辅助功能权限（系统设置 → 隐私与安全 → 辅助功能）
- 微信自动更新已禁用（见下方说明）

## 可执行文件

`/Users/yay/workspace/wechat-cli/wechat可通过 `~/.local/bin/wechat` 访问（已加入 PATH）。

## 命令

| 命令 | 说明 | 示例 |
|------|------|------|
| `wechat list` | 列出所有聊天 | `wechat list` |
| `wechat unread` | 只显示未读聊天 | `wechat unread` |
| `wechat search <name>` | 按名字搜索聊天（模糊匹配） | `wechat search 涛涛` |
| `wechat open <name>` | 打开某人的聊天窗口 | `wechat open 涛涛` |
| `wechat read [name]` | 读取聊天记录（不传 name 读当前聊天） | `wechat read 涛涛` |
| `wechat send <name> <msg>` | 给某人发消息 | `wechat send 涛涛 "你好"` |

## 输出格式

### 聊天列表 (list/unread/search)
```
1. 涛涛 [1 unread]
   哈哈，到家就好
   21:26
```

标记说明：`[N unread]` 未读数，`[muted]` 已静音，`[pinned]` 已置顶

### 消息记录 (read)
```
  --- Apr 23, 2024 22:31 ---
  >> Me: 没啊
  << 涛涛: 祝贺祝贺
```

`>>` 表示自己发送，`<<` 表示对方发送，`---` 为时间分隔线。

## 技术细节

### 聊天列表读取
路径：`Window > SplitGroup > ScrollArea > Table > Row > Cell > (inner AXRow).name`

聊天信息编码在 inner AXRow 的 name 属性中，格式：
`名字,最后消息,时间,N unread message(s)[,Mute Notifications][,Sticky on Top]`

### 消息读取
路径：`Window > SplitGroup > SplitGroup(右侧面板) > ScrollArea(第1个) > Table(Messages) > Row > Cell > (inner element).name`

消息格式：`NameSaid:内容` 或 `MeSaid:内容`，时间戳为独立行。

### 发送消息
三步操作（必须分开执行）：
1. `osascript` 设置输入框 focused = true
2. `osascript` 设置输入框 value = 消息文本
3. `osascript` set frontmost + key code 36（回车发送）

关键点：key code 36 之前必须 set frontmost，否则不生效。

### 切换聊天
使用 `AXUIElementSetAttributeValue(row, "AXSelected", true)` 选中聊天行。
注意：`click` 和 `AXPressAction` 对微信无效，必须用 `set selected`。

## 禁用微信自动更新

```bash
# 禁用 Sparkle 自动更新
defaults write com.tencent.xinWeChat SUAutomaticallyUpdate -bool false
defaults write com.tencent.xinWeChat SUEnableAutomaticChecks -bool false
defaults write com.tencent.xinWeChat SUScheduledCheckInterval -int 0

# 移除 Sparkle 更新程序的可执行权限
SPARKLE="/Applications/WeChat.app/Contents/Frameworks/Sparkle.framework"
chmod -x "$SPARKLE/Versions/B/Autoupdate"
chmod -x "$SPARKLE/Versions/B/Updater.app/Contents/MacOS/Updater"
```

## 已知限制

- 只能读取当前可见的聊天列表和消息（不能滚动加载更多历史）
- 发送消息会短暂将微信设为前台窗口
- 群聊名字含逗号时解析可能错位
- 图片/视频等媒体消息只显示类型标记如 `[Photo]` `[Video]`
- 需要微信窗口处于 Chats 标签页
