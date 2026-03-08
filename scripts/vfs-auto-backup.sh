#!/bin/bash
BACKUP_DIR=~/vfs-backups
mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
OUTFILE="$BACKUP_DIR/vfs-$TIMESTAMP.json"

PAGE_ID=$(curl -s http://localhost:9222/json 2>/dev/null | node -e "
var d='';process.stdin.on('data',function(c){d+=c});
process.stdin.on('end',function(){
  var pages=JSON.parse(d);
  var p=pages.find(function(x){return x.type==='page'&&x.url.indexOf('genspark.ai')>-1});
  if(p)console.log(p.id);
})" 2>/dev/null)

if [ -z "$PAGE_ID" ]; then
  echo "$(date): ERROR - No Genspark page found" >> "$BACKUP_DIR/backup.log"
  exit 1
fi

RESULT=$(node -e "
var WebSocket=require('ws');
var ws=new WebSocket('ws://localhost:9222/devtools/page/'+process.argv[1]);
ws.on('open',function(){
  ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{
    expression:'vfs.backup().then(function(r){return window.__vfs_snapshot})',
    returnByValue:true,awaitPromise:true
  }}));
});
ws.on('message',function(d){
  var msg=JSON.parse(d.toString());
  if(msg.id===1){
    if(msg.result&&msg.result.result&&msg.result.result.value){
      process.stdout.write(msg.result.result.value);
    }
    ws.close();
  }
});
setTimeout(function(){process.exit(1)},30000);
" "$PAGE_ID" 2>/dev/null)

if [ -z "$RESULT" ]; then
  echo "$(date): ERROR - Backup returned empty" >> "$BACKUP_DIR/backup.log"
  exit 1
fi

echo "$RESULT" > "$OUTFILE"
SIZE=$(wc -c < "$OUTFILE")
echo "$(date): OK - $OUTFILE ($SIZE bytes)" >> "$BACKUP_DIR/backup.log"

ls -t "$BACKUP_DIR"/vfs-*.json 2>/dev/null | tail -n +21 | xargs rm -f 2>/dev/null
