#!/usr/bin/env node
// safe_edit.js - 安全编辑文件
// 用法: node safe_edit.js <file> <old_text_file> <new_text_file>
// 或者: node safe_edit.js <file> --line <n> <new_text_file>

const fs = require("fs");
const args = process.argv.slice(2);
const targetFile = args[0];

if (!targetFile || !fs.existsSync(targetFile)) {
  console.error("File not found:", targetFile);
  process.exit(1);
}

let content = fs.readFileSync(targetFile, "utf8");
const backup = targetFile + ".bak";
fs.writeFileSync(backup, content);
console.log("Backup:", backup);

if (args[1] === "--line") {
  const lineNum = parseInt(args[2]);
  const newTextFile = args[3];
  const newText = fs.readFileSync(newTextFile, "utf8");
  const lines = content.split("\n");
  lines[lineNum - 1] = newText.trim();
  content = lines.join("\n");
} else {
  const oldTextFile = args[1];
  const newTextFile = args[2];
  const oldText = fs.readFileSync(oldTextFile, "utf8");
  const newText = fs.readFileSync(newTextFile, "utf8");
  if (!content.includes(oldText)) {
    console.error("Old text not found!");
    process.exit(1);
  }
  content = content.replace(oldText, newText);
}

fs.writeFileSync(targetFile, content);
console.log("Updated:", targetFile);
