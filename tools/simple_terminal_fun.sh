#!/bin/bash

echo "=== 终端酷炫工具展示 ==="
echo "
echo "1. 矩阵雨效果"
echo "2. ASCII艺术文字"
echo "3. 彩虹文字效果"
echo "4. 会说话的动物"
echo "5. 系统信息仪表板"
echo "
read -p "请选择 (1-5): " choice

echo "
case $choice in
  1)
    echo "启动矩阵雨效果... (按q退出)"
    cmatrix -s
    ;;
  2)
    echo "TERMINAL FUN" | figlet -f slant
    ;;
  3)
    echo "彩虹文字效果" | lolcat
    ;;
  4)
    echo "你好，终端!" | cowsay
    ;;
  5)
    echo "=== 系统信息 ==="
    echo "主机: $(hostname)"
    echo "用户: $(whoami)"
    echo "系统: $(sw_vers -productName) $(sw_vers -productVersion)"
    echo "时间: $(date)"
    ;;
  *)
    echo "无效选择"
    ;;
esac
