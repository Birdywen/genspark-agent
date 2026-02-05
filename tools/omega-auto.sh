#!/bin/bash
# Omega Auto Executor v1.0
# 一键执行：选中命令 → 执行 → 结果发送回对话

export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8

# 1. 获取剪贴板内容（假设已经复制了命令）
input=$(pbpaste)

if [[ -z "$input" ]]; then
    osascript -e 'display notification "Clipboard is empty" with title "Omega"'
    exit 1
fi

# 2. 执行命令
result=$(/Users/yay/workspace/genspark-agent/tools/omega-runner-noconfirm.sh "$input" 2>&1)

# 3. 复制结果到剪贴板
echo "$result" | pbcopy

# 4. 模拟粘贴并发送（聚焦到最前面的应用）
osascript << 'EOF'
tell application "System Events"
    delay 0.2
    keystroke "v" using command down
    delay 0.3
    keystroke return
end tell
EOF

# 5. 通知
osascript -e 'display notification "Executed and sent!" with title "Omega"'
