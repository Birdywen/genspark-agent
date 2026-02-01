# ΩBATCH 批量执行完整指南

## 一、基本语法

### 1.1 单行格式

```
ΩBATCH{"steps":[...]}ΩEND
```

### 1.2 多行格式

```
ΩBATCH{
  "steps": [
    {
      "tool": "工具名",
      "params": {"参数": "值"},
      "saveAs": "变量名"
    }
  ],
  "stopOnError": false
}ΩEND
```

---

## 二、核心功能

### 2.1 变量保存 (saveAs)

将步骤执行结果保存到变量中：

```json
{
  "tool": "run_command",
  "params": {"command": "date"},
  "saveAs": "currentDate"
}
```

保存的变量包含：
- `success`: 是否成功 (boolean)
- `result`: 执行结果 (string)

### 2.2 条件执行 (when)

根据前置步骤的结果决定是否执行：

#### 语法格式

```json
{
  "tool": "run_command",
  "params": {"command": "echo 'hello'"},
  "when": {"var": "变量名", "条件类型": "值"}
}
```

#### 支持的条件类型

| 条件类型 | 说明 | 示例 |
|---------|------|------|
| `success` | 检查步骤是否成功 | `{"var": "step1", "success": true}` |
| `contains` | 检查结果是否包含指定字符串 | `{"var": "step1", "contains": "OK"}` |
| `regex` | 正则表达式匹配 | `{"var": "step1", "regex": "v[0-9]+"}` |

#### 示例

```json
ΩBATCH{
  "steps": [
    {
      "tool": "run_command",
      "params": {"command": "node -v"},
      "saveAs": "nodeVersion"
    },
    {
      "tool": "run_command",
      "params": {"command": "echo 'Node.js installed'"},
      "when": {"var": "nodeVersion", "success": true}
    },
    {
      "tool": "run_command",
      "params": {"command": "echo 'Version check passed'"},
      "when": {"var": "nodeVersion", "regex": "v[2-9][0-9]"}
    }
  ]
}ΩEND
```

### 2.3 错误处理 (stopOnError)

控制遇到错误时的行为：

```json
{
  "steps": [...],
  "stopOnError": false  // false=继续执行, true/默认=立即停止
}
```

#### 对比示例

**stopOnError: true (默认)**
```json
ΩBATCH{
  "steps": [
    {"tool": "run_command", "params": {"command": "echo 'step1'"}},
    {"tool": "run_command", "params": {"command": "cat /nonexistent"}},
    {"tool": "run_command", "params": {"command": "echo 'step3'"}}  // 不会执行
  ]
}ΩEND
```
结果：步骤2失败后停止，步骤3不执行

**stopOnError: false**
```json
ΩBATCH{
  "steps": [
    {"tool": "run_command", "params": {"command": "echo 'step1'"}},
    {"tool": "run_command", "params": {"command": "cat /nonexistent"}},
    {"tool": "run_command", "params": {"command": "echo 'step3'"}}  // 仍会执行
  ],
  "stopOnError": false
}ΩEND
```
结果：步骤2失败，但步骤3继续执行

---

## 三、实用场景

### 3.1 文件检查与备份

```json
ΩBATCH{
  "steps": [
    {
      "tool": "read_file",
      "params": {"path": "/Users/yay/workspace/config.json"},
      "saveAs": "configFile"
    },
    {
      "tool": "run_command",
      "params": {"command": "echo 'Config file exists'"},
      "when": {"var": "configFile", "success": true}
    },
    {
      "tool": "write_file",
      "params": {
        "path": "/Users/yay/workspace/config.backup.json",
        "content": "{{configFile.result}}"
      },
      "when": {"var": "configFile", "success": true}
    }
  ]
}ΩEND
```

### 3.2 环境检查

```json
ΩBATCH{
  "steps": [
    {
      "tool": "run_command",
      "params": {"command": "node -v"},
      "saveAs": "nodeCheck"
    },
    {
      "tool": "run_command",
      "params": {"command": "npm -v"},
      "saveAs": "npmCheck"
    },
    {
      "tool": "run_command",
      "params": {"command": "git --version"},
      "saveAs": "gitCheck"
    },
    {
      "tool": "run_command",
      "params": {"command": "echo 'All tools installed'"},
      "when": {"var": "nodeCheck", "success": true}
    }
  ],
  "stopOnError": false
}ΩEND
```

### 3.3 多文件处理

```json
ΩBATCH{
  "steps": [
    {
      "tool": "list_directory",
      "params": {"path": "/Users/yay/workspace/project"},
      "saveAs": "projectFiles"
    },
    {
      "tool": "run_command",
      "params": {"command": "echo 'Found package.json'"},
      "when": {"var": "projectFiles", "contains": "package.json"}
    },
    {
      "tool": "read_file",
      "params": {"path": "/Users/yay/workspace/project/package.json"},
      "saveAs": "packageJson",
      "when": {"var": "projectFiles", "contains": "package.json"}
    }
  ]
}ΩEND
```

### 3.4 版本检查与条件安装

```json
ΩBATCH{
  "steps": [
    {
      "tool": "run_command",
      "params": {"command": "node -v"},
      "saveAs": "nodeVersion"
    },
    {
      "tool": "run_command",
      "params": {"command": "echo 'Node.js version is compatible'"},
      "when": {"var": "nodeVersion", "regex": "v(1[8-9]|[2-9][0-9])"}
    },
    {
      "tool": "run_command",
      "params": {"command": "echo 'WARNING: Node.js version too old'"},
      "when": {"var": "nodeVersion", "regex": "v(1[0-7]|[0-9])\\."}
    }
  ],
  "stopOnError": false
}ΩEND
```

---

## 四、注意事项

### 4.1 安全限制

批量执行仍受安全机制约束：
- ✅ 命令必须在白名单中（config.json 的 allowedCommands）
- ✅ 文件路径必须在允许的目录内
- ✅ 黑名单命令会被阻止

### 4.2 变量引用语法

**✓ 正确：在 when 条件中**
```json
{"when": {"var": "myVar", "contains": "test"}}
```

**✗ 错误：不要使用 variable**
```json
{"when": {"variable": "myVar", "contains": "test"}}  // 错误！
```

### 4.3 调试技巧

1. **使用 stopOnError: false** 查看所有步骤的执行情况
2. **添加 echo 命令** 追踪执行流程
3. **检查返回结果** 确认每个步骤的 success 状态

```json
ΩBATCH{
  "steps": [
    {"tool": "run_command", "params": {"command": "echo '=== Step 1 Start ==='"}},
    {"tool": "run_command", "params": {"command": "date"}, "saveAs": "step1"},
    {"tool": "run_command", "params": {"command": "echo '=== Step 1 Complete ==='"}},
    {"tool": "run_command", "params": {"command": "echo 'Step1 success'"},
     "when": {"var": "step1", "success": true}}
  ],
  "stopOnError": false
}ΩEND
```

---

## 五、完整示例

### 5.1 项目部署检查

```json
ΩBATCH{
  "steps": [
    {
      "tool": "run_command",
      "params": {"command": "echo '=== Starting deployment check ==='"},
      "saveAs": "start"
    },
    {
      "tool": "run_command",
      "params": {"command": "git status --porcelain"},
      "saveAs": "gitStatus"
    },
    {
      "tool": "run_command",
      "params": {"command": "echo 'Working directory is clean'"},
      "when": {"var": "gitStatus", "contains": ""}
    },
    {
      "tool": "run_command",
      "params": {"command": "npm test"},
      "saveAs": "testResults"
    },
    {
      "tool": "run_command",
      "params": {"command": "echo 'All tests passed'"},
      "when": {"var": "testResults", "success": true}
    },
    {
      "tool": "run_command",
      "params": {"command": "npm run build"},
      "saveAs": "buildResults",
      "when": {"var": "testResults", "success": true}
    },
    {
      "tool": "run_command",
      "params": {"command": "echo '=== Deployment check complete ==='"},
      "when": {"var": "buildResults", "success": true}
    }
  ],
  "stopOnError": false
}ΩEND
```

### 5.2 数据采集与分析

```json
ΩBATCH{
  "steps": [
    {
      "tool": "run_command",
      "params": {"command": "date +%Y-%m-%d"},
      "saveAs": "currentDate"
    },
    {
      "tool": "list_directory",
      "params": {"path": "/Users/yay/workspace/logs"},
      "saveAs": "logFiles"
    },
    {
      "tool": "run_command",
      "params": {"command": "wc -l /Users/yay/workspace/logs/*.log"},
      "saveAs": "logStats",
      "when": {"var": "logFiles", "contains": ".log"}
    },
    {
      "tool": "run_command",
      "params": {"command": "grep -c ERROR /Users/yay/workspace/logs/*.log || true"},
      "saveAs": "errorCount",
      "when": {"var": "logFiles", "contains": ".log"}
    },
    {
      "tool": "run_command",
      "params": {"command": "echo 'Log analysis complete'"},
      "when": {"var": "errorCount", "success": true}
    }
  ],
  "stopOnError": false
}ΩEND
```

---

## 六、与其他功能的对比

| 特性 | ΩBATCH | ΩPLAN | ΩFLOW |
|------|--------|-------|-------|
| 用途 | 明确的多步骤执行 | AI 自动分解任务 | 使用预定义模板 |
| 灵活性 | 高（完全手动控制） | 中（AI 智能规划） | 低（固定模板） |
| 条件执行 | ✅ 支持 | ✅ 支持 | ✅ 支持 |
| 并行优化 | ❌ 顺序执行 | ✅ 自动并行 | ✅ 模板定义 |
| 适用场景 | 已知的固定流程 | 复杂的未知任务 | 常见的标准操作 |

---

## 七、常见问题

### Q1: when 条件不生效？

**A:** 检查语法，使用 `var` 而不是 `variable`：
```json
// ✓ 正确
{"when": {"var": "step1", "contains": "OK"}}

// ✗ 错误
{"when": {"variable": "step1", "contains": "OK"}}
```

### Q2: 步骤执行失败但没有错误信息？

**A:** 可能是命令被安全白名单阻止，检查：
1. 命令是否在 config.json 的 allowedCommands 中
2. 文件路径是否在 allowedPaths 中
3. 查看日志：`tail -50 /Users/yay/workspace/genspark-agent/server-v2/logs/agent.log`

### Q3: 如何引用上一步的结果？

**A:** 目前不支持 `{{变量名}}` 模板插值，只能通过 `when` 条件判断。如需传递结果，使用文件：

```json
{
  "steps": [
    {"tool": "run_command", "params": {"command": "date > /tmp/result.txt"}},
    {"tool": "run_command", "params": {"command": "cat /tmp/result.txt"}}
  ]
}
```

### Q4: stopOnError: false 为什么还是停止了？

**A:** 安全检查失败（如命令被阻止）会立即停止，stopOnError 只对工具执行错误有效。

---

## 八、测试验证

使用以下命令测试批量执行功能：

```json
ΩBATCH{
  "steps": [
    {"tool": "run_command", "params": {"command": "echo 'Test 1: Basic execution'"}, "saveAs": "test1"},
    {"tool": "run_command", "params": {"command": "echo 'Test 2: Condition met'"}, "when": {"var": "test1", "success": true}},
    {"tool": "run_command", "params": {"command": "cat /nonexistent"}},
    {"tool": "run_command", "params": {"command": "echo 'Test 4: Continued after error'"}}
  ],
  "stopOnError": false
}ΩEND
```

预期结果：4个步骤全部执行，第3步失败但不影响第4步。
