#!/bin/bash
# Omega 命令解析器 v1.1
# 让终端也能运行 AI 生成的 Ω{...}ΩSTOP 格式命令
# 新增：结果自动保存到 /private/tmp/omega-result.txt
#
# 用法:
#   omega '粘贴的内容'
#   echo '内容' | omega
#   pbpaste | omega    # macOS 直接从剪贴板执行

RESULT_FILE="/private/tmp/omega-result.txt"

parse_and_run() {
    local input="$1"
    
    # 提取 Ω{...}ΩSTOP 之间的 JSON
    local json=$(echo "$input" | grep -oE 'Ω\{[^Ω]*\}ΩSTOP' | head -1 | sed 's/^Ω//' | sed 's/ΩSTOP$//')
    
    if [[ -z "$json" ]]; then
        echo "❌ 未找到 Ω{...}ΩSTOP 格式的命令" | tee "$RESULT_FILE"
        return 1
    fi
    
    local tool=$(echo "$json" | jq -r '.tool' 2>/dev/null)
    
    if [[ -z "$tool" || "$tool" == "null" ]]; then
        echo "❌ JSON 解析失败" | tee "$RESULT_FILE"
        return 1
    fi
    
    echo "🔧 工具: $tool"
    echo "📋 参数:"
    echo "$json" | jq '.params' 2>/dev/null
    echo ""
    read -p "▶️  确认执行? [Y/n] " confirm
    if [[ "$confirm" == "n" || "$confirm" == "N" ]]; then
        echo "⏹️  已取消" | tee "$RESULT_FILE"
        return 0
    fi
    
    echo "─────────────────────────────"
    
    # 执行并捕获输出
    local output
    case "$tool" in
        "run_command")
            local cmd=$(echo "$json" | jq -r '.params.command')
            echo "$ $cmd"
            output=$(eval "$cmd" 2>&1)
            echo "$output"
            ;;
        "write_file")
            local path=$(echo "$json" | jq -r '.params.path')
            local content=$(echo "$json" | jq -r '.params.content')
            mkdir -p "$(dirname "$path")"
            printf '%b' "$content" > "$path"
            output="✅ 已写入: $path ($(wc -c < "$path" | tr -d ' ') 字节)"
            echo "$output"
            ;;
        "read_file")
            local path=$(echo "$json" | jq -r '.params.path')
            output=$(cat "$path" 2>&1)
            echo "$output"
            ;;
        "list_directory")
            local path=$(echo "$json" | jq -r '.params.path')
            output=$(ls -la "$path" 2>&1)
            echo "$output"
            ;;
        *)
            output="❌ 未支持的工具: $tool"
            echo "$output"
            ;;
    esac
    
    # 保存结果
    echo "$output" > "$RESULT_FILE"
    
    echo ""
    echo "─────────────────────────────"
    echo "✅ 完成 (结果已保存到 $RESULT_FILE)"
    echo "💡 AI 可读取: Ω{\"tool\":\"read_file\",\"params\":{\"path\":\"$RESULT_FILE\"}}ΩSTOP"
}

# 主入口
if [[ -p /dev/stdin ]]; then
    input=$(cat)
else
    input="$1"
fi

parse_and_run "$input"
