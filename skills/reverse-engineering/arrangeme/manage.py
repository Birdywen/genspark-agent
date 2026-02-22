#!/usr/bin/env python3
"""ArrangeMe Title Management Tool

Usage:
  python manage.py list [--search=QUERY] [--status=STATUS]
  python manage.py detail <titleId>
  python manage.py edit <titleId> [--title=T] [--composer=C] [--price=P] [--difficulty=D] [--genres=G]
  python manage.py unpublish <titleId> [titleId2 ...]
  python manage.py bulk-price <price> [--search=QUERY]
  python manage.py export [output.json]
"""
import json
import sys
from arrangeme import ArrangeMeClient


def list_titles(client, search='', limit=20):
    """List titles with optional search."""
    result = client.get_titles(start=0, length=limit, search=search)
    total = result.get('recordsTotal', 0)
    filtered = result.get('recordsFiltered', 0)
    print(f'Total: {total}, Showing: {filtered}')
    print(f'{"ID":<10} {"Title":<45} {"Format":<20} {"Price":<8} {"Status"}')
    print('-' * 110)
    for r in result.get('data', []):
        print(f'{client._strip_html(r.get("ame_id","")):<10} '
              f'{client._strip_html(r.get("title",""))[:44]:<45} '
              f'{client._strip_html(r.get("format",""))[:19]:<20} '
              f'{client._strip_html(r.get("price","")):<8} '
              f'{client._strip_html(r.get("status",""))}')


def show_detail(client, title_id):
    """Show full detail of a title."""
    print(f'=== Title {title_id} ===')
    
    print('\n--- Details ---')
    details = client.get_title_edit_details(title_id)
    for k, v in details.items():
        print(f'  {k}: {v}')
    
    print('\n--- Arrangement ---')
    arr = client.get_title_edit_arrangement(title_id)
    for k, v in arr.items():
        print(f'  {k}: {v}')
    
    print('\n--- Genres ---')
    genres = client.get_title_edit_genres(title_id)
    print(f'  Genre IDs: {genres}')


def edit_title(client, title_id, title=None, composer=None, arranger=None,
               price=None, difficulty=None, genres=None, description=None):
    """Edit a title's properties."""
    if title or composer or arranger or description:
        print('Updating details...')
        client.update_title_details(
            title_id,
            title=title,
            composers=composer,
            arrangers=arranger,
            description=description
        )
        print('  Details updated')

    if price or difficulty:
        print('Updating arrangement...')
        client.update_title_arrangement(
            title_id,
            price=price,
            difficulty=difficulty
        )
        print('  Arrangement updated')

    if genres:
        print('Updating genres...')
        genre_ids = [g.strip() for g in genres.split(',')]
        client.update_title_genres(title_id, genre_ids)
        print(f'  Genres set to: {genre_ids}')

    print(f'Done editing title {title_id}')


def unpublish_titles(client, title_ids):
    """Unpublish one or more titles."""
    for tid in title_ids:
        print(f'Unpublishing {tid}...')
        client.unpublish(tid)
        print(f'  Done')


def export_all(client, output_path='arrangeme_titles.json'):
    """Export all titles to JSON."""
    data = client.get_all_titles()
    with open(output_path, 'w') as f:
        json.dump(data, f, indent=2)
    print(f'Exported {len(data)} titles to {output_path}')


def parse_arg(args, prefix):
    """Parse --key=value argument."""
    for a in args:
        if a.startswith(prefix + '='):
            return a[len(prefix)+1:]
    return None


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    client = ArrangeMeClient()
    cmd = sys.argv[1]

    if cmd == 'list':
        search = parse_arg(sys.argv, '--search') or ''
        limit = int(parse_arg(sys.argv, '--limit') or '20')
        list_titles(client, search=search, limit=limit)

    elif cmd == 'detail':
        show_detail(client, sys.argv[2])

    elif cmd == 'edit':
        tid = sys.argv[2]
        edit_title(
            client, tid,
            title=parse_arg(sys.argv, '--title'),
            composer=parse_arg(sys.argv, '--composer'),
            arranger=parse_arg(sys.argv, '--arranger'),
            price=parse_arg(sys.argv, '--price'),
            difficulty=parse_arg(sys.argv, '--difficulty'),
            genres=parse_arg(sys.argv, '--genres'),
            description=parse_arg(sys.argv, '--description')
        )

    elif cmd == 'unpublish':
        tids = sys.argv[2:]
        tids = [t for t in tids if not t.startswith('--')]
        unpublish_titles(client, tids)

    elif cmd == 'export':
        out = sys.argv[2] if len(sys.argv) > 2 else 'arrangeme_titles.json'
        export_all(client, out)

    else:
        print(f'Unknown command: {cmd}')
        print(__doc__)
