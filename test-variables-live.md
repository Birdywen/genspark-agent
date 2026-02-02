# 变量传递功能 - 实战测试

## 准备工作

1. **重启服务器**（加载新功能）：
```bash
cd /Users/yay/workspace/genspark-agent/server-v2
node index.js
```

2. **刷新浏览器** Extension 页面

---

## 测试1: 基础变量传递

在对话中输入：

```
ΩBATCH{"steps":[
  {"tool":"run_command", "params":{"command":"echo '{\"name\":\"test\",\"count\":42}'"}, "saveAs":"result"},
  {"tool":"run_command", "params":{"command":"echo 'Name: {{result.name}}, Count: {{result.count}}'"}}
]}ΩEND
```

**期望结果**：
```
Name: test, Count: 42
```

---

## 测试2: 数组和过滤器

```
ΩBATCH{"steps":[
  {"tool":"run_command", "params":{"command":"echo '{\"ids\":[\"123\",\"456\",\"789\"]}'"}, "saveAs":"data"},
  {"tool":"run_command", "params":{"command":"echo 'Total: {{data.ids | length}}, Joined: {{data.ids | join(\",\")}}'"}}
]}ΩEND
```

**期望结果**：
```
Total: 3, Joined: 123,456,789
```

---

## 测试3: 链式过滤器

```
ΩBATCH{"steps":[
  {"tool":"run_command", "params":{"command":"echo '{\"scores\":[85,90,78,92]}'"}, "saveAs":"data"},
  {"tool":"run_command", "params":{"command":"echo 'Average: {{data.scores | avg | round(1)}}'"}}
]}ΩEND
```

**期望结果**：
```
Average: 86.3
```

---

## 测试4: PubMed 真实场景

```
ΩBATCH{"steps":[
  {"tool":"run_command", "params":{"command":"curl -s 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=covid-19&retmax=3&retmode=json'"}, "saveAs":"search"},
  {"tool":"run_command", "params":{"command":"echo 'Found {{search.esearchresult.count}} articles, IDs: {{search.esearchresult.idlist | join(\",\")}}'"}}
]}ΩEND
```

**期望结果**：显示找到的文章数量和前3个PMID

---

## 测试5: 条件执行

```
ΩBATCH{"steps":[
  {"tool":"run_command", "params":{"command":"echo '{\"status\":\"success\"}'"}, "saveAs":"result"},
  {"tool":"run_command", "params":{"command":"echo 'Success case'"}, "when":{"var":"result.status", "equals":"success"}},
  {"tool":"run_command", "params":{"command":"echo 'Failure case'"}, "when":{"var":"result.status", "equals":"failed"}}
]}ΩEND
```

**期望结果**：只显示 "Success case"

---

## 故障排除

如果测试失败：

1. **检查服务器日志**：
   ```bash
   tail -f logs/app.log
   ```

2. **验证文件**：
   ```bash
   ls -lh variable-resolver.js state-manager.js
   ```

3. **语法检查**：
   ```bash
   node -c variable-resolver.js
   node -c state-manager.js
   ```

4. **运行单元测试**：
   ```bash
   node test-variable-resolver.js
   ```

---

**准备就绪后，开始测试！** 🚀
