# 长内容写入指南

## 问题
write_file 写长内容时 JSON parse error

## 解决方案

### 1. heredoc（推荐）
cat > file << 'EOF'
内容
EOF

### 2. 分段追加
cat >> file << 'EOF'
更多内容
EOF

### 3. Python脚本
复杂文档用Python生成
