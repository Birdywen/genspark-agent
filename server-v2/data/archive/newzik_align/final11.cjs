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
const rows=[]; let cur=[],prev=1e9;
for(const it of items){ if(it.x<prev-5){ if(cur.length)rows.push(cur); cur=[]; } cur.push(it); prev=it.x; }
if(cur.length)rows.push(cur);
// 每行切段, 标记first; 段内记录每音的abc_x
const segs=[];
for(const row of rows){
  let segL=null,curN=[],first=true;
  for(const it of row){ if(it.t==='b'){ if(curN.length){segs.push({L:segL,R:it.x,notes:curN,first:first});first=false;} curN=[];segL=it.x; } else curN.push(it); }
  if(curN.length){ const lx=curN[curN.length-1].x; const stp=curN.length>1?lx-curN[curN.length-2].x:18; segs.push({L:segL,R:lx+stp,notes:curN,first:first}); }
}
const byM={}; gold.forEach(x=>{(byM[x.measure]=byM[x.measure]||[]).push(x);});
const nums=Object.keys(byM).map(Number).sort((a,b)=>a-b);
const mbox={}; ocr.measures.forEach(m=>mbox[m.number]=m);
const my={}; ocr.measures.forEach(m=>my[m.number]=(m.y1+m.y3)/2);
// newzik某小节已检测chord的x(按x排序), 用于行首反解
function chordXs(M){ const mb=mbox[M]; return ocr.chords.filter(c=>c.page===mb.page&&mb.x1-8<=(c.x1+c.x3)/2&&(c.x1+c.x3)/2<=mb.x3+8&&Math.abs((c.y1+c.y3)/2-my[M])<55).map(c=>(c.x1+c.x3)/2).sort((a,b)=>a-b); }
const out=[];
for(let i=0;i<nums.length&&i<segs.length;i++){
  const M=nums[i],seg=segs[i],mb=mbox[M];
  const gns=byM[M].slice().sort((a,b)=>a.sync-b.sync);
  const n=seg.notes.length;
  // abc相对位置 rel[j] (首音=0)
  const aL=seg.notes[0].x, aR=seg.R;
  const rel=seg.notes.map(o=>(o.x-aL)/(aR-aL));
  let nL,nR;
  if(seg.first){
    // 行首: 用measured音(已知newzik x)做最小二乘反解 nL,nR. x = nL + rel*(nR-nL)
    // 收集(rel_j, newzik_x) 对: measured音按sync顺序对应gns的measured, 其newzik x=chordXs就近
    const cxs=chordXs(M);
    const anchors=[]; // {rel, x}
    for(let j=0;j<n;j++){ if(gns[j].source==='measured'){ // 该measured音的newzik x: 取cxs里与其预估最近的
      anchors.push({rel:rel[j],gj:j}); } }
    // 把measured音按出现序配cxs(都按x升序, measured音在小节内x也升序)
    const measRels=anchors.map(a=>a.rel);
    if(cxs.length>=2 && measRels.length>=2){
      // 线性拟合 x = a + b*rel, 用measRels[k]<->cxs[k] (数量可能不等, 取min)
      const m=Math.min(measRels.length,cxs.length);
      let sr=0,sx=0,srx=0,srr=0;
      for(let k=0;k<m;k++){ const r=measRels[k],x=cxs[k]; sr+=r;sx+=x;srx+=r*x;srr+=r*r; }
      const b=(m*srx-sr*sx)/(m*srr-sr*sr); const a=(sx-b*sr)/m;
      nL=a; nR=a+b;
    } else { nL=mb.x1+70; nR=mb.x3; }
  } else { nL=mb.x1; nR=mb.x3; }
  for(let j=0;j<n&&j<gns.length;j++){ const nx=nL+rel[j]*(nR-nL); const g=gns[j]; out.push({measure:M,step:g.step,octave:g.octave,midi:g.midi,source:g.source,nx:nx,page:mb.page}); }
}
fs.writeFileSync('/tmp/mapped4.json',JSON.stringify(out));
console.log('映射%d音 -> mapped4.json',out.length);
[1,70,71,77].forEach(M=>console.log('m%d:',JSON.stringify(out.filter(o=>o.measure===M).map(o=>o.step+o.octave+(o.source==='reversed'?'R':'')+':'+Math.round(o.nx)))));
