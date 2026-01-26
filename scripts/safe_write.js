#!/usr/bin/env node
// safe_write.js - 安全写入文件的 helper
// 用法: echo "内容" | node safe_write.js /path/to/file
// 或者: node safe_write.js /path/to/file "内容"

const fs = require("fs");
const path = require("path");

const targetPath = process.argv[2];
const directContent = process.argv[3];

if (!targetPath) {
  console.error("Usage: node safe_write.js <path> [content]");
  console.error("  or: echo content | node safe_write.js <path>");
  process.exit(1);
}

// 确保目录存在
const dir = path.dirname(targetPath);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

if (directContent) {
  // 直接传入内容
  fs.writeFileSync(targetPath, directContent);
  console.log("Written:", targetPath, "(", directContent.length, "bytes)");
} else {
  // 从 stdin 读取
  let data = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", chunk => data += chunk);
  process.stdin.on("end", () => {
    fs.writeFileSync(targetPath, data);
    console.log("Written:", targetPath, "(", data.length, "bytes)");
  });
}
