#!/usr/bin/env python3
"""ArrangeMe Data Export Tool

Usage:
  python export.py sales [output.json]
  python export.py titles [output.json]
  python export.py csv [output.csv]
  python export.py report
  python export.py all [output_dir]
"""
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from arrangeme import ArrangeMeClient


def export_sales(client, output_path='arrangeme_sales.json'):
    data = client.get_all_sales()
    with open(output_path, 'w') as f:
        json.dump(data, f, indent=2)
    print(f'Exported {len(data)} sales to {output_path}')
    return data


def export_titles(client, output_path='arrangeme_titles.json'):
    data = client.get_all_titles()
    with open(output_path, 'w') as f:
        json.dump(data, f, indent=2)
    print(f'Exported {len(data)} titles to {output_path}')
    return data


def export_csv(client, output_path='arrangeme_sales.csv'):
    raw = client.download_sales_csv(output_path)
    return raw


def generate_report(client):
    """Generate a summary report."""
    sales = client.get_sales(start=0, length=1)
    titles = client.get_titles(start=0, length=1)

    total_sales = sales.get('recordsTotal', 0)
    total_titles = titles.get('recordsTotal', 0)

    # Get recent sales
    recent = client.get_sales(start=0, length=10)

    print(f'\n=== ArrangeMe Report ({datetime.now().strftime("%Y-%m-%d")}) ===')
    print(f'Total titles: {total_titles}')
    print(f'Total sales records: {total_sales}')
    print(f'\nRecent Sales:')
    for r in recent.get('data', []):
        date = client._strip_html(r.get('date', ''))
        title = client._strip_html(r.get('title', ''))
        amount = client._strip_html(r.get('salesAmount', ''))
        commission = client._strip_html(r.get('commissionAmount', ''))
        channel = client._strip_html(r.get('saleChannels', ''))
        country = client._strip_html(r.get('countryName', ''))
        print(f'  {date}  {amount:>8}  {commission:>8}  {title[:40]:<42} {channel:<20} {country}')


def export_all(client, output_dir='.'):
    """Export everything."""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime('%Y%m%d')

    export_sales(client, output_dir / f'sales_{ts}.json')
    export_titles(client, output_dir / f'titles_{ts}.json')
    export_csv(client, output_dir / f'sales_{ts}.csv')
    generate_report(client)


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    client = ArrangeMeClient()
    cmd = sys.argv[1]

    if cmd == 'sales':
        out = sys.argv[2] if len(sys.argv) > 2 else 'arrangeme_sales.json'
        export_sales(client, out)

    elif cmd == 'titles':
        out = sys.argv[2] if len(sys.argv) > 2 else 'arrangeme_titles.json'
        export_titles(client, out)

    elif cmd == 'csv':
        out = sys.argv[2] if len(sys.argv) > 2 else 'arrangeme_sales.csv'
        export_csv(client, out)

    elif cmd == 'report':
        generate_report(client)

    elif cmd == 'all':
        out_dir = sys.argv[2] if len(sys.argv) > 2 else '.'
        export_all(client, out_dir)

    else:
        print(f'Unknown command: {cmd}')
        print(__doc__)
