/**
 * Topic Fetcher
 * 从 RSS/网页抓取今日话题候选
 * 
 * 用法:
 *   node topic-fetcher.js <category>          # 获取该类别的话题候选
 *   node topic-fetcher.js tech --count 5      # 获取5个候选
 *   node topic-fetcher.js --auto              # 自动选择今天类别
 * 
 * 输出: JSON { category, candidates: [{title, url, source, score}] }
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '../../data/video-automation');
const plan = JSON.parse(fs.readFileSync(path.join(dataDir, 'content-plan.json'), 'utf8'));
const history = JSON.parse(fs.readFileSync(path.join(dataDir, 'content-history.json'), 'utf8'));

/**
 * HTTP GET 请求
 */
function fetchUrl(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 VideoBot/1.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

/**
 * 从 RSS XML 中提取条目
 */
function parseRSS(xml) {
  const items = [];
  const itemRegex = /<item[^>]*>(.*?)<\/item>/gs;
  let match;
  
  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];
    
    const title = (itemXml.match(/<title[^>]*>(?:<\!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/) || [])[1] || '';
    const link = (itemXml.match(/<link[^>]*>(?:<\!\[CDATA\[)?(.*?)(?:\]\]>)?<\/link>/) || [])[1] || '';
    const description = (itemXml.match(/<description[^>]*>(?:<\!\[CDATA\[)?(.*?)(?:\]\]>)?<\/description>/) || [])[1] || '';
    const pubDate = (itemXml.match(/<pubDate[^>]*>(.*?)<\/pubDate>/) || [])[1] || '';
    
    if (title) {
      items.push({
        title: title.replace(/<[^>]+>/g, '').trim(),
        url: link.trim(),
        description: description.replace(/<[^>]+>/g, '').substring(0, 200).trim(),
        pubDate
      });
    }
  }
  
  // Atom feed fallback
  if (items.length === 0) {
    const entryRegex = /<entry[^>]*>(.*?)<\/entry>/gs;
    while ((match = entryRegex.exec(xml)) !== null) {
      const entryXml = match[1];
      const title = (entryXml.match(/<title[^>]*>(?:<\!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/) || [])[1] || '';
      const link = (entryXml.match(/<link[^>]*href=["']([^"']+)["']/) || [])[1] || '';
      const summary = (entryXml.match(/<summary[^>]*>(?:<\!\[CDATA\[)?(.*?)(?:\]\]>)?<\/summary>/) || [])[1] || '';
      
      if (title) {
        items.push({
          title: title.replace(/<[^>]+>/g, '').trim(),
          url: link.trim(),
          description: summary.replace(/<[^>]+>/g, '').substring(0, 200).trim(),
          pubDate: ''
        });
      }
    }
  }
  
  return items;
}

/**
 * Hacker News 专用解析（JSON API）
 */
async function fetchHackerNews(count = 10) {
  try {
    const topIds = JSON.parse(await fetchUrl('https://hacker-news.firebaseio.com/v0/topstories.json'));
    const items = [];
    
    for (const id of topIds.slice(0, count)) {
      try {
        const story = JSON.parse(await fetchUrl(`https://hacker-news.firebaseio.com/v0/item/${id}.json`));
        if (story && story.title && story.url) {
          items.push({
            title: story.title,
            url: story.url,
            description: `Score: ${story.score}, Comments: ${story.descendants || 0}`,
            pubDate: new Date(story.time * 1000).toISOString(),
            score: story.score
          });
        }
      } catch (e) { /* skip */ }
    }
    
    return items;
  } catch (e) {
    return [];
  }
}

/**
 * 评估话题质量
 */
function scoreTopic(item, category) {
  let score = 50; // 基础分
  
  const title = item.title.toLowerCase();
  
  // 长度适中的标题加分
  if (title.length > 20 && title.length < 80) score += 10;
  
  // 包含数字/数据加分（更吸引眼球）
  if (/\d+/.test(title)) score += 5;
  
  // 包含情感/动作词加分
  const powerWords = ['new', 'first', 'breaking', 'secret', 'revealed', 'shocking', 'how', 'why', 'future', 'billion', 'million', 'dead', 'crisis', 'revolution', 'impossible', 'incredible', 'discover', 'launch', 'ban', 'warning'];
  for (const w of powerWords) {
    if (title.includes(w)) { score += 3; break; }
  }
  
  // 类别相关性加分
  const categoryKeywords = {
    tech: ['ai', 'robot', 'software', 'app', 'startup', 'google', 'apple', 'microsoft', 'openai', 'chip', 'quantum', 'crypto', 'blockchain', 'code', 'hack', 'cyber', 'data', 'cloud', 'gpu'],
    people: ['story', 'life', 'born', 'died', 'legend', 'hero', 'founder', 'inventor', 'artist', 'genius', 'war', 'history'],
    society: ['law', 'protest', 'rights', 'election', 'policy', 'justice', 'inequality', 'climate', 'immigration', 'health', 'education'],
    science: ['study', 'research', 'discover', 'space', 'nasa', 'brain', 'dna', 'gene', 'physics', 'chemistry', 'biology', 'planet', 'star', 'ocean'],
    business: ['market', 'stock', 'revenue', 'profit', 'startup', 'invest', 'ipo', 'ceo', 'billion', 'economy', 'trade', 'growth'],
    culture: ['movie', 'music', 'art', 'book', 'film', 'song', 'celebrity', 'fashion', 'food', 'travel', 'game', 'meme', 'viral'],
    wildcard: [] // 接受任何话题
  };
  
  const keywords = categoryKeywords[category] || [];
  for (const kw of keywords) {
    if (title.includes(kw)) { score += 8; break; }
  }
  
  // HN score 加分
  if (item.score) {
    if (item.score > 500) score += 20;
    else if (item.score > 200) score += 15;
    else if (item.score > 100) score += 10;
    else if (item.score > 50) score += 5;
  }
  
  // 去重惩罚
  const topicWords = new Set(title.split(/\s+/).filter(w => w.length > 3));
  for (const used of history.topics_used) {
    const usedWords = new Set(used.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    let overlap = 0;
    for (const w of topicWords) { if (usedWords.has(w)) overlap++; }
    if (overlap / Math.max(topicWords.size, 1) > 0.4) {
      score -= 30; // 相似话题大幅扣分
      break;
    }
  }
  
  return Math.max(0, Math.min(100, score));
}

/**
 * 获取指定类别的话题候选
 */
async function fetchTopics(categoryId, count = 10) {
  const sources = plan.sources[categoryId] || [];
  let allItems = [];
  
  for (const source of sources) {
    try {
      if (source.url.includes('hacker-news') || source.url.includes('ycombinator')) {
        const items = await fetchHackerNews(20);
        allItems.push(...items.map(i => ({ ...i, source: source.name })));
      } else if (source.type === 'rss') {
        const xml = await fetchUrl(source.url);
        const items = parseRSS(xml);
        allItems.push(...items.map(i => ({ ...i, source: source.name })));
      }
    } catch (e) {
      console.error(`Failed to fetch ${source.name}: ${e.message}`);
    }
  }
  
  // 评分并排序
  const scored = allItems.map(item => ({
    title: item.title,
    url: item.url,
    source: item.source,
    description: item.description || '',
    score: scoreTopic(item, categoryId)
  }));
  
  scored.sort((a, b) => b.score - a.score);
  
  // 去重（相似标题）
  const unique = [];
  const seen = new Set();
  for (const item of scored) {
    const key = item.title.toLowerCase().substring(0, 30);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(item);
    }
    if (unique.length >= count) break;
  }
  
  return unique;
}

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  let categoryId = null;
  let count = 10;
  let autoMode = false;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--count' && args[i + 1]) {
      count = parseInt(args[++i]);
    } else if (args[i] === '--auto') {
      autoMode = true;
    } else if (args[i] === '--help') {
      console.log('Usage: node topic-fetcher.js <category> [--count N] [--auto]');
      console.log('Categories:', plan.categories.map(c => c.id).join(', '));
      process.exit(0);
    } else if (!args[i].startsWith('--')) {
      categoryId = args[i];
    }
  }
  
  if (autoMode && !categoryId) {
    const { getTodayCategory } = require('./content-scheduler.js');
    const cat = getTodayCategory();
    categoryId = cat.id;
  }
  
  if (!categoryId) {
    console.error('Please specify a category or use --auto');
    console.error('Categories:', plan.categories.map(c => c.id).join(', '));
    process.exit(1);
  }
  
  fetchTopics(categoryId, count).then(candidates => {
    console.log(JSON.stringify({
      category: categoryId,
      count: candidates.length,
      candidates
    }, null, 2));
  }).catch(e => {
    console.error('Error:', e.message);
    process.exit(1);
  });
}

module.exports = { fetchTopics, scoreTopic };
