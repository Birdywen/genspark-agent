#!/bin/bash
# 终端酷炫工具展示脚本
# 作者: AI助手
# 日期: $(date)

echo "🚀 终端酷炫工具包 🚀"
echo "════"
echo "

echo "请选择要展示的效果:"
echo "1. 矩阵雨效果 (cmatrix)"
echo "2. ASCII艺术文字 (figlet)"
echo "3. 彩虹文字效果 (lolcat)"
echo "4. 会说话的动物 (cowsay)"
echo "5. 蒸汽火车动画 (sl)"
echo "6. ASCII水族馆 (asciiquarium)"
echo "7. 系统信息仪表板"
echo "8. 全部展示"
echo "9. 退出"
echo "
read -p "请输入选项 (1-9): " choice

echo "
case $choice in
    1)
        echo "启动矩阵雨效果... (按q退出)"
        cmatrix -s
        ;;
    2)
        echo "ASCII艺术文字展示:"
        echo "════"
        echo "TERMINAL FUN" | figlet -f slant
        echo "MAC POWER" | figlet -f big
        ;;
    3)
        echo "彩虹文字效果:"
        echo "════"
        echo "🌈 欢迎来到彩虹终端世界 🌈" | lolcat
        echo "✨ 让终端变得多彩有趣 ✨" | lolcat
        ;;
    4)
        echo "会说话的动物:"
        echo "════"
        echo "你好，我是终端牛!" | cowsay
        echo "
        echo "喵~ 我是终端猫!" | cowsay -f tux
        ;;
    5)
        echo "启动蒸汽火车动画..."
        sl
        ;;
    6)
        echo "启动ASCII水族馆... (按Ctrl+C退出)"
        asciiquarium
        ;;
    7)
        echo "系统信息仪表板:"
        echo "════"
        echo "🖥️  主机: $(hostname)"
        echo "👤 用户: $(whoami)"
        echo "🐧 系统: $(sw_vers -productName) $(sw_vers -productVersion)"
        echo "🏗️  架构: $(uname -m)"
        echo "⏰ 时间: $(date)"
        echo "📊 CPU: $(sysctl -n machdep.cpu.brand_string)"
        echo "💾 内存: $(sysctl -n hw.memsize | awk '{printf "%.1f GB", \$1/1024/1024/1024}')"
        echo "💿 磁盘: $(df -h / | tail -1 | awk '{print \$3" / "\$2" ("\$5" used)"}')"
        ;;
    8)
        echo "即将展示所有效果，按Enter继续..."
        read
        
        clear
        echo "1. 矩阵雨效果演示 (3秒)"
        timeout 3 cmatrix -s 2>/dev/null || sleep 3
        
        clear
        echo "2. ASCII艺术文字"
        echo "TERMINAL SHOW" | figlet -f slant
        sleep 2
        
        clear
        echo "3. 彩虹效果"
        echo "多彩终端体验" | lolcat
        sleep 2
        
        clear
        echo "4. 会说话的牛"
        echo "展示完成!" | cowsay
        sleep 2
        
        clear
        echo "所有效果展示完毕! 🎉"
        ;;
    9)
        echo "再见! 👋"
        exit 0
        ;;
    *)
        echo "无效选项，请重新运行脚本。"
        ;;
esac

echo "
echo "════"
echo "脚本执行完成!"
echo "要再次运行，请输入: bash terminal_fun.sh"
