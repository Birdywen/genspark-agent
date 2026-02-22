#!/bin/bash
# viasocket Flow Management Skill v1.2
# Fixed: publish (empty body), list_flows (data.flows), delete (status=0)

TOKEN_FILE="/private/tmp/viasocket_token.txt"
BASE="https://flow-api.viasocket.com"
EXEC="https://flow.sokt.io"
ORG_ID="54490"
PROJECT="proj54490"

get_token() {
  if [ ! -f "$TOKEN_FILE" ]; then
    echo "ERROR: Token file not found at $TOKEN_FILE"
    exit 1
  fi
  cat "$TOKEN_FILE" | tr -d '\n'
}

gen_step_id() {
  echo "func$(cat /dev/urandom | LC_ALL=C tr -dc 'a-zA-Z0-9' | head -c 8)"
}

TOKEN=$(get_token)
CMD="$1"
shift

case "$CMD" in

search_plugin|vs_search_plugin)
  QUERY="$1"
  if [ -z "$QUERY" ]; then echo "Usage: vs.sh search_plugin <keyword>"; exit 1; fi
  curl -s -H "Accept: application/json" -H "proxy_auth_token: $TOKEN" \
    "$BASE/dbdash/getplugin?query=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$QUERY'))")&fields%5B%5D=name&fields%5B%5D=rowid&fields%5B%5D=domain&fields%5B%5D=description&fields%5B%5D=iconurl" | python3 -c "
import sys,json
data = json.load(sys.stdin)
d = data.get('data',{}).get('data',{}) if isinstance(data,dict) else data
rows = d.get('rows',[]) if isinstance(d,dict) else d
if isinstance(rows, list):
    for p in rows[:20]:
        print(f\"{p.get('name','?')} | pluginId: {p.get('rowid','?')} | {p.get('domain','')}\")
        desc = p.get('description','')[:100]
        if desc: print(f'  {desc}')
else:
    print(json.dumps(data, indent=2)[:500])
"
  ;;

list_actions|vs_list_actions)
  PLUGIN_ID="$1"
  if [ -z "$PLUGIN_ID" ]; then echo "Usage: vs.sh list_actions <pluginId>"; exit 1; fi
  curl -s -H "Accept: application/json" -H "proxy_auth_token: $TOKEN" \
    "$BASE/dbdash/getpluginbyplugid/action?pluginrecordid=$PLUGIN_ID&type=action&status=published" | python3 -c "
import sys,json
data = json.load(sys.stdin)
d = data.get('data',{}).get('data',{}) if isinstance(data,dict) else data
rows = d.get('rows',[]) if isinstance(d,dict) else d
if isinstance(rows, list):
    print(f'Total actions: {len(rows)}')
    for r in rows:
        print(f\"{r.get('name','?')} | actionId: {r.get('rowid','?')} | key: {r.get('key','?')}\")
        desc = r.get('description','')[:120]
        if desc: print(f'  {desc}')
else:
    print(json.dumps(data, indent=2)[:500])
"
  ;;

get_action_detail|vs_get_action_detail)
  ACTION_ID="$1"
  if [ -z "$ACTION_ID" ]; then echo "Usage: vs.sh get_action_detail <actionId>"; exit 1; fi
  curl -s -H "Accept: application/json" -H "proxy_auth_token: $TOKEN" \
    "$BASE/dbdash/getpluginbyplugid/action?rowid=$ACTION_ID" | python3 -c "
import sys,json
data = json.load(sys.stdin)
d = data.get('data',{}).get('data',{}) if isinstance(data,dict) else data
rows = d.get('rows',[]) if isinstance(d,dict) else d
if isinstance(rows, list) and len(rows) > 0:
    r = rows[0]
    print(f\"Name: {r.get('name','?')}\")
    print(f\"Key: {r.get('key','?')}\")
    print(f\"actionId: {r.get('rowid','?')}\")
    print(f\"pluginId: {r.get('pluginrecordid','?')}\")
    print(f\"authType: {r.get('authtype','?')}\")
    print(f\"Description: {r.get('description','')[:200]}\")
    code = r.get('code','')
    if code:
        print(f'Code template ({len(code)} chars):')
        print(code[:2000])
    inputfields = r.get('inputfields','')
    if inputfields:
        print(f'Input fields: {str(inputfields)[:500]}')
else:
    print(json.dumps(data, indent=2)[:1000])
"
  ;;

create_flow|vs_create_flow)
  TITLE="$1"
  if [ -z "$TITLE" ]; then echo "Usage: vs.sh create_flow <title>"; exit 1; fi
  curl -s -X POST \
    -H "Accept: application/json" -H "Content-Type: application/json" \
    -H "proxy_auth_token: $TOKEN" \
    "$BASE/projects/$PROJECT/scripts" \
    -d "{\"title\":\"$TITLE\",\"type\":\"flow\"}" | python3 -c "
import sys,json
data = json.load(sys.stdin)
if data.get('success'):
    d = data.get('data',{})
    print(f\"SUCCESS: Flow created\")
    print(f\"scriptId: {d.get('id','?')}\")
    print(f\"title: {d.get('title','?')}\")
    print(f\"webhook: https://flow.sokt.io/func/{d.get('id','?')}\")
else:
    print(f\"ERROR: {data.get('message','unknown')}\")
"
  ;;

add_step|vs_add_step)
  SCRIPT_ID="$1"; STEP_TYPE="$2"; STEP_TITLE="$3"
  ACTION_ID="$4"; ICON_URL="$5"; POSITION="${6:-0}"
  if [ -z "$SCRIPT_ID" ] || [ -z "$STEP_TYPE" ] || [ -z "$STEP_TITLE" ]; then
    echo "Usage: vs.sh add_step <scriptId> <type> <title> [actionId] [iconUrl] [position]"
    echo "Types: function, plugin, ifBlock, api, variable, delay, break"
    exit 1
  fi
  STEP_ID=$(gen_step_id)
  if [ "$STEP_TYPE" = "plugin" ] && [ -n "$ACTION_ID" ]; then
    BODY="{\"type\":\"plugin\",\"title\":\"$STEP_TITLE\",\"orderGroup\":\"root\",\"position\":$POSITION,\"stepId\":\"$STEP_ID\",\"actionId\":\"$ACTION_ID\",\"iconUrl\":\"${ICON_URL:-}\",\"configurationJson\":\"\",\"configurationJsonEncrypted\":\"\"}"
  else
    BODY="{\"type\":\"$STEP_TYPE\",\"title\":\"$STEP_TITLE\",\"orderGroup\":\"root\",\"position\":$POSITION,\"stepId\":\"$STEP_ID\"}"
  fi
  curl -s -X POST \
    -H "Accept: application/json" -H "Content-Type: application/json" \
    -H "proxy_auth_token: $TOKEN" \
    "$BASE/scripts/$PROJECT/$SCRIPT_ID/stepv2" \
    -d "$BODY" | python3 -c "
import sys,json
data = json.load(sys.stdin)
if data.get('success'):
    js = data.get('script',{}).get('json_script',{})
    print('SUCCESS: Step created')
    print(f'stepId: $STEP_ID')
    print(f'title: $STEP_TITLE')
    print(f'type: $STEP_TYPE')
    print(f\"order: {js.get('order',{})}\")
else:
    print(f\"ERROR: {data.get('message','unknown')}\")
"
  ;;

update_step|vs_update_step)
  SCRIPT_ID="$1"; STEP_TITLE="$2"; STEP_TYPE="$3"; CODE_INPUT="$4"
  if [ -z "$SCRIPT_ID" ] || [ -z "$STEP_TITLE" ] || [ -z "$STEP_TYPE" ] || [ -z "$CODE_INPUT" ]; then
    echo "Usage: vs.sh update_step <scriptId> <stepTitle> <type> <code_or_file>"
    exit 1
  fi
  STEP_ID=$(curl -s -H "Accept: application/json" -H "proxy_auth_token: $TOKEN" \
    "$BASE/projects/$PROJECT/scripts/$SCRIPT_ID?type=flow" | python3 -c "
import sys,json
d = json.load(sys.stdin).get('data',{})
b = d.get('json_script',{}).get('blocks',{}).get('$STEP_TITLE',{})
print(b.get('identifier',''))
" 2>/dev/null)
  if [ -z "$STEP_ID" ]; then echo "ERROR: Step '$STEP_TITLE' not found"; exit 1; fi

  if [ -f "$CODE_INPUT" ]; then
    CODE_SRC="$CODE_INPUT"
    IS_FILE=1
  else
    CODE_SRC="$CODE_INPUT"
    IS_FILE=0
  fi

  python3 << PYEOF
import json
code_input = '''$CODE_INPUT'''
is_file = $IS_FILE
if is_file:
    with open(code_input) as f:
        code = f.read()
else:
    code = code_input

step_type = '$STEP_TYPE'
if step_type == 'function':
    body = {
        'type': 'function',
        'code': code,
        'title': '$STEP_TITLE',
        'org_id': '$ORG_ID',
        'project_id': '$PROJECT',
        'calculateDetailedVariables': False,
        'auth_id': None,
        'action_id': None,
        'stepId': '$STEP_ID',
        'dynamicVariables': {}
    }
elif step_type == 'plugin':
    body = {
        'type': 'plugin',
        'code': {'type': 'action', 'source': code},
        'title': '$STEP_TITLE',
        'org_id': '$ORG_ID',
        'project_id': '$PROJECT',
        'calculateDetailedVariables': False,
        'auth_id': None,
        'action_id': None,
        'stepId': '$STEP_ID',
        'dynamicVariables': {}
    }
else:
    body = {'type': step_type, 'title': '$STEP_TITLE', 'stepId': '$STEP_ID'}

with open('/tmp/vs_update_body.json', 'w') as f:
    json.dump(body, f)
PYEOF

  curl -s -X PUT \
    -H "Accept: application/json" -H "Content-Type: application/json" \
    -H "proxy_auth_token: $TOKEN" \
    "$BASE/scripts/$SCRIPT_ID/stepv2/$STEP_TITLE" \
    -d @/tmp/vs_update_body.json | python3 -c "
import sys,json
data = json.load(sys.stdin)
if data.get('success') or data.get('function'):
    print('SUCCESS: Step updated')
    f = data.get('function',{})
    if f: print(f\"code length: {len(f.get('code',''))}\")
else:
    print(f\"ERROR: {data.get('message','unknown')}\")
"
  ;;

publish|vs_publish)
  SCRIPT_ID="$1"
  if [ -z "$SCRIPT_ID" ]; then echo "Usage: vs.sh publish <scriptId>"; exit 1; fi
  curl -s -X PUT \
    -H "Accept: application/json" -H "Content-Type: application/json" \
    -H "proxy_auth_token: $TOKEN" \
    -d '{}' \
    "$BASE/projects/$PROJECT/scripts/$SCRIPT_ID/publish" | python3 -c "
import sys,json
data = json.load(sys.stdin)
if data.get('success'):
    print('SUCCESS: Flow published')
    print(f\"webhook: https://flow.sokt.io/func/{data.get('data',{}).get('id','$SCRIPT_ID')}\")
else:
    print(f\"ERROR: {data.get('message','unknown')}\")
"
  ;;

run|vs_run)
  SCRIPT_ID="$1"; PAYLOAD="${2:-\{\}}"
  if [ -z "$SCRIPT_ID" ]; then echo "Usage: vs.sh run <scriptId> [payload]"; exit 1; fi
  curl -s -X POST \
    -H "Accept: application/json" -H "Content-Type: application/json" \
    -H "proxy_auth_token: $TOKEN" \
    "$EXEC/func/$SCRIPT_ID" -d "$PAYLOAD" | python3 -m json.tool 2>/dev/null
  ;;

dryrun|vs_dryrun)
  SCRIPT_ID="$1"; PAYLOAD="${2:-\{\}}"
  if [ -z "$SCRIPT_ID" ]; then echo "Usage: vs.sh dryrun <scriptId> [payload]"; exit 1; fi
  curl -s -X POST \
    -H "Accept: application/json" -H "Content-Type: application/json" \
    -H "proxy_auth_token: $TOKEN" \
    "$EXEC/func/$SCRIPT_ID/test" -d "$PAYLOAD" | python3 -m json.tool 2>/dev/null
  ;;

get_flow|vs_get_flow)
  SCRIPT_ID="$1"
  if [ -z "$SCRIPT_ID" ]; then echo "Usage: vs.sh get_flow <scriptId>"; exit 1; fi
  curl -s -H "Accept: application/json" -H "proxy_auth_token: $TOKEN" \
    "$BASE/projects/$PROJECT/scripts/$SCRIPT_ID?type=flow" | python3 -c "
import sys,json
data = json.load(sys.stdin)
d = data.get('data', data)
print(f\"Title: {d.get('title','?')}\")
print(f\"Status: {d.get('status','?')} (1=active, 3=draft)\")
print(f\"Script ID: {d.get('id','?')}\")
print(f\"Webhook: https://flow.sokt.io/func/{d.get('id','?')}\")
js = d.get('json_script',{})
print(f\"Version: {js.get('version','?')}\")
print(f\"Order: {json.dumps(js.get('order',{}))}\")
blocks = js.get('blocks',{})
print(f'Steps ({len(blocks)}):')
for name, block in blocks.items():
    print(f'  {name} | type: {block.get(\"type\",\"?\")} | status: {block.get(\"status\",\"?\")} | id: {block.get(\"identifier\",\"?\")}')
"
  ;;

list_flows|vs_list_flows)
  curl -s -H "Accept: application/json" -H "proxy_auth_token: $TOKEN" \
    "$BASE/orgs/$ORG_ID/projects?type=flow&bringflows=true" | python3 -c "
import sys,json
data = json.load(sys.stdin)
d = data.get('data',{})
flows = d.get('flows',[])
projects = d.get('projects',[])
smap = {'1':'active','3':'draft','0':'deleted'}
if projects:
    for p in projects:
        print(f\"Project: {p.get('title','?')} ({p.get('id','?')})\")
if flows:
    print(f'Flows ({len(flows)}):')
    for f in flows:
        s = str(f.get('status','?'))
        print(f\"  {f.get('title','(untitled)')} | {f.get('id','?')} | {smap.get(s,s)} | {str(f.get('updatedAt','?'))[:19]}\")
else:
    print('No flows found')
"
  ;;

delete_step|vs_delete_step)
  SCRIPT_ID="$1"; STEP_TITLE="$2"
  if [ -z "$SCRIPT_ID" ] || [ -z "$STEP_TITLE" ]; then
    echo "Usage: vs.sh delete_step <scriptId> <stepTitle>"; exit 1
  fi
  curl -s -X DELETE \
    -H "Accept: application/json" -H "proxy_auth_token: $TOKEN" \
    "$BASE/scripts/$SCRIPT_ID/stepv2/$STEP_TITLE" | python3 -c "
import sys,json
data = json.load(sys.stdin)
if data.get('success'): print('SUCCESS: Step deleted')
else: print(f\"ERROR: {data.get('message','unknown')}\")
"
  ;;

delete_flow|vs_delete_flow)
  SCRIPT_ID="$1"
  if [ -z "$SCRIPT_ID" ]; then echo "Usage: vs.sh delete_flow <scriptId>"; exit 1; fi
  # Step 1: Pause first (status=3), required before delete
  curl -s -X PUT \
    -H "Accept: application/json" -H "Content-Type: application/json" \
    -H "proxy_auth_token: $TOKEN" \
    -d '{"status":"3"}' \
    "$BASE/projects/$PROJECT/scripts/$SCRIPT_ID/status" > /dev/null 2>&1
  sleep 1
  # Step 2: Delete (status=0)
  curl -s -X PUT \
    -H "Accept: application/json" -H "Content-Type: application/json" \
    -H "proxy_auth_token: $TOKEN" \
    -d '{"status":"0"}' \
    "$BASE/projects/$PROJECT/scripts/$SCRIPT_ID/status" | python3 -c "
import sys,json
data = json.load(sys.stdin)
if data.get('success'): print('SUCCESS: Flow deleted (pause -> delete)')
else: print(f\"ERROR: {data.get('message','unknown')}\")
"
  ;;

logs|vs_logs)
  SCRIPT_ID="$1"; LIMIT="${2:-10}"
  if [ -z "$SCRIPT_ID" ]; then echo "Usage: vs.sh logs <scriptId> [limit]"; exit 1; fi
  curl -s -H "Accept: application/json" -H "proxy_auth_token: $TOKEN" \
    "$BASE/logs/projectid/$PROJECT/scriptid/$SCRIPT_ID?page=1&limit=$LIMIT" | python3 -c "
import sys,json
data = json.load(sys.stdin)
fr = data.get('data',{}).get('finalResponse',{}) if isinstance(data,dict) else {}
for sid, logs in fr.items():
    if isinstance(logs, list):
        print(f'Logs for {sid}: {len(logs)} entries')
        for l in logs:
            ts = l.get('requestTimestamp','?')[:19]
            dry = 'DRY-RUN' if l.get('isDryRun') else 'LIVE'
            err = l.get('errorMessage','')[:100]
            time_ms = l.get('flowMetadata',{}).get('time','?')
            print(f'  [{ts}] {dry} | {time_ms}ms | {err}')
if not fr:
    print(json.dumps(data, indent=2)[:500])
"
  ;;

check_auth|vs_check_auth)
  curl -s -H "Accept: application/json" -H "proxy_auth_token: $TOKEN" \
    "$BASE/authtoken/org/$ORG_ID/auth" | python3 -c "
import sys,json
data = json.load(sys.stdin)
auths = data if isinstance(data, list) else data.get('data', [])
if isinstance(auths, dict):
    for k,v in auths.items():
        if isinstance(v, list): auths = v; break
if isinstance(auths, list):
    print(f'Authorized services: {len(auths)}')
    for a in auths:
        print(f\"  {a.get('service_name',a.get('name','?'))} | authId: {a.get('id','?')} | pluginId: {a.get('service_id','?')}\")
else:
    print(json.dumps(data, indent=2)[:500])
"
  ;;


duplicate_flow|vs_duplicate_flow)
  SCRIPT_ID="$1"
  if [ -z "$SCRIPT_ID" ]; then echo "Usage: vs.sh duplicate_flow scriptId"; exit 1; fi
  curl -s -X POST \
    -H "Accept: application/json" -H "Content-Type: application/json" \
    -H "proxy_auth_token: $TOKEN" \
    -d '{}' \
    "$BASE/projects/$PROJECT/scripts/$SCRIPT_ID/duplicate" | python3 -c "
import sys,json
data = json.load(sys.stdin)
if data.get('success'):
    d = data.get('data',{})
    print('SUCCESS: Duplicated to ' + str(d.get('id','?')))
    print('  Title: ' + str(d.get('title','?')))
    js = d.get('json_script',{})
    print('  Steps: ' + str(js.get('order',{}).get('root',[])))
else:
    print('ERROR: ' + str(data.get('message','unknown')))
"
  ;;


revert_flow|vs_revert_flow)
  SCRIPT_ID="$1"
  if [ -z "$SCRIPT_ID" ]; then echo "Usage: vs.sh revert_flow scriptId"; exit 1; fi
  curl -s -X PUT \
    -H "Accept: application/json" -H "Content-Type: application/json" \
    -H "proxy_auth_token: $TOKEN" \
    -d '{}' \
    "$BASE/projects/$PROJECT/scripts/$SCRIPT_ID/revert" | python3 -c "
import sys,json
data = json.load(sys.stdin)
if data.get('success'):
    print('SUCCESS: Flow published version')
    js = data.get('data',{}).get('json_script',{})
    print('  Version: ' + str(js.get('version','?')) + ' | Steps: ' + str(js.get('order',{}).get('root',[])))
else:
    print('ERROR: ' + str(data.get('message','unknown')))
"
  ;;

get_functions|vs_get_functions)
  SCRIPT_ID="$1"
  if [ -z "$SCRIPT_ID" ]; then echo "Usage: vs.sh get_functions scriptId"; exit 1; fi
  curl -s -H "Accept: application/json" -H "proxy_auth_token: $TOKEN" \
    "$BASE/scripts/$SCRIPT_ID/functions/" | python3 -c "
import sys,json
data = json.load(sys.stdin)
funcs = data.get('data',[])
if isinstance(funcs, list):
    print('Functions:', len(funcs))
    for f in funcs:
        code = f.get('code','')
        lines = len(code.split(chr(10))) if code else 0
        print('  ' + str(f.get('id','?')) + ' | ' + str(f.get('title','?')) + ' | type=' + str(f.get('type','?')) + ' | ' + str(lines) + ' lines')
else:
    print(json.dumps(data, indent=2)[:500])
"
  ;;

get_function|vs_get_function)
  SCRIPT_ID="$1"; FUNC_ID="$2"
  if [ -z "$SCRIPT_ID" ] || [ -z "$FUNC_ID" ]; then echo "Usage: vs.sh get_function scriptId functionId"; exit 1; fi
  curl -s -H "Accept: application/json" -H "proxy_auth_token: $TOKEN" \
    "$BASE/scripts/$SCRIPT_ID/functions/$FUNC_ID" | python3 -c "
import sys,json
data = json.load(sys.stdin)
if data.get('success'):
    funcs = data.get('data',[])
    if isinstance(funcs, list) and funcs:
        f = funcs[0]
        print('ID:', f.get('id','?'), '| Title:', f.get('title','?'), '| Type:', f.get('type','?'))
        code = f.get('code','')
        if code:
            print('--- Code ---')
            print(code[:3000])
    else:
        print('Function not found')
else:
    print('ERROR:', data.get('message','unknown'))
"
  ;;

help|--help|-h|"")
  echo "viasocket Flow Management v1.2"
  echo ""
  echo "Usage: vs.sh <command> [args...]"
  echo ""
  echo "Discovery:"
  echo "  search_plugin <keyword>      Search plugins"
  echo "  list_actions <pluginId>      List plugin actions"
  echo "  get_action_detail <actionId> Get action detail + code template"
  echo "  check_auth                   List authorized services"
  echo ""
  echo "Flow Management:"
  echo "  create_flow <title>          Create new flow"
  echo "  get_flow <scriptId>          Get flow details"
  echo "  list_flows                   List all flows"
  echo "  publish <scriptId>           Publish flow"
  echo "  delete_flow <scriptId>       Delete flow (pause then delete)"
  echo "  duplicate_flow <scriptId>   Duplicate (copy) a flow"
  echo "  revert_flow <scriptId>      Revert to last published version"
  echo ""
  echo "Step Management:"
  echo "  add_step <scriptId> <type> <title> [actionId] [iconUrl] [position]"
  echo "  update_step <scriptId> <stepTitle> <type> <code_or_file>"
  echo "  delete_step <scriptId> <stepTitle>"
  echo ""
  echo "Inspection:"
  echo "  get_functions <scriptId>           List all functions with code line count"
  echo "  get_function <scriptId> <funcId>   Get function code"
  echo ""
  echo "Execution:"
  echo "  run <scriptId> [payload]     Run flow"
  echo "  dryrun <scriptId> [payload]  Dry run flow"
  echo "  logs <scriptId> [limit]      View execution logs"
  echo ""
  echo "Step types: function, plugin, ifBlock, api, variable, delay, break"
  ;;

*) echo "Unknown command: $CMD. Run 'vs.sh help'"; exit 1 ;;

esac
