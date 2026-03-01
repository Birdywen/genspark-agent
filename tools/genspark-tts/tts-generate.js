#!/usr/bin/env node
/**
 * Genspark TTS Generator - 通过浏览器 eval_js 生成语音
 * 
 * 这个脚本生成 eval_js 所需的代码片段，由 agent 在浏览器中执行
 * 
 * Usage: node tts-generate.js <text> [voiceId]
 * 
 * 输出: 打印 eval_js 代码，agent 复制执行即可
 */

const fs = require('fs');
const path = require('path');

const text = process.argv[2] || '你好，这是一个语音测试。';
const voiceId = process.argv[3] || 'gemini-kore-chinese';

// Load voice info
const VOICES_CSV = path.join(__dirname, 'voices.csv');
const csv = fs.readFileSync(VOICES_CSV, 'utf8');
const lines = csv.trim().split('\n');
const header = lines[0].split(',');
const voices = lines.slice(1).map(line => {
  const parts = line.split(',');
  const obj = {};
  header.forEach((h, i) => obj[h] = parts[i] || '');
  return obj;
});

const voice = voices.find(v => v.id === voiceId) || voices.find(v => v.id.includes(voiceId));
if (!voice) {
  console.error('Voice not found:', voiceId);
  process.exit(1);
}

console.log(JSON.stringify({
  voice: voice.id,
  name: voice.name,
  model: voice.model,
  text: text.substring(0, 100),
  evalCode: generateEvalCode(text, voice)
}));

function generateEvalCode(text, voice) {
  // 生成要在 eval_js 中执行的代码
  const safeText = text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
  const safeName = voice.name.replace(/'/g, "\\'");
  
  return `
return new Promise(function(resolve) {
  var body = {
    models: ['gpt-4.1'],
    run_with_another_model: false,
    request_web_knowledge: false,
    speed_mode: false,
    use_webpage_capture_screen: false,
    use_python_workspace: false,
    dataframe_enhanced: false,
    enable_jupyter: false,
    custom_tools: [],
    unselected_custom_tools: [],
    installed_custom_tools: [],
    model_params: {
      type: 'audio',
      model: '${voice.model}',
      voices: ['${safeName}'],
      dialogue: false,
      background_mode: true
    },
    writingContent: null,
    type: 'audio_generation_agent',
    project_id: null,
    messages: [{ role: 'user', content: '${safeText}' }],
    user_s_input: '${safeText}'
  };

  fetch('/api/agent/ask_proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(function(r) { return r.text(); }).then(function(responseText) {
    // 从 SSE 响应中提取音频 URL
    var audioMatch = responseText.match(/generated_asset_uri['":\\\\s]+["'](https:\\/\\/[^"']+)['"]/);
    var fileMatch = responseText.match(/api\\/files\\/s\\/([^"'\\\\s]+)/);
    if (audioMatch) {
      resolve('AUDIO_URL:' + audioMatch[1]);
    } else if (fileMatch) {
      resolve('AUDIO_URL:https://www.genspark.ai/api/files/s/' + fileMatch[1]);
    } else {
      resolve('RAW:' + responseText.substring(responseText.length - 1000));
    }
  });
});
`.trim();
}