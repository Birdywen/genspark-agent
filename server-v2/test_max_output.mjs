import WebSocket from 'ws';
import { readFileSync } from 'fs';
const cfg = JSON.parse(readFileSync(process.env.HOME + '/.config/genspark/config.json', 'utf8'));
const ts = String(Date.now());
const rand = Array.from({length:11}, () => Math.floor(Math.random()*10)).join('');
const mid = 'udpxpnmk' + ts.slice(-8) + rand + ts.slice(-3);
const ws = new WebSocket('wss://vear.com/conversation/go', {
  headers: { Cookie: cfg.cookies, Origin: 'https://vear.com', 'User-Agent': 'Mozilla/5.0' }
});
let result = '', chunks = 0, start = Date.now();
ws.on('open', () => {
  ws.send(JSON.stringify({ uid: cfg.uid, mid, q: 'Write numbers 1 to 500, one per line. Do not skip any.', m: 11, ms: 7, t: 'm' }));
});
ws.on('message', d => {
  const msg = JSON.parse(d.toString());
  if (msg.t === 'm') { result += msg.c; chunks++; }
  if (msg.t === 'n') {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`chunks: ${chunks}`);
    console.log(`chars: ${result.length}`);
    console.log(`lines: ${result.split('\n').length}`);
    console.log(`time: ${elapsed}s`);
    console.log(`last 200 chars: ${result.slice(-200)}`);
    ws.close(); process.exit(0);
  }
});
ws.on('error', e => console.log('ERR:', e.message));
setTimeout(() => {
  console.log(`TIMEOUT after 180s - got ${result.length} chars, ${chunks} chunks`);
  console.log(`last 200: ${result.slice(-200)}`);
  process.exit(1);
}, 180000);
