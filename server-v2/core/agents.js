// core/agents.js — 跨扩展 Agent 注册与通信

const registeredAgents = new Map();
let _logger = null;

function init(logger) {
  _logger = logger;
}

function register(ws, agentId, site) {
  if (registeredAgents.has(agentId)) {
    const old = registeredAgents.get(agentId);
    if (old.ws !== ws) {
      _logger.info(`Agent ${agentId} 重新注册 (旧: ${old.site} -> 新: ${site})`);
    }
  }
  registeredAgents.set(agentId, { ws, site, lastSeen: Date.now() });
  _logger.info(`注册 Agent: ${agentId} @ ${site}, 当前总数: ${registeredAgents.size}`);
}

function unregister(ws) {
  for (const [agentId, info] of registeredAgents) {
    if (info.ws === ws) {
      registeredAgents.delete(agentId);
      _logger.info(`注销 Agent: ${agentId}`);
      return agentId;
    }
  }
  return null;
}

function sendMessage(fromAgent, toAgent, message) {
  const target = registeredAgents.get(toAgent);
  if (!target) {
    return { success: false, error: `Agent "${toAgent}" 不在线` };
  }
  try {
    target.ws.send(JSON.stringify({
      type: 'cross_extension_message',
      from: fromAgent,
      to: toAgent,
      message: message,
      timestamp: Date.now()
    }));
    _logger.info(`跨扩展消息: ${fromAgent} -> ${toAgent}`);
    return { success: true };
  } catch (e) {
    _logger.error(`发送跨扩展消息失败: ${e.message}`);
    return { success: false, error: e.message };
  }
}

function getOnline() {
  const agents = [];
  for (const [agentId, info] of registeredAgents) {
    agents.push({ agentId, site: info.site, lastSeen: info.lastSeen });
  }
  return agents;
}

export { init, register, unregister, sendMessage, getOnline };
export default { init, register, unregister, sendMessage, getOnline };
