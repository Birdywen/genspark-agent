---
name: ntfy-notify
description: 手机推送通知工具，基于 ntfy.sh 免费服务，一行命令推送到手机
---

# ntfy-notify Skill

通过 ntfy.sh 向手机发送推送通知。适用于长时间任务完成通知、服务器监控告警、定时提醒等场景。

## 前置条件

- 手机安装 ntfy app（iOS / Android）
- 订阅 topic: `oci-arm-grabber-yay`（默认 topic，可自定义）

## 默认配置

- **Topic**: `oci-arm-grabber-yay`
- **Server**: `https://ntfy.sh`

## 工具列表

### ntfy-send

发送一条推送通知到手机。

**参数：**
- `message` (必填): 通知内容
- `title` (可选): 通知标题，默认 "Genspark Agent"
- `priority` (可选): 优先级，可选 min/low/default/high/urgent，默认 default
- `tags` (可选): emoji 标签，如 tada, warning, check 等
- `topic` (可选): 自定义 topic，默认使用配置的 topic

**用法：**
```bash
# 基础通知
curl -d "任务完成了" ntfy.sh/oci-arm-grabber-yay

# 带标题和优先级
curl -H "Title: 视频生成完成" -H "Priority: high" -H "Tags: tada" -d "视频已上传到 YouTube" ntfy.sh/oci-arm-grabber-yay

# 带点击链接
curl -H "Title: 部署完成" -H "Click: https://example.com" -d "新版本已上线" ntfy.sh/oci-arm-grabber-yay
```

### ntfy-subscribe

提示用户如何在手机上订阅通知。

### ntfy-test

发送一条测试通知，确认推送链路正常。

## 使用场景

### 1. 长任务完成通知
当 agent 执行耗时任务（视频生成、音频分离、文件转换等）时，完成后自动推送：
```bash
curl -H "Title: Demucs 分离完成" -H "Tags: musical_note" -d "vocals.wav 和 accompaniment.wav 已保存到 /tmp/output/" ntfy.sh/oci-arm-grabber-yay
```

### 2. 服务器监控
```bash
# 磁盘告警
curl -H "Title: 磁盘空间告警" -H "Priority: urgent" -H "Tags: warning" -d "服务器磁盘使用率超过 90%" ntfy.sh/oci-arm-grabber-yay

# 服务挂了
curl -H "Title: 服务异常" -H "Priority: urgent" -H "Tags: rotating_light" -d "genspark-agent 进程已停止" ntfy.sh/oci-arm-grabber-yay
```

### 3. 后台任务跟踪
任何用 nohup 或 & 放到后台的任务，在末尾加一行 curl 即可：
```bash
nohup long_running_task && curl -d "任务完成" ntfy.sh/oci-arm-grabber-yay &
```

## 注意事项

- ntfy.sh 是公共服务，topic 名称相当于频道名，任何知道名称的人都能订阅。不要发送敏感信息。
- 如需私密通知，可自建 ntfy 服务器。
- 免费版无需注册，无限消息数。
