#!/bin/bash
# vfs-kv.sh - Sandbox VFS KV CLI tool
# Usage: vfs-kv.sh <command> [args...]

SANDBOX="https://3000-isjad10r8glpogdbe5r7n-02b9cc79.sandbox.novita.ai"

case "$1" in
  health|h)
    curl -s "$SANDBOX/vfs/health" | jq .
    ;;
  stats|st)
    curl -s "$SANDBOX/vfs/stats" | jq .
    ;;
  ls|l)
    curl -s "$SANDBOX/vfs/ls" | jq '.[] | "\(.name) [\(.contentSize)b] \(.updated_at)"' -r
    ;;
  read|r)
    [ -z "$2" ] && echo "Usage: vfs-kv.sh read <slot>" && exit 1
    curl -s "$SANDBOX/vfs/read/$2" | jq -r '.content'
    ;;
  write|w)
    [ -z "$2" ] && echo "Usage: vfs-kv.sh write <slot> [file|-]" && exit 1
    if [ -n "$3" ] && [ "$3" != "-" ]; then
      CONTENT=$(cat "$3")
    else
      CONTENT=$(cat)
    fi
    curl -s -X POST "$SANDBOX/vfs/write/$2" -H "Content-Type: application/json" \
      -d "$(jq -n --arg c "$CONTENT" --arg d "$2" '{content:$c,description:$d}')" | jq .
    ;;
  msgs|m)
    [ -z "$2" ] && echo "Usage: vfs-kv.sh msgs <slot>" && exit 1
    curl -s "$SANDBOX/vfs/msg/$2" | jq '.[] | "\(.key) [\(.size)b] \(.updated_at)"' -r
    ;;
  readmsg|rm)
    [ -z "$3" ] && echo "Usage: vfs-kv.sh readmsg <slot> <key>" && exit 1
    curl -s "$SANDBOX/vfs/msg/$2/$3" | jq -r '.value'
    ;;
  writemsg|wm)
    [ -z "$3" ] && echo "Usage: vfs-kv.sh writemsg <slot> <key> [file|-]" && exit 1
    if [ -n "$4" ] && [ "$4" != "-" ]; then
      VALUE=$(cat "$4")
    else
      VALUE=$(cat)
    fi
    curl -s -X POST "$SANDBOX/vfs/msg/$2/$3" -H "Content-Type: application/json" \
      -d "$(jq -n --arg v "$VALUE" '{value:$v}')" | jq .
    ;;
  search|s)
    [ -z "$2" ] && echo "Usage: vfs-kv.sh search <query>" && exit 1
    curl -s "$SANDBOX/vfs/search?q=$(python3 -c "import urllib.parse;print(urllib.parse.quote('$2'))")" | jq .
    ;;
  full|f)
    [ -z "$2" ] && echo "Usage: vfs-kv.sh full <slot>" && exit 1
    curl -s "$SANDBOX/vfs/full/$2" | jq .
    ;;
  backup|bk)
    DEST="${2:-/private/tmp/vfs-backup-$(date +%Y%m%d-%H%M%S).json}"
    curl -s "$SANDBOX/vfs/backup" > "$DEST"
    echo "Backup saved to $DEST ($(wc -c < "$DEST" | tr -d ' ') bytes)"
    ;;
  restore|rs)
    [ -z "$2" ] && echo "Usage: vfs-kv.sh restore <file>" && exit 1
    curl -s -X POST "$SANDBOX/vfs/restore" -H "Content-Type: application/json" -d @"$2" | jq .
    ;;
  sync)
    # Full sync from VFS (browser) → Sandbox via vfs-exec.sh
    echo "Starting full sync via vfs-exec.sh..."
    VX="/Users/yay/workspace/genspark-agent/scripts/vfs-exec.sh"
    cat > /private/tmp/_sync_slots.js << 'JSEOF'
var slots = ['context','registry','boot-prompt','ref-guide','system-prompt','toolkit','fn'];
var results = []; var i = 0;
function next() {
  if (i >= slots.length) return Promise.resolve(results);
  var name = slots[i++];
  return new Promise(function(r,j){vfs.read(name).then(r).catch(function(){r('')})})
  .then(function(c){return vfsRemote.write(name,c||'',name)})
  .then(function(r){results.push(name+':'+r.size+'b');return next()})
  .catch(function(e){results.push(name+':ERR');return next()});
}
return next().then(function(){return results.join(' | ')});
JSEOF
    bash "$VX" /private/tmp/_sync_slots.js 60000
    echo ""
    echo "Slot sync complete. For messages, run: vfs-kv.sh sync-msgs <slot>"
    ;;
  sync-msgs)
    [ -z "$2" ] && echo "Usage: vfs-kv.sh sync-msgs <slot> [start] [batchSize]" && exit 1
    START="${3:-0}"
    SIZE="${4:-30}"
    VX="/Users/yay/workspace/genspark-agent/scripts/vfs-exec.sh"
    cat > /private/tmp/_sync_msgs.js << JSEOF
var slot='$2',BS=$START,SZ=$SIZE;
return new Promise(function(r,j){vfs.listMsg(slot).then(r).catch(function(){r([])})})
.then(function(msgs){
  var batch=msgs.slice(BS,BS+SZ),mi=0,c=0;
  function nx(){
    if(mi>=batch.length)return Promise.resolve(slot+' ['+BS+'-'+(BS+batch.length)+']: '+c+'/'+batch.length+' (total:'+msgs.length+')');
    var k=batch[mi].key||batch[mi].name;mi++;
    return new Promise(function(r,j){vfs.readMsg(slot,k).then(r).catch(function(){r('')})})
    .then(function(v){var s=typeof v==='string'?v:JSON.stringify(v);return vfsRemote.writeMsg(slot,k,s)})
    .then(function(){c++;return nx()}).catch(function(){return nx()});
  }
  return nx();
});
JSEOF
    bash "$VX" /private/tmp/_sync_msgs.js 45000
    ;;
  delmsg|dm)
    [ -z "$3" ] && echo "Usage: vfs-kv.sh delmsg <slot> <key>" && exit 1
    curl -s -X DELETE "$SANDBOX/vfs/msg/$2/$3" | jq .
    ;;
  delslot|ds)
    [ -z "$2" ] && echo "Usage: vfs-kv.sh delslot <slot>" && exit 1
    curl -s -X DELETE "$SANDBOX/vfs/slot/$2" | jq .
    ;;
  *)
    echo "vfs-kv.sh - Sandbox VFS KV CLI"
    echo ""
    echo "Commands:"
    echo "  health|h              Health check"
    echo "  stats|st              Statistics"
    echo "  ls|l                  List all slots"
    echo "  read|r <slot>         Read slot content"
    echo "  write|w <slot> [file] Write slot (from file or stdin)"
    echo "  msgs|m <slot>         List messages in slot"
    echo "  readmsg|rm <s> <k>    Read message"
    echo "  writemsg|wm <s> <k> [f] Write message"
    echo "  search|s <query>      Full-text search"
    echo "  full|f <slot>         Full slot dump"
    echo "  backup|bk [file]      Backup all data"
    echo "  restore|rs <file>     Restore from backup"
    echo "  sync                  Sync all slots VFS→Sandbox"
    echo "  sync-msgs <slot> [start] [batch] Sync messages"
    echo "  delmsg|dm <s> <k>     Delete message"
    echo "  delslot|ds <slot>     Delete slot"
    ;;
esac