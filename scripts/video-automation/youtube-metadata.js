/**
 * YouTube Metadata Generator
 * 生成符合 YouTube Shorts 规范的标题、描述、标签
 * 
 * 用法:
 *   node youtube-metadata.js <category> <topic> [source_url]
 *   echo '{"category":"tech","topic":"...","source_url":"...","script":"..."}' | node youtube-metadata.js
 * 
 * 输出: JSON { title, description, tags, hashtags }
 */

const fs = require('fs');
const path = require('path');

// 配置
const TITLE_MAX = 100;
const TITLE_RECOMMENDED = 60;
const TAGS_MAX_CHARS = 500;
const HASHTAGS_COUNT = [3, 5];

// 加载模板
const dataDir = path.join(__dirname, '../../data/video-automation');
const plan = JSON.parse(fs.readFileSync(path.join(dataDir, 'content-plan.json'), 'utf8'));
const templates = JSON.parse(fs.readFileSync(path.join(dataDir, 'prompt-templates.json'), 'utf8'));

/**
 * 从脚本/话题中提取关键信息
 */
function extractKeyInfo(topic, script) {
  // 提取第一句作为 hook
  const sentences = (script || topic).split(/[.!?]/).filter(s => s.trim());
  const hookSentence = sentences[0] ? sentences[0].trim() : topic;
  
  // 提取关键词（去掉常见停用词）
  const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'and', 'or', 'but', 'not', 'this', 'that', 'it', 'as', 'be', 'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'about', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'than', 'then', 'so', 'if', 'when', 'where', 'how', 'what', 'which', 'who', 'whom', 'why', 'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'only', 'own', 'same', 'just', 'also', 'very', 'its', 'his', 'her', 'their', 'our', 'your', 'my', 'been', 'being', 'having']);
  
  const words = (topic + ' ' + (script || '')).toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));
  
  // 词频统计
  const freq = {};
  words.forEach(w => { freq[w] = (freq[w] || 0) + 1; });
  
  const keywords = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([w]) => w);
  
  // 提取简短话题（用于标题）
  let topicShort = topic;
  if (topicShort.length > 40) {
    // 截断到合理长度
    topicShort = topicShort.substring(0, 40).replace(/\s+\S*$/, '') + '...';
  }
  
  return { hookSentence, keywords, topicShort };
}

/**
 * 生成标题
 */
function generateTitle(category, topic, script) {
  const { topicShort, hookSentence } = extractKeyInfo(topic, script);
  const cat = plan.categories.find(c => c.id === category);
  const catHashtag = cat ? cat.hashtags[0] : '#Shorts';
  
  // 策略：简洁有力的标题 + 类别标签 + #Shorts
  let title = '';
  
  // 尝试从话题中提取核心
  const topicCore = topic
    .replace(/^Create a video (about|of)\s*/i, '')
    .replace(/^(this|the)\s+(news|story|article)\s*/i, '')
    .replace(/\[\s*/g, '')
    .replace(/\s*\]/g, '')
    .replace(/\.\s*Please ensure.*/i, '')
    .replace(/\.\s*Here are additional.*/i, '')
    .trim();
  
  if (topicCore.length <= 45) {
    title = `${topicCore} ${catHashtag} #Shorts`;
  } else {
    // 截断并保持完整词
    let short = topicCore.substring(0, 45);
    short = short.replace(/\s+\S*$/, '');
    title = `${short} ${catHashtag} #Shorts`;
  }
  
  // 确保不超过限制
  if (title.length > TITLE_MAX) {
    const suffix = ` ${catHashtag} #Shorts`;
    const maxCore = TITLE_MAX - suffix.length;
    let core = topicCore.substring(0, maxCore);
    core = core.replace(/\s+\S*$/, '');
    title = core + suffix;
  }
  
  return title;
}

/**
 * 生成描述
 */
function generateDescription(category, topic, script, sourceUrl) {
  const { hookSentence } = extractKeyInfo(topic, script);
  const cat = plan.categories.find(c => c.id === category);
  
  // 生成摘要（从脚本取前 2-3 句）
  let summary = '';
  if (script) {
    const sentences = script.split(/(?<=[.!?])\s+/).filter(s => s.trim());
    summary = sentences.slice(0, 3).join(' ');
    if (summary.length > 300) {
      summary = summary.substring(0, 300).replace(/\s+\S*$/, '') + '...';
    }
  } else {
    summary = topic;
  }
  
  // 构建 hashtags
  const catHashtags = templates.youtube_metadata.hashtag_rules.per_category[category] || [];
  const mustInclude = templates.youtube_metadata.hashtag_rules.must_include;
  const allHashtags = [...new Set([...mustInclude, ...catHashtags])].slice(0, 5);
  const hashtagStr = allHashtags.join(' ');
  
  // 组装描述
  let description = hookSentence + '\n\n' + summary;
  
  if (sourceUrl) {
    description += '\n\nSource: ' + sourceUrl;
  }
  
  description += '\n\n' + hashtagStr;
  description += '\n\n---\n' + plan.rules.ai_disclosure;
  
  return description;
}

/**
 * 生成标签
 */
function generateTags(category, topic, script) {
  const { keywords } = extractKeyInfo(topic, script);
  const cat = plan.categories.find(c => c.id === category);
  const baseTags = cat ? [...cat.tags_base] : ['Shorts'];
  
  // 合并基础标签 + 关键词标签
  const allTags = [...new Set([...baseTags, ...keywords.slice(0, 5)])];
  
  // 确保不超过 500 字符
  let result = [];
  let totalChars = 0;
  for (const tag of allTags) {
    if (totalChars + tag.length + 2 > TAGS_MAX_CHARS) break;
    result.push(tag);
    totalChars += tag.length + 2; // 逗号+空格
  }
  
  return result;
}

/**
 * 生成完整 YouTube 元数据
 */
function generateMetadata(input) {
  const { category, topic, script, source_url } = input;
  
  const title = generateTitle(category, topic, script);
  const description = generateDescription(category, topic, script, source_url);
  const tags = generateTags(category, topic, script);
  
  const cat = plan.categories.find(c => c.id === category);
  const catHashtags = templates.youtube_metadata.hashtag_rules.per_category[category] || [];
  const mustInclude = templates.youtube_metadata.hashtag_rules.must_include;
  const hashtags = [...new Set([...mustInclude, ...catHashtags])].slice(0, 5);
  
  return {
    title,
    description,
    tags,
    hashtags,
    title_length: title.length,
    description_length: description.length,
    tags_chars: tags.join(', ').length,
    valid: {
      title_ok: title.length <= TITLE_MAX,
      title_recommended: title.length <= TITLE_RECOMMENDED,
      tags_ok: tags.join(', ').length <= TAGS_MAX_CHARS
    }
  };
}

// CLI 模式
if (require.main === module) {
  let input;
  
  if (process.argv.length >= 4) {
    // node youtube-metadata.js <category> <topic> [source_url]
    input = {
      category: process.argv[2],
      topic: process.argv[3],
      source_url: process.argv[4] || '',
      script: ''
    };
  } else {
    // stdin JSON
    try {
      const stdinData = fs.readFileSync('/dev/stdin', 'utf8');
      input = JSON.parse(stdinData);
    } catch (e) {
      console.error('Usage: node youtube-metadata.js <category> <topic> [source_url]');
      console.error('  or: echo \'{"category":"tech","topic":"..."}\' | node youtube-metadata.js');
      process.exit(1);
    }
  }
  
  const result = generateMetadata(input);
  console.log(JSON.stringify(result, null, 2));
}

module.exports = { generateMetadata, generateTitle, generateDescription, generateTags };
