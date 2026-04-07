import subprocess,json,os,urllib.parse
TOKEN='0a1ccea6c5a3a8845558aebd8204c454'
BASE='https://kg.diffbot.com/kg/v3/dql'

def dql(query,size=5):
    url=f'{BASE}?token={TOKEN}&size={size}&query={urllib.parse.quote(query)}'
    r=subprocess.run(['curl','-s',url],capture_output=True,text=True)
    return json.loads(r.stdout)

print('='*60)
print('Q1: Anthropic deep dive (strict match)')
print('='*60)
d=dql('type:Organization strict:name:"Anthropic"',1)
for r in d.get('data',[]):
    e=r['entity']
    for k in sorted(e.keys()):
        v=e.get(k)
        if v is None: continue
        s=str(v)
        if len(s)>200: s=s[:200]+'...'
        print(f'  {k}: {s}')

print()
print('='*60)
print('Q2: Anthropic employees (strict employer match)')
print('='*60)
d=dql('type:Person employments.{strict:employer.name:"Anthropic" isCurrent:true} sortBy:importance',10)
print(f'Total: {d.get("resultsCount",0)}')
for i,r in enumerate(d.get('data',[])):
    e=r['entity']
    emps=[x for x in e.get('employments',[]) if 'Anthropic' in str(x.get('employer',{}).get('name',''))]
    title=emps[0].get('title','?') if emps else '?'
    edus=[x.get('institution',{}).get('name','') for x in e.get('educations',[])][:2]
    prevs=[x.get('employer',{}).get('name','') for x in e.get('employments',[]) if not x.get('isCurrent') and 'Anthropic' not in str(x.get('employer',{}).get('name',''))][:4]
    print(f'{i+1}. {e.get("name")} | {title} | edu:{edus} | prev:{prevs}')

print()
print('='*60)
print('Q3: Companies similar to Anthropic (top 15)')
print('='*60)
d=dql('type:Organization similarTo("Anthropic","OpenAI") nbEmployees>30',15)
print(f'Total: {d.get("resultsCount",0)}')
for i,r in enumerate(d.get('data',[])):
    e=r['entity']
    desc=str(e.get('description',''))[:60]
    city=''
    locs=e.get('locations',[])
    if locs:
        city=locs[0].get('city',{}).get('name','') if isinstance(locs[0],dict) else ''
    print(f'{i+1}. {e.get("name")} | {e.get("nbEmployees","?")}人 | {city} | {desc}')

print()
print('='*60)
print('Q4: Latest Anthropic+Claude news')
print('='*60)
d=dql('type:Article text:"Anthropic" text:"Claude" sortBy:date',8)
print(f'Total: {d.get("resultsCount",0)}')
for i,r in enumerate(d.get('data',[])):
    e=r['entity']
    dt=e.get('date',{}).get('str','?') if isinstance(e.get('date'),dict) else '?'
    print(f'{i+1}. [{dt[:16]}] {e.get("title","?")[:65]} | {e.get("siteName","?")} | sent={e.get("sentiment",0):.2f}')

print()
print('='*60)
print('Q5: AI companies that IPOed or got acquired recently')
print('='*60)
d=dql('type:Organization industries:"Artificial Intelligence Companies" or(isPublic:true, isAcquired:true) nbEmployees>100 sortBy:importance',10)
print(f'Total: {d.get("resultsCount",0)}')
for i,r in enumerate(d.get('data',[])):
    e=r['entity']
    status='Public' if e.get('isPublic') else ('Acquired' if e.get('isAcquired') else '?')
    print(f'{i+1}. {e.get("name")} | {e.get("nbEmployees","?")}人 | {status} | {str(e.get("description",""))[:60]}')
