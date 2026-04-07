const fs = require('fs');
let code = fs.readFileSync('sys-tools.js', 'utf8');

const old = `handlers.set('web_search', async (params) => {
  const q = params.q || params.query || '';
  if (!q) return { success: false, error: 'No query provided' };
  try {
    const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q);
    const raw = execSync('curl -s "' + url + '" -H "User-Agent: Mozilla/5.0"', { timeout: 30000, encoding: 'utf8' });
    const results = [];
    const parts = raw.split('result__a');
    for (let i = 1; i < parts.length && results.length < 8; i++) {
      const hrefM = parts[i].match(/href="([^"]+)"/);
      const textM = parts[i].match(/>([^<]+)/);
      const snipM = parts[i].match(/result__snippet[^>]*>([^<]*)/);
      if (hrefM && textM) {
        results.push({ url: hrefM[1], title: textM[1].trim(), snippet: snipM ? snipM[1].trim() : '' });
      }
    }
    return { success: true, query: q, results };
  } catch(e) {
    return { success: false, error: e.message };
  }
});`;

const replacement = `handlers.set('web_search', async (params) => {
  const { exec } = await import('child_process');
  const q = params.q || params.query || '';
  if (!q) return { success: false, error: 'No query provided' };
  const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q);
  return new Promise((resolve) => {
    exec('curl -s "' + url + '" -H "User-Agent: Mozilla/5.0"', { timeout: 30000, encoding: 'utf8' }, (err, stdout) => {
      if (err) { resolve({ success: false, error: err.message }); return; }
      const results = [];
      const parts = stdout.split('result__a');
      for (let i = 1; i < parts.length && results.length < 8; i++) {
        const hrefM = parts[i].match(/href="([^"]+)"/);
        const textM = parts[i].match(/>([^<]+)/);
        const snipM = parts[i].match(/result__snippet[^>]*>([^<]*)/);
        if (hrefM && textM) {
          results.push({ url: hrefM[1], title: textM[1].trim(), snippet: snipM ? snipM[1].trim() : '' });
        }
      }
      resolve({ success: true, query: q, results });
    });
  });
});`;

if (code.includes(old)) {
  code = code.replace(old, replacement);
  fs.writeFileSync('sys-tools.js', code);
  console.log('PATCHED: web_search now uses async exec (non-blocking)');
} else {
  console.log('ERROR: old handler not found');
}
