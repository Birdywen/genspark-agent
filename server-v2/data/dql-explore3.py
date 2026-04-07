import subprocess,json,os,urllib.parse
TOKEN='0a1ccea6c5a3a8845558aebd8204c454'
BASE='https://kg.diffbot.com/kg/v3/dql'

def dql(query,size=5):
    url=f'{BASE}?token={TOKEN}&size={size}&query={urllib.parse.quote(query)}'
    r=subprocess.run(['curl','-s',url],capture_output=True,text=True)
    return json.loads(r.stdout)

# Q1: Anthropic精华信息
print('=== Q1: Anthropic Profile ===')
d=dql('type:Organization strict:name:"Anthropic"',1)
e=d['data'][0]['entity']
print(f"Name: {e.get('name')}")
print(f"Full: {e.get('fullName')}")
print(f"Desc: {str(e.get('description',''))[:200]}")
print(f"Employees: {e.get('nbEmployees')} (range {e.get('nbEmployeesMin')}-{e.get('nbEmployeesMax')})")
rev=e.get('revenue',{})
print(f"Revenue: ${rev.get('value',0)/1e6:.0f}M {rev.get('currency','')}")
print(f"Public: {e.get('isPublic')} | Acquired: {e.get('isAcquired')}")
print(f"CEO: {e.get('ceo',{}).get('name','')}")
print(f"Founded: {e.get('foundingDate',{}).get('str','?') if isinstance(e.get('foundingDate'),dict) else e.get('foundingDate','?')}")
print(f"Homepage: {e.get('homepageUri','')}")
print(f"Importance: {e.get('importance')} | Origins: {e.get('nbOrigins')} | InEdges: {e.get('nbIncomingEdges')}")
board=[m.get('name','') for m in e.get('boardMembers',[])]
print(f"Board: {board[:8]}")
comps=[c.get('name','') for c in e.get('competitors',[])]
print(f"Competitors: {comps[:8]}")
cats=[c.get('name','') for c in e.get('categories',[])]
print(f"Categories: {cats[:6]}")
inds=e.get('industries',[])
print(f"Industries: {inds[:6]}")
investors=set()
for inv in e.get('investments',[]):
    for investor in inv.get('investors',[]):
        investors.add(investor.get('name',''))
print(f"Investors: {sorted(investors)[:10]}")
locs=e.get('locations',[])
for l in locs[:3]:
    city=l.get('city',{}).get('name','') if isinstance(l.get('city'),dict) else ''
    country=l.get('country',{}).get('name','') if isinstance(l.get('country'),dict) else ''
    cur=l.get('isCurrent','')
    print(f"  Location: {city}, {country} (current={cur})")

# Q2: Anthropic team
print()
print('=== Q2: Anthropic Key People ===')
d=dql('type:Person employments.{strict:employer.name:"Anthropic" isCurrent:true} sortBy:importance',10)
print(f'Total in KG: {d.get("resultsCount",0)}')
for i,r in enumerate(d.get('data',[])):
    e=r['entity']
    emps=[x for x in e.get('employments',[]) if 'Anthropic' in str(x.get('employer',{}).get('name',''))]
    title=emps[0].get('title','?') if emps else '?'
    edus=[x.get('institution',{}).get('name','') for x in e.get('educations',[])][:2]
    prevs=[x.get('employer',{}).get('name','') for x in e.get('employments',[]) if not x.get('isCurrent') and 'Anthropic' not in str(x.get('employer',{}).get('name',''))][:3]
    print(f'{i+1}. {e.get("name")} | {title} | edu:{edus} | prev:{prevs}')

# Q3: Similar companies
print()
print('=== Q3: Similar to Anthropic+OpenAI (top 15) ===')
d=dql('type:Organization similarTo("Anthropic","OpenAI") nbEmployees>30',15)
print(f'Total: {d.get("resultsCount",0)}')
for i,r in enumerate(d.get('data',[])):
    e=r['entity']
    print(f'{i+1}. {e.get("name")} | {e.get("nbEmployees","?")}人 | {str(e.get("description",""))[:60]}')

# Q4: Latest news
print()
print('=== Q4: Latest Anthropic+Claude News ===')
d=dql('type:Article text:"Anthropic" text:"Claude" sortBy:date',8)
print(f'Total: {d.get("resultsCount",0)}')
for i,r in enumerate(d.get('data',[])):
    e=r['entity']
    dt=e.get('date',{}).get('str','?') if isinstance(e.get('date'),dict) else '?'
    print(f'{i+1}. [{dt[:10]}] {e.get("title","?")[:60]} | {e.get("siteName","?")} | sent={e.get("sentiment",0):.2f}')
