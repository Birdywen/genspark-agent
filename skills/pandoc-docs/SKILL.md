---
name: pandoc-docs
description: 万能文档转换工具，支持 Markdown、HTML、PDF、Word、EPUB 等格式互转
---

# Pandoc Docs Skill

文档格式转换的瑞士军刀，支持几十种格式互转。

## 常用转换

### Markdown 转其他格式
```bash
# Markdown → HTML
pandoc input.md -o output.html

# Markdown → PDF（需要 LaTeX 或 wkhtmltopdf）
pandoc input.md -o output.pdf

# Markdown → Word
pandoc input.md -o output.docx

# Markdown → EPUB 电子书
pandoc input.md -o output.epub --metadata title="书名"

# Markdown → PPT
pandoc input.md -o output.pptx
```

### 其他格式转 Markdown
```bash
# HTML → Markdown
pandoc input.html -o output.md

# Word → Markdown
pandoc input.docx -o output.md

# EPUB → Markdown
pandoc input.epub -o output.md
```

### 带样式的转换
```bash
# 使用自定义 CSS
pandoc input.md -o output.html --css=style.css --standalone

# 使用 Word 模板
pandoc input.md -o output.docx --reference-doc=template.docx

# 代码高亮主题
pandoc input.md -o output.html --highlight-style=zenburn
```

### 高级功能
```bash
# 生成目录
pandoc input.md -o output.html --toc --toc-depth=3

# 包含元数据
pandoc input.md -o output.pdf \
  --metadata title="标题" \
  --metadata author="作者" \
  --metadata date="2026-02-03"

# 合并多个文件
pandoc ch1.md ch2.md ch3.md -o book.pdf

# 自动编号章节
pandoc input.md -o output.pdf --number-sections
```

### PDF 选项（使用 wkhtmltopdf）
```bash
pandoc input.md -o output.pdf \
  --pdf-engine=wkhtmltopdf \
  --pdf-engine-opt=--page-size \
  --pdf-engine-opt=A4
```

## 支持的格式

**输入格式**：markdown, html, docx, epub, latex, rst, textile, org, mediawiki, json...

**输出格式**：markdown, html, html5, pdf, docx, epub, latex, beamer(slides), pptx, rst...

## 实用示例

### 批量转换
```bash
# 目录下所有 Markdown 转 HTML
for f in *.md; do pandoc "$f" -o "${f%.md}.html"; done
```

### 制作电子书
```bash
pandoc title.txt ch*.md -o book.epub \
  --metadata title="我的书" \
  --metadata author="作者名" \
  --toc \
  --epub-cover-image=cover.jpg
```

### 生成幻灯片
```bash
# 使用 reveal.js
pandoc slides.md -o slides.html -t revealjs -s

# 使用 beamer (PDF)
pandoc slides.md -o slides.pdf -t beamer
```

## 注意事项

1. PDF 生成需要 LaTeX 或 wkhtmltopdf
2. 使用 `--standalone` (-s) 生成完整文档
3. 中文 PDF 需要指定中文字体
4. 复杂排版建议先转 LaTeX 再调整
