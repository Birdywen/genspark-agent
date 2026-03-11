#!/bin/bash
# 即插即用技能管理器 v2
# 用法:
#   plug.sh load ffmpeg     — 注入 ffmpeg 技能（自动找最后一条 assistant 消息）
#   plug.sh remove          — 拔出最后注入的技能
#   plug.sh list            — 列出可用技能
#   plug.sh show            — 显示当前注入状态

cd /Users/yay/workspace/genspark-agent
ACTION=$1
SKILL=$2

case "$ACTION" in
  load)
    if [ -z "$SKILL" ]; then
      echo "用法: plug.sh load <技能名>"
      echo "例: plug.sh load ffmpeg"
      exit 1
    fi
    cat > /private/tmp/plug-action.js << JSEOF
var convId = new URLSearchParams(window.location.search).get("id");
return new Promise(function(r,j){
  vfs.readMsg("toolkit","_forged:skill-${SKILL}").then(function(raw){
    return fetch("/api/project/update", {
      method:"POST", headers:{"Content-Type":"application/json"}, credentials:"include",
      body: JSON.stringify({id:convId, request_not_update_permission:true})
    }).then(function(resp){return resp.json()}).then(function(d){
      var ss = d.data.session_state;
      var msgs = ss.messages;
      var targetIdx = -1;
      for(var i=msgs.length-1; i>=0; i--){
        if(msgs[i].role === "assistant"){
          targetIdx = i;
          break;
        }
      }
      if(targetIdx === -1) return r({error:"no assistant message found"});
      msgs[targetIdx].content = raw;
      return fetch("/api/project/update", {
        method:"POST", headers:{"Content-Type":"application/json"}, credentials:"include",
        body: JSON.stringify({id:convId, session_state:ss, request_not_update_permission:true})
      }).then(function(r2){return r2.json()}).then(function(d2){
        r({ok:true, idx:targetIdx, skill:"${SKILL}", len:raw.length, preview:raw.substring(0,80)});
      });
    });
  }).catch(j);
});
JSEOF
    bash scripts/vfs-exec.sh /private/tmp/plug-action.js
    ;;
  remove)
    cat > /private/tmp/unplug-action.js << 'JSEOF'
var convId = new URLSearchParams(window.location.search).get("id");
return fetch("/api/project/update", {
  method:"POST", headers:{"Content-Type":"application/json"}, credentials:"include",
  body: JSON.stringify({id:convId, request_not_update_permission:true})
}).then(function(r){return r.json()}).then(function(d){
  var ss = d.data.session_state;
  var msgs = ss.messages;
  var targetIdx = -1;
  for(var i=msgs.length-1; i>=0; i--){
    if(msgs[i].role === "assistant" && msgs[i].content.indexOf("[Skill Module:") > -1){
      targetIdx = i;
      break;
    }
  }
  if(targetIdx === -1) return {error:"no skill module found"};
  msgs[targetIdx].content = "0";
  return fetch("/api/project/update", {
    method:"POST", headers:{"Content-Type":"application/json"}, credentials:"include",
    body: JSON.stringify({id:convId, session_state:ss, request_not_update_permission:true})
  }).then(function(r2){return r2.json()}).then(function(){
    return {ok:true, idx:targetIdx, cleared:true};
  });
});
JSEOF
    bash scripts/vfs-exec.sh /private/tmp/unplug-action.js
    ;;
  list)
    cat > /private/tmp/list-skills.js << 'JSEOF'
return new Promise(function(r,j){
  vfs.query("toolkit","_forged:skill-").then(function(list){
    var skills = list.results.filter(function(m){return m.key.indexOf("_forged:skill-")===0}).map(function(m){
      return {name: m.key.replace("_forged:skill-",""), size: m.size};
    });
    r(skills);
  }).catch(j);
});
JSEOF
    bash scripts/vfs-exec.sh /private/tmp/list-skills.js
    ;;
  show)
    cat > /private/tmp/show-skill.js << 'JSEOF'
var convId = new URLSearchParams(window.location.search).get("id");
return fetch("/api/project/update", {
  method:"POST", headers:{"Content-Type":"application/json"}, credentials:"include",
  body: JSON.stringify({id:convId, request_not_update_permission:true})
}).then(function(r){return r.json()}).then(function(d){
  var msgs = d.data.session_state.messages;
  var found = [];
  for(var i=0;i<msgs.length;i++){
    if(msgs[i].content && msgs[i].content.indexOf("[Skill Module:") > -1){
      var name = msgs[i].content.match(/\[Skill Module: ([^\]]+)\]/);
      found.push({idx:i, role:msgs[i].role, skill:name?name[1]:"unknown", len:msgs[i].content.length});
    }
  }
  return {total:msgs.length, injected:found};
});
JSEOF
    bash scripts/vfs-exec.sh /private/tmp/show-skill.js
    ;;
  *)
    echo "即插即用技能管理器 v2"
    echo "  plug.sh load <技能名>  — 注入技能（自动替换最后一条AI消息）"
    echo "  plug.sh remove         — 拔出最后注入的技能"
    echo "  plug.sh list           — 列出可用技能"
    echo "  plug.sh show           — 显示当前注入状态"
    ;;
esac
