const fs = require('fs');
const file = 'sys-tools.js';
let code = fs.readFileSync(file, 'utf8');

const oldHandler = `handlers.set('web_search', async (params) => {
  const q = params.q || params.query || '';
  if (!q) return { success: false, error: 'No query provided' };
  try {
    const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q);
    const raw = execSync('curl -s "' + url + '" -H "User-Agent: Mozilla/5.0"', { timeout: 15000, encoding: 'utf8' });
    const results = [];
    const parts = raw.split('result__a');
    for (let i = 1; i < parts.length && results.length < 5; i++) {
      const hrefM = parts[i].match(/href="([^"]+)"/);
      const textM = parts[i].match(/>([^<]+)/);
      if (hrefM && textM) {
        results.push({ url: hrefM[1], title: textM[1].trim(), snippet: '' });
      }
    }
    return { success: true, query: q, results };
  } catch(e) {
    return { success: false, error: e.message };
  }
});`;

const newHandler = `handlers.set('web_search', async (params, context) => {
  const { evalInBrowser } = context || {};
  const q = params.q || params.query || '';
  if (!q) return { success: false, error: 'No query provided' };
  
  // 方案1: evalInBrowser 走浏览器 fetch
  if (evalInBrowser) {
    try {
      const searchUrl = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q);
      const jsCode = [
        'return fetch("' + searchUrl + '")',
        '.then(r=>r.text())',
        '.then(html=>{',
        '  var results=[];',
        '  var parts=html.split("result__a");',
        '  for(var i=1;i<parts.length&&results.length<8;i++){',
        '    var hm=parts[i].match(/href="([^"]+)"/);',
        '    var tm=parts[i].match(/>([^<]+)/);',
        '    var sm=parts[i].match(/result__snippet[^>]*>([^<]*)/);',
        '    if(hm&&tm)results.push({url:hm[1],title:tm[1].trim(),snippet:sm?sm[1].trim():""});',
        '  }',
        '  return JSON.stringify(results);',
        '})',
      ].join('\\n');
      const raw = await evalInBrowser(jsCode, 30000);
      const results = JSON.parse(raw);
      return { success: true, query: q, results };
    } catch(e) {
      // fallback to curl
    }
  }
  
  // 方案2: fallback curl
  try {
    const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q);
    const raw = execSync('curl -s "' + url + '" -H "User-Agent: Mozilla/5.0"', { timeout: 15000, encoding: 'utf8' });
    const results = [];
    const parts = raw.split('result__a');
    for (let i = 1; i < parts.length && results.length < 5; i++) {
      const hrefM = parts[i].match(/href="([^"]+)"/);
      const textM = parts[i].match(/>([^<]+)/);
      if (hrefM && textM) {
        results.push({ url: hrefM[1], title: textM[1].trim(), snippet: '' });
      }
    }
    return { success: true, query: q, results };
  } catch(e) {
    return { success: false, error: e.message };
  }
});`;

if (code.includes(oldHandler)) {
  code = code.replace(oldHandler, newHandler);
  fs.writeFileSync(file, code);
  console.log('PATCHED: web_search now uses evalInBrowser with curl fallback');
} else {
  console.log('ERROR: old handler not found, manual patch needed');
  // show what we're looking for
  const idx = code.indexOf("handlers.set('web_search'");
  if (idx >= 0) console.log('Found handler at index', idx, ':', code.substring(idx, idx+100));
}
