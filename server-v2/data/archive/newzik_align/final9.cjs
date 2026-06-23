const {Abc}=require('/Users/yay/workspace/livescore/viewer/abc2svg-1.js');
const fs=require('fs');
const abc=fs.readFileSync('/tmp/gold_rowsplit.abc','utf8');
const gold=JSON.parse(fs.readFileSync('/Users/yay/workspace/livescore/scores/Dotzauer_goldmap.json','utf8'));
const ocr=JSON.parse(fs.readFileSync('/Users/yay/workspace/newzik-toolkit/pieces/Dotzauer_-_exercises_for_violoncello_boo/ocr.json','utf8'))[0];
let tsf=null,MT=null;
const user={img_out:()=>{},errmsg:()=>{},read_file:()=>'',get_abcmodel:(t,v,mt)=>{tsf=t;MT=mt;},anno_start:()=>{},anno_stop:()=>{}};
new Abc(user).tosvg('s',abc);
const NOTE=MT.indexOf('note'),BAR=MT.indexOf('bar');
const items=[]; let s=tsf;
while(s){ if(s.type==NOTE&&s.notes)s.notes.forEach(n=>items.push({t:'n',x:(s.x||0)+(n.shhd||0),midi:n.midi})); else if(s.type==BAR)items.push({t:'b',x:s.x||0}); s=s.ts_next; }
// 先分abc行(x回跳), 再每行内按BAR切小节
const rows=[]; let cur=[],prevx=1e9;
for(const it of items){ if(it.x<prevx-5){ if(cur.length)rows.push(cur); cur=[]; } cur.push(it); prevx=it.x; }
if(cur.length)rows.push(cur);
// 每行: 行内BAR切段. 行首段左界=行内首音x - 平均音距的一半(估留白)
const segs=[];
for(const row of rows){
  const notes=row.filter(o=>o.t==='n');
  const bars=row.filter(o=>o.t==='b').map(o=>o.x);
  // 行首左界: 首音 - (首音到第一个BAR内音距估计). 用首两音间距
  const firstNoteX=notes[0].x;
  const sndX=notes.length>1?notes[1].x:firstNoteX+18;
  const lead=firstNoteX-(sndX-firstNoteX)*0.7; // 行首小节左界
  let segL=lead, bi=0, curN=[];
  for(const it of row){
    if(it.t==='b'){ segs.push({L:segL,R:it.x,notes:curN}); curN=[]; segL=it.x; }
    else curN.push(it);
  }
  if(curN.length){ const lastX=curN[curN.length-1].x; segs.push({L:segL,R:lastX+(lastX-(curN.length>1?curN[curN.length-2].x:segL)),notes:curN}); }
}
const byM={}; gold.forEach(x=>{(byM[x.measure]=byM[x.measure]||[]).push(x);});
const nums=Object.keys(byM).map(Number).sort((a,b)=>a-b);
const mbox={}; ocr.measures.forEach(m=>mbox[m.number]=m);
console.log('段数=%d 小节数=%d',segs.length,nums.length);
const out=[]; let bad=0;
for(let i=0;i<nums.length&&i<segs.length;i++){
  const M=nums[i],seg=segs[i],mb=mbox[M];
  const gns=byM[M].slice().sort((a,b)=>a.sync-b.sync);
  for(let j=0;j<seg.notes.length&&j<gns.length;j++){
    let t=(seg.notes[j].x-seg.L)/(seg.R-seg.L); if(t<0||t>1)bad++;
    const nx=mb.x1+t*(mb.x3-mb.x1); const g=gns[j];
    out.push({measure:M,step:g.step,octave:g.octave,midi:g.midi,source:g.source,nx:nx,page:mb.page});
  }
}
fs.writeFileSync('/tmp/mapped2.json',JSON.stringify(out));
console.log('映射%d音, t越界=%d',out.length,bad);
console.log('m70:',JSON.stringify(out.filter(o=>o.measure===70).map(o=>o.step+o.octave+':'+Math.round(o.nx))));
console.log('m76:',JSON.stringify(out.filter(o=>o.measure===76).map(o=>o.step+o.octave+':'+Math.round(o.nx))));
