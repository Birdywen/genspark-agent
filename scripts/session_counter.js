#!/usr/bin/env node
const fs = require("fs");
const FILE = "/private/tmp/session_counter.json";
const cmd = process.argv[2];
function load() {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); }
  catch { return { session_id: Date.now().toString(), round: 0, warning_threshold: 30 }; }
}
function save(data) { fs.writeFileSync(FILE, JSON.stringify(data, null, 2)); }
if (cmd === "inc" || cmd === "i") {
  const data = load(); data.round++; save(data);
  if (data.round >= data.warning_threshold) {
    console.log("⚠️ 【Context 预警】当前对话已达 " + data.round + " 轮，建议总结进度");
  } else { console.log("Round: " + data.round + "/" + data.warning_threshold); }
} else if (cmd === "status" || cmd === "s") {
  console.log(JSON.stringify(load(), null, 2));
} else if (cmd === "reset" || cmd === "r") {
  save({ session_id: Date.now().toString(), round: 0, warning_threshold: 30 });
  console.log("Session reset");
} else { console.log("Usage: node session_counter.js [inc|status|reset]"); }
