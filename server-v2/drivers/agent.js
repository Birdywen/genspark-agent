// Agent Factory Driver - 从 agent.db (SQLite) 读 agent 场景，通过浏览器 ask_proxy 执行
import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename2 = fileURLToPath(import.meta.url);
const __dirname2 = dirname(__filename2);
const DBFILE = join(__dirname2, '..', 'dbfile.cjs');

function dbQuery(sql) {
  try {
    const result = execSync(`node ${DBFILE} query "${sql.replace(/"/g, '\"')}"`, {
      cwd: join(__dirname2, '..'),
      encoding: 'utf8',
      timeout: 10000
    }).trim();
    return result ? JSON.parse(result) : [];
  } catch(e) {
    return [];
  }
}

function dbRun(action, slot, key, value) {
  try {
    const args = value !== undefined
      ? `${action} local_store ${slot} ${key}`
      : `${action} local_store ${slot} ${key}`;
    if (action === 'set' && value !== undefined) {
      const escaped = value.replace(/"/g, '\"');
      execSync(`node ${DBFILE} set local_store ${slot} ${key} "${escaped}"`, {
        cwd: join(__dirname2, '..'),
        encoding: 'utf8',
        timeout: 10000
      });
      return true;
    }
    if (action === 'get') {
      return execSync(`node ${DBFILE} get local_store ${slot} ${key}`, {
        cwd: join(__dirname2, '..'),
        encoding: 'utf8',
        timeout: 10000
      }).trim();
    }
    return null;
  } catch(e) {
    return null;
  }
}

async function getAgent(name) {
  const rows = dbQuery("SELECT content FROM local_store WHERE slot='agent' AND key='" + name.replace(/'/g, "''") + "'");
  if (!rows.length) return null;
  try { return JSON.parse(rows[0].content); } catch(e) { return null; }
}

async function listAgents() {
  const rows = dbQuery("SELECT key, content, updated_at FROM local_store WHERE slot='agent' ORDER BY updated_at DESC");
  return rows.map(function(r) {
    var meta = {};
    try { meta = JSON.parse(r.content); } catch(e) {}
    return {
      name: r.key,
      description: meta.description || '',
      model: meta.model || 'claude-opus-4-6',
      version: meta.version || 1,
      capabilities: meta.capabilities || [],
      updated_at: r.updated_at
    };
  });
}

async function saveAgent(name, agentData) {
  const content = JSON.stringify(agentData);
  // Use dbfile.cjs set which handles upsert
  const rows = dbQuery("SELECT key FROM local_store WHERE slot='agent' AND key='" + name.replace(/'/g, "''") + "'");
  if (rows.length) {
    dbQuery("UPDATE local_store SET content='" + content.replace(/'/g, "''") + "', updated_at=datetime('now') WHERE slot='agent' AND key='" + name.replace(/'/g, "''") + "'");
  } else {
    dbQuery("INSERT INTO local_store(slot,key,content,updated_at) VALUES('agent','" + name.replace(/'/g, "''") + "','" + content.replace(/'/g, "''") + "',datetime('now'))");
  }
  return { ok: true, name: name, size: content.length };
}

async function deleteAgent(name) {
  dbQuery("DELETE FROM local_store WHERE slot='agent' AND key='" + name.replace(/'/g, "''") + "'");
  return { ok: true, deleted: name };
}

function buildMessages(agent, task, vars) {
  var msgs = JSON.parse(JSON.stringify(agent.messages));
  for (var i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'user') {
      var content = msgs[i].content;
      content = content.replace(/\{\{INPUT\}\}/g, task || '');
      content = content.replace(/\{\{TASK\}\}/g, task || '');
      content = content.replace(/\$\{TASK\}/g, task || '');
      if (vars) {
        for (var key in vars) {
          content = content.replace(new RegExp('\\{\\{' + key + '\\}\\}', 'g'), vars[key]);
          content = content.replace(new RegExp('\\$\\{' + key + '\\}', 'g'), vars[key]);
        }
      }
      msgs[i].content = content;
      break;
    }
  }
  return msgs;
}

function buildBrowserExecCode(messages, model, temperature) {
  var msgsJSON = JSON.stringify(messages);
  return 'return (function(){' +
    'var PROJECT_ID="1876348b-72a6-405c-823d-29ffc5be35b2";' +
    'var msgs=' + msgsJSON + ';' +
    'var formatted=msgs.map(function(m){return{role:m.role,id:Math.random().toString(36).slice(2),content:m.content}});' +
    'var lastUser="";for(var i=msgs.length-1;i>=0;i--)if(msgs[i].role==="user"){lastUser=msgs[i].content;break}' +
    'return new Promise(function(resolve,reject){' +
    'var xhr=new XMLHttpRequest();' +
    'xhr.open("POST","/api/agent/ask_proxy",true);' +
    'xhr.setRequestHeader("Content-Type","application/json");' +
    'xhr.withCredentials=true;xhr.timeout=300000;' +
    'xhr.onload=function(){' +
    'var c="";xhr.responseText.split("\\n").forEach(function(l){' +
    'if(l.indexOf("data: ")===0&&l.indexOf("[DONE]")===-1){try{var d=JSON.parse(l.slice(6));' +
    'if(d.type==="message_field_delta"&&d.field_name==="content")c+=d.delta}catch(e){}}});' +
    'resolve(c)};' +
    'xhr.onerror=function(){reject("XHR error")};' +
    'xhr.ontimeout=function(){reject("timeout")};' +
    'xhr.send(JSON.stringify({' +
    'ai_chat_model:"' + model + '",' +
    'ai_chat_enable_search:false,ai_chat_disable_personalization:true,' +
    'use_moa_proxy:false,moa_models:[],type:"ai_chat",' +
    'project_id:PROJECT_ID,messages:formatted,' +
    'user_s_input:lastUser,is_private:true,push_token:"",' +
    'temperature:' + (temperature || 0.3) +
    '}))})})()';
}

const agent = {
  name: 'agent',
  tools: ['agent_run', 'agent_pipeline', 'agent_list', 'agent_save', 'agent_delete', 'agent_generate'],
  
  async handle(tool, params, context) {

  if (tool === 'agent_list') {
    return { ok: true, agents: await listAgents() };
  }

  if (tool === 'agent_delete') {
    return await deleteAgent(params.name);
  }

  if (tool === 'agent_save') {
    return { ok: true, result: await saveAgent(params.name, JSON.parse(params.data)) };
  }

if (tool === 'agent_run') {
    var agent = await getAgent(params.name);
    if (!agent) return { ok: false, error: 'Agent not found: ' + params.name };
    var model = params.model || agent.model || 'gpt-5-4';
    if (!agent.messages && agent.system_prompt) {
      agent.messages = [
        { role: 'system', content: agent.system_prompt },
        { role: 'user', content: '{{TASK}}' }
      ];
    }
    var msgs = buildMessages(agent, params.task, params.vars ? JSON.parse(params.vars) : null);
    var browserCode = buildBrowserExecCode(msgs, model, params.temperature || 0.3);
    if (context.browserTool) {
      var result = await context.browserTool('eval_js', { code: browserCode }, 300000);
      // saveTo: 从结果中提取代码块并保存到文件（支持 cjs/js/html/任意语言）
      if (params.saveTo && result && result.ok !== false) {
        var rawContent = typeof result === "string" ? result : (result.result || result.data || "");
        var extracted = null;
        // 1. 提取最后一个代码块（agent 可能输出多段自言自语+多个代码块）
        var allCodeBlocks = [];
        var codeRe = /```(?:cjs|js|javascript|python|html|swift|sh|bash|json)?\s*\n([\s\S]*?)\n```/g;
        var m;
        while ((m = codeRe.exec(rawContent)) !== null) allCodeBlocks.push(m[1].trim());
        if (allCodeBlocks.length > 0) {
          // 取最长的代码块（通常是最完整的那个）
          extracted = allCodeBlocks.sort((a,b) => b.length - a.length)[0];
        }
        // 2. 如果没有代码块，尝试 HTML
        if (!extracted) {
          var dtMatch = rawContent.match(/<!DOCTYPE[\s\S]*<\/html>/i);
          if (dtMatch) extracted = dtMatch[0].trim();
        }
        // 3. 如果还没有，找第一行代码开头
        if (!extracted) {
          var rLines = rawContent.split("\n");
          var codeStart = rLines.findIndex(function(l) { return /^(const |var |let |import |require|#!|'use strict')/.test(l.trim()); });
          if (codeStart >= 0) extracted = rLines.slice(codeStart).join("\n");
          else extracted = rawContent;
        }
        if (extracted) {
          const { writeFileSync } = require("fs");
          var savePath = params.saveTo;
          if (!savePath.startsWith("/")) savePath = "/Users/yay/workspace/" + savePath;
          // 不强制加 .html，保留用户指定的扩展名
          writeFileSync(savePath, extracted, "utf8");
          result = { ok: true, savedTo: savePath, savedBytes: extracted.length };
        }
      }
        if (html && html.indexOf('<') > -1) {
          const { writeFileSync } = await import('fs');
          var savePath = params.saveTo;
          if (!savePath.startsWith('/')) savePath = '/Users/yay/workspace/' + savePath;
          if (!savePath.endsWith('.html')) savePath += '.html';
          writeFileSync(savePath, html, 'utf8');
          result = { ok: true, savedTo: savePath, savedBytes: html.length };
        }
      }
      return result;
    }
    return { ok: true, mode: 'messages-only', messages: msgs, model: model };
  }

    if (tool === 'agent_pipeline') {
      // 两步 pipeline: planner -> builder
      var plannerName = params.planner || 'opus-planner';
      var builderName = params.builder || 'web-designer-v8';
      var planModel = params.planModel || 'claude-opus-4-6';
      var buildModel = params.model || 'deepseek-v3';
      var task = params.task;
      if (!task) return { ok: false, error: 'task is required' };

      // Step 1: Plan
      var planner = await getAgent(plannerName);
      if (!planner) return { ok: false, error: 'Planner not found: ' + plannerName };
      var planMsgs = planner.messages.map(function(m) {
        return { role: m.role, content: m.content.replace('${TASK}', task).replace('{{TASK}}', task) };
      });
      // Step 1a: 写 plan messages 到 VFS
      var pipeId = 'pipe-' + Date.now();
      await context.browserTool('eval_js', {
        code: "return vfs.writeMsg('toolkit','" + pipeId + "-plan-msgs'," + JSON.stringify(JSON.stringify(planMsgs)) + ").then(function(){return 'ok';})"
      });
      // Step 1b: 从 VFS 读 plan messages 并调 AI
      var planResult = await context.browserTool('eval_js', {
        code: "return vfs.readMsg('toolkit','" + pipeId + "-plan-msgs').then(function(r){return __tk.askProxy(JSON.parse(r),'" + planModel + "').then(function(plan){return vfs.writeMsg('toolkit','" + pipeId + "-plan',plan).then(function(){return 'plan:'+plan.length;});});})"
      });
      var planLen = typeof planResult === 'string' ? planResult : (planResult.result || '');
      if (!planLen || !planLen.startsWith('plan:')) return { ok: false, error: 'Plan generation failed', raw: planLen };

      // Step 2: Build
      var builder = await getAgent(builderName);
      if (!builder) return { ok: false, error: 'Builder not found: ' + builderName };
      // Step 2a: 构建 build messages，plan 从 VFS 读取
      var builderMsgsTemplate = JSON.stringify(builder.messages);
      await context.browserTool('eval_js', {
        code: "return vfs.readMsg('toolkit','" + pipeId + "-plan').then(function(plan){var tmpl=" + JSON.stringify(builderMsgsTemplate) + ";var msgs=JSON.parse(tmpl).map(function(m){var t=plan+'\\n\\nIMPORTANT: Output ONLY the complete HTML code starting with <!DOCTYPE html>. No explanations, no markdown fences.';return{role:m.role,content:m.content.replace('${TASK}',t).replace('{{TASK}}',t)};});return vfs.writeMsg('toolkit','" + pipeId + "-build-msgs',JSON.stringify(msgs)).then(function(){return 'ok';});})"
      });
      // Step 2b: 从 VFS 读 build messages 并调 AI
      var buildResult = await context.browserTool('eval_js', {
        code: "return vfs.readMsg('toolkit','" + pipeId + "-build-msgs').then(function(r){return __tk.askProxy(JSON.parse(r),'" + buildModel + "').then(function(html){return vfs.writeMsg('toolkit','" + pipeId + "-html',html).then(function(){return 'html:'+html.length;});});})"
      });
      var buildLen = typeof buildResult === 'string' ? buildResult : (buildResult.result || '');
      if (!buildLen || !buildLen.startsWith('html:')) return { ok: false, error: 'Build failed', raw: buildLen };
      // Step 2c: 读取最终 HTML
      var htmlResult = await context.browserTool('eval_js', {
        code: "return vfs.readMsg('toolkit','" + pipeId + "-html')"
      });
      var html = typeof htmlResult === 'string' ? htmlResult : (htmlResult.result || htmlResult.data || '');

      // Extract HTML
      var htmlMatch = html.match(/```html\s*\n?([\s\S]*?)```/);
      var cleanHtml = htmlMatch ? htmlMatch[1].trim() : null;
      if (!cleanHtml) {
        var dtMatch = html.match(/<!DOCTYPE[\s\S]*<\/html>/i);
        cleanHtml = dtMatch ? dtMatch[0].trim() : html;
      }

      // Save
      if (params.saveTo && cleanHtml && cleanHtml.indexOf('<') > -1) {
        const { writeFileSync } = await import('fs');
        var savePath = params.saveTo;
        if (!savePath.startsWith('/')) savePath = '/Users/yay/workspace/' + savePath;
        if (!savePath.endsWith('.html')) savePath += '.html';
        writeFileSync(savePath, cleanHtml, 'utf8');
        return { ok: true, savedTo: savePath, savedBytes: cleanHtml.length, planLength: plan.length };
      }
      return { ok: true, plan: plan.substring(0, 500) + '...', htmlLength: cleanHtml.length };
    }

        if (tool === 'agent_generate') {
    // Helper: resolve param value - if starts with @file: read file content
    function resolveParam(val) {
      if (!val) return '';
      if (val.startsWith('@file:')) {
        try { return readFileSync(val.slice(6).trim(), 'utf8').trim(); }
        catch(e) { return '[FILE_ERROR: ' + e.message + ']'; }
      }
      return val;
    }
    // Support spec file: single JSON with {goal, capabilities, pitfalls, model, name}
    var spec = params;
    if (params.spec) {
      try {
        var specContent = params.spec.startsWith('@file:') 
          ? readFileSync(params.spec.slice(6).trim(), 'utf8') 
          : params.spec;
        spec = Object.assign({}, params, JSON.parse(specContent));
      } catch(e) {
        return { ok: false, error: 'Cannot parse spec: ' + e.message };
      }
    }
    var goal = resolveParam(spec.goal);
    var capabilities = resolveParam(spec.capabilities);
    var pitfalls = resolveParam(spec.pitfalls);
    var evolveScene;
    try {
      evolveScene = JSON.parse(readFileSync('/Users/yay/workspace/forged-benchmark/evolve-forged-v9.json', 'utf8'));
    } catch(e) {
      return { ok: false, error: 'Cannot read evolve forged: ' + e.message };
    }
    var evolveMsgs = JSON.parse(JSON.stringify(evolveScene));
    for (var j = evolveMsgs.length - 1; j >= 0; j--) {
      if (evolveMsgs[j].role === 'user') {
        evolveMsgs[j].content = evolveMsgs[j].content
          .replace('${GOAL}', goal)
          .replace('${CAPABILITIES}', capabilities)
          .replace('${PITFALLS}', pitfalls);
        break;
      }
    }
    var genCode = buildBrowserExecCode(evolveMsgs, params.model || 'gpt-5-4', 0.3);
    if (context.browserTool) {
      return await context.browserTool('eval_js', { code: genCode }, 300000);
    }
    return { ok: true, mode: 'messages-only', messages: evolveMsgs };
  }

  return { ok: false, error: 'Unknown tool: ' + tool };
  }
};

export default agent;
