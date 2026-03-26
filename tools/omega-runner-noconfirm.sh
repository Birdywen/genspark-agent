#!/bin/zsh
# omega-runner-noconfirm.sh
# 解析选中的 ΩHERE/Ω{} 命令文本，通过 WebSocket 发送给 genspark-agent 执行
# 结果复制到剪贴板（带提示词），并发送通知

# 设置 PATH（Automator Service 环境没有用户 PATH）
export PATH="/Users/yay/.nvm/versions/node/v23.9.0/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8

INPUT="$1"
if [ -z "$INPUT" ]; then
  INPUT="$(cat)"
fi

if [ -z "$INPUT" ]; then
  echo "错误: 没有输入"
  exit 1
fi

# 用 node 解析并执行
RESULT=$(cd /Users/yay/workspace/genspark-agent/server-v2 && /Users/yay/.nvm/versions/node/v23.9.0/bin/node -e '
const WebSocket = require("ws");
const input = process.argv[1];

function parseOmegaHere(text) {
  const hereMatch = text.match(/ΩHERE\s+(\S+)/);
  if (!hereMatch) return null;
  const tool = hereMatch[1];
  const params = {};
  const lines = text.split("\n");
  let i = 1;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "ΩEND" || line.trim() === "") { i++; continue; }
    const heredocMatch = line.match(/^@(\w+)<<(\w+)$/);
    if (heredocMatch) {
      const key = heredocMatch[1];
      const delim = heredocMatch[2];
      let content = [];
      i++;
      while (i < lines.length && lines[i].trim() !== delim) {
        content.push(lines[i]);
        i++;
      }
      params[key] = content.join("\n");
      i++;
      continue;
    }
    const kvMatch = line.match(/^@(\w+)=(.+)$/);
    if (kvMatch) {
      let val = kvMatch[2].trim();
      if (val === "true") val = true;
      else if (val === "false") val = false;
      else if (/^\d+$/.test(val)) val = parseInt(val);
      params[kvMatch[1]] = val;
    }
    i++;
  }
  return { tool, params };
}

function parseOmegaJson(text) {
  const jsonMatch = text.match(/Ω(\{[\s\S]*?\})(?:ΩSTOP)?/);
  if (!jsonMatch) return null;
  try {
    const obj = JSON.parse(jsonMatch[1]);
    return { tool: obj.tool, params: obj.params || {} };
  } catch(e) { return null; }
}

function parseOmegaBatch(text) {
  const batchMatch = text.match(/ΩBATCH(\{[\s\S]*?\})ΩEND/);
  if (!batchMatch) return null;
  try {
    const obj = JSON.parse(batchMatch[1]);
    return { type: "batch", steps: obj.steps, options: obj };
  } catch(e) { return null; }
}

let parsed = null;
let isBatch = false;

if (input.includes("ΩBATCH")) {
  parsed = parseOmegaBatch(input);
  isBatch = true;
} else if (input.includes("ΩHERE")) {
  parsed = parseOmegaHere(input);
} else if (input.includes("Ω{")) {
  parsed = parseOmegaJson(input);
}

if (!parsed) {
  process.stderr.write("无法解析命令格式\n");
  process.exit(1);
}

const ws = new WebSocket("ws://localhost:8765");
const callId = "manual_" + Date.now() + "_" + Math.random().toString(36).slice(2,6);

ws.on("open", () => {
  let msg;
  if (isBatch) {
    msg = { type: "tool_batch", id: callId, steps: parsed.steps, options: {} };
  } else {
    msg = { type: "tool_call", id: callId, tool: parsed.tool, params: parsed.params };
  }
  ws.send(JSON.stringify(msg));
});

let resultReceived = false;

ws.on("message", (data) => {
  try {
    const resp = JSON.parse(data.toString());
    if (resp.type === "tool_result" && resp.id === callId) {
      resultReceived = true;
      process.stdout.write(resp.result || "(无输出)");
      setTimeout(() => { ws.close(); process.exit(0); }, 200);
    } else if (resp.type === "batch_complete") {
      resultReceived = true;
      process.stdout.write(JSON.stringify(resp, null, 2));
      setTimeout(() => { ws.close(); process.exit(0); }, 200);
    }
  } catch(e) {}
});

ws.on("error", (err) => {
  process.stderr.write("WebSocket 连接失败: " + err.message + "\n");
  process.exit(1);
});

setTimeout(() => {
  if (!resultReceived) {
    process.stderr.write("超时 (60s)\n");
    ws.close();
    process.exit(1);
  }
}, 60000);
' "$INPUT" 2>&1)

EXIT_CODE=$?

# 组装带提示词的输出，方便粘贴回对话
if [ $EXIT_CODE -eq 0 ]; then
  OUTPUT="你发的上一条命令没有被自动执行，我手动运行了。以下是执行结果：

\`\`\`
${RESULT}
\`\`\`"
else
  OUTPUT="你发的上一条命令没有被自动执行，我手动运行后出错了：

\`\`\`
${RESULT}
\`\`\`"
fi

# 复制到剪贴板
printf "%s" "$OUTPUT" | pbcopy

# 发送通知
osascript -e 'display notification "结果已复制到剪贴板，可直接粘贴回对话" with title "Ω Run Omega"'
