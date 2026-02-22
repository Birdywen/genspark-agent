#!/usr/bin/env python3
"""ArrangeMe API SDK - Complete automation toolkit"""
import json
import os
import re
import time
import random
import string
import urllib.request
import urllib.parse
import urllib.error
from pathlib import Path


class ArrangeMeClient:
    BASE_URL = 'https://www.arrangeme.com'
    S3_BUCKET = 'arrangeme-uploads'
    S3_REGION = 'us-west-2'
    COGNITO_POOL_ID = 'us-west-2:a0ce8d26-2469-4be3-ab21-aa5342357f62'

    def __init__(self, session_cookie=None, cookie_file=None):
        """Initialize with session cookie string or cookie file path."""
        if session_cookie:
            self.cookie = session_cookie
        elif cookie_file:
            with open(cookie_file) as f:
                self.cookie = f.read().strip()
        else:
            cookie_path = Path(__file__).parent / '.cookie'
            if cookie_path.exists():
                self.cookie = cookie_path.read_text().strip()
            else:
                raise ValueError('No session cookie provided. Pass session_cookie, cookie_file, or create .cookie file.')

    def _request(self, path, method='GET', data=None, content_type=None):
        """Make authenticated request to ArrangeMe."""
        url = self.BASE_URL + path
        req = urllib.request.Request(url, method=method)
        req.add_header('Cookie', self.cookie)
        req.add_header('User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')
        if data is not None:
            if isinstance(data, dict):
                body = urllib.parse.urlencode(data).encode()
                req.add_header('Content-Type', 'application/x-www-form-urlencoded')
            elif isinstance(data, bytes):
                body = data
                if content_type:
                    req.add_header('Content-Type', content_type)
            else:
                body = str(data).encode()
                if content_type:
                    req.add_header('Content-Type', content_type)
            req.data = body
            req.method = 'POST'
        try:
            with urllib.request.urlopen(req) as resp:
                raw = resp.read().decode('utf-8', errors='replace')
                ct = resp.headers.get('content-type', '')
                if 'json' in ct:
                    return json.loads(raw)
                return raw
        except urllib.error.HTTPError as e:
            body = e.read().decode('utf-8', errors='replace') if e.fp else ''
            raise Exception(f'HTTP {e.code}: {body[:500]}')

    def _post_form(self, path, data):
        """POST form data."""
        return self._request(path, method='POST', data=data)

    @staticmethod
    def _strip_html(html):
        """Remove HTML tags from string."""
        if not html:
            return ''
        return re.sub(r'<[^>]+>', '', html).strip()

    # ─── DATA EXPORT ─────────────────────────────────────

    def get_sales(self, start=0, length=100, sort_col=0, sort_dir='desc', search=''):
        """Fetch sales data (paginated)."""
        data = {
            'returnJson': 'true',
            'sortColumnIndex': sort_col,
            'sortDirection': sort_dir,
            'start': start,
            'length': length,
            'search': search
        }
        result = self._post_form('/account/dashboardSales.action', data)
        if isinstance(result, dict) and result.get('error') == 'no-session':
            raise Exception('Session expired')
        return result

    def get_all_sales(self, page_size=100):
        """Fetch ALL sales records."""
        all_data = []
        start = 0
        while True:
            result = self.get_sales(start=start, length=page_size)
            total = result.get('recordsTotal', 0)
            records = result.get('data', [])
            for r in records:
                all_data.append({
                    'date': self._strip_html(r.get('date', '')),
                    'titleId': self._strip_html(r.get('sellerTitleId', '')),
                    'title': self._strip_html(r.get('title', '')),
                    'format': self._strip_html(r.get('format', '')),
                    'channel': self._strip_html(r.get('saleChannels', '')),
                    'country': self._strip_html(r.get('countryName', '')),
                    'quantity': int(self._strip_html(r.get('quantity', '0')) or 0),
                    'salesAmount': self._strip_html(r.get('salesAmount', '')),
                    'commission': self._strip_html(r.get('commissionAmount', ''))
                })
            if len(all_data) >= total or not records:
                break
            start += page_size
            print(f'  Fetched {len(all_data)}/{total} sales...')
        print(f'Done: {len(all_data)} total sales')
        return all_data

    def get_titles(self, start=0, length=100, sort_col=0, sort_dir='desc', search=''):
        """Fetch titles data (paginated)."""
        data = {
            'returnJson': 'true',
            'sortColumnIndex': sort_col,
            'sortDirection': sort_dir,
            'start': start,
            'length': length,
            'search': search
        }
        result = self._post_form('/account/dashboardTitles.action', data)
        if isinstance(result, dict) and result.get('error') == 'no-session':
            raise Exception('Session expired')
        return result

    def get_all_titles(self, page_size=100):
        """Fetch ALL title records."""
        all_data = []
        start = 0
        while True:
            result = self.get_titles(start=start, length=page_size)
            total = result.get('recordsTotal', 0)
            records = result.get('data', [])
            for r in records:
                all_data.append({
                    'ameId': self._strip_html(r.get('ame_id', '')),
                    'title': self._strip_html(r.get('title', '')),
                    'format': self._strip_html(r.get('format', '')),
                    'price': self._strip_html(r.get('price', '')),
                    'status': self._strip_html(r.get('status', '')),
                    'publishedTo': self._strip_html(r.get('published_to', '')),
                    'added': self._strip_html(r.get('added', ''))
                })
            if len(all_data) >= total or not records:
                break
            start += page_size
            print(f'  Fetched {len(all_data)}/{total} titles...')
        print(f'Done: {len(all_data)} total titles')
        return all_data

    def download_sales_csv(self, output_path=None):
        """Download all sales as CSV."""
        raw = self._request('/account/download/sales/csv')
        if output_path:
            Path(output_path).write_text(raw)
            print(f'Saved to {output_path}')
        return raw

    # ─── TITLE DETAILS ───────────────────────────────────

    def get_title_detail(self, seller_title_id):
        """Get title detail page and parse key info."""
        html = self._request(f'/title/{seller_title_id}')
        info = {'sellerTitleId': seller_title_id}
        m = re.search(r'Status\s+([\w\s-]+)', html)
        if m:
            info['status'] = m.group(1).strip()
        return info

    def get_title_edit_details(self, seller_title_id):
        """Get current title details for editing."""
        html = self._request(f'/title/edit/details/{seller_title_id}')
        fields = {}
        for m in re.finditer(r'name="([^"]+)"[^>]*value="([^"]*)"', html):
            fields[m.group(1)] = m.group(2)
        ta = re.search(r'name="title\.description"[^>]*>(.*?)</textarea>', html, re.S)
        if ta:
            fields['title.description'] = self._strip_html(ta.group(1))
        return fields

    def get_title_edit_arrangement(self, seller_title_id):
        """Get current arrangement details for editing."""
        html = self._request(f'/title/edit/arrangement/{seller_title_id}')
        fields = {}
        for m in re.finditer(r'name="([^"]+)"[^>]*value="([^"]*)"', html):
            fields[m.group(1)] = m.group(2)
        for m in re.finditer(r'<option[^>]*selected[^>]*value="([^"]*)"', html):
            pass  # TODO: parse selected options
        return fields

    def get_title_edit_genres(self, seller_title_id):
        """Get current genre selections."""
        html = self._request(f'/title/edit/genres/{seller_title_id}')
        selected = re.findall(r'value="(\d+)"[^>]*selected', html)
        return selected

    # ─── TITLE EDITING ───────────────────────────────────

    def update_title_details(self, seller_title_id, title=None, composers=None, arrangers=None, artists=None, description=None, external_link=None):
        """Update title details (Step 2)."""
        current = self.get_title_edit_details(seller_title_id)
        data = {'sellerTitleId': seller_title_id}
        data['title.contentTitle'] = title or current.get('title.contentTitle', '')
        data['title.contributors.composers'] = composers or current.get('title.contributors.composers', '')
        data['title.contributors.arrangers'] = arrangers or current.get('title.contributors.arrangers', '')
        data['title.contributors.artists'] = artists or current.get('title.contributors.artists', '')
        data['title.description'] = description or current.get('title.description', '')
        data['title.externalLink.linkUrl'] = external_link or current.get('title.externalLink.linkUrl', '')
        return self._post_form('/title/edit/details', data)

    def update_title_arrangement(self, seller_title_id, group_id=None, type_id=None, difficulty=None, price=None):
        """Update arrangement details (Step 3)."""
        current = self.get_title_edit_arrangement(seller_title_id)
        data = {'sellerTitleId': seller_title_id}
        data['title.arrangement.groupId'] = group_id or current.get('title.arrangement.groupId', '')
        if type_id:
            data['title.arrangement.typeId'] = type_id
        data['title.difficultyLevel'] = difficulty or current.get('title.difficultyLevel', '')
        data['priceStr'] = price or current.get('priceStr', '')
        return self._post_form('/title/edit/arrangement', data)

    def update_title_genres(self, seller_title_id, genre_ids):
        """Update genres (Step 4). genre_ids = list of genre ID strings."""
        data = [('sellerTitleId', seller_title_id)]
        for gid in genre_ids:
            data.append(('title.genreIds', gid))
        body = urllib.parse.urlencode(data).encode()
        return self._request('/title/edit/genres', method='POST', data=body, content_type='application/x-www-form-urlencoded')

    # ─── PUBLISH / UNPUBLISH ─────────────────────────────

    def publish(self, seller_title_id):
        """Publish a title (Draft -> Processing -> Published)."""
        return self._request(f'/title/publish/{seller_title_id}')

    def unpublish(self, seller_title_id):
        """Unpublish a title."""
        return self._request(f'/title/unpublish/{seller_title_id}')

    def delete_title(self, seller_title_id):
        """Delete a title."""
        return self._request(f'/title/delete/{seller_title_id}')

    # ─── BULK OPERATIONS ─────────────────────────────────

    def bulk_select_all(self, select_pdfs=True, select_mp3s=False):
        """Select all titles for bulk operation."""
        data = {
            'selectAllPDFs': str(select_pdfs).lower(),
            'selectAllMP3s': str(select_mp3s).lower()
        }
        return self._post_form('/title/bulk/selectAll.action', data)

    def bulk_save_prices(self, form_data, publish=False):
        """Bulk save arrangement prices."""
        if publish:
            form_data['publish'] = 'true'
        return self._post_form('/title/bulk/saveArrangementPrices.action', form_data)

    def bulk_save_difficulty(self, form_data, publish=False):
        """Bulk save difficulty levels."""
        if publish:
            form_data['publish'] = 'true'
        return self._post_form('/title/bulk/saveDifficultyLevels.action', form_data)

    def bulk_save_genres(self, form_data, publish=False):
        """Bulk save genres."""
        if publish:
            form_data['publish'] = 'true'
        return self._post_form('/title/bulk/saveGenres.action', form_data)

    def bulk_save_arrangement_groups(self, form_data, publish=False):
        """Bulk save arrangement groups."""
        if publish:
            form_data['publish'] = 'true'
        return self._post_form('/title/bulk/saveArrangementGroups.action', form_data)

    # ─── ARRANGEMENT TYPES ───────────────────────────────

    def get_arrangement_types(self, group_id):
        """Get arrangement types for a group."""
        result = self._request(f'/sell/arrangementTypeGroups.action?arrangementGroupId={group_id}')
        if isinstance(result, str):
            result = json.loads(result)
        return result

    # ─── DELETE ATTACHMENTS ──────────────────────────────

    def delete_preview_mp3(self, seller_title_id):
        """Delete preview MP3 from a title."""
        return self._request(f'/title/edit/deletePreviewMp3.action?sellerTitleId={seller_title_id}')

    def delete_cover_image(self, seller_title_id):
        """Delete cover image from a title."""
        return self._request(f'/title/edit/deleteCoverImage.action?sellerTitleId={seller_title_id}')

    # ─── DOWNLOAD ────────────────────────────────────────

    def get_pdf_url(self, seller_title_id):
        """Get pre-signed S3 URL for a title's PDF."""
        html = self._request(f'/title/{seller_title_id}')
        match = re.search(r'data="(https://arrangeme-pdf\.s3[^"]+)"', html)
        if match:
            return match.group(1).replace('&amp;', '&')
        return None

    def get_mp3_url(self, seller_title_id):
        """Get pre-signed S3 URL for a title's MP3."""
        html = self._request(f'/title/{seller_title_id}')
        match = re.search(r'(https://arrangeme-audio\.s3[^"]+)', html)
        if match:
            return match.group(1).replace('&amp;', '&')
        return None

    def download_pdf(self, seller_title_id, output_path=None):
        """Download a title's PDF file."""
        url = self.get_pdf_url(seller_title_id)
        if not url:
            raise Exception(f'No PDF found for title {seller_title_id}')
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req) as resp:
            data = resp.read()
        if output_path is None:
            output_path = f'title_{seller_title_id}.pdf'
        Path(output_path).write_bytes(data)
        print(f'Downloaded PDF ({len(data)} bytes) -> {output_path}')
        return output_path

    def download_mp3(self, seller_title_id, output_path=None):
        """Download a title's MP3 file."""
        url = self.get_mp3_url(seller_title_id)
        if not url:
            raise Exception(f'No MP3 found for title {seller_title_id}')
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req) as resp:
            data = resp.read()
        if output_path is None:
            output_path = f'title_{seller_title_id}.mp3'
        Path(output_path).write_bytes(data)
        print(f'Downloaded MP3 ({len(data)} bytes) -> {output_path}')
        return output_path

    # ─── S3 UPLOAD HELPERS ───────────────────────────────

    @staticmethod
    def _generate_s3_key(filename):
        """Generate S3 key in ArrangeMe format."""
        rand = ''.join(random.choices(string.ascii_lowercase + string.digits, k=8))
        safe_name = filename.replace(' ', '_')
        return f'files/{rand}_{safe_name}'

    def upload_to_s3(self, file_path):
        """Upload file to ArrangeMe S3 bucket using boto3 with Cognito credentials.
        Returns the S3 key."""
        try:
            import boto3
        except ImportError:
            raise ImportError('boto3 required for S3 upload. pip install boto3')

        from botocore.config import Config
        client = boto3.client(
            'cognito-identity',
            region_name=self.S3_REGION
        )
        identity = client.get_id(IdentityPoolId=self.COGNITO_POOL_ID)
        creds = client.get_credentials_for_identity(IdentityId=identity['IdentityId'])
        ak = creds['Credentials']['AccessKeyId']
        sk = creds['Credentials']['SecretKey']
        st = creds['Credentials']['SessionToken']

        s3 = boto3.client(
            's3',
            region_name=self.S3_REGION,
            aws_access_key_id=ak,
            aws_secret_access_key=sk,
            aws_session_token=st
        )

        file_path = Path(file_path)
        s3_key = self._generate_s3_key(file_path.name)
        content_type = 'application/pdf' if file_path.suffix == '.pdf' else 'audio/mpeg'

        s3.upload_file(
            str(file_path),
            self.S3_BUCKET,
            s3_key,
            ExtraArgs={'ContentType': content_type}
        )
        print(f'Uploaded {file_path.name} -> s3://{self.S3_BUCKET}/{s3_key}')
        return s3_key

    # ─── FULL UPLOAD FLOW ────────────────────────────────

    def upload_new_title(self, pdf_path, title, composers, arrangers='',
                         description='', group_id=1, type_id=3,
                         difficulty=3, price='5.99', genre_ids=None,
                         mp3_path=None, preview_mp3_path=None,
                         cover_image_path=None, title_type='publicdomain',
                         how_modified='Change in arrangement',
                         how_modified_desc='Arranged for the specified format',
                         external_link='', artists='', auto_publish=True):
        """Complete 4-step upload flow.
        
        Args:
            pdf_path: Path to PDF file
            title: Display title
            composers: Composer name(s)
            arrangers: Arranger name(s)
            description: Title description
            group_id: Arrangement group (1=Piano/Keyboard)
            type_id: Arrangement type (3=Piano Solo)
            difficulty: 1-5 (1=Beginner, 5=Expert)
            price: Price string (e.g., '5.99')
            genre_ids: List of genre IDs (e.g., ['7'] for Classical)
            mp3_path: Optional MP3 sample path
            preview_mp3_path: Optional preview MP3 path
            cover_image_path: Optional cover image path
            title_type: 'publicdomain', 'original', etc.
            how_modified: How the arrangement was modified
            how_modified_desc: Description of modifications
        """
        if genre_ids is None:
            genre_ids = ['7']  # Classical

        print(f'=== Uploading: {title} ===')

        # Step 1: Upload files to S3
        print('Step 1: Uploading files to S3...')
        pdf_s3_key = self.upload_to_s3(pdf_path)

        mp3_s3_key = ''
        if mp3_path:
            mp3_s3_key = self.upload_to_s3(mp3_path)

        preview_s3_key = ''
        if preview_mp3_path:
            preview_s3_key = self.upload_to_s3(preview_mp3_path)

        cover_s3_key = ''
        if cover_image_path:
            cover_s3_key = self.upload_to_s3(cover_image_path)

        # Step 1: Submit upload form
        upload_data = {
            'sellerTitleId': '0',
            'generatePreviewMp3Status': 'new',
            'uploadedPdfS3Key': pdf_s3_key,
            'howModified': how_modified,
            'howModifiedDesc': how_modified_desc,
            'reUpload': 'false'
        }
        if mp3_s3_key:
            upload_data['uploadedMp3S3Key'] = mp3_s3_key
        if preview_s3_key:
            upload_data['uploadedPreviewMp3S3Key'] = preview_s3_key
        if cover_s3_key:
            upload_data['uploadedCoverImageS3Key'] = cover_s3_key

        resp1 = self._post_form(f'/sell/{title_type}/sheet/upload', upload_data)
        print('  Upload form submitted')

        # Extract sellerTitleId from response
        sid_match = re.search(r'sellerTitleId["\']?[^>]*value=["\']?(\d+)', str(resp1))
        if not sid_match:
            sid_match = re.search(r'title/(\d+)', str(resp1))
        if not sid_match:
            raise Exception('Could not extract sellerTitleId from upload response')
        seller_title_id = sid_match.group(1)
        print(f'  Title ID: {seller_title_id}')

        # Step 2: Title Details
        print('Step 2: Setting title details...')
        details_data = {
            'sellerTitleId': seller_title_id,
            'title.contentTitle': title,
            'title.contributors.composers': composers,
            'title.contributors.arrangers': arrangers,
            'title.contributors.artists': artists,
            'title.description': description or title,
            'title.externalLink.linkUrl': external_link
        }
        self._post_form(f'/sell/{title_type}/sheet/details', details_data)
        print('  Details saved')

        # Step 3: Arrangement Details
        print('Step 3: Setting arrangement details...')
        arr_data = {
            'sellerTitleId': seller_title_id,
            'title.arrangement.groupId': group_id,
            'title.arrangement.typeId': type_id,
            'title.difficultyLevel': difficulty,
            'priceStr': price
        }
        self._post_form(f'/sell/{title_type}/sheet/arrangement', arr_data)
        print('  Arrangement saved')

        # Step 4: Genres
        print('Step 4: Setting genres...')
        genre_data = [('sellerTitleId', '0')]
        for gid in genre_ids:
            genre_data.append(('title.genreIds', gid))
        body = urllib.parse.urlencode(genre_data).encode()
        self._request(f'/sell/{title_type}/sheet/genres', method='POST', data=body, content_type='application/x-www-form-urlencoded')
        print('  Genres saved (status: Draft)')

        # Step 5: Publish (optional)
        if auto_publish:
            print('Step 5: Publishing...')
            self.publish(seller_title_id)
            print('  Publish triggered (status: Processing)')

        print(f'=== SUCCESS: {title} (ID: {seller_title_id}) ===')
        return seller_title_id


# ─── CLI USAGE ───────────────────────────────────────────
if __name__ == '__main__':
    import sys
    if len(sys.argv) < 2:
        print('Usage:')
        print('  python arrangeme.py sales [output.json]')
        print('  python arrangeme.py titles [output.json]')
        print('  python arrangeme.py csv [output.csv]')
        print('  python arrangeme.py detail <titleId>')
        print('  python arrangeme.py unpublish <titleId>')
        print('  python arrangeme.py upload <pdf> <title> <composer> [options]')
        sys.exit(1)

    client = ArrangeMeClient()
    cmd = sys.argv[1]

    if cmd == 'sales':
        data = client.get_all_sales()
        out = sys.argv[2] if len(sys.argv) > 2 else 'arrangeme_sales.json'
        with open(out, 'w') as f:
            json.dump(data, f, indent=2)
        print(f'Saved {len(data)} sales to {out}')

    elif cmd == 'titles':
        data = client.get_all_titles()
        out = sys.argv[2] if len(sys.argv) > 2 else 'arrangeme_titles.json'
        with open(out, 'w') as f:
            json.dump(data, f, indent=2)
        print(f'Saved {len(data)} titles to {out}')

    elif cmd == 'csv':
        out = sys.argv[2] if len(sys.argv) > 2 else 'arrangeme_sales.csv'
        client.download_sales_csv(out)

    elif cmd == 'detail':
        tid = sys.argv[2]
        info = client.get_title_detail(tid)
        print(json.dumps(info, indent=2))

    elif cmd == 'unpublish':
        tid = sys.argv[2]
        client.unpublish(tid)
        print(f'Unpublished title {tid}')

    elif cmd == 'upload':
        if len(sys.argv) < 5:
            print('Usage: python arrangeme.py upload <pdf> <title> <composer>')
            sys.exit(1)
        pdf = sys.argv[2]
        title = sys.argv[3]
        composer = sys.argv[4]
        sid = client.upload_new_title(pdf, title, composer)
        print(f'Uploaded: {sid}')

    else:
        print(f'Unknown command: {cmd}')
