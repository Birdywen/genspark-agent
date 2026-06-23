import json,statistics,fitz
from PIL import Image,ImageDraw
base='/Users/yay/workspace/newzik-toolkit/pieces/Dotzauer_-_exercises_for_violoncello_boo/'
ocr=json.load(open(base+'ocr.json'))[0]
geo=json.load(open(base+'geometry.json'))
m3=json.load(open('/tmp/mapped3.json'))
m4=json.load(open('/tmp/mapped4.json'))
rf=set([1,7,14,21,28,35,42,49,56,63,70,77,84])
# 合并: 行首小节取m4, 其余取m3. 用(measure,顺序)对齐
from collections import defaultdict
m3by=defaultdict(list); m4by=defaultdict(list)
for o in m3: m3by[o['measure']].append(o)
for o in m4: m4by[o['measure']].append(o)
merged=[]
for M in sorted(m3by):
    src=m4by[M] if M in rf else m3by[M]
    merged.extend(src)
json.dump(merged,open('/tmp/mappedF.json','w'))
mbox={m['number']:m for m in ocr['measures']}
my={m['number']:(m['y1']+m['y3'])/2 for m in ocr['measures']}
DI={'C':0,'D':1,'E':2,'F':3,'G':4,'A':5,'B':6}
def dia(s,o): return o*7+DI[s]
def ygeo(pg,M,st,oc):
    s=min([x for x in geo['systems'] if x['page']==pg],key=lambda x:abs((x['y1']+x['y3'])/2-my[M]))
    ymid=(s['y1']+s['y3'])/2; sp=(s['y3']-s['y1'])/8.0
    return ymid+sp*(22-dia(st,oc))
doc=fitz.open(base+'score.pdf'); R={}
for pi,p in enumerate(doc):
    z=1019.0/p.rect.width; px=p.get_pixmap(matrix=fitz.Matrix(z,z)); px.save('/tmp/j%d.png'%pi); R[pi]=Image.open('/tmp/j%d.png'%pi).convert('RGB')
D={pi:ImageDraw.Draw(im) for pi,im in R.items()}
def dot(pi,x,y,col,r=5): D[pi].ellipse([x-r,y-r,x+r,y+r],outline=col,width=2)
for c in ocr['chords']: dot(c['page'],(c['x1']+c['x3'])/2,(c['y1']+c['y3'])/2,(0,170,0))
rc=0
for o in merged:
    if o['source']!='reversed': continue
    dot(o['page'],o['nx'],ygeo(o['page'],o['measure'],o['step'],o['octave']),(220,0,0),6); rc+=1
for pi,im in R.items(): im.save('/tmp/BEST_p%d.png'%pi)
print('green=%d red=%d -> /tmp/BEST_p0.png /tmp/BEST_p1.png'%(len(ocr['chords']),rc))
meas=[o for o in merged if o['source']=='measured']; errs=[]
for o in meas:
    yy=ygeo(o['page'],o['measure'],o['step'],o['octave'])
    cand=[(c['x1']+c['x3'])/2 for c in ocr['chords'] if c['page']==o['page'] and abs((c['x1']+c['x3'])/2-o['nx'])<40 and abs((c['y1']+c['y3'])/2-yy)<25]
    if cand: errs.append(min(abs(c-o['nx']) for c in cand))
print('合并版 measured x残差: 中位=%.1f 均=%.1f max=%.1f n=%d'%(statistics.median(errs),sum(errs)/len(errs),max(errs),len(errs)))
