const fs=require('fs');
const g=JSON.parse(fs.readFileSync('/Users/yay/workspace/livescore/scores/Dotzauer_goldmap.json','utf8'));
const ocr=JSON.parse(fs.readFileSync('/Users/yay/workspace/newzik-toolkit/pieces/Dotzauer_-_exercises_for_violoncello_boo/ocr.json','utf8'))[0];
const APOS=String.fromCharCode(39);
const names=['C','^C','D','^D','E','F','^F','G','^G','A','^A','B'];
function midi2abc(m){
  const pc=((m%12)+12)%12; const oct=Math.floor(m/12)-1;
  const base=names[pc]; const acc=base.indexOf('^')>=0?'^':''; const low=base.replace('^','');
  let L;
  if(oct>=5){ L=acc+low.toLowerCase(); for(let k=5;k<oct;k++)L+=APOS; }
  else if(oct===4){ L=acc+low; }
  else { L=acc+low; for(let k=oct;k<4;k++)L+=','; }
  return L;
}
const byM={}; g.forEach(x=>{(byM[x.measure]=byM[x.measure]||[]).push(x);});
const nums=Object.keys(byM).map(Number).sort((a,b)=>a-b);
// newzik分行: measure -> (page,system) 行键, 保持顺序
const rowKeyOf={}; ocr.measures.forEach(m=>{ rowKeyOf[m.number]=m.page+'_'+m.system; });
// 每小节body
function measBody(M){
  const ns=byM[M].slice().sort((a,b)=>a.sync-b.sync); const toks=[];
  for(let i=0;i<ns.length;i++){ const s=ns[i].sync; const nx=i+1<ns.length?ns[i+1].sync:2; let dur=Math.round((nx-s)*4); if(dur<1)dur=1; let tok=midi2abc(ns[i].midi); if(dur!==1)tok+=dur; toks.push(tok); }
  return toks.join(' ');
}
// 按newzik行分组生成, 每行末尾%lastM
const lines=[]; let cur=[]; let curKey=null;
for(const M of nums){
  const k=rowKeyOf[M];
  if(curKey!==null && k!==curKey){ const lastM=cur[cur.length-1]; lines.push(' '+cur.map(measBody).join(' | ')+' | %'+lastM); cur=[]; }
  cur.push(M); curKey=k;
}
if(cur.length){ const lastM=cur[cur.length-1]; lines.push(' '+cur.map(measBody).join(' | ')+' | %'+lastM); }
const abc=['X:1','T:Dotzauer (newzik-rowsplit)','M:2/4','L:1/16','K:F','V:1 bass',...lines].join('\n');
fs.writeFileSync('/tmp/gold_rowsplit.abc',abc);
console.log('生成: '+lines.length+'行 (应=newzik行数), '+nums.length+'小节');
lines.forEach((l,i)=>{ const mc=(l.match(/\|/g)||[]).length; console.log('行%d: %d小节 末%s',i,mc,(l.match(/%(\d+)/)||[])[1]); });
