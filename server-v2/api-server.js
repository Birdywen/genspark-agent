// Genspark Agent API Server
// 独立的 HTTP API 入口，通过 LLM API + MCP 工具实现 Agent Loop
// 支持 OpenAI 兼容格式 (DeepSeek, GPT, etc) 和 Anthropic 格式
// 用法: node api-server.js
// API: POST /v1/agent  { "prompt": false }

import { createServer } from "http";
import { spawn } from "child_process";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- 配置 ---

const API_PORT = parseInt(process.env.API_PORT || "8780");
const LLM_API_KEY = process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
const LLM_BASE_URL = process.env.LLM_BASE_URL || "https://api.deepseek.com/v1";
const LLM_MODEL = process.env.LLM_MODEL || "deepseek-chat";
const LLM_FORMAT = process.env.LLM_FORMAT || "openai"; // "openai" or "anthropic"
const MAX_TOOL_ROUNDS = parseInt(process.env.MAX_TOOL_ROUNDS || "30");

if (!LLM_API_KEY) {
  console.error("[API] LLM_API_KEY 环境变量未设置 (也可用 DEEPSEEK_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY)");
  process.exit(1);
}

function expandEnvVars(obj) {
  if (typeof obj === "string") return obj.replace(/\$\{([^}]+)\}/g, (_, name) => process.env[name] || "");
  if (Array.isArray(obj)) return obj.map(expandEnvVars);
  if (obj && typeof obj === "object") {
    const result = {};
    for (const [k, v] of Object.entries(obj)) result[k] = expandEnvVars(v);
    return result;
  }
  return obj;
}

const config = expandEnvVars(JSON.parse(readFileSync(path.join(__dirname, "config.json"), "utf-8")));

// --- 日志 ---

function log(level) {
  var args = Array.prototype.slice.call(arguments, 1);
  var ts = new Date().toISOString().slice(11, 19);
  var prefixes = { info: "\x1b[36mINFO\x1b[0m", ok: "\x1b[32m OK \x1b[0m", warn: "\x1b[33mWARN\x1b[0m", err: "\x1b[31m ERR\x1b[0m" };
  console.log("[" + ts + "] [" + (prefixes[level] || level) + "]", ...args);
}

// --- MCP 客户端 ---

class MCPClient {
  constructor(name, cmd, args, env, opts) {
    this.name = name;
    this.cmd = cmd;
    this.args = args || [];
    this.env = env || {};
    this.startupTimeout = (opts && opts.startupTimeout) || 5000;
    this.requestTimeout = (opts && opts.requestTimeout) || 60000;
    this.process = null;
    this.requestId = 0;
    this.pending = new Map();
    this.buffer = "";
    this.tools = [];
  }

  async start() {
    log("info", "[" + this.name + "] 启动中...");
    this.process = spawn(this.cmd, this.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: Object.assign({}, process.env, this.env)
    });
    this.process.stdout.on("data", (d) => this._onData(d));
    this.process.stderr.on("data", (d) => {
      var msg = d.toString().trim();
      if (msg) log("warn", "[" + this.name + "] stderr: " + msg);
    });
    this.process.on("error", (e) => log("err", "[" + this.name + "] error: " + e.message));
    this.process.on("close", (code) => log("info", "[" + this.name + "] 退出 code=" + code));

    await new Promise((r) => setTimeout(r, this.startupTimeout));
    if (this.process.exitCode !== null) {
      throw new Error("[" + this.name + "] 进程已退出 code=" + this.process.exitCode);
    }

    await this._send("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "genspark-api", version: "1.0" }
    });
    this.process.stdin.write(JSON.stringify({jsonrpc:"2.0",method:"notifications/initialized"}) + "\n");

    var r = await this._send("tools/list");
    var needsPrefix = this.name.startsWith("ssh");
    var self = this;
    this.tools = (r.tools || []).map(function(t) {
      return Object.assign({}, t, {
        name: needsPrefix ? self.name + ":" + t.name : t.name,
        _originalName: t.name,
        _server: self.name
      });
    });
    log("ok", "[" + this.name + "] 就绪, " + this.tools.length + " 个工具");
  }

  _onData(data) {
    this.buffer += data.toString();
    var lines = this.buffer.split("\n");
    this.buffer = lines.pop();
    for (var i = 0; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      try {
        var msg = JSON.parse(lines[i]);
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          var p = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
        }
      } catch(e) {}
    }
  }

  _send(method, params, opts) {
    var id = ++this.requestId;
    var timeout = (opts && opts.timeout) || this.requestTimeout;
    var self = this;
    return new Promise(function(resolve, reject) {
      self.pending.set(id, { resolve: resolve, reject: reject });
      self.process.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: id, method: method, params: params || {} }) + "\n");
      setTimeout(function() {
        if (self.pending.has(id)) {
          self.pending.delete(id);
          reject(new Error("[" + self.name + "] timeout (" + timeout + "ms)"));
        }
      }, timeout);
    });
  }

  async call(toolName, args, opts) {
    var originalName = toolName.includes(":") ? toolName.split(":")[1] : toolName;
    return this._send("tools/call", { name: originalName, arguments: args || {} }, opts);
  }

  stop() {
    try { if (this.process) this.process.kill(); } catch(e) {}
  }
}

// --- MCP Hub ---

class MCPHub {
  constructor() {
    this.clients = new Map();
    this.tools = [];
  }

  async start() {
    var servers = config.mcpServers || {};
    for (var entry of Object.entries(servers)) {
      var name = entry[0], cfg = entry[1];
      var client = new MCPClient(name, cfg.command, cfg.args || [], cfg.env || {}, {
        startupTimeout: cfg.startupTimeout || 5000,
        requestTimeout: cfg.requestTimeout || 60000
      });
      try {
        await client.start();
        this.clients.set(name, client);
        this.tools.push.apply(this.tools, client.tools);
      } catch (e) {
        log("err", "[" + name + "] 启动失败: " + e.message);
      }
    }
    log("ok", "MCP Hub 就绪, 共 " + this.tools.length + " 个工具");
  }

  findClient(toolName) {
    for (var entry of this.clients) {
      var c = entry[1];
      if (c.tools.some(function(t) { return t.name === toolName; })) return c;
    }
    return null;
  }

  async call(toolName, args, opts) {
    var client = this.findClient(toolName);
    if (!client) throw new Error("工具未找到: " + toolName);
    return client.call(toolName, args, opts);
  }

  // OpenAI 兼容格式的 tools
  toOpenAITools() {
    return this.tools.map(function(t) {
      return {
        type: "function",
        function: {
          name: t.name.replace(/:/g, "__"),
          description: t.description || "",
          parameters: t.inputSchema || { type: "object", properties: {} }
        }
      };
    });
  }

  // Anthropic 格式的 tools
  toAnthropicTools() {
    return this.tools.map(function(t) {
      return {
        name: t.name,
        description: t.description || "",
        input_schema: t.inputSchema || { type: "object", properties: {} }
      };
    });
  }

  stop() {
    for (var entry of this.clients) entry[1].stop();
  }
}

// --- LLM API 调用 ---

async function callLLM(messages, tools, systemPrompt) {
  if (LLM_FORMAT === "anthropic") {
    return callAnthropic(messages, tools, systemPrompt);
  }
  return callOpenAI(messages, tools, systemPrompt);
}

async function callOpenAI(messages, tools, systemPrompt) {
  var msgs = [];
  if (systemPrompt) msgs.push({ role: "system", content: systemPrompt });
  msgs.push.apply(msgs, messages);

  var body = {
    model: LLM_MODEL,
    max_tokens: 8192,
    messages: msgs,
    tools: tools,
    tool_choice: "auto"
  };

  var resp = await fetch(LLM_BASE_URL + "/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + LLM_API_KEY
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    var text = await resp.text();
    throw new Error("LLM API " + resp.status + ": " + text);
  }

  return resp.json();
}

async function callAnthropic(messages, tools, systemPrompt) {
  var body = {
    model: LLM_MODEL,
    max_tokens: 8192,
    system: systemPrompt || "You are a helpful assistant.",
    messages: messages,
    tools: tools
  };

  var resp = await fetch(LLM_BASE_URL + "/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": LLM_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    var text = await resp.text();
    throw new Error("Anthropic API " + resp.status + ": " + text);
  }

  return resp.json();
}

// --- Agent Loop ---

async function agentLoop(hub, prompt, options) {
  options = options || {};
  var system = options.system || "You are a helpful assistant with access to local system tools. Use them to help the user. Be concise and always use tools when the task requires accessing files, running commands, or interacting with the system.";
  var maxRounds = options.maxRounds || MAX_TOOL_ROUNDS;
  var onEvent = options.onEvent || null;
  var isOpenAI = LLM_FORMAT !== "anthropic";

  var allTools = isOpenAI ? hub.toOpenAITools() : hub.toAnthropicTools();
  var toolFilter = options.toolFilter;
  var tools = toolFilter ? allTools.filter(function(t) { var n = isOpenAI ? t.function.name : t.name; return toolFilter.indexOf(n) >= 0; }) : allTools;
  var messages = [{ role: "user", content: prompt }];
  var toolLog = [];

  function emit(event) { if (onEvent) onEvent(event); }
  emit({ type: "start", prompt: prompt, toolCount: tools.length, model: LLM_MODEL });

  for (var round = 0; round < maxRounds; round++) {
    emit({ type: "round", round: round + 1 });
    log("info", "[Agent] Round " + (round + 1) + "/" + maxRounds);

    var response;
    try {
      response = await callLLM(messages, tools, system);
    } catch (e) {
      log("err", "[Agent] LLM API 错误: " + e.message);
      emit({ type: "error", error: e.message });
      return { success: false, error: e.message, toolLog: toolLog };
    }

    if (isOpenAI) {
      // OpenAI 格式解析
      var choice = response.choices && response.choices[0];
      if (!choice) {
        return { success: false, error: "No choices in response", toolLog: toolLog };
      }

      var msg = choice.message;
      var finishReason = choice.finish_reason;

      if (msg.content) {
        emit({ type: "text", text: msg.content });
      }

      // 没有 tool_calls，返回最终结果
      if (finishReason !== "tool_calls" || !msg.tool_calls || msg.tool_calls.length === 0) {
        emit({ type: "done", text: msg.content || "" });
        log("ok", "[Agent] 完成, " + (round + 1) + " 轮, " + toolLog.length + " 次工具调用");
        return { success: true, text: msg.content || "", toolLog: toolLog, rounds: round + 1 };
      }

      // 有 tool_calls — 执行
      messages.push(msg); // 把 assistant 消息(含 tool_calls)加入历史

      for (var i = 0; i < msg.tool_calls.length; i++) {
        var tc = msg.tool_calls[i];
        var toolName = tc.function.name.replace(/__/g, ":");
        var toolArgs;
        try {
          toolArgs = JSON.parse(tc.function.arguments);
        } catch(e) {
          toolArgs = {};
        }

        log("info", "[Agent] 调用工具: " + toolName, JSON.stringify(toolArgs).substring(0, 200));
        emit({ type: "tool_call", name: toolName, input: toolArgs });

        try {
          var mcpResult = await hub.call(toolName, toolArgs);
          var text = (mcpResult.content || [])
            .filter(function(c) { return c.type === "text"; })
            .map(function(c) { return c.text; })
            .join("\n");
          messages.push({ role: "tool", tool_call_id: tc.id, content: text || "OK" });
          toolLog.push({ tool: toolName, input: toolArgs, output: text, success: true });
          emit({ type: "tool_result", name: toolName, output: text.substring(0, 500), success: true });
        } catch (e) {
          log("err", "[Agent] 工具错误: " + toolName + " - " + e.message);
          messages.push({ role: "tool", tool_call_id: tc.id, content: "Error: " + e.message });
          toolLog.push({ tool: toolName, input: toolArgs, error: e.message, success: false });
          emit({ type: "tool_result", name: toolName, error: e.message, success: false });
        }
      }

    } else {
      // Anthropic 格式解析
      var content = response.content;
      var stopReason = response.stop_reason;
      var textParts = [];
      var toolUses = [];

      for (var j = 0; j < content.length; j++) {
        if (content[j].type === "text") {
          textParts.push(content[j].text);
          emit({ type: "text", text: content[j].text });
        } else if (content[j].type === "tool_use") {
          toolUses.push(content[j]);
        }
      }

      if (stopReason === "end_turn" || toolUses.length === 0) {
        var finalText = textParts.join("\n");
        emit({ type: "done", text: finalText });
        log("ok", "[Agent] 完成, " + (round + 1) + " 轮, " + toolLog.length + " 次工具调用");
        return { success: true, text: finalText, toolLog: toolLog, rounds: round + 1 };
      }

      messages.push({ role: "assistant", content: content });
      var toolResults = [];

      for (var k = 0; k < toolUses.length; k++) {
        var tu = toolUses[k];
        log("info", "[Agent] 调用工具: " + tu.name, JSON.stringify(tu.input).substring(0, 200));
        emit({ type: "tool_call", name: tu.name, input: tu.input });

        try {
          var mcpRes = await hub.call(tu.name, tu.input);
          var txt = (mcpRes.content || [])
            .filter(function(c) { return c.type === "text"; })
            .map(function(c) { return c.text; })
            .join("\n");
          toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: txt || "OK" });
          toolLog.push({ tool: tu.name, input: tu.input, output: txt, success: true });
          emit({ type: "tool_result", name: tu.name, output: txt.substring(0, 500), success: true });
        } catch (e) {
          log("err", "[Agent] 工具错误: " + tu.name + " - " + e.message);
          toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: "Error: " + e.message, is_error: true });
          toolLog.push({ tool: tu.name, input: tu.input, error: e.message, success: false });
          emit({ type: "tool_result", name: tu.name, error: e.message, success: false });
        }
      }
      messages.push({ role: "user", content: toolResults });
    }
  }

  log("warn", "[Agent] 达到最大轮次 " + maxRounds);
  emit({ type: "max_rounds" });
  return { success: false, error: "达到最大工具调用轮次 (" + maxRounds + ")", toolLog: toolLog };
}

// --- HTTP 服务器 ---

var hub = null;

function parseBody(req) {
  return new Promise(function(resolve, reject) {
    var body = "";
    req.on("data", function(chunk) { body += chunk; });
    req.on("end", function() {
      try { resolve(JSON.parse(body)); }
      catch(e) { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

function sendJSON(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(data));
}

function sendSSE(res, event) {
  res.write("data: " + JSON.stringify(event) + "\n\n");
}

var server = createServer(async function(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    });
    return res.end();
  }

  if (req.method === "GET" && req.url === "/health") {
    return sendJSON(res, 200, {
      status: "ok",
      tools: hub ? hub.tools.length : 0,
      model: LLM_MODEL,
      format: LLM_FORMAT,
      maxRounds: MAX_TOOL_ROUNDS
    });
  }

  if (req.method === "GET" && req.url === "/tools") {
    if (!hub) return sendJSON(res, 503, { error: "Hub not ready" });
    var tools = hub.tools.map(function(t) { return { name: t.name, description: t.description || "", server: t._server }; });
    return sendJSON(res, 200, { count: tools.length, tools: tools });
  }

  if (req.method === "POST" && req.url === "/v1/agent") {
    if (!hub) return sendJSON(res, 503, { error: "Hub not ready" });
    var body;
    try { body = await parseBody(req); } catch(e) { return sendJSON(res, 400, { error: "Invalid JSON body" }); }

    var prompt = body.prompt;
    if (!prompt) return sendJSON(res, 400, { error: "Missing prompt field" });

    var opts = {
      system: body.system || undefined,
      maxRounds: body.max_rounds || MAX_TOOL_ROUNDS,
      toolFilter: body.tools || null
    };

    if (body.stream) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*"
      });
      opts.onEvent = function(event) { sendSSE(res, event); };
      try {
        var result = await agentLoop(hub, prompt, opts);
        sendSSE(res, Object.assign({ type: "final" }, result));
        res.write("data: [DONE]\n\n");
      } catch (e) {
        sendSSE(res, { type: "error", error: e.message });
      }
      return res.end();
    }

    try {
      var result = await agentLoop(hub, prompt, opts);
      return sendJSON(res, 200, result);
    } catch (e) {
      return sendJSON(res, 500, { error: e.message });
    }
  }

  if (req.method === "POST" && req.url === "/v1/tool") {
    if (!hub) return sendJSON(res, 503, { error: "Hub not ready" });
    var body;
    try { body = await parseBody(req); } catch(e) { return sendJSON(res, 400, { error: "Invalid JSON body" }); }
    if (!body.tool) return sendJSON(res, 400, { error: "Missing tool field" });
    try {
      var result = await hub.call(body.tool, body.params || {});
      return sendJSON(res, 200, { success: true, result: result });
    } catch (e) {
      return sendJSON(res, 500, { success: false, error: e.message });
    }
  }

  sendJSON(res, 404, { error: "Not found. Endpoints: GET /health, GET /tools, POST /v1/agent, POST /v1/tool" });
});

// --- 启动 ---

async function main() {
  console.log("");
  console.log("\x1b[36m" + String.fromCharCode(9556) + "══════════════════════════════════════════" + String.fromCharCode(9559) + "\x1b[0m");
  console.log("\x1b[36m" + String.fromCharCode(9553) + "   Genspark Agent API Server              " + String.fromCharCode(9553) + "\x1b[0m");
  console.log("\x1b[36m" + String.fromCharCode(9562) + "══════════════════════════════════════════" + String.fromCharCode(9565) + "\x1b[0m");
  console.log("");

  log("info", "Model: " + LLM_MODEL);
  log("info", "Format: " + LLM_FORMAT);
  log("info", "API Base: " + LLM_BASE_URL);
  log("info", "Max rounds: " + MAX_TOOL_ROUNDS);

  hub = new MCPHub();
  await hub.start();

  server.listen(API_PORT, "0.0.0.0", function() {
    log("ok", "API Server 监听: http://localhost:" + API_PORT);
    log("info", "端点:");
    log("info", "  GET  /health     - 健康检查");
    log("info", "  GET  /tools      - 列出所有工具");
    log("info", "  POST /v1/agent   - Agent Loop (prompt -> 自动调工具 -> 结果)");
    log("info", "  POST /v1/tool    - 直接调用单个工具");
    console.log("");
  });
}

process.on("SIGINT", function() { log("info", "收到 SIGINT, 退出..."); if(hub) hub.stop(); process.exit(0); });
process.on("SIGTERM", function() { log("info", "收到 SIGTERM, 退出..."); if(hub) hub.stop(); process.exit(0); });

main().catch(function(e) { log("err", "启动失败: " + e.message); process.exit(1); });
