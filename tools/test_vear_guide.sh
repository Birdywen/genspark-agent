#!/bin/bash
echo "=== vear.py 使用指南 ==="
echo
echo "1. 安装依赖:"
echo "   pip3 install websocket-client"
echo
echo "2. 设置 Cookie:"
echo "   export GENSPARK_COOKIES="your_cookie_here""
echo
echo "3. 基本用法:"
echo "   python vear.py "你的问题""
echo
echo "4. 文件分析:"
echo "   python vear.py --files 文件名 "分析这个文件""
echo
echo "5. 交互模式:"
echo "   python vear.py"
echo "   (输入消息，Ctrl+D 结束)"
echo
echo "6. 不同模型:"
echo "   python vear.py --model sonnet "问题""
echo "   可用模型: opus, sonnet, haiku, gpt4, gemini, grok"
echo
echo "7. 获取帮助:"
echo "   python vear.py --help"
