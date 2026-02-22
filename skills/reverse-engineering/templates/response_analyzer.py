#!/usr/bin/env python3
"""
API Response Structure Analyzer
用法: echo '{"data":{...}}' | python3 response_analyzer.py
或:   python3 response_analyzer.py < response.json
或:   python3 response_analyzer.py response.json

分析 JSON 响应的结构，识别常见模式（pagination, error, data wrapper, auth），
输出 schema 概要，帮助快速理解未知 API 的返回格式。
"""

import sys
import json

def analyze_type(val, depth=0, max_depth=4):
    if depth > max_depth:
        return "..."
    if val is None:
        return "null"
    if isinstance(val, bool):
        return "boolean"
    if isinstance(val, int):
        return "integer"
    if isinstance(val, float):
        return "float"
    if isinstance(val, str):
        if len(val) > 200:
            return f"string(len={len(val)})"
        return f"string"
    if isinstance(val, list):
        if len(val) == 0:
            return "array(empty)"
        sample = analyze_type(val[0], depth + 1, max_depth)
        return f"array({len(val)})[{sample}]"
    if isinstance(val, dict):
        fields = {}
        for k, v in val.items():
            fields[k] = analyze_type(v, depth + 1, max_depth)
        return fields
    return str(type(val).__name__)


def detect_patterns(data):
    patterns = []
    if not isinstance(data, dict):
        return patterns

    keys = set(data.keys())
    lower_keys = {k.lower() for k in keys}

    # Data wrapper
    for dw in ["data", "result", "results", "response", "payload", "body"]:
        if dw in lower_keys:
            patterns.append(f"data_wrapper: '{dw}'")

    # Pagination
    page_keys = {"page", "limit", "offset", "total", "count", "has_more",
                 "hasmore", "next", "nextpage", "cursor", "pagesize",
                 "totalcount", "totalresults", "per_page"}
    found_page = lower_keys & page_keys
    if found_page:
        patterns.append(f"pagination: {sorted(found_page)}")

    # Error
    err_keys = {"error", "errors", "message", "msg", "code", "status",
                "success", "ok", "errorcode", "errormessage"}
    found_err = lower_keys & err_keys
    if found_err:
        patterns.append(f"error_fields: {sorted(found_err)}")

    # Auth
    auth_keys = {"token", "access_token", "refresh_token", "auth",
                 "authorization", "api_key", "apikey", "session", "jwt"}
    found_auth = lower_keys & auth_keys
    if found_auth:
        patterns.append(f"auth_fields: {sorted(found_auth)}")

    # Metadata
    meta_keys = {"meta", "metadata", "_meta", "links", "_links", "headers"}
    found_meta = lower_keys & meta_keys
    if found_meta:
        patterns.append(f"metadata: {sorted(found_meta)}")

    return patterns


def main():
    raw = ""
    if len(sys.argv) > 1:
        with open(sys.argv[1], "r") as f:
            raw = f.read()
    else:
        raw = sys.stdin.read()

    raw = raw.strip()
    if not raw:
        print("ERROR: empty input")
        sys.exit(1)

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"ERROR: invalid JSON - {e}")
        print(f"First 200 chars: {raw[:200]}")
        sys.exit(1)

    print("=" * 60)
    print("API Response Structure Analysis")
    print("=" * 60)

    # Top-level type
    if isinstance(data, dict):
        print(f"\nType: Object ({len(data)} keys)")
        print(f"Keys: {list(data.keys())}")
    elif isinstance(data, list):
        print(f"\nType: Array ({len(data)} items)")
    else:
        print(f"\nType: {type(data).__name__}")

    # Schema
    print("\n--- Schema ---")
    schema = analyze_type(data)
    if isinstance(schema, dict):
        for k, v in schema.items():
            if isinstance(v, dict):
                print(f"  {k}: {{")
                for k2, v2 in v.items():
                    print(f"    {k2}: {v2}")
                print(f"  }}")
            else:
                print(f"  {k}: {v}")
    else:
        print(f"  {schema}")

    # Patterns
    patterns = detect_patterns(data)
    if patterns:
        print("\n--- Detected Patterns ---")
        for p in patterns:
            print(f"  {p}")

    # Sample values (top-level strings and numbers)
    if isinstance(data, dict):
        print("\n--- Sample Values ---")
        shown = 0
        for k, v in data.items():
            if shown >= 10:
                break
            if isinstance(v, (str, int, float, bool)) or v is None:
                sv = str(v)
                if len(sv) > 120:
                    sv = sv[:120] + "..."
                print(f"  {k}: {sv}")
                shown += 1

    print("\n" + "=" * 60)


if __name__ == "__main__":
    main()
