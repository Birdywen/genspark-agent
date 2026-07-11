#!/bin/bash
set -e
K='QUzVl_woTtn-uK17jUO9XlUuqeHVWZqxLImp_dy6Pak'
BASE='https://app.halbestunde.com/omr-external/service-omr/v2'
PDF="$1"
OUT="${2:-/tmp/halb_out.xml}"
FN=$(uuidgen).pdf
cd /tmp
echo "[1/5] GET presigned-upload"
curl -s "$BASE/recognize/presigned-upload?filename=$FN" -H "api-key: $K" -H 'referer: https://app.halbestunde.com/' -o up.json
UPLOAD_URL=$(python3 -c 'import json;print(json.load(open("up.json"))["url"])')
FILE_ID=$(python3 -c 'import json;print(json.load(open("up.json"))["filename"])')
echo "  fileId=$FILE_ID"
echo "[2/5] PUT upload"
curl -s -X PUT "$UPLOAD_URL" -H 'Content-Type: application/pdf' --data-binary "@$PDF" -o /dev/null -w '  HTTP:%{http_code} size:%{size_upload}\n'
echo "[3/5] POST recognize/presigned-upload (trigger OCR)"
curl -s -X POST "$BASE/recognize/presigned-upload" -H 'api-key: $K' -H 'content-type: application/json' -H 'referer: https://app.halbestunde.com/' --data-raw '{"filename":"'$FILE_ID'","device_hash":"2eeaba797a85af41008d47edbf461843","uid":"6e870408-2ff0-48dd-88fd-b7a18c58169a","pdf_image":true}' -o post.json
INF_ID=$(python3 -c 'import json;print(json.load(open("post.json"))["inference_id"])')
echo "  inference_id=$INF_ID"
echo "[4/5] Poll scan_result"
for i in $(seq 1 60); do
  curl -s "$BASE/recognize/$INF_ID" -H "api-key: $K" -H 'referer: https://app.halbestunde.com/' -o poll.json
  SCAN=$(python3 -c 'import json;d=json.load(open("poll.json"));b=d.get("body",d);print(b.get("scan_result"))' 2>/dev/null || echo None)
  if [ "$SCAN" = "True" ]; then
    echo "  done at [$i]"
    break
  fi
  sleep 2
done
echo "[5/5] Download XML"
XML_URL=$(python3 -c 'import json;d=json.load(open("poll.json"));b=d.get("body",d);print(b["result_xml"])')
ENC=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$XML_URL")
curl -s "$BASE/presigned-download/?url_storage=$ENC" -H "api-key: $K" -H 'referer: https://app.halbestunde.com/' -o dl.json
DL_URL=$(python3 -c 'import json;print(json.load(open("dl.json"))["url"])')
curl -s "$DL_URL" -o "$OUT" -w '  HTTP:%{http_code} size:%{size_download}\n'
echo "=== $OUT ==="
ls -la "$OUT"
echo "measure: " $(grep -c '<measure' "$OUT")
echo "note: " $(grep -c '<note' "$OUT")
