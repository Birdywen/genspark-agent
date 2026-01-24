# 进阶指南

本文档补充核心规则，涵盖错误处理、长时间任务、权限边界等进阶内容。

---

## 一、错误处理

当工具调用失败时，根据错误类型采取不同策略：

| 错误类型 | 处理方式 |
|----------|----------|
| 工具未找到 | 检查工具名拼写，或改用替代方案 |
| 参数错误 | 检查参数格式，修正后重试 |
| 文件/路径不存在 | 确认路径正确，必要时先用 `list_directory` 探查 |
| 权限拒绝 | 检查是否在允许目录内，或提示用户手动处理 |
| 命令执行失败 | 分析错误输出，尝试修正命令或换用其他方法 |
| 超时 | 考虑拆分任务、使用后台执行，或提示用户手动运行 |

**重试规则**：
- 同一操作最多重试 **2 次**
- 重试前必须分析失败原因并调整参数或方法
- 连续失败后，向用户说明问题并请求指导

**常见错误示例**：
```
错误: 工具未找到: readfile
→ 修正: 应为 read_file（注意下划线）

错误: 路径不允许: /etc/passwd
→ 该路径不在允许范围内，无法访问系统文件

错误: 命令被阻止: sudo rm
→ 安全限制，不能执行 sudo 命令
```

---

## 二、命令执行说明

每次响应只输出 **一个** `@TOOL` 调用，等待系统返回后再继续。

但这不影响命令内部的组合——以下方式都是允许的：

```bash
# 管道组合
cat file.txt | grep pattern | wc -l

# 顺序执行
cd project && npm install && npm run build

# 并行执行
command1 & command2 & wait

# 批量操作
for f in *.txt; do echo "$f"; done

# 条件执行
test -f config.json && cat config.json || echo "文件不存在"
```

对于多个独立文件操作，优先使用批量工具如 `read_multiple_files`。

---

## 三、长时间运行的命令

默认超时：**30 秒**

### 预计超时的任务处理

对于可能超时的命令（大文件处理、网络下载、编译构建等），使用以下策略：

**方式一：后台执行 + 日志**
```bash
# 后台运行，输出重定向到日志
nohup long_command > /private/tmp/task_output.log 2>&1 &
echo $!  # 输出 PID 供后续查询
```

**方式二：检查后台任务状态**
```bash
# 检查进程是否仍在运行
ps -p <PID> > /dev/null 2>&1 && echo "运行中" || echo "已结束"

# 查看输出
tail -50 /private/tmp/task_output.log   # 查看最后50行
cat /private/tmp/task_output.log        # 查看完整输出
```

**方式三：拆分任务**
- 大文件分块处理
- 批量任务分批执行
- 使用流式处理减少内存占用

### 常见耗时任务参考

| 任务类型 | 预估时间 | 建议处理方式 |
|----------|----------|-------------|
| `npm install` | 30s-5min | 后台执行 + 日志 |
| `pip install` | 10s-2min | 后台执行 + 日志 |
| 大文件下载 (>100MB) | 视网速 | 后台执行，`curl -o file url` |
| 视频转码 (`ffmpeg`) | 1min-1hr | 后台执行，完成后检查输出 |
| 项目构建 (`make`, `build`) | 30s-10min | 后台执行 + 日志 |
| 递归搜索大目录 | 5s-30s | 用 `fd`/`rg` 替代 `find`/`grep` |

### 后台任务完整示例

```bash
# 1. 启动后台任务（第一次工具调用）
nohup npm install > /private/tmp/npm_install.log 2>&1 & echo "PID: $!"

# 2. 稍后检查状态（第二次工具调用）
if ps aux | grep -v grep | grep -q "npm install"; then
  echo "仍在运行..."
  tail -10 /private/tmp/npm_install.log
else
  echo "已完成"
  tail -30 /private/tmp/npm_install.log
fi
```

---

## 四、权限与安全边界

### 目录访问限制

查询当前允许访问的目录（注意实际调用时加 @ 前缀）：
```
TOOL:{"tool":"list_allowed_directories","params":{}}
```

常见允许目录：
- 用户工作区：`/Users/yay/workspace`
- 临时目录：`/private/tmp`

具体以查询结果为准，配置可能包含更多目录。

### 命令安全限制

**已屏蔽的危险命令**（部分列表）：
- 系统破坏：`rm -rf /`, `rm -rf ~`, `rm -rf *`
- 权限提升：`sudo rm`, `sudo su`
- 权限滥用：`chmod 777`, `chmod -R 777`
- 系统操作：`shutdown`, `reboot`, `halt`
- 远程执行：`curl | sh`, `wget | bash`
- Fork 炸弹：`:(){:|:&};:`

**允许的命令**（部分列表）：
- 文件操作：`ls`, `cat`, `cp`, `mv`, `rm`, `mkdir`, `touch`
- 搜索工具：`grep`, `rg`, `fd`, `find`
- 开发工具：`git`, `node`, `npm`, `python`, `python3`
- 网络工具：`curl`, `wget`
- 媒体处理：`ffmpeg`, `ffprobe`, `convert`, `pandoc`
- 进程管理：`ps`, `nohup`, `sleep`, `pkill`

### 越界处理

当操作目标不在允许范围内时：
1. **明确告知**：向用户说明该路径无法访问
2. **不尝试绕过**：不使用符号链接、`../` 等方式突破限制
3. **建议替代**：
   - 需要临时文件 → 使用 `/private/tmp`
   - 需要持久存储 → 使用 `/Users/yay/workspace` 下的子目录

### 安全操作规范

**高危操作前确认**：
```bash
# 删除前先列出目标
ls -la target_dir/
# 确认无误后再删除
rm -r target_dir/

# 覆盖文件前检查
test -f important.txt && echo "文件已存在，将被覆盖"
```

**避免访问敏感文件**：
- SSH 密钥：`~/.ssh/*`
- 环境变量：`.env`, `.env.local`
- 密钥文件：`*.pem`, `*_secret*`, `*password*`
