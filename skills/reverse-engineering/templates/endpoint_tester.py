#!/usr/bin/env python3
"""
Endpoint 批量测试器
用法: python3 endpoint_tester.py <base_url> <token_file> [endpoints_file]

不传 endpoints_file 时，从 stdin 读取 endpoint 列表（每行一个: METHOD /path）

示例:
  echo "GET /api/user\nPOST /api/data" | python3 endpoint_tester.py https://api.example.com /tmp/token.txt
  python3 endpoint_tester.py https://api.example.com /tmp/token.txt endpoints.txt
"""

import sys, json, subprocess, os

def test_endpoint(base_url, method, path, token, token_header='Authorization', token_prefix='Bearer '):
    url = base_url.rstrip('/') + path
    cmd = ['curl', '-s', '-o', '/dev/null', '-w',
           '{"status":%{http_code},"size":%{size_download},"time":%{time_total}}',
           '-X', method,
           '-H', 'Accept: application/json',
           '-H', f'{token_header}: {token_prefix}{token}',
           url]
    if method in ('POST', 'PUT', 'PATCH'):
        cmd.extend(['-H', 'Content-Type: application/json', '-d', '{}'])

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        info = json.loads(result.stdout)
        return {'url': url, 'method': method, 'status': info['status'], 'size': info['size'], 'time': round(info['time'], 2)}
    except Exception as e:
        return {'url': url, 'method': method, 'status': 0, 'error': str(e)}

def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)

    base_url = sys.argv[1]
    token_file = sys.argv[2]
    token = open(token_file).read().strip()

    # 支持自定义 token header（第4个参数）
    token_header = sys.argv[4] if len(sys.argv) > 4 else 'Authorization'
    token_prefix = sys.argv[5] if len(sys.argv) > 5 else 'Bearer '

    # 读取 endpoints
    if len(sys.argv) > 3 and os.path.exists(sys.argv[3]):
        lines = open(sys.argv[3]).read().strip().split('\n')
    else:
        lines = sys.stdin.read().strip().split('\n')

    results = []
    for line in lines:
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        parts = line.split(None, 1)
        method = parts[0].upper() if len(parts) > 1 else 'GET'
        path = parts[1] if len(parts) > 1 else parts[0]
        r = test_endpoint(base_url, method, path, token, token_header, token_prefix)
        status_icon = '✓' if 200 <= r['status'] < 300 else '✗' if r['status'] >= 400 else '?'
        print(f"  {status_icon} {r['status']} {method:6s} {path:50s} {r.get('size',0):>6}B  {r.get('time',0):.2f}s")
        print(f"\nTotal: {len(results)} | Success: {sum(1 for r in results if 200<=r['status']<300)} | Failed: {sum(1 for r in results if r['status']>=400)}")

if __name__ == '__main__':
    main()