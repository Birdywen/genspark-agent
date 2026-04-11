#!/usr/bin/env python3
"""article-pipeline.py - MHTML → Diffbot → articles_temp 表

用法:
  python3 article-pipeline.py <aidrive_folder> [--db <db_path>] [--table <table_name>]

示例:
  python3 article-pipeline.py "/7 articles"
  python3 article-pipeline.py "/new papers" --table articles_batch2

流程:
  1. aidrive ls 获取 .mhtml 文件列表
  2. aidrive get_readable_url 获取下载链接
  3. curl 下载 mhtml
  4. Python email 模块提取纯 HTML
  5. Diffbot Article API (POST HTML) 提取结构化数据
  6. Diffbot NL API 提取 NLP 实体
  7. 存入 SQLite articles_temp 表

依赖: requests, sqlite3 (标准库)
"""
import sys, os, re, json, email, sqlite3, subprocess, argparse, quopri
from pathlib import Path

DIFFBOT_TOKEN = "0a1ccea6c5a3a8845558aebd8204c454"
DB_DEFAULT = os.path.expanduser("~/workspace/genspark-agent/server-v2/data/agent.db")
AGENT_URL = "http://localhost:8766"  # agent HTTP endpoint for aidrive

def aidrive_call(action, path):
    """Call aidrive via agent HTTP API"""
    import urllib.request, json as j
    payload = j.dumps({"tool": "aidrive", "params": {"action": action, "path": path}})
    req = urllib.request.Request(f"{AGENT_URL}/tool", data=payload.encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return j.loads(resp.read())
    except Exception:
        return None

def extract_html_from_mhtml(mhtml_bytes):
    """Extract the main text/html part from MHTML bytes"""
    msg = email.message_from_bytes(mhtml_bytes)
    for part in msg.walk():
        ct = part.get_content_type()
        if ct == "text/html":
            payload = part.get_payload(decode=True)
            if payload and len(payload) > 10000:
                return payload.decode("utf-8", errors="replace")
    return None

def clean_html(html_str):
    """Remove base64 images and excessive whitespace to reduce size"""
    html_str = re.sub(r'src="data:image/[^"]{100,}"', 'src=""', html_str)
    html_str = re.sub(r'url\(data:image/[^)]{100,}\)', 'url()', html_str)
    return html_str

def diffbot_article(html_bytes, source_url=""):
    """POST HTML to Diffbot Article API, return structured data"""
    # url param is REQUIRED by Diffbot even for POST HTML - use dummy if not provided
    effective_url = source_url or "https://example.com/article"
    url = f"https://api.diffbot.com/v3/article?token={DIFFBOT_TOKEN}&timeout=120000&url={effective_url}"
    result = subprocess.run(
        ["curl", "-s", "-X", "POST", "-H", "Content-Type: text/html",
         "--data-binary", "@-", url],
        input=html_bytes, capture_output=True, timeout=180
    )
    return json.loads(result.stdout)

def diffbot_nlp(text, max_chars=50000):
    """POST text to Diffbot NL API for entity extraction"""
    text = text[:max_chars]
    url = f"https://nl.diffbot.com/v1/?fields=entities&token={DIFFBOT_TOKEN}"
    payload = json.dumps({"content": text, "lang": "en"})
    result = subprocess.run(
        ["curl", "-s", "-X", "POST", "-H", "Content-Type: application/json",
         "-d", payload, url],
        capture_output=True, timeout=120
    )
    try:
        data = json.loads(result.stdout)
        entities = []
        for e in data.get("entities", [])[:15]:
            entities.append({"name": e.get("name",""), "salience": round(e.get("salience",0), 3)})
        return entities
    except Exception:
        return []

def ensure_table(db, table):
    """Create articles table if not exists"""
    db.execute(f"""CREATE TABLE IF NOT EXISTS {table} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT, authors TEXT, year TEXT, journal TEXT,
        content TEXT, url TEXT, filename TEXT,
        diffbot_entities TEXT,
        created_at TEXT DEFAULT (datetime('now'))
    )""")
    db.commit()

def process_mhtml_file(mhtml_path, source_url, db, table):
    """Process a single MHTML file through the full pipeline"""
    filename = os.path.basename(mhtml_path)
    
    # 1. Read and extract HTML
    with open(mhtml_path, "rb") as f:
        mhtml_bytes = f.read()
    
    html = extract_html_from_mhtml(mhtml_bytes)
    if not html:
        print(f"  ✗ No HTML found in {filename}")
        return False
    print(f"  HTML extracted: {len(html)//1024} KB")
    
    # 2. Clean HTML
    html = clean_html(html)
    html_bytes = html.encode("utf-8")
    
    # 3. Diffbot Article API
    print(f"  Diffbot Article (curl POST HTML)...")
    article_data = diffbot_article(html_bytes, source_url)
    obj = (article_data.get("objects") or [{}])[0]
    
    title = obj.get("title", "").strip()
    authors = obj.get("author", "")
    text = obj.get("text", "")
    date_str = obj.get("date", "")
    
    # Extract year from date
    year = ""
    ym = re.search(r"(20[012]\d)", date_str)
    if ym:
        year = ym.group(1)
    
    print(f"  Title: {title[:80]}")
    print(f"  Authors: {authors[:50]}")
    print(f"  Year: {year}, Text: {len(text)} chars")
    
    # 4. NLP entities
    print(f"  NLP entities...")
    entities = diffbot_nlp(text)
    print(f"  Entities: {len(entities)}")
    
    # 5. Save to DB
    db.execute(f"""INSERT INTO {table} 
        (title, authors, year, journal, content, url, filename, diffbot_entities)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (title, authors, year, "", text[:50000], source_url, filename, json.dumps(entities))
    )
    db.commit()
    print(f"  ✓ Saved")
    return True

def main():
    parser = argparse.ArgumentParser(description="MHTML → Diffbot → SQLite pipeline")
    parser.add_argument("input", help="AI Drive folder path, or local directory with .mhtml files")
    parser.add_argument("--db", default=DB_DEFAULT, help="SQLite database path")
    parser.add_argument("--table", default="articles_temp", help="Target table name")
    parser.add_argument("--local", action="store_true", help="Input is a local directory (skip aidrive)")
    args = parser.parse_args()
    
    db = sqlite3.connect(args.db)
    ensure_table(db, args.table)
    
    if args.local:
        # Local mode: read .mhtml files from directory
        mhtml_dir = os.path.expanduser(args.input)
        files = sorted([f for f in os.listdir(mhtml_dir) if f.endswith(".mhtml")])
        print(f"Found {len(files)} .mhtml files in {mhtml_dir}")
        
        ok = 0
        for i, fname in enumerate(files, 1):
            print(f"\n=== [{i}/{len(files)}] {fname[:70]} ===")
            fpath = os.path.join(mhtml_dir, fname)
            if process_mhtml_file(fpath, "", db, args.table):
                ok += 1
        
        print(f"\n{'='*60}")
        print(f"Done: {ok}/{len(files)} succeeded")
    else:
        # AI Drive mode: download via aidrive
        print(f"Listing AI Drive: {args.input}")
        # This mode requires the agent HTTP API to be running
        # Files are downloaded to /tmp/article_pipeline/
        tmpdir = "/tmp/article_pipeline"
        os.makedirs(tmpdir, exist_ok=True)
        
        # List files via aidrive
        ls_result = aidrive_call("ls", args.input)
        if not ls_result:
            print("Error: Cannot connect to agent API for aidrive. Use --local mode instead.")
            sys.exit(1)
        
        # Get readable URLs and download
        files_data = ls_result.get("result", {}).get("files", [])
        mhtml_files = [f for f in files_data if f.get("name", "").endswith(".mhtml")]
        print(f"Found {len(mhtml_files)} .mhtml files")
        
        ok = 0
        for i, finfo in enumerate(mhtml_files, 1):
            fname = finfo["name"]
            fpath_drive = f"{args.input}/{fname}"
            print(f"\n=== [{i}/{len(mhtml_files)}] {fname[:70]} ===")
            
            # Get download URL
            url_result = aidrive_call("get_readable_url", fpath_drive)
            if not url_result or not url_result.get("result", {}).get("url"):
                print(f"  ✗ Cannot get download URL")
                continue
            
            download_url = url_result["result"]["url"]
            local_path = os.path.join(tmpdir, f"article_{i}.mhtml")
            
            # Download
            subprocess.run(["curl", "-sL", "-o", local_path, download_url], timeout=60)
            
            if process_mhtml_file(local_path, "", db, args.table):
                ok += 1
        
        print(f"\n{'='*60}")
        print(f"Done: {ok}/{len(mhtml_files)} succeeded")
    
    # Summary
    rows = db.execute(f"SELECT id, substr(title,1,55), length(content), year, substr(authors,1,30) FROM {args.table} ORDER BY id").fetchall()
    print(f"\n{args.table}: {len(rows)} rows")
    for r in rows:
        print(f"  [{r[0]:>3}] {r[1]:55s} | {r[2]:>6} ch | {r[3]:4s} | {r[4]}")
    
    db.close()

if __name__ == "__main__":
    main()
