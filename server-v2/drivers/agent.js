// Agent Factory Driver - 从 Supabase 读 agent 场景，通过浏览器 ask_proxy 执行
import { readFileSync } from 'fs';

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_KEY;

function hdrs(extra) {
  return Object.assign({
    'apikey': SB_KEY,
    'Authorization': 'Bearer ' + SB_KEY,
    'Content-Type': 'application/json'
  }, extra || {});
}

async function getAgent(name) {
  const res = await fetch(
    SB_URL + '/rest/v1/agent_memory?type=eq.agent&name=eq.' + encodeURIComponent(name) + '&limit=1',
    { headers: hdrs() }
  );
  const rows = await res.json();
  if (!rows.length) return null;
  return JSON.parse(rows[0].content);
}

async function listAgents() {
  const res = await fetch(
    SB_URL + '/rest/v1/agent_memory?type=eq.agent&select=id,name,content,created_at,updated_at&order=created_at.desc',
    { headers: hdrs() }
  );
  const rows = await res.json();
  return rows.map(function(r) {
    var meta = {};
    try { meta = JSON.parse(r.content); } catch(e) {}
    return {
      id: r.id, name: r.name,
      description: meta.description || '',
      model: meta.model || 'gpt-5-4',
      version: meta.version || 1,
      capabilities: meta.capabilities || [],
      created_at: r.created_at
    };
  });
}

async function saveAgent(name, agentData) {
  const res = await fetch(SB_URL + '/rest/v1/agent_memory', {
    method: 'POST',
    headers: hdrs({ 'Prefer': 'return=representation' }),
    body: JSON.stringify({ type: 'agent', scene: 'factory', name: name, content: JSON.stringify(agentData) })
  });
  return await res.json();
}

async function deleteAgent(name) {
  const res = await fetch(
    SB_URL + '/rest/v1/agent_memory?type=eq.agent&name=eq.' + encodeURIComponent(name),
    { method: 'DELETE', headers: hdrs() }
  );
  return { ok: res.ok, status: res.status };
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
    'xhr.withCredentials=true;xhr.timeout=120000;' +
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
  tools: ['agent_run', 'agent_list', 'agent_save', 'agent_delete', 'agent_generate'],
  
  async handle(tool, params, context) {
  if (!SB_URL) return { ok: false, error: 'SUPABASE_URL not set' };

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
      return await context.browserTool('eval_js', { code: browserCode });
    }
    return { ok: true, mode: 'messages-only', messages: msgs, model: model };
  }

  if (tool === 'agent_generate') {
    var evolveScene;
    try {
      evolveScene = JSON.parse(readFileSync('/Users/yay/workspace/forged-benchmark/evolve-forged-v7.json', 'utf8'));
    } catch(e) {
      return { ok: false, error: 'Cannot read evolve forged: ' + e.message };
    }
    var evolveMsgs = JSON.parse(JSON.stringify(evolveScene));
    for (var j = evolveMsgs.length - 1; j >= 0; j--) {
      if (evolveMsgs[j].role === 'user') {
        evolveMsgs[j].content = evolveMsgs[j].content
          .replace('${GOAL}', params.goal || '')
          .replace('${CAPABILITIES}', params.capabilities || '')
          .replace('${PITFALLS}', params.pitfalls || '');
        break;
      }
    }
    var genCode = buildBrowserExecCode(evolveMsgs, params.model || 'gpt-5-4', 0.3);
    if (context.browserTool) {
      return await context.browserTool('eval_js', { code: genCode });
    }
    return { ok: true, mode: 'messages-only', messages: evolveMsgs };
  }

  return { ok: false, error: 'Unknown tool: ' + tool };
  }
};

export default agent;
