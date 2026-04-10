// nlp-scorer.js — Diffbot NLP salience scoring for compress
// Input: array of {idx, role, content}
// Output: array of {idx, score, entities, action}

const https = require('https');
const path = require('path');

// Code keywords that force retention regardless of NLP score
const FORCE_KEEP_PATTERNS = [
  /\b(fix|bug|root.?cause|found|broke|crash|regression)\b/i,
  /\b(ENOENT|TIMEOUT|ERROR|429|500|403|SIGTERM|SIGKILL)\b/,
  /\b(lesson|rule|principle|architecture|design.?decision)\b/i,
  /\b(deploy|release|migrate|rollback|backup)\b/i,
];

// Patterns that indicate filler/noise
const FILLER_PATTERNS = [
  /^(ok|okay|好|嗯|对|收到|继续|great|sure|thanks|got it|hmm)[.!?]*$/i,
  /^\[对话状态/,
  /^⚠️.*压缩阈值/,
  /^echo\s+(hello|test|ok)/i,
];

function getToken() {
  try {
    const fs = require('fs');
    const envPath = path.join(__dirname, '.env');
    const env = fs.readFileSync(envPath, 'utf8');
    const match = env.match(/DIFFBOT_TOKEN=(.+)/);
    return match ? match[1].trim() : null;
  } catch(e) { return null; }
}

function callDiffbotNLP(text, token) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ content: text });
    const url = `https://nl.diffbot.com/v1/?fields=entities,sentiment&token=${token}`;
    const parsed = new URL(url);
    const opts = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 8000
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

async function scoreMessages(messages, opts = {}) {
  const token = opts.token || getToken();
  if (!token) return messages.map((m,i) => ({idx: i, score: 0.5, entities: [], action: 'RULE_ONLY', error: 'no token'}));

  const results = [];
  const batchSize = opts.batchSize || 5; // concurrent requests
  
  for (let i = 0; i < messages.length; i += batchSize) {
    const batch = messages.slice(i, i + batchSize);
    const promises = batch.map(async (msg, j) => {
      const idx = i + j;
      const text = (msg.content || msg.text || '').substring(0, 2000);
      
      // Quick filler check — skip NLP call
      for (const pat of FILLER_PATTERNS) {
        if (pat.test(text.trim())) {
          return { idx, score: 0, entities: [], action: 'DROP', reason: 'filler' };
        }
      }
      
      // Force keep check
      for (const pat of FORCE_KEEP_PATTERNS) {
        if (pat.test(text)) {
          return { idx, score: 1.0, entities: [], action: 'KEEP_FULL', reason: 'force_pattern' };
        }
      }
      
      // Short messages with no special patterns
      if (text.length < 30) {
        return { idx, score: 0.1, entities: [], action: 'COMPRESS', reason: 'short' };
      }

      // NLP scoring
      try {
        const data = await callDiffbotNLP(text, token);
        const entities = (data.entities || []).sort((a,b) => (b.salience||0) - (a.salience||0));
        const maxSalience = entities.length > 0 ? entities[0].salience || 0 : 0;
        const entityCount = entities.length;
        const sentiment = Math.abs(data.sentiment || 0);
        
        // Combined score: salience + entity density + sentiment intensity
        const densityBonus = Math.min(entityCount * 0.05, 0.2);
        const sentimentBonus = sentiment > 0.5 ? 0.1 : 0;
        let score = Math.min(maxSalience + densityBonus + sentimentBonus, 1.0);

        // Code/path detection bonus
        if (/\.(js|py|cjs|json|sh|html|css)\b/.test(text)) score = Math.min(score + 0.15, 1.0);
        if (/\bfunction\s+\w|=>|async\s/.test(text)) score = Math.min(score + 0.1, 1.0);

        let action;
        if (score >= 0.4) action = 'KEEP_FULL';
        else if (score >= 0.15) action = 'SUMMARIZE';
        else action = 'COMPRESS';

        const topEntities = entities.slice(0, 3).map(e => e.name);
        return { idx, score: Math.round(score * 1000) / 1000, entities: topEntities, action, entityCount };
      } catch(e) {
        // NLP failed — fall back to rule-based
        let score = 0.5;
        if (text.length > 500) score = 0.6;
        if (/\.(js|py|cjs)/.test(text)) score = 0.7;
        return { idx, score, entities: [], action: 'SUMMARIZE', reason: 'nlp_error', error: e.message };
      }
    });
    const batchResults = await Promise.all(promises);
    results.push(...batchResults);
  }
  return results;
}

// CLI test mode
if (require.main === module) {
  const testMsgs = [
    {content: 'OK'},
    {content: 'Found it! ai-bridge.js formatResult has .substring(0,500) truncating all tool results. This is the root cause.'},
    {content: 'Added Extension context invalidated protection with fallback WebSocket to server-v2'},
    {content: 'echo hello returned hello'},
    {content: '好'},
    {content: 'Diffbot NL API returns entities with salience scores that can be used to prioritize message retention during compress'},
    {content: 'The error was ENOENT because the file path was wrong'},
  ];
  scoreMessages(testMsgs).then(r => {
    console.log('NLP Scorer Results:');
    r.forEach(x => {
      const txt = (testMsgs[x.idx].content || '').substring(0, 60);
      console.log(`  [${x.idx}] score=${x.score.toFixed(3)} action=${x.action.padEnd(10)} entities=[${x.entities.join(', ')}]  "${txt}"`);
    });
  });
}

module.exports = { scoreMessages, FORCE_KEEP_PATTERNS, FILLER_PATTERNS };
