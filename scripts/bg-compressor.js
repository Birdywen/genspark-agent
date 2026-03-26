#!/usr/bin/env node
/**
 * Background Compressor v1.0
 * 
 * 后台预压缩服务：定时提取当前对话中间消息，调 AI 压缩成摘要，存入 agent.db
 * 
 * 用法: node bg-compressor.js [--once] [--interval=300]
 */

const path = require('path');
const crypto = require('crypto');
const Database = require(path.join(__dirname, '../server-v2/node_modules/better-sqlite3'));
const { WebSocket } = require(path.join(__dirname, '../server-v2/node_modules/ws'));

const DB_PATH = path.join(__dirname, '../server-v2/data/agent.db');
const WS_URL = 'ws://localhost:8765';
const TAIL_KEEP = 30;
const MIN_MSGS = 100;
const COMPRESS_MODEL = 'claude-sonnet-4';

function getLocal(slot, key) {
  const db = new Database(DB_PATH);
  const row = db.prepare('SELECT content FROM local_store WHERE slot=? AND key=?').get(slot, key);
  db.close();
  return row ? row.content : null;
}

function setLocal(slot, key, content) {
  const db = new Database(DB_PATH);
  db.prepare("INSERT INTO local_store (slot,key,content,updated_at) VALUES (?,?,?,datetime('now')) ON CONFLICT(slot,key) DO UPDATE SET content=excluded.content, updated_at=excluded.updated_at").run(slot, key, content);
  db.close();
}

function browserEval(code, timeout) {
  return new Promise(function(resolve, reject) {
    var ws = new WebSocket(WS_URL);
    var timer = setTimeout(function() { ws.close(); reject(new Error('timeout')); }, timeout || 30000);
    ws.on('error', function(e) { clearTimeout(timer); reject(e); });
    ws.on('open', function() {
      ws.send(JSON.stringify({ type: 'browser_list_tabs', id: 'tabs' }));
    });
    ws.on('message', function(data) {
      var msg = JSON.parse(data.toString());
      if (msg.type === 'browser_list_tabs_result' && msg.success) {
        var tabs = JSON.parse(msg.result);
        var tab = tabs.find(function(t) { return t.url && t.url.indexOf('genspark.ai/agents') !== -1; });
        if (!tab) { clearTimeout(timer); ws.close(); reject(new Error('no genspark agent tab')); return; }
        ws.send(JSON.stringify({ type: 'browser_eval', id: 'bg_comp', code: code, tabId: tab.id, timeout: timeout || 30000 }));
      }
      if (msg.type === 'browser_eval_result') {
        clearTimeout(timer); ws.close();
        msg.success ? resolve(msg.result) : reject(new Error(msg.error));
      }
    });
  });
}

async function compress() {
  console.log('[BG-Compress] Starting...');

  // Step 1: 获取当前对话消息概要
  var result = await browserEval("var cid=new URLSearchParams(window.location.search).get('id');if(!cid)return JSON.stringify({error:'no id'});return fetch('/api/project/update',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({id:cid,request_not_update_permission:true})}).then(function(r){return r.json()}).then(function(d){var msgs=d.data.session_state.messages;var r={convId:cid,total:msgs.length,previews:[]};for(var i=0;i<msgs.length;i++){r.previews.push({i:i,role:msgs[i].role,len:(msgs[i].content||'').length,p:(msgs[i].content||'').substring(0,150)})}return JSON.stringify(r)})", 15000);

  var conv = JSON.parse(result);
  if (conv.error) { console.log('[BG-Compress] Error:', conv.error); return; }
  console.log('[BG-Compress] Conv:', conv.convId.substring(0,8), 'msgs:', conv.total);

  if (conv.total < MIN_MSGS) { console.log('[BG-Compress] Too few, skip'); return; }

  // Step 2: 确定中间区域
  var forgedEnd = 0;
  for (var i = 0; i < Math.min(conv.previews.length, 15); i++) {
    if (conv.previews[i].p.indexOf('__FORGED__') !== -1) forgedEnd = i + 1;
  }
  if (forgedEnd === 0) forgedEnd = 3;
  var midStart = forgedEnd;
  var midEnd = conv.total - TAIL_KEEP;
  if (midEnd <= midStart) { console.log('[BG-Compress] No mid section'); return; }

  // 检查是否已压缩
  var state = conv.convId + ':' + conv.total;
  if (getLocal('compress', 'last-state') === state) { console.log('[BG-Compress] Already done'); return; }

  console.log('[BG-Compress] Mid: [' + midStart + '..' + midEnd + '] = ' + (midEnd-midStart) + ' msgs');

  // Step 3: 提取中间消息内容
  var midResult = await browserEval("var cid=new URLSearchParams(window.location.search).get('id');return fetch('/api/project/update',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({id:cid,request_not_update_permission:true})}).then(function(r){return r.json()}).then(function(d){var msgs=d.data.session_state.messages;var mid=[];for(var i=" + midStart + ";i<" + midEnd + ";i++){var c=msgs[i].content||'';if(c.length>500)c=c.substring(0,400)+'...[trunc '+c.length+']';mid.push(msgs[i].role+': '+c)}return JSON.stringify({mid:mid.join('\\n---\\n'),count:mid.length})})", 15000);

  var midData = JSON.parse(midResult);
  console.log('[BG-Compress] Extracted', midData.count, 'msgs,', midData.mid.length, 'chars');

  // Step 4: 调 AI 压缩 - 先存 prompt 到 local_store，浏览器从 8766 读
  var prompt = "你是一个对话压缩器。下面是一段人类和AI助手之间的工作对话记录（包含大量代码和命令）。请将其压缩成简洁的中文摘要。\n\n规则：\n1. 只总结做了什么、遇到什么问题、怎么解决的\n2. 不要复述任何代码、命令或文件内容\n3. 每个要点一句话，按时间顺序\n4. 总字数不超过500字\n5. 格式：纯文本，不要代码块\n\n对话记录：\n" + midData.mid;

  // 分两步：先把 prompt 写入 window 变量，再调 ask_proxy
  var hexPrompt = Buffer.from(prompt, 'utf8').toString('hex');
  var step1Code = "window.__bgPrompt=new TextDecoder().decode(new Uint8Array('" + hexPrompt + "'.match(/.{2}/g).map(function(h){return parseInt(h,16)})));return 'set:'+window.__bgPrompt.length";
  console.log('[BG-Compress] Setting prompt in browser...');
  var setResult = await browserEval(step1Code, 15000);
  console.log('[BG-Compress] ' + setResult);


  // Step 4b: 创建临时对话获取 project_id
  var createCode = "return fetch('/api/project/create',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({name:'bg-compress-tmp',session_state:{messages:[]},type:'ai_chat'})}).then(function(r){return r.json()}).then(function(d){window.__bgPid=d.data.id;return 'pid:'+d.data.id})";
  var pidResult = await browserEval(createCode, 15000);
  console.log("[BG-Compress] " + pidResult);
  var compCode = "var pt=window.__bgPrompt;if(!pt)return 'ERROR:no prompt';var body={ai_chat_model:'" + COMPRESS_MODEL + "',ai_chat_enable_search:false,ai_chat_disable_personalization:true,use_moa_proxy:false,moa_models:[],writingContent:null,type:'ai_chat',project_id:window.__bgPid,messages:[{id:crypto.randomUUID(),role:'user',content:pt}],user_s_input:'compress',is_private:true,push_token:''};var iframe=document.createElement('iframe');iframe.style.display='none';document.body.appendChild(iframe);var rf=iframe.contentWindow.fetch;document.body.removeChild(iframe);return rf.call(window,'https://www.genspark.ai/api/agent/ask_proxy',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify(body)}).then(function(r){if(!r.ok)return 'ERROR:'+r.status;var reader=r.body.getReader();var decoder=new TextDecoder();var content='';function read(){return reader.read().then(function(res){if(res.done)return content;var text=decoder.decode(res.value,{stream:true});var lines=text.split('\\n');for(var i=0;i<lines.length;i++){if(lines[i].startsWith('data: ')){try{var d=JSON.parse(lines[i].substring(6));if(d.type==='message_field_delta'&&d.field_name==='content')content+=d.delta}catch(e){}}}return read()})}return read()})";

  console.log('[BG-Compress] Calling AI...');
  var summary = await browserEval(compCode, 90000);

  if (!summary || summary.startsWith('ERROR:')) {
    console.log('[BG-Compress] Failed:', (summary||'').substring(0,200));
    return;
  }

  console.log('[BG-Compress] Summary:', summary.length, 'chars');

  // Step 5: 存入 agent.db
  setLocal('compress', 'mid-summary', summary);
  setLocal('compress', 'mid-range', midStart + '-' + midEnd);
  setLocal('compress', 'mid-count', String(midData.count));
  setLocal('compress', 'last-state', state);
  setLocal('compress', 'updated', new Date().toISOString());
  console.log('[BG-Compress] Saved to agent.db');

  // Step 6: 删除临时对话
  try {
    var delCode = "return fetch('/api/project/delete?project_id='+window.__bgPid,{credentials:'include'}).then(function(r){return 'del:'+r.status})";
    var delResult = await browserEval(delCode, 10000);
    console.log("[BG-Compress] " + delResult);
  } catch(e) { console.log("[BG-Compress] Cleanup failed: " + e.message); }
}

var args = process.argv.slice(2);
var once = args.includes('--once');
var intArg = args.find(function(a) { return a.startsWith('--interval='); });
var interval = intArg ? parseInt(intArg.split('=')[1]) : 1800;

compress().then(function() {
  if (once) process.exit(0);
  console.log('[BG-Compress] Next in', interval, 's');
  setInterval(function() { compress().catch(function(e) { console.error(e.message); }); }, interval * 1000);
}).catch(function(e) { console.error('[BG-Compress] Fatal:', e.message); process.exit(1); });