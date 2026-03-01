#!/usr/bin/env node
/**
 * Genspark TTS - Text to Speech via Genspark Audio API
 * 
 * Usage:
 *   node genspark-tts.js "要转换的文本" [options]
 * 
 * Options:
 *   --voice <id>       Voice ID (default: gemini-kore-chinese)
 *   --model <model>    TTS model (default: auto from voice)
 *   --lang <language>  Filter voices by language
 *   --gender <m/f>     Filter voices by gender
 *   --style <style>    Filter voices by style
 *   --list             List available voices (with filters)
 *   --output <file>    Output file path (default: /private/tmp/tts_output.mp3)
 *   --dialogue         Enable dialogue mode
 *   --tab <tabId>      Browser tab ID for Genspark (required)
 * 
 * Examples:
 *   node genspark-tts.js "你好世界" --voice gemini-kore-chinese --tab 2012096965
 *   node genspark-tts.js --list --lang chinese --gender female
 *   node genspark-tts.js "Hello world" --voice elevenlabs-v3-narrator-english --tab 2012096965
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const VOICES_CSV = path.join(__dirname, 'voices.csv');
const DEFAULT_OUTPUT = '/private/tmp/tts_output.mp3';

// Parse args
const args = process.argv.slice(2);
let text = '';
const opts = {
  voice: null,
  model: null,
  lang: null,
  gender: null,
  style: null,
  list: false,
  output: DEFAULT_OUTPUT,
  dialogue: false,
  tab: null,
};

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--voice') opts.voice = args[++i];
  else if (args[i] === '--model') opts.model = args[++i];
  else if (args[i] === '--lang') opts.lang = args[++i];
  else if (args[i] === '--gender') opts.gender = args[++i];
  else if (args[i] === '--style') opts.style = args[++i];
  else if (args[i] === '--list') opts.list = true;
  else if (args[i] === '--output' || args[i] === '-o') opts.output = args[++i];
  else if (args[i] === '--dialogue') opts.dialogue = true;
  else if (args[i] === '--tab') opts.tab = args[++i];
  else if (!args[i].startsWith('--')) text = args[i];
}

// Load voices
function loadVoices() {
  const csv = fs.readFileSync(VOICES_CSV, 'utf8');
  const lines = csv.trim().split('\n');
  const header = lines[0].split(',');
  return lines.slice(1).map(line => {
    const parts = line.split(',');
    const obj = {};
    header.forEach((h, i) => obj[h] = parts[i] || '');
    return obj;
  });
}

// List voices
function listVoices() {
  let voices = loadVoices();
  if (opts.lang) voices = voices.filter(v => v.language === opts.lang);
  if (opts.gender) voices = voices.filter(v => v.gender === (opts.gender === 'm' ? 'male' : opts.gender === 'f' ? 'female' : opts.gender));
  if (opts.style) voices = voices.filter(v => v.style === opts.style);
  if (opts.model) voices = voices.filter(v => v.model.includes(opts.model));

  // Group by model
  const byModel = {};
  voices.forEach(v => {
    if (!byModel[v.model]) byModel[v.model] = [];
    byModel[v.model].push(v);
  });

  console.log(`\n📢 Found ${voices.length} voices:\n`);
  for (const [model, vlist] of Object.entries(byModel)) {
    console.log(`  🎵 ${model} (${vlist.length} voices)`);
    // Deduplicate by name (same voice different languages)
    const byName = {};
    vlist.forEach(v => {
      if (!byName[v.name]) byName[v.name] = { ...v, languages: [] };
      byName[v.name].languages.push(v.language);
    });
    for (const [name, v] of Object.entries(byName)) {
      const langs = v.languages.length > 5 
        ? v.languages.slice(0, 5).join(',') + `+${v.languages.length - 5}` 
        : v.languages.join(',');
      console.log(`    ${v.gender === 'female' ? '👩' : '👨'} ${name.padEnd(25)} ${v.style.padEnd(15)} [${langs}]`);
      console.log(`      ID: ${v.id}  "${v.description}"`);
    }
    console.log('');
  }
}

// Generate TTS via eval_js (browser-based)
async function generateTTS() {
  if (!text) {
    console.error('❌ No text provided. Usage: node genspark-tts.js "text" --tab <tabId>');
    process.exit(1);
  }
  if (!opts.tab) {
    console.error('❌ No tab ID provided. Use --tab <tabId>');
    console.error('   Get tab ID from: list_tabs tool');
    process.exit(1);
  }

  // Find voice info
  const voices = loadVoices();
  let voice;
  if (opts.voice) {
    voice = voices.find(v => v.id === opts.voice);
    if (!voice) {
      // Try partial match
      voice = voices.find(v => v.id.includes(opts.voice));
    }
  }
  if (!voice) {
    // Default: Chinese female narrator
    voice = voices.find(v => v.id === 'gemini-kore-chinese') || voices[0];
  }

  const model = opts.model || voice.model;
  console.log(`\n🎤 Voice: ${voice.name} (${voice.id})`);
  console.log(`🎵 Model: ${model}`);
  console.log(`📝 Text: ${text.substring(0, 80)}${text.length > 80 ? '...' : ''}`);
  console.log(`📁 Output: ${opts.output}`);
  console.log(`\n⏳ Generating...`);

  // Build the request body that matches what the browser sends
  const requestBody = {
    models: ["gpt-4.1"],
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
      type: "audio",
      model: model,
      voices: [voice.name],
      dialogue: opts.dialogue,
      background_mode: true
    },
    writingContent: null,
    type: "audio_generation_agent",
    project_id: null,
    messages: [{ role: "user", content: text }],
    user_s_input: text
  };

  // Write request body to temp file for eval_js to read
  const reqFile = '/private/tmp/tts_request.json';
  fs.writeFileSync(reqFile, JSON.stringify(requestBody));

  console.log('\n📋 Request saved to', reqFile);
  console.log('👉 Execute this in eval_js on tab', opts.tab, 'to generate:');
  console.log(`
--- Copy below ---
fetch('/api/agent/ask_proxy', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: ${JSON.stringify(JSON.stringify(requestBody)).replace(/\\"/g, '\\"')}
}).then(r => r.text()).then(t => {
  // Extract audio URL from SSE response
  var match = t.match(/generated_asset_uri.*?(https:\\/\\/[^"]+)/);
  return match ? match[1] : 'Audio URL not found in: ' + t.substring(0, 500);
});
--- End ---
  `);
}

// Main
if (opts.list) {
  listVoices();
} else {
  generateTTS();
}