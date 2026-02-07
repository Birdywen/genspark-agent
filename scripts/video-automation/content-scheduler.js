/**
 * Content Scheduler
 * 根据星期几选择类别，构建完整的 Opus Pro prompt
 * 
 * 用法:
 *   node content-scheduler.js                    # 自动选择今天的类别
 *   node content-scheduler.js --category tech     # 指定类别
 *   node content-scheduler.js --topic "..."       # 指定话题
 *   node content-scheduler.js --category tech --topic "AI news" --source "https://..."
 * 
 * 输出: JSON { category, topic, source_url, prompt, voice, metadata }
 */

const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '../../data/video-automation');
const plan = JSON.parse(fs.readFileSync(path.join(dataDir, 'content-plan.json'), 'utf8'));
const templates = JSON.parse(fs.readFileSync(path.join(dataDir, 'prompt-templates.json'), 'utf8'));
const history = JSON.parse(fs.readFileSync(path.join(dataDir, 'content-history.json'), 'utf8'));

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * 根据星期几获取今日类别
 */
function getTodayCategory() {
  const today = DAYS[new Date().getDay()];
  
  // 找到今天排期的类别
  const matched = plan.categories.filter(c => c.schedule.includes(today));
  
  if (matched.length === 0) {
    // fallback: wildcard
    return plan.categories.find(c => c.id === 'wildcard');
  }
  
  if (matched.length === 1) {
    return matched[0];
  }
  
  // 多个类别匹配同一天（如 Thursday = tech + science）
  // 选择最近最少使用的
  const recentByCategory = {};
  history.published.forEach(p => {
    if (!recentByCategory[p.category] || p.date > recentByCategory[p.category]) {
      recentByCategory[p.category] = p.date;
    }
  });
  
  matched.sort((a, b) => {
    const dateA = recentByCategory[a.id] || '2000-01-01';
    const dateB = recentByCategory[b.id] || '2000-01-01';
    return dateA.localeCompare(dateB); // 最久没用的排前面
  });
  
  return matched[0];
}

/**
 * 检查话题是否重复
 */
function isTopicDuplicate(topic) {
  const topicLower = topic.toLowerCase();
  const topicWords = new Set(topicLower.split(/\s+/).filter(w => w.length > 3));
  
  for (const used of history.topics_used) {
    const usedLower = used.toLowerCase();
    const usedWords = new Set(usedLower.split(/\s+/).filter(w => w.length > 3));
    
    // 计算重叠度
    let overlap = 0;
    for (const w of topicWords) {
      if (usedWords.has(w)) overlap++;
    }
    
    const overlapRatio = overlap / Math.max(topicWords.size, 1);
    if (overlapRatio > 0.6) {
      return { duplicate: true, matchedWith: used, overlapRatio };
    }
  }
  
  return { duplicate: false };
}

/**
 * 构建完整的 Opus Pro prompt
 */
function buildPrompt(categoryId, topic, sourceUrl) {
  const template = templates.templates[categoryId];
  if (!template) {
    throw new Error(`Unknown category: ${categoryId}`);
  }
  
  const thumbnailInstruction = templates.thumbnail_instruction;
  const commonRules = templates.common_rules.join('\n- ');
  
  let prompt = template.prompt
    .replace(/{duration}/g, template.duration)
    .replace(/{topic}/g, topic)
    .replace(/{source_url}/g, sourceUrl || 'N/A')
    .replace(/{thumbnail_instruction}/g, thumbnailInstruction)
    .replace(/{common_rules}/g, commonRules);
  
  return prompt;
}

/**
 * 构建 Opus Pro API 请求体
 */
function buildOpusPayload(prompt) {
  return {
    initialText: prompt,
    voice: plan.channel.default_voice,
    enableCaption: true
  };
}

/**
 * 主调度逻辑
 */
function schedule(options = {}) {
  // 确定类别
  let category;
  if (options.category) {
    category = plan.categories.find(c => c.id === options.category);
    if (!category) {
      throw new Error(`Unknown category: ${options.category}. Available: ${plan.categories.map(c => c.id).join(', ')}`);
    }
  } else {
    category = getTodayCategory();
  }
  
  // 话题
  const topic = options.topic || null;
  const sourceUrl = options.source || '';
  
  if (!topic) {
    return {
      category: category.id,
      category_label: category.label,
      content_type: category.content_type,
      audience: category.audience,
      tone: category.tone,
      sources: plan.sources[category.id] || [],
      needs_topic: true,
      message: `Category: ${category.label} (${category.id}). Please provide a topic. Suggested sources: ${(plan.sources[category.id] || []).map(s => s.name).join(', ')}`
    };
  }
  
  // 检查重复
  const dupCheck = isTopicDuplicate(topic);
  if (dupCheck.duplicate) {
    return {
      category: category.id,
      error: 'duplicate_topic',
      message: `Topic too similar to previously used: "${dupCheck.matchedWith}" (${Math.round(dupCheck.overlapRatio * 100)}% overlap). Please choose a different topic.`
    };
  }
  
  // 构建 prompt
  const prompt = buildPrompt(category.id, topic, sourceUrl);
  const opusPayload = buildOpusPayload(prompt);
  
  // 生成 YouTube 元数据预览
  const { generateMetadata } = require('./youtube-metadata.js');
  const metadata = generateMetadata({
    category: category.id,
    topic: topic,
    source_url: sourceUrl,
    script: ''
  });
  
  return {
    category: category.id,
    category_label: category.label,
    topic: topic,
    source_url: sourceUrl,
    prompt: prompt,
    opus_payload: opusPayload,
    youtube_metadata_preview: metadata,
    duplicate_check: 'passed',
    today: DAYS[new Date().getDay()],
    timestamp: new Date().toISOString()
  };
}

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  const options = {};
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--category' && args[i + 1]) {
      options.category = args[++i];
    } else if (args[i] === '--topic' && args[i + 1]) {
      options.topic = args[++i];
    } else if (args[i] === '--source' && args[i + 1]) {
      options.source = args[++i];
    } else if (args[i] === '--help') {
      console.log('Usage: node content-scheduler.js [--category <id>] [--topic <text>] [--source <url>]');
      console.log('Categories:', plan.categories.map(c => c.id).join(', '));
      process.exit(0);
    }
  }
  
  try {
    const result = schedule(options);
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

module.exports = { schedule, getTodayCategory, isTopicDuplicate, buildPrompt };
