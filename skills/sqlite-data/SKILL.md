---
name: sqlite-data
description: SQLite 数据库操作工具，支持创建、查询、分析、导入导出数据
---

# SQLite Data Skill

轻量级数据库工具，适合数据分析、本地存储、快速原型。

## 常用命令

### 基础操作
```bash
# 打开/创建数据库
sqlite3 database.db

# 执行 SQL 语句
sqlite3 database.db "SELECT * FROM users LIMIT 10;"

# 执行 SQL 文件
sqlite3 database.db < script.sql
```

### 表操作
```sql
-- 查看所有表
.tables

-- 查看表结构
.schema table_name

-- 创建表
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 添加索引
CREATE INDEX idx_users_email ON users(email);
```

### 数据导入导出
```bash
# CSV 导入
sqlite3 database.db <<EOF
.mode csv
.import data.csv table_name
EOF

# CSV 导出
sqlite3 -header -csv database.db "SELECT * FROM users;" > output.csv

# JSON 导出
sqlite3 -json database.db "SELECT * FROM users;" > output.json

# SQL dump
sqlite3 database.db .dump > backup.sql

# 从 dump 恢复
sqlite3 new_database.db < backup.sql
```

### 数据分析
```sql
-- 统计
SELECT COUNT(*), AVG(price), MAX(price), MIN(price) FROM products;

-- 分组统计
SELECT category, COUNT(*) as count, SUM(sales) as total
FROM products
GROUP BY category
ORDER BY total DESC;

-- 时间序列分析
SELECT date(created_at) as day, COUNT(*) as count
FROM orders
GROUP BY day
ORDER BY day;
```

### 输出格式
```bash
# 表格格式
sqlite3 -header -column database.db "SELECT * FROM users;"

# Markdown 表格
sqlite3 -header -markdown database.db "SELECT * FROM users;"

# JSON 格式
sqlite3 -json database.db "SELECT * FROM users;"
```

## 与其他工具结合

### 配合 jq 处理 JSON
```bash
sqlite3 -json db.db "SELECT * FROM users;" | jq '.[] | select(.age > 18)'
```

### 配合 chart-visualization
```bash
# 导出数据后可用图表 Skill 可视化
sqlite3 -json db.db "SELECT month, sales FROM monthly_sales;" > /tmp/data.json
```

## 注意事项

1. SQLite 是单文件数据库，易于备份和迁移
2. 支持事务：BEGIN, COMMIT, ROLLBACK
3. 使用 `.mode` 切换输出格式
4. 大量插入时用事务包裹可提升 100x 性能
