-- Omega Auto Executor
-- 用法: 选中命令后运行此脚本，自动执行并发送结果

-- 1. 获取选中的文本
tell application "System Events"
    keystroke "c" using command down
    delay 0.3
end tell

-- 2. 执行 Omega
set selectedText to the clipboard
set shellCmd to "/Users/yay/workspace/genspark-agent/tools/omega-runner-noconfirm.sh " & quoted form of selectedText
set cmdResult to do shell script shellCmd

-- 3. 复制结果到剪贴板
set the clipboard to cmdResult

-- 4. 粘贴到输入框并发送
tell application "System Events"
    delay 0.2
    keystroke "v" using command down
    delay 0.2
    keystroke return
end tell

return "Done!"
