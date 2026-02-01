# 变量传递示例：PubMed 完整流程

> 演示如何使用变量传递功能自动化 PubMed 文献搜索

---

## 场景：自动化文献搜索和报告生成

**目标**：搜索 COVID-19 相关文献，获取详情，生成报告

**之前（需要多轮）**：
1. 搜索 → 获得 ID
2. 人工复制 ID
3. 查询详情 → 获得数据
4. 人工整理
5. 生成报告

**现在（一次完成）**：

```javascript
ΩBATCH{"steps":[
  // 步骤1: 搜索文献
  {
    "tool": "run_command",
    "params": {
      "command": "curl -s 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=covid-19&retmax=5&retmode=json'"
    },
    "saveAs": "searchData"
  },
  
  // 步骤2: 提取 PMID（自动使用步骤1的结果）
  {
    "tool": "run_command",
    "params": {
      "command": "echo '{{searchData}}' | jq -r '.esearchresult.idlist | join(\",\")'"
    },
    "saveAs": "pmids"
  },
  
  // 步骤3: 获取详情（自动使用步骤2的PMID）
  {
    "tool": "run_command",
    "params": {
      "command": "curl -s 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id={{pmids}}&retmode=json'"
    },
    "saveAs": "details"
  },
  
  // 步骤4: 生成报告
  {
    "tool": "write_file",
    "params": {
      "path": "/tmp/report.md",
      "content": "# Report\n\nTotal: {{searchData.esearchresult.count}}\nPMIDs: {{pmids}}"
    }
  }
]}ΩEND
```

## 支持的过滤器

- `{{arr | length}}` - 长度
- `{{arr | join(',')}}` - 连接
- `{{arr | slice(0,5)}}` - 切片
- `{{num | round(2)}}` - 四舍五入
- `{{str | upper}}` - 大写
- `{{var | default('val')}}` - 默认值

