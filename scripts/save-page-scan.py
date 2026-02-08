#!/usr/bin/env python3
"""将 page-annotator.js 的 JSON 结果存入知识库
用法: echo '<json>' | python3 save-page-scan.py
或:   python3 save-page-scan.py '<json>'
"""
import sqlite3, json, sys, re

DB = '/Users/yay/workspace/.agent_memory/project_knowledge.db'

# 读取输入
if len(sys.argv) > 1:
    raw = sys.argv[1]
else:
    raw = sys.stdin.read()

data = json.loads(raw)
url = data.get('url', '')
title = data.get('title', '')
elements = data.get('elements', [])

# 从 URL 提取站点名
match = re.search(r'https?://(?:www\.)?([^/]+)', url)
site = match.group(1) if match else url

db = sqlite3.connect(DB)
c = db.cursor()

# 清除旧数据
c.execute('DELETE FROM page_elements WHERE site=?', (site,))
c.execute('DELETE FROM page_scans WHERE site=?', (site,))

# 插入扫描记录
c.execute('INSERT INTO page_scans (site, page_url, page_title, element_count) VALUES (?,?,?,?)',
          (site, url, title, len(elements)))

# 插入元素
for el in elements:
    c.execute('''INSERT INTO page_elements 
        (site, page_url, page_title, element_index, tag, selector, text_content, 
         placeholder, role, element_type, position_x, position_y, width, height)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
        (site, url, title, el.get('i',0), el.get('tag',''), el.get('sel', el.get('selector','')),
         el.get('txt', el.get('text','')), el.get('ph', el.get('placeholder','')),
         el.get('role',''), el.get('type',''),
         el.get('x',0), el.get('y',0), el.get('w',0), el.get('h',0)))

db.commit()
print(f'Saved {len(elements)} elements for {site}')
db.close()
