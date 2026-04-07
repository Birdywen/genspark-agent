import subprocess,json,sys,os
TOKEN=os.environ.get('DIFFBOT_TOKEN','0a1ccea6c5a3a8845558aebd8204c454')
BASE='https://kg.diffbot.com/kg/v3/dql'

def dql(query,size=5):
    import urllib.parse
    url=f'{BASE}?token={TOKEN}&size={size}&query={urllib.parse.quote(query)}'
    r=subprocess.run(['curl','-s',url],capture_output=True,text=True)
    return json.loads(r.stdout)

print('='*60)
print('Q1: Top AI Companies by importance (with revenue)')
print('='*60)
d=dql('type:Organization industries:"Artificial Intelligence Companies" nbEmployees>200 has:revenue sortBy:importance',10)
print(f'Total hits: {d.get("resultsCount",0)}')
for i,r in enumerate(d.get('data',[])):
    e=r['entity']
    rev=e.get('revenue',{})
    val=rev.get('value',0)
    print(f'{i+1}. {e.get("name")} | {e.get("nbEmployees")}人 | ${val/1e6:.0f}M | imp={e.get("importance",0):.3f} | {e.get("homepageUri","?")[:40]}')

print()
print('='*60)
print('Q2: Anthropic current employees')
print('='*60)
d=dql('type:Person employments.{employer.name:"Anthropic" isCurrent:true} sortBy:importance',8)
print(f'Total hits: {d.get("resultsCount",0)}')
for i,r in enumerate(d.get('data',[])):
    e=r['entity']
    emps=[x for x in e.get('employments',[]) if 'Anthropic' in x.get('employer',{}).get('name','')]
    title=emps[0].get('title','?') if emps else '?'
    edus=[x.get('institution',{}).get('name','?') for x in e.get('educations',[])][:2]
    prevs=[x.get('employer',{}).get('name','?') for x in e.get('employments',[]) if not x.get('isCurrent') and 'Anthropic' not in x.get('employer',{}).get('name','')][:3]
    print(f'{i+1}. {e.get("name")} | {title} | edu:{edus} | prev:{prevs}')

print()
print('='*60)
print('Q3: Companies similar to Anthropic+OpenAI')
print('='*60)
d=dql('type:Organization similarTo("Anthropic","OpenAI") nbEmployees>50',8)
print(f'Total hits: {d.get("resultsCount",0)}')
for i,r in enumerate(d.get('data',[])):
    e=r['entity']
    desc=str(e.get('description',''))[:80]
    print(f'{i+1}. {e.get("name")} | {e.get("nbEmployees")}人 | {desc}')

print()
print('='*60)
print('Q4: Latest articles mentioning Anthropic+Claude')
print('='*60)
d=dql('type:Article text:"Anthropic" text:"Claude" sortBy:date',5)
print(f'Total hits: {d.get("resultsCount",0)}')
for i,r in enumerate(d.get('data',[])):
    e=r['entity']
    dt=e.get('date',{}).get('str','?')
    print(f'{i+1}. [{dt}] {e.get("title","?")[:70]} | {e.get("siteName","?")} | sent={e.get("sentiment",0):.2f}')

print()
print('='*60)
print('Q5: Anthropic entity deep dive')
print('='*60)
d=dql('type:Organization strict:name:"Anthropic"',1)
for r in d.get('data',[]):
    e=r['entity']
    for k in ['name','nbEmployees','homepageUri','description','industries','foundingDate','isPublic','importance','nbOrigins','nbIncomingEdges']:
        v=e.get(k)
        if v is not None:
            if isinstance(v,str) and len(v)>120: v=v[:120]+'...'
            print(f'  {k}: {v}')
