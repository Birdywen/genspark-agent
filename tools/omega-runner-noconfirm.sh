#!/bin/bash
# Omega Command Runner v1.5
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8

RESULT_FILE="/private/tmp/omega-result.txt"

# Get input
if [[ -n "$1" ]]; then
    input="$1"
else
    input=$(cat)
fi

# Trim whitespace
input=$(echo "$input" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')

# Prefix message
PREFIX="[Manual Exec] I saw your output but MCP failed. I ran it manually, here is the result:"

# Check if Omega format
if echo "$input" | grep -qE '[ΩŒ©].*\{.*\}.*STOP'; then
    # Omega format: extract JSON
    json=$(echo "$input" | sed -n 's/.*[ΩŒ©]\({.*}\)[ΩŒ©]*STOP.*/\1/p' | head -1)
    
    if [[ -z "$json" ]]; then
        json=$(echo "$input" | grep -oE '\{"tool":"[^"]+"[^}]+\}' | head -1)
    fi
    
    if [[ -z "$json" ]]; then
        echo "[ERROR] Failed to parse Omega command" | tee "$RESULT_FILE"
        exit 1
    fi
    
    tool=$(echo "$json" | jq -r '.tool' 2>/dev/null)
    
    case "$tool" in
        "run_command")
            cmd=$(echo "$json" | jq -r '.params.command')
            ;;
        "write_file")
            path=$(echo "$json" | jq -r '.params.path')
            content=$(echo "$json" | jq -r '.params.content')
            mkdir -p "$(dirname "$path")"
            printf '%b' "$content" > "$path"
            result="$PREFIX\n\n[Tool] write_file\n[OK] Written: $path"
            echo -e "$result" | tee "$RESULT_FILE"
            exit 0
            ;;
        "read_file")
            path=$(echo "$json" | jq -r '.params.path')
            output=$(cat "$path" 2>&1)
            result="$PREFIX\n\n[Tool] read_file\n[Path] $path\n---\n$output"
            echo -e "$result" | tee "$RESULT_FILE"
            exit 0
            ;;
        "list_directory")
            path=$(echo "$json" | jq -r '.params.path')
            output=$(ls -la "$path" 2>&1)
            result="$PREFIX\n\n[Tool] list_directory\n[Path] $path\n---\n$output"
            echo -e "$result" | tee "$RESULT_FILE"
            exit 0
            ;;
        *)
            echo "[ERROR] Unsupported: $tool" | tee "$RESULT_FILE"
            exit 1
            ;;
    esac
else
    # Plain command
    cmd="$input"
fi

# Execute command
output=$(eval "$cmd" 2>&1)
result="$PREFIX\n\n[Command] $cmd\n---\n$output"
echo -e "$result" | tee "$RESULT_FILE"
