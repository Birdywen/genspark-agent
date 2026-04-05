  // ============== 初始化 ==============

  window.__gizAgentLoadState = { loadTime: Date.now(), marked: false };

  // 超时唤醒监控
  let lastAiMessageTime = Date.now();
  const WAKEUP_TIMEOUT = 120000; // 2分钟无响应则唤醒
  const WAKEUP_CHECK_INTERVAL = 20000;

  setInterval(() => {
    if (!state.agentRunning) { lastAiMessageTime = Date.now(); return; }
    const elapsed = Date.now() - lastAiMessageTime;
    if (elapsed > WAKEUP_TIMEOUT) {
      addLog('⏰ AI 超过 ' + Math.round(elapsed/1000) + 's 无响应，发送唤醒', 'warning');
      sendMessageSafe('继续');
      lastAiMessageTime = Date.now();
    }
  }, WAKEUP_CHECK_INTERVAL);

  // 更新最后 AI 消息时间
  document.addEventListener('__giz_message__', () => { lastAiMessageTime = Date.now(); });

  // 请求工具列表
  function requestTools() {
    chrome.runtime.sendMessage({ type: 'SEND_TO_SERVER', payload: { type: 'get_tools' } }, resp => {
      if (resp?.success) addLog('🔧 已请求工具列表', 'info');
    });
  }

  function init() {
    const setup = () => {
      setTimeout(() => {
        createInfoPanel();
        updateStatus();
        addLog('🚀 Giz Agent Bridge 已启动 v2.0', 'success');
        addLog('📡 等待 WebSocket 连接...', 'info');
        // 检查 background 连接状态
        chrome.runtime.sendMessage({ type: 'GET_STATUS' }, resp => {
          if (resp?.connected) {
            state.wsConnected = true;
            updateStatus();
            addLog('✅ Agent Server 已连接', 'success');
            requestTools();
          }
        });
      }, 1000);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
    else setup();
  }

  init();
