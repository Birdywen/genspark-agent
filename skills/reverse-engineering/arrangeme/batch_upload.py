#!/usr/bin/env python3
"""ArrangeMe Batch Upload Tool

Usage:
  python batch_upload.py <folder> [--dry-run]
  python batch_upload.py --csv <manifest.csv>

Folder mode: Reads PDF files from folder, uses filename as title.
CSV mode: Reads manifest with columns: pdf_path, title, composer, arranger, group_id, type_id, difficulty, price, genres
"""
import csv
import json
import os
import sys
import time
from pathlib import Path
from arrangeme import ArrangeMeClient


def upload_from_folder(folder, dry_run=False):
    """Upload all PDFs from a folder using filename as title."""
    client = ArrangeMeClient()
    folder = Path(folder)
    pdfs = sorted(folder.glob('*.pdf'))
    print(f'Found {len(pdfs)} PDF files in {folder}')

    results = []
    for i, pdf in enumerate(pdfs):
        title = pdf.stem.replace('_', ' ').replace('-', ' - ')
        print(f'\n[{i+1}/{len(pdfs)}] {title}')

        if dry_run:
            print('  [DRY RUN] Would upload:', pdf.name)
            results.append({'file': pdf.name, 'title': title, 'status': 'dry_run'})
            continue

        try:
            sid = client.upload_new_title(
                pdf_path=str(pdf),
                title=title,
                composers='',
                arrangers='MPS',
                group_id=1,
                type_id=3,  # Piano Solo
                difficulty=3,
                price='5.99',
                genre_ids=['7']  # Classical
            )
            results.append({'file': pdf.name, 'title': title, 'sellerTitleId': sid, 'status': 'success'})
            time.sleep(2)  # Be gentle
        except Exception as e:
            print(f'  ERROR: {e}')
            results.append({'file': pdf.name, 'title': title, 'status': 'error', 'error': str(e)})

    return results


def upload_from_csv(csv_path, dry_run=False):
    """Upload titles from a CSV manifest.
    
    CSV columns: pdf_path, title, composer, arranger, group_id, type_id, 
                 difficulty, price, genres, description, mp3_path, cover_path
    """
    client = ArrangeMeClient()
    results = []

    with open(csv_path) as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    print(f'Found {len(rows)} titles in {csv_path}')

    for i, row in enumerate(rows):
        title = row.get('title', '')
        print(f'\n[{i+1}/{len(rows)}] {title}')

        if dry_run:
            print('  [DRY RUN] Would upload:', row.get('pdf_path', ''))
            results.append({**row, 'status': 'dry_run'})
            continue

        try:
            genre_str = row.get('genres', '7')
            genre_ids = [g.strip() for g in genre_str.split(',') if g.strip()]

            sid = client.upload_new_title(
                pdf_path=row['pdf_path'],
                title=title,
                composers=row.get('composer', ''),
                arrangers=row.get('arranger', 'MPS'),
                description=row.get('description', ''),
                group_id=int(row.get('group_id', 1)),
                type_id=int(row.get('type_id', 3)),
                difficulty=int(row.get('difficulty', 3)),
                price=row.get('price', '5.99'),
                genre_ids=genre_ids,
                mp3_path=row.get('mp3_path') or None,
                cover_image_path=row.get('cover_path') or None
            )
            results.append({**row, 'sellerTitleId': sid, 'status': 'success'})
            time.sleep(2)
        except Exception as e:
            print(f'  ERROR: {e}')
            results.append({**row, 'status': 'error', 'error': str(e)})

    return results


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    dry_run = '--dry-run' in sys.argv

    if '--csv' in sys.argv:
        idx = sys.argv.index('--csv')
        csv_path = sys.argv[idx + 1]
        results = upload_from_csv(csv_path, dry_run=dry_run)
    else:
        folder = sys.argv[1]
        results = upload_from_folder(folder, dry_run=dry_run)

    # Save results
    out_path = 'upload_results.json'
    with open(out_path, 'w') as f:
        json.dump(results, f, indent=2)
    print(f'\nResults saved to {out_path}')

    success = sum(1 for r in results if r['status'] == 'success')
    errors = sum(1 for r in results if r['status'] == 'error')
    print(f'Done: {success} success, {errors} errors, {len(results)} total')
