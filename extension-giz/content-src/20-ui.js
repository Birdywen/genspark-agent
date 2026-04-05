  // ============== UI 面板 ==============

  function createInfoPanel() {
    if (document.getElementById('giz-agent-panel')) return;
    const panel = document.createElement('div');
    panel.id = 'giz-agent-panel';
    panel.innerHTML = `
      <div id="giz-panel-header">
        <span id="giz-panel-title">⚡ Giz Agent Bridge</span>
        <div style="display:flex;gap:6px;align-items:center">
          <span id="giz-agent-round" style="font-size:10px;color:#888">Round: 0</span>
          <button id="giz-panel-clear" title="Clear logs" style="background:transparent;border:none;color:#888;cursor:pointer;font-size:12px;padding:0 4px;">🗑</button>
          <button id="giz-panel-minimize">_</button>
        </div>
      </div>
      <div id="giz-panel-body">
        <div id="giz-status-bar">
          <span id="giz-server-status">Server: ❌</span>
          <span id="giz-ws-hook-status">WS-Hook: ❌</span>
          <span id="giz-agent-status">Agent: ⏸</span>
        </div>
        <div id="giz-stats-bar">
          <span id="giz-call-count">Calls: 0</span>
          <span id="giz-pending-count">Pending: 0</span>
          <span id="giz-tools-count">Tools: 0</span>
        </div>
        <div id="giz-executing" style="display:none;padding:4px 8px;background:#1a2a1a;border-radius:4px;margin-bottom:6px;font-size:11px;color:#4ade80">
          ⚡ Executing: <span id="giz-exec-tool"></span> <span id="giz-exec-time" style="color:#888">0s</span>
        </div>
        <div id="giz-log-container"></div>
      </div>`;
    document.body.appendChild(panel);

    // minimize
    const minBtn = document.getElementById('giz-panel-minimize');
    const body = document.getElementById('giz-panel-body');
    minBtn.onclick = () => { body.classList.toggle('collapsed'); minBtn.textContent = body.classList.contains('collapsed') ? '□' : '_'; };

    // clear logs
    document.getElementById('giz-panel-clear').onclick = () => {
      const c = document.getElementById('giz-log-container'); if (c) c.innerHTML = '';
    };

    // drag
    let ox, oy, dragging = false;
    const hdr = document.getElementById('giz-panel-header');
    hdr.addEventListener('mousedown', e => { dragging = true; ox = e.clientX - panel.offsetLeft; oy = e.clientY - panel.offsetTop; });
    document.addEventListener('mousemove', e => { if (!dragging) return; panel.style.left = (e.clientX-ox)+'px'; panel.style.top = (e.clientY-oy)+'px'; panel.style.right='auto'; panel.style.bottom='auto'; });
    document.addEventListener('mouseup', () => { dragging = false; });
  }

  function addLog(message, type = 'info') {
    const container = document.getElementById('giz-log-container');
    if (!container) return;
    const entry = document.createElement('div');
    entry.className = 'giz-log-entry ' + type;
    entry.innerHTML = '<div class="giz-log-time">' + new Date().toLocaleTimeString() + '</div><div class="giz-log-msg">' + message + '</div>';
    container.insertBefore(entry, container.firstChild);
    while (container.children.length > CONFIG.MAX_LOGS) container.removeChild(container.lastChild);
  }

  function updateStatus() {
    const el = id => document.getElementById(id);
    if (el('giz-server-status')) el('giz-server-status').textContent = 'Server: ' + (state.wsConnected ? '✅' : '❌');
    if (el('giz-ws-hook-status')) el('giz-ws-hook-status').textContent = 'WS-Hook: ' + (state.wsHookActive ? '✅' : '❌');
    if (el('giz-agent-status')) el('giz-agent-status').textContent = 'Agent: ' + (state.agentRunning ? '🔄' : '⏸');
    if (el('giz-call-count')) el('giz-call-count').textContent = 'Calls: ' + state.totalCalls;
    if (el('giz-pending-count')) el('giz-pending-count').textContent = 'Pending: ' + state.pendingCalls.size;
    if (el('giz-tools-count')) el('giz-tools-count').textContent = 'Tools: ' + state.availableTools.length;
    if (el('giz-agent-round')) el('giz-agent-round').textContent = 'Round: ' + state.roundCount;
  }

  let execTimer = null;
  function showExecutingIndicator(toolName) {
    const el = document.getElementById('giz-executing');
    const tn = document.getElementById('giz-exec-tool');
    const tt = document.getElementById('giz-exec-time');
    if (el) el.style.display = 'block';
    if (tn) tn.textContent = toolName || '...';
    const start = Date.now();
    if (execTimer) clearInterval(execTimer);
    execTimer = setInterval(() => { if (tt) tt.textContent = ((Date.now()-start)/1000).toFixed(1)+'s'; }, 100);
  }
  function hideExecutingIndicator() {
    const el = document.getElementById('giz-executing');
    if (el) el.style.display = 'none';
    if (execTimer) { clearInterval(execTimer); execTimer = null; }
  }
