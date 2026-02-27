#!/bin/bash
# 脱敏显示 .env 配置状态（只显示变量名 + 是否已设置，不暴露值）
ENV_FILE="/Users/yay/workspace/genspark-agent/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: .env not found"
  exit 1
fi

echo "=== .env Config Status ==="
while IFS= read -r line; do
  # 跳过空行和注释
  [[ -z "$line" || "$line" =~ ^# ]] && echo "$line" && continue
  # 提取变量名
  var_name="${line%%=*}"
  var_value="${line#*=}"
  if [ -n "$var_value" ]; then
    # 显示前4字符 + 掩码
    preview="${var_value:0:4}****"
    echo "$var_name=$preview"
  else
    echo "$var_name=(empty)"
  fi
done < "$ENV_FILE"

echo ""
echo "--- README (infrastructure info) ---"
head -80 /Users/yay/workspace/genspark-agent/README.md