#!/usr/bin/env python3
"""
Genspark CLI 简化版 - 基础功能测试
"""

import sys
import os
import argparse

print("=== Genspark CLI 简化版 ===")
print()
print("使用方法:")
print("  1. 设置环境变量:")
print("     export GENSPARK_COOKIES='your_cookie'")
print("  2. 运行命令:")
print("     python vear_simple.py '你的消息'")
print()
print("参数:")
print("  --model: 指定模型 (opus, sonnet, haiku, gpt4, gemini)")
print("  --files: 上传文件")
print("  --help:  显示帮助")
print()
print("示例:")
print("  python vear_simple.py '你好'")
print("  python vear_simple.py --model sonnet '写一首诗'")
print("  python vear_simple.py --files README.md '分析这个文件'")
print()
print("注意: 这是简化版，需要安装完整依赖才能连接 Genspark")
print("完整版需要: pip3 install websocket-client")
