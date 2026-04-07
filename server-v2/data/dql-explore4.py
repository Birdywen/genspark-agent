import subprocess,json,os,urllib.parse
TOKEN='0a1ccea6c5a3a8845558aebd8204c454'

def dql(query,size=5):
    url=f'https://kg.diffbot.com/kg/v3/dql?token={TOKEN}&size={size}&query={urllib.parse.quote(query)}'
    r=subprocess.run(['curl','-s',url],capture_output=True,text=True)
    return json.loads(r.stdout)

def enhance(name,etype='Person',employer=None):
    params=f'token={TOKEN}&type={etype}&name={urllib.parse.quote(name)}'
    if employer: params+=f'&employer={urllib.parse.quote(employer)}'
    url=f'https://kg.diffbot.com/kg/v3/enhance?{params}'
    r=subprocess.run(['curl','-s',url],capture_output=True,text=True)
    return json.loads(r.stdout)

# Q1: Key people via Enhance
print('=== Anthropic Key People (Enhance API) ===')
for name in ['Dario Amodei','Daniela Amodei','Chris Olah','Tom Brown','Jared Kaplan','Jan Leike']:
    d=enhance(name,'Person','Anthropic')
    entities=d.get('data',[])
    if entities:
        e=entities[0].get('entity',{})
        emps=e.get('employments',[])
        cur=[x for x in emps if x.get('isCurrent')]
        title=cur[0].get('title','?') if cur else '?'
        edus=[x.get('institution',{}).get('name','') for x in e.get('educations',[])][:2]
        prevs=[x.get('employer',{}).get('name','') for x in emps if not x.get('isCurrent')][:4]
        skills=e.get('skills',[])
        skill_names=[s.get('name','') for s in skills][:5] if isinstance(skills,list) else []
        print(f'  {name}: {title}')
        print(f'    Education: {edus}')
        print(f'    Previous: {prevs}')
        print(f'    Skills: {skill_names}')
    else:
        print(f'  {name}: NOT FOUND')
    print()

# Q2: Similar companies expanded
print('=== Similar to Anthropic+OpenAI ===')
d=dql('type:Organization similarTo("Anthropic","OpenAI") nbEmployees>30',15)
print(f'Total: {d.get("resultsCount",0)}')
for i,r in enumerate(d.get('data',[])):
    e=r['entity']
    emps=e.get('nbEmployees','?')
    rev=e.get('revenue',{})
    rev_str=f'${rev.get("value",0)/1e6:.0f}M' if rev else 'N/A'
    print(f'{i+1}. {e.get("name")} | {emps}人 | {rev_str} | {str(e.get("description",""))[:50]}')

# Q3: Latest news
print()
print('=== Latest AI News (Anthropic/Claude) ===')
d=dql('type:Article text:"Anthropic" text:"Claude" sortBy:date',8)
print(f'Total articles: {d.get("resultsCount",0)}')
for i,r in enumerate(d.get('data',[])):
    e=r['entity']
    dt=e.get('date',{}).get('str','?')[:10] if isinstance(e.get('date'),dict) else '?'
    sent=e.get('sentiment',0)
    print(f'{i+1}. [{dt}] {e.get("title","?")[:55]} | {e.get("siteName","?")} | sent={sent:.2f}')

# Q4: Anthropic recent funding/investment news
print()
print('=== Anthropic Investment Articles ===')
d=dql('type:Article text:"Anthropic" text:or("funding","valuation","investment","Series") sortBy:date',5)
for i,r in enumerate(d.get('data',[])):
    e=r['entity']
    dt=e.get('date',{}).get('str','?')[:10] if isinstance(e.get('date'),dict) else '?'
    print(f'{i+1}. [{dt}] {e.get("title","?")[:65]} | {e.get("siteName","?")}')

# Q5: Who left Google for AI startups?
print()
print('=== Ex-Google now at AI startups ===')
d=dql('type:Person employments.{employer.name:or("Anthropic","OpenAI","Mistral AI","Cohere") isCurrent:true} employments.{employer.name:"Google" isCurrent:false} sortBy:importance',8)
print(f'Total: {d.get("resultsCount",0)}')
for i,r in enumerate(d.get('data',[])):
    e=r['entity']
    cur=[x for x in e.get('employments',[]) if x.get('isCurrent')]
    title=cur[0].get('title','?') if cur else '?'
    company=cur[0].get('employer',{}).get('name','?') if cur else '?'
    print(f'{i+1}. {e.get("name")} | now: {company} ({title})')
