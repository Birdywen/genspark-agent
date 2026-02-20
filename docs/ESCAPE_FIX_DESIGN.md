# ΩSafe 转义问题系统性修复方案

## 问题根源

Claude 输出的 `Ω{JSON}ΩSTOP` 格式要求所有参数值 JSON 编码在一个字符串中。
当参数值本身含有 JSON 特殊字符（引号 `"`、反斜杠 `\`、换行 `\n`）时，
需要精确的多层转义。而 SSE 传输和 DOM 渲染会破坏这些转义。

### 受影响的工具

| 工具 | 问题参数 | 典型场景 |
|------|----------|----------|
| write_file | content | 写 JS 文件含引号反斜杠模板字符串 |
| edit_file | edits[].oldText/newText | 精确匹配含特殊字符的代码 |
| eval_js | code | JS 代码含引号、正则、模板字符串 |
| run_command | stdin | shell 脚本含引号管道 |
| async_task | code, condition | JS 代码 |

### 当前缓解措施（不够）

1. `safeJsonParse` — 修复中文引号、换行符、fallback 逐字段提取
2. `extractJsonStringValue` — 正则提取单个字符串字段
3. AutoScript — server 端检测复杂命令写入 .sh 文件
4. 系统提示词建议 — 让 Claude 用 stdin 模式、先 write_file 再 bash

## 修复方案：双格式支持

### 方案：增强现有 JSON 格式的解析鲁棒性 + 新增 heredoc 格式

#### 1. Heredoc 格式（新增，用于含大内容的工具调用）

```
ΩHERE tool_name
@param_name=simple_value
@another_param=simple_value
@big_param<<DELIM
任意内容，不需要任何转义
引号 " ' ` 反斜杠 \ 换行都原样保留
DELIM
ΩEND
```

**规则：ΩHERE tool_name` 开始，`ΩEND` 结束
- 简单参数用 `@key=value`（单行）
- 大内容参数用 heredoc：`@key<<DELIM` ... `DELIM`（多行）
- DELIM 可以是任意标识符（如 EOF、CONTENT_END、===）
- 内容区域内**零转义**，原样传递

**示例 — write_file：**
```
ΩHERE write_file
@path=/Users/yay/workspace/test.js
@content<<EOF
const msg = "hello \"world\"";
const tmpl = `value is ${1 + 2}`;
console.log(msg);
EOF
ΩEND
```

**示例 — edit_file：**
```
ΩHERE edit_file
@path=/Users/yay/workspace/test.js
@oldText<<OLD
const msg = "hello";
OLD
@newText<<NEW
const msg = "hello world";
NEW
ΩEND
```

**示例 — eval_js：**
```
ΩHERE eval_js
@tabId=12345
@code<<CODE
const el = document.querySelector('#result');
return { text: el?.textContent, html: el?.innerHTML };
CODE
ΩEND
```

**示例 — run_command (stdin)：**
```
ΩHERE run_command
@command=bash
@stdin<<SCRIPT
#!/bin/bash
for f in *.mp3; do
  echo "Processing: $f"
  ffmpeg -i "$f" -c:a aac "${f%.mp3}.m4a"
done
SCRIPT
ΩEND
```

#### 2. 增强 safeJsonParse（改进现有格式的容错）

对现有 `Ω{JSON}ΩSTOP` 格式增强：

- **Base64 content 字段**：如果 content/stdin/code 字段的值以 `base64:` 前缀开头，自动 base64 decode
- **改进 extractJsonStringValue**：处理连续反斜杠、嵌套引号的情况
- **edit_file edits 特殊处理**：对 edits 数组单独用更宽松的解析

## 实现计划

### Step 1: content.js — 新HeredocFormat()
在 parseToolCalls 中优先检测 ΩHERE 格式

### Step 2: content.js SSE 通道 — tryParseSSECommands() 增加 ΩHERE 支持

### Step 3: 系统提示词更新 — 告知 Claude 何时使用 ΩHERE 格式

### Step 4: 测试验证

## 优势

1. **零转义** — heredoc 内容区域不需要任何 JSON 转义
2. **SSE 安全** — 没有 JSON 结构，不怕字符丢失
3. **向后兼容** — 现有 Ω{JSON}ΩSTOP 格式继续支持
4. **简单可靠** — 解析器只需找分隔符，不需复杂 JSON 修复
