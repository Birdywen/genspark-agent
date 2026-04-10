  // ============== UI ==============

  function createPanel() {
    if (document.getElementById('agent-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'agent-panel';
    panel.innerHTML = `
      <div id="agent-header">
        <span id="agent-title">🤖 Agent v34</span>
        <span id="agent-id" style="font-size:10px;color:#9ca3af;margin-left:4px"></span>
        <span id="agent-status">初始化</span>
        <span id="agent-round" title="点击重置轮次" style="cursor:pointer;font-size:10px;color:#9ca3af;margin-left:6px">R:0</span>
      </div>
      <div id="agent-executing"><span class="exec-spinner">⚙️</span><span class="exec-tool">工具名</span><span class="exec-time">0.0s</span></div>
      <div id="agent-tools"></div>
      <div id="agent-logs"></div>
      <div id="agent-actions">
        <button id="agent-copy-prompt" title="复制系统提示词给AI">📋 提示词</button>
        <button id="agent-clear" title="清除日志">🗑️</button>
        <button id="agent-terminal" title="迷你终端">⌨️ 终端</button>
        <button id="agent-reconnect" title="重连服务器">🔄</button>
        <button id="agent-switch-server" title="切换本地/云端">💻 本地</button>
        <button id="agent-reload-ext" title="重载扩展">♻️</button>
        <button id="agent-compress" title="上下文压缩：用预设总结替换当前对话">🗜️ 压缩</button>
        <button id="agent-minimize" title="最小化">➖</button>
      </div>
    `;
    
    document.body.appendChild(panel);

    const style = document.createElement('style');
    style.textContent = `
      #agent-panel {
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 300px;
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        border: 1px solid #0f3460;
        border-radius: 12px;
        padding: 12px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 12px;
        color: #e4e4e7;
        z-index: 2147483647;
        box-shadow: 0 8px 32px rgba(0,0,0,0.4);
        transition: all 0.3s ease;
      }
      #agent-panel.minimized {
        width: auto;
        padding: 8px 12px;
      }
      #agent-panel.minimized #agent-tools,
      #agent-panel.minimized #agent-logs,
      #agent-panel.minimized #agent-actions button:not(#agent-minimize) {
        display: none !important;
      }
      #agent-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
        padding-bottom: 8px;
        border-bottom: 1px solid #0f3460;
      }
      #agent-title { font-weight: 600; font-size: 13px; }
      #agent-status {
        padding: 3px 10px;
        border-radius: 12px;
        font-size: 11px;
        font-weight: 500;
        background: #6b7280;
        color: white;
      }
      #agent-status.connected { background: #10b981; }
      #agent-status.running { background: #f59e0b; animation: pulse 1.5s infinite; }
      #agent-status.disconnected { background: #ef4444; }
      @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
      #agent-executing { display: none; padding: 10px 12px; margin-bottom: 10px; background: linear-gradient(90deg, #1e3a5f 0%, #2d4a6f 50%, #1e3a5f 100%); background-size: 200% 100%; animation: shimmer 2s infinite linear; border-radius: 8px; font-size: 12px; color: #93c5fd; border: 1px solid #3b82f6; }
      #agent-executing.active { display: flex; align-items: center; gap: 8px; }
      #agent-executing .exec-spinner { animation: spin 1s linear infinite; font-size: 14px; }
      #agent-executing .exec-tool { flex: 1; font-weight: 600; color: #60a5fa; }
      #agent-executing .exec-time { font-family: monospace; color: #fbbf24; font-weight: 600; font-size: 13px; }
      @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
      @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
      #agent-tools {
        font-size: 11px;
        color: #9ca3af;
        margin-bottom: 8px;
        padding: 6px 8px;
        background: rgba(255,255,255,0.05);
        border-radius: 6px;
        display: none;
      }
      #agent-tools code {
        background: #3730a3;
        padding: 1px 4px;
        border-radius: 3px;
        margin: 0 2px;
        font-size: 10px;
      }
      #agent-logs {
        max-height: 180px;
        overflow-y: auto;
        margin-bottom: 10px;
        padding: 8px;
        background: rgba(0,0,0,0.3);
        border-radius: 8px;
      }
      .agent-log-entry {
        margin-bottom: 4px;
        padding: 4px 6px;
        border-radius: 4px;
        background: rgba(255,255,255,0.03);
        border-left: 3px solid;
        font-size: 11px;
        line-height: 1.4;
        word-break: break-all;
      }
      .agent-log-entry.info { border-color: #3b82f6; }
      .agent-log-entry.success { border-color: #10b981; }
      .agent-log-entry.error { border-color: #ef4444; }
      .agent-log-entry.tool { border-color: #8b5cf6; }
      .agent-log-entry.result { border-color: #06b6d4; }
      .agent-log-time { color: #6b7280; font-size: 9px; margin-right: 4px; }
      #agent-actions { display: flex; gap: 6px; flex-wrap: wrap; }
      #agent-actions button {
        flex: 1;
        min-width: 60px;
        padding: 6px 8px;
        border: none;
        border-radius: 6px;
        background: #374151;
        color: #e4e4e7;
        cursor: pointer;
        font-size: 11px;
        transition: all 0.2s;
      }
      #agent-actions button:hover { background: #4b5563; }
      #agent-copy-prompt { background: #3730a3 !important; }
      #agent-copy-prompt:hover { background: #4338ca !important; }
      #agent-compress { background: #92400e !important; }
      #agent-compress:hover { background: #b45309 !important; }
      #agent-compress.ready { background: #dc2626 !important; animation: pulse-compress 1.5s infinite; }
      #agent-compress.warning { background: #ea580c !important; animation: pulse-warning 3s infinite; }
      @keyframes pulse-compress { 0%,100%{opacity:1} 50%{opacity:0.6} }
      @keyframes pulse-warning { 0%,100%{opacity:1} 50%{opacity:0.7} }
      #agent-terminal { background: #7c3aed !important; }
      #agent-terminal:hover { background: #8b5cf6 !important; }
      #mini-terminal {
        display: none;
        position: fixed;
        bottom: 80px;
        right: 20px;
        width: 480px;
        height: 320px;
        background: #0d1117;
        border: 1px solid #30363d;
        border-radius: 10px;
        z-index: 2147483647;
        box-shadow: 0 12px 40px rgba(0,0,0,0.6);
        font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
        font-size: 12px;
        color: #c9d1d9;
        flex-direction: column;
        overflow: hidden;
      }
      #mini-terminal.visible { display: flex; }
      #mini-terminal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 6px 12px;
        background: #161b22;
        border-bottom: 1px solid #30363d;
        cursor: move;
        user-select: none;
      }
      #mini-terminal-header span { font-size: 11px; color: #8b949e; }
      #mini-terminal-close {
        background: none;
        border: none;
        color: #8b949e;
        cursor: pointer;
        font-size: 14px;
        padding: 0 4px;
      }
      #mini-terminal-close:hover { color: #f85149; }
      #mini-terminal-output {
        flex: 1;
        overflow-y: auto;
        padding: 8px 12px;
        white-space: pre-wrap;
        word-break: break-all;
        font-size: 11.5px;
        line-height: 1.5;
      }
      #mini-terminal-output .term-cmd { color: #58a6ff; }
      #mini-terminal-output .term-ok { color: #7ee787; }
      #mini-terminal-output .term-err { color: #f85149; }
      #mini-terminal-output .term-dim { color: #484f58; }
      #mini-terminal-input-row {
        display: flex;
        align-items: center;
        padding: 6px 12px;
        border-top: 1px solid #30363d;
        background: #0d1117;
      }
      #mini-terminal-input-row .prompt { color: #7ee787; margin-right: 6px; font-weight: bold; }
      #mini-terminal-input {
        flex: 1;
        background: none;
        border: none;
        outline: none;
        color: #c9d1d9;
        font-family: inherit;
        font-size: 12px;
        caret-color: #58a6ff;
      }
    `;
    document.head.appendChild(style);

    // ── 压缩总结编辑模态框 ──
    function showCompressModal(summaryText) {
      // 移除已有的模态框
      const existing = document.getElementById('compress-modal-overlay');
      if (existing) existing.remove();
      
      const overlay = document.createElement('div');
      overlay.id = 'compress-modal-overlay';
      overlay.innerHTML = `
        <div id="compress-modal">
          <div id="compress-modal-header">
            <span>📝 压缩总结编辑器</span>
            <span id="compress-modal-chars"></span>
          </div>
          <textarea id="compress-modal-editor"></textarea>
          <div id="compress-modal-actions">
            <button id="compress-modal-cancel">取消</button>
            <button id="compress-modal-confirm">✅ 确认压缩</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      
      const editor = document.getElementById('compress-modal-editor');
      const charsSpan = document.getElementById('compress-modal-chars');
      editor.value = summaryText;
      charsSpan.textContent = summaryText.length + ' 字符';
      
      editor.addEventListener('input', () => {
        charsSpan.textContent = editor.value.length + ' 字符';
      });
      
      document.getElementById('compress-modal-cancel').onclick = () => {
        overlay.remove();
        addLog('❌ 取消压缩', 'error');
      };
      
      document.getElementById('compress-modal-confirm').onclick = () => {
        const edited = editor.value.trim();
        if (edited.length < 50) {
          alert('总结太短，至少需要 50 字符');
          return;
        }
        overlay.remove();
        window.__COMPRESS_SUMMARY = edited;
      };
      
      // ESC 关闭
      overlay.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          overlay.remove();
          addLog('❌ 取消压缩', 'error');
        }
      });
      
      // 添加样式
      if (!document.getElementById('compress-modal-style')) {
        const style = document.createElement('style');
        style.id = 'compress-modal-style';
        style.textContent = `
          #compress-modal-overlay {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.7);
            z-index: 2147483647;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          #compress-modal {
            width: 80vw;
            max-width: 900px;
            height: 80vh;
            background: #1a1a2e;
            border: 1px solid #0f3460;
            border-radius: 12px;
            display: flex;
            flex-direction: column;
            box-shadow: 0 20px 60px rgba(0,0,0,0.5);
          }
          #compress-modal-header {
            padding: 16px 20px;
            border-bottom: 1px solid #0f3460;
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 16px;
            font-weight: 600;
            color: #e4e4e7;
          }
          #compress-modal-chars {
            font-size: 13px;
            color: #a1a1aa;
            font-weight: normal;
          }
          #compress-modal-editor {
            flex: 1;
            margin: 12px 20px;
            padding: 16px;
            background: #0d1117;
            border: 1px solid #30363d;
            border-radius: 8px;
            color: #c9d1d9;
            font-family: 'SF Mono', 'Fira Code', monospace;
            font-size: 13px;
            line-height: 1.6;
            resize: none;
            outline: none;
          }
          #compress-modal-editor:focus {
            border-color: #58a6ff;
          }
          #compress-modal-actions {
            padding: 12px 20px 16px;
            display: flex;
            justify-content: flex-end;
            gap: 12px;
          }
          #compress-modal-cancel {
            padding: 8px 20px;
            background: #333;
            color: #e4e4e7;
            border: 1px solid #555;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
          }
          #compress-modal-cancel:hover { background: #444; }
          #compress-modal-confirm {
            padding: 8px 24px;
            background: #dc2626;
            color: white;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
          }
          #compress-modal-confirm:hover { background: #ef4444; }
        `;
        document.head.appendChild(style);
      }
      
      editor.focus();
    }

    // ── 跨压缩记忆存储 ──
    const CONTEXT_STORAGE_ID = '59cdb9cb-b175-4cdd-af44-e8927d7b006a';

    async function writeContextStorage(text) {
      try {
        const r = await fetch('/api/project/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ id: CONTEXT_STORAGE_ID, name: text, request_not_update_permission: true })
        });
        const d = await r.json();
        const savedLen = d.data && d.data.name ? d.data.name.length : 0;
        // 写后读回验证
        if (savedLen > 0) {
          const readBack = await readContextStorage();
          const expectedPrefix = text.substring(0, 100);
          const actualPrefix = readBack.substring(0, 100);
          if (actualPrefix !== expectedPrefix) {
            console.warn('writeContextStorage: verify mismatch! retrying...', { expectedPrefix, actualPrefix });
            addLog('⚠️ 存储写入验证不一致，重试...', 'warning');
            const r2 = await fetch('/api/project/update', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ id: CONTEXT_STORAGE_ID, name: text, request_not_update_permission: true })
            });
            const d2 = await r2.json();
            const retryLen = d2.data && d2.data.name ? d2.data.name.length : 0;
            addLog(retryLen > 0 ? '✅ 重试写入成功 (' + retryLen + ' 字符)' : '❌ 重试写入失败', retryLen > 0 ? 'success' : 'error');
            return retryLen;
          }
        }
        return savedLen;
      } catch(e) { console.error('writeContextStorage failed:', e); return 0; }
    }

    async function readContextStorage() {
      try {
        const r = await fetch('/api/project/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ id: CONTEXT_STORAGE_ID, request_not_update_permission: true })
        });
        const d = await r.json();
        return d.data ? (d.data.name || '') : '';
      } catch(e) { console.error('readContextStorage failed:', e); return ''; }
    }

    // ── 代码存储 (独立对话，与上下文存储隔离) ──
    const CODE_STORAGE_ID = '731a7c05-a990-4dc2-9b42-25f58b9e454e';

    async function writeCodeStorage(text) {
      try {
        const r = await fetch('/api/project/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ id: CODE_STORAGE_ID, name: text, request_not_update_permission: true })
        });
        const d = await r.json();
        return d.data && d.data.name ? d.data.name.length : 0;
      } catch(e) { console.error('writeCodeStorage failed:', e); return 0; }
    }

    async function readCodeStorage() {
      try {
        const r = await fetch('/api/project/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ id: CODE_STORAGE_ID, request_not_update_permission: true })
        });
        const d = await r.json();
        return d.data ? (d.data.name || '') : '';
      } catch(e) { console.error('readCodeStorage failed:', e); return ''; }
    }

    window.writeCodeStorage = writeCodeStorage;
    window.readCodeStorage = readCodeStorage;

    // ── 通用槽位读写 (虚拟文件系统基础) ──
    async function writeSlot(slotId, text) {
      try {
        const r = await fetch('/api/project/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ id: slotId, name: text, request_not_update_permission: true })
        });
        const d = await r.json();
        return d.data && d.data.name ? d.data.name.length : 0;
      } catch(e) { console.error('writeSlot failed:', e); return 0; }
    }

    async function readSlot(slotId) {
      try {
        const r = await fetch('/api/project/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ id: slotId, request_not_update_permission: true })
        });
        const d = await r.json();
        return d.data ? (d.data.name || '') : '';
      } catch(e) { console.error('readSlot failed:', e); return ''; }
    }

    async function createSlot(name) {
      try {
        const r = await fetch('/api/project/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ session_state: {steps: [], messages: []}, name: name || '', type: 'ai_chat' })
        });
        const d = await r.json();
        return d.data ? d.data.id : null;
      } catch(e) { console.error('createSlot failed:', e); return null; }
    }

    window.writeSlot = writeSlot;
    window.readSlot = readSlot;
    window.createSlot = createSlot;

    // ── Messages Channel (VFS 2.0) ──
    async function readSlotFull(slotId) {
      try {
        const r = await fetch('/api/project/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ id: slotId, request_not_update_permission: true })
        });
        const d = await r.json();
        return d.data || null;
      } catch(e) { console.error('readSlotFull failed:', e); return null; }
    }

    async function writeSlotMessages(slotId, messages) {
      try {
        const r = await fetch('/api/project/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ id: slotId, session_state: { steps: [], messages: messages }, request_not_update_permission: true })
        });
        const d = await r.json();
        const msgs = d.data && d.data.session_state ? d.data.session_state.messages : [];
        return msgs.length;
      } catch(e) { console.error('writeSlotMessages failed:', e); return 0; }
    }

    async function readSlotMessages(slotId) {
      try {
        const data = await readSlotFull(slotId);
        return data && data.session_state ? (data.session_state.messages || []) : [];
      } catch(e) { console.error('readSlotMessages failed:', e); return []; }
    }

    window.readSlotFull = readSlotFull;
    window.writeSlotMessages = writeSlotMessages;
    window.readSlotMessages = readSlotMessages;

    // ── VFS (Virtual File System) ──
    const VFS_REGISTRY_ID = '9045a811-9a4c-4d33-ad79-31c12cebd911';
    window.__VFS_REGISTRY_ID = VFS_REGISTRY_ID;

    async function vfsReadRegistry() {
      try {
        const data = await readSlot(VFS_REGISTRY_ID);
        if (data) return JSON.parse(data);
        throw new Error('empty registry');
      } catch(e) {
        // Fallback: try chrome.storage.local via background
        console.log('[VFS] Registry read failed, trying chrome.storage.local recovery...');
        try {
          const backup = await new Promise((resolve) => {
            chrome.runtime.sendMessage({ type: 'VFS_RECOVER_REGISTRY' }, resolve);
          });
          if (backup && backup.ok && backup.data) {
            const reg = JSON.parse(backup.data);
            console.log('[VFS] Recovered registry from chrome.storage.local, ts:', backup.timestamp);
            addLog('🔄 VFS registry recovered from local backup', 'warning');
            // Restore to cloud
            await writeSlot(VFS_REGISTRY_ID, backup.data);
            return reg;
          }
        } catch(e2) { console.error('[VFS] Local recovery also failed:', e2); }
        return { __meta: { version: 1 }, slots: {} };
      }
    }

    async function vfsSaveRegistry(reg) {
      const json = JSON.stringify(reg);
      const len = await writeSlot(VFS_REGISTRY_ID, json);
      // Async backup to chrome.storage.local (fire and forget)
      try {
        chrome.runtime.sendMessage({ type: 'VFS_BACKUP_REGISTRY', data: json });
      } catch(e) { console.error('[VFS] Backup to chrome.storage.local failed:', e); }
      return len;
    }

    window.vfs = {
      resolve: async function(name) {
        const reg = await vfsReadRegistry();
        const s = reg.slots[name];
        return s ? s.id : null;
      },

      ls: async function() {
        const reg = await vfsReadRegistry();
        return Object.keys(reg.slots).map(function(k) {
          const s = reg.slots[k];
          return { name: k, id: s.id, desc: s.desc || '', created: s.created || '' };
        });
      },

      mount: async function(name, desc) {
        const reg = await vfsReadRegistry();
        if (reg.slots[name]) return { error: 'exists', id: reg.slots[name].id };
        const id = await createSlot(name);
        if (!id) return { error: 'create_failed' };
        reg.slots[name] = { id: id, created: new Date().toISOString(), desc: desc || '' };
        await vfsSaveRegistry(reg);
        return { ok: true, name: name, id: id };
      },

      unmount: async function(name) {
        const reg = await vfsReadRegistry();
        if (!reg.slots[name]) return { error: 'not_found' };
        if (name === 'registry') return { error: 'cannot_unmount_registry' };
        const id = reg.slots[name].id;
        delete reg.slots[name];
        await vfsSaveRegistry(reg);
        await writeSlot(id, '');
        return { ok: true, name: name, freed: id };
      },

      read: async function(name) {
        const id = await window.vfs.resolve(name);
        if (!id) return { error: 'not_found: ' + name };
        return readSlot(id);
      },

      write: async function(name, content) {
        const id = await window.vfs.resolve(name);
        if (!id) return { error: 'not_found: ' + name };
        const len = await writeSlot(id, content);
        if (name.indexOf("._prev") === -1) { window.vfs._logChange(name, "write", "name", len, content).catch(function(){}); }
        return { ok: true, name: name, length: len };
      },

      append: async function(name, content) {
        const id = await window.vfs.resolve(name);
        if (!id) return { error: 'not_found: ' + name };
        const existing = await readSlot(id);
        const len = await writeSlot(id, existing + content);
        return { ok: true, name: name, length: len, appended: content.length };
      },

      snapshot: async function(name) {
        const prevName = name + '._prev';
        const id = await window.vfs.resolve(name);
        if (!id) return { error: 'not_found: ' + name };
        const content = await readSlot(id);
        if (!content) return { ok: true, skipped: 'empty' };
        const reg = await vfsReadRegistry();
        let prevId;
        if (reg.slots[prevName]) {
          prevId = reg.slots[prevName].id;
        } else {
          prevId = await createSlot(prevName);
          reg.slots[prevName] = { id: prevId, created: new Date().toISOString(), desc: 'auto-backup of ' + name };
          await vfsSaveRegistry(reg);
        }
        const len = await writeSlot(prevId, content);
        return { ok: true, name: prevName, length: len };
      },

      safeWrite: async function(name, content) {
        await window.vfs.snapshot(name);
        return window.vfs.write(name, content);
      },

      backup: async function(options) {
        // VFS 2.0 backup: name + messages dual-channel
        const opts = options || {};
        const includeMessages = opts.messages !== false; // default true
        const list = await window.vfs.ls();
        const slots = {};
        for (const s of list) {
          const slotData = { name: s.name, id: s.id, desc: s.desc, created: s.created };
          slotData.content = await readSlot(s.id);
          if (includeMessages) {
            try {
              slotData.messages = await readSlotMessages(s.id);
            } catch(e) { slotData.messages = []; }
          }
          slots[s.name] = slotData;
        }
        const snap = {
          meta: { version: 2, timestamp: new Date().toISOString(), slot_count: list.length, includesMessages: includeMessages },
          slots: slots
        };
        const json = JSON.stringify(snap);
        window.__vfs_snapshot = json;
        // POST to agent server for persistence
        try {
          fetch('http://localhost:8766/upload-payload', {
            method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: json
          }).catch(function() {});
        } catch(e) {}
        return { ok: true, size: json.length, slot_count: list.length, version: 2, includesMessages: includeMessages };
      },

      exec: async function(name, args) {
        const code = await window.vfs.read(name);
        if (!code || code.error) return { error: 'slot_empty_or_not_found: ' + name };
        try {
          const fn = new Function('args', code);
          let result = fn(args);
          if (result && typeof result.then === 'function') result = await result;
          return { ok: true, result: result };
        } catch(e) {
          return { error: e.message, stack: e.stack };
        }
      },

      restoreFrom: async function(snapshotJson, options) {
        // VFS 2.0 restore: name + messages dual-channel
        const opts = options || {};
        const snap = typeof snapshotJson === 'string' ? JSON.parse(snapshotJson) : snapshotJson;
        const version = snap.meta && snap.meta.version || 1;
        const names = Object.keys(snap.slots);
        const results = [];
        for (const name of names) {
          const s = snap.slots[name];
          // Restore name channel
          const len = await writeSlot(s.id, s.content || '');
          var msgCount = 0;
          // Restore messages channel (v2+)
          if (version >= 2 && s.messages && s.messages.length > 0 && opts.skipMessages !== true) {
            try {
              msgCount = await writeSlotMessages(s.id, s.messages);
            } catch(e) { msgCount = -1; }
          }
          results.push(name + ':name=' + len + ',msgs=' + msgCount);
        }
        return { ok: true, version: version, restored: results };
      },

      // ── Messages Channel (VFS 2.0) ──
      readMsg: async function(name, key) {
        const id = await window.vfs.resolve(name);
        if (!id) return { error: 'not_found: ' + name };
        const msgs = await readSlotMessages(id);
        if (key) {
          const found = msgs.find(function(m) { return m.id === key; });
          return found ? found.content : null;
        }
        return msgs.map(function(m) { return { key: m.id, size: (m.content || '').length }; });
      },

      writeMsg: async function(name, key, value) {
        const id = await window.vfs.resolve(name);
        if (!id) return { error: 'not_found: ' + name };
        const msgs = await readSlotMessages(id);
        const idx = msgs.findIndex(function(m) { return m.id === key; });
        if (idx >= 0) {
          msgs[idx].content = value;
        } else {
          msgs.push({ id: key, role: 'user', content: value });
        }
        const count = await writeSlotMessages(id, msgs);
        if (key.indexOf("_h:") !== 0) { window.vfs._logChange(name, "writeMsg:" + key, "messages", (value || "").length, value).catch(function(){}); }
        return { ok: true, name: name, key: key, totalMessages: count };
      },

      deleteMsg: async function(name, key) {
        const id = await window.vfs.resolve(name);
        if (!id) return { error: 'not_found: ' + name };
        const msgs = await readSlotMessages(id);
        const filtered = msgs.filter(function(m) { return m.id !== key; });
        if (filtered.length === msgs.length) return { error: 'key_not_found: ' + key };
        const count = await writeSlotMessages(id, filtered);
        return { ok: true, name: name, deleted: key, totalMessages: count };
      },

      listMsg: async function(name) {
        const id = await window.vfs.resolve(name);
        if (!id) return { error: 'not_found: ' + name };
        const msgs = await readSlotMessages(id);
        return msgs.map(function(m) { return { key: m.id, role: m.role, size: (m.content || '').length }; });
      },

      full: async function(name) {
        const id = await window.vfs.resolve(name);
        if (!id) return { error: 'not_found: ' + name };
        const data = await readSlotFull(id);
        if (!data) return { error: 'read_failed' };
        var msgsArr = data.session_state && data.session_state.messages ? data.session_state.messages : [];
        return {
          nameLen: data.name ? data.name.length : 0,
          messages: msgsArr.length,
          keys: Object.keys(data)
        };
      },

      // ── Phase 3: Conversation History Management ──

      cleanup: async function(name, filterFn) {
        // Clean up messages in a VFS slot. filterFn(msg) returns true to KEEP.
        // Without filterFn, removes messages with empty content.
        const id = await window.vfs.resolve(name);
        if (!id) return { error: 'not_found: ' + name };
        const msgs = await readSlotMessages(id);
        var before = msgs.length;
        var kept;
        if (filterFn) {
          kept = msgs.filter(filterFn);
        } else {
          kept = msgs.filter(function(m) { return m.content && m.content.trim().length > 0; });
        }
        var removed = before - kept.length;
        if (removed === 0) return { ok: true, name: name, removed: 0, remaining: before };
        var count = await writeSlotMessages(id, kept);
        return { ok: true, name: name, removed: removed, remaining: count };
      },

      inject: async function(conversationId, messages) {
        // Inject messages into any conversation's session_state.messages[]
        // messages: array of {role, content} or {id, role, content}
        if (!conversationId) return { error: 'no_conversation_id' };
        if (!messages || !messages.length) return { error: 'no_messages' };
        var data = await readSlotFull(conversationId);
        if (!data) return { error: 'read_failed' };
        var ss = data.session_state || { messages: [] };
        if (!ss.messages) ss.messages = [];
        var injected = 0;
        for (var i = 0; i < messages.length; i++) {
          var m = messages[i];
          ss.messages.unshift({
            id: m.id || ('injected-' + Date.now() + '-' + i),
            role: m.role || 'user',
            content: m.content || ''
          });
          injected++;
        }
        var resp = await fetch('/api/project/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ id: conversationId, session_state: ss, request_not_update_permission: true })
        });
        var result = await resp.json();
        var finalCount = result.data && result.data.session_state && result.data.session_state.messages ? result.data.session_state.messages.length : -1;
        return { ok: true, injected: injected, totalMessages: finalCount };
      },

      export: async function(conversationId) {
        // Export full conversation data as JSON
        if (!conversationId) return { error: 'no_conversation_id' };
        var data = await readSlotFull(conversationId);
        if (!data) return { error: 'read_failed' };
        return {
          ok: true,
          id: data.id,
          name: data.name,
          type: data.type,
          ctime: data.ctime,
          mtime: data.mtime,
          messages: data.session_state && data.session_state.messages ? data.session_state.messages.map(function(m) {
            return { id: m.id, role: m.role, content: m.content, ctime: m.ctime };
          }) : [],
          session_state_keys: data.session_state ? Object.keys(data.session_state) : []
        };
      },

      clone: async function(fromId, toId) {
        // Clone messages from one conversation to another
        if (!fromId || !toId) return { error: 'need_both_fromId_and_toId' };
        var srcData = await readSlotFull(fromId);
        if (!srcData) return { error: 'source_read_failed' };
        var srcMsgs = srcData.session_state && srcData.session_state.messages ? srcData.session_state.messages : [];
        if (srcMsgs.length === 0) return { error: 'source_empty' };
        var dstData = await readSlotFull(toId);
        if (!dstData) return { error: 'dest_read_failed' };
        var dstSs = { messages: srcMsgs.map(function(m) { return { id: m.id, role: m.role, content: m.content }; }) };
        var resp = await fetch('/api/project/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ id: toId, session_state: dstSs, request_not_update_permission: true })
        });
        var result = await resp.json();
        var finalCount = result.data && result.data.session_state && result.data.session_state.messages ? result.data.session_state.messages.length : -1;
        return { ok: true, from: fromId, to: toId, cloned: srcMsgs.length, totalMessages: finalCount };
      },

      // ── Phase 5: Executable Command Library ──
      execMsg: async function(slot, key, args) {
        var code = await window.vfs.readMsg(slot, key);
        if (!code) return { error: 'not_found: ' + slot + '/' + key };
        try {
          var fn = new Function('args', code);
          var result = fn(args);
          if (result && typeof result.then === 'function') result = await result;
          return { ok: true, key: key, result: result };
        } catch(e) {
          return { error: e.message, key: key, stack: e.stack };
        }
      },

      // ── Phase 6: Version History ──
      _historyPrefix: '_h:',
      _historyMax: 20,

      _logChange: async function(name, op, channel, size, preview) {
        try {
          var id = await window.vfs.resolve(name);
          if (!id) return;
          var ts = new Date().toISOString();
          var key = '_h:' + ts;
          var pv = (preview || '').substring(0, 200);
          var entry = JSON.stringify({op: op, ch: channel, size: size, pv: pv, ts: ts});
          var msgs = await readSlotMessages(id);
          msgs.push({id: key, role: 'user', content: entry});
          var hMsgs = msgs.filter(function(m) {
            return m.id && m.id.indexOf('_h:') === 0;
          });
          if (hMsgs.length > window.vfs._historyMax) {
            var cut = hMsgs.length - window.vfs._historyMax;
            var rIds = {};
            for (var i = 0; i < cut; i++) {
              rIds[hMsgs[i].id] = true;
            }
            msgs = msgs.filter(function(m) {
              return !rIds[m.id];
            });
          }
          await writeSlotMessages(id, msgs);
        } catch(e) {
          console.error('[VFS] _logChange failed:', e);
        }
      },

      history: async function(name) {
        var id = await window.vfs.resolve(name);
        if (!id) return { error: 'not_found: ' + name };
        var msgs = await readSlotMessages(id);
        var entries = [];
        for (var i = 0; i < msgs.length; i++) {
          var mid = msgs[i].id;
          if (mid && mid.indexOf('_h:') === 0) {
            try {
              var e = JSON.parse(msgs[i].content);
              entries.push(e);
            } catch(err) {}
          }
        }
        entries.sort(function(a, b) {
          return a.ts > b.ts ? -1 : 1;
        });
        return { name: name, count: entries.length, entries: entries };
      },

      rollback: async function(name, version) {
        var id = await window.vfs.resolve(name);
        if (!id) return { error: 'not_found: ' + name };
        var msgs = await readSlotMessages(id);
        var target = null;
        for (var i = 0; i < msgs.length; i++) {
          if (msgs[i].id === '_h:' + version) {
            try {
              target = JSON.parse(msgs[i].content);
            } catch(e) {}
            break;
          }
        }
        if (!target) {
          return { error: 'version_not_found: ' + version };
        }
        if (!target.snapshot) {
          return { error: 'no_snapshot (only safeWrite creates snapshots)' };
        }
        var len = await writeSlot(id, target.snapshot);
        var logP = window.vfs._logChange(
          name, 'rollback', 'name', len,
          'rolled back to ' + version
        );
        await logP;
        return { ok: true, name: name, rolledBackTo: version, length: len };
      },

      // ── Phase 7: Structured Query ──
      query: async function(slot, opts) {
        var o = opts || {};
        var id = await window.vfs.resolve(slot);
        if (!id) return { error: 'not_found: ' + slot };
        var msgs = await readSlotMessages(id);
        var results = [];
        for (var i = 0; i < msgs.length; i++) {
          var m = msgs[i];
          var key = m.id || '';
          var content = m.content || '';
          var size = content.length;
          if (o.prefix && key.indexOf(o.prefix) !== 0) continue;
          if (o.exclude && key.indexOf(o.exclude) === 0) continue;
          if (o.contains && content.indexOf(o.contains) === -1) continue;
          if (o.role && m.role !== o.role) continue;
          if (o.minSize && size < o.minSize) continue;
          if (o.maxSize && size > o.maxSize) continue;
          if (o.after || o.before) {
            try {
              var entry = JSON.parse(content);
              var ts = entry.ts || '';
              if (o.after && ts < o.after) continue;
              if (o.before && ts > o.before) continue;
            } catch(e) {
              if (o.after || o.before) continue;
            }
          }
          results.push({
            key: key,
            role: m.role,
            size: size,
            preview: content.substring(0, 150)
          });
          if (o.limit && results.length >= o.limit) break;
        }
        return { slot: slot, total: results.length, results: results };
      },

      search: async function(keyword) {
        var list = await window.vfs.ls();
        var found = [];
        for (var s = 0; s < list.length; s++) {
          var slot = list[s];
          var id = slot.id;
          var nameContent = await readSlot(id);
          if (nameContent && nameContent.indexOf(keyword) > -1) {
            var idx = nameContent.indexOf(keyword);
            found.push({
              slot: slot.name,
              channel: 'name',
              pos: idx,
              context: nameContent.substring(Math.max(0, idx - 40), idx + keyword.length + 40)
            });
          }
          var msgs = await readSlotMessages(id);
          for (var i = 0; i < msgs.length; i++) {
            var c = msgs[i].content || '';
            var mIdx = c.indexOf(keyword);
            if (mIdx > -1) {
              found.push({
                slot: slot.name,
                channel: 'msg:' + (msgs[i].id || i),
                pos: mIdx,
                context: c.substring(Math.max(0, mIdx - 40), mIdx + keyword.length + 40)
              });
            }
          }
        }
        return { keyword: keyword, total: found.length, results: found };
      }
    };

    // ── Auto-load VFS extensions from fn messages ──
    setTimeout(function() { if (window.vfs && window.vfs.loadExtensions) window.vfs.loadExtensions().then(function(r) { console.log("[VFS] Extensions loaded:", r.loaded); }).catch(function(){}); }, 1000);

    // ── VFS cross-world event listeners ──
    // Listen for MAIN world's sse-hook.js registry save events
    window.addEventListener('__vfs_registry_saved__', function(e) {
      if (e.detail) {
        try {
          chrome.runtime.sendMessage({ type: 'VFS_BACKUP_REGISTRY', data: e.detail });
        } catch(err) { console.error('[VFS] Cross-world backup relay failed:', err); }
      }
    });

    // Listen for MAIN world's recovery request
    window.addEventListener('__vfs_recovery_needed__', function() {
      console.log('[VFS] MAIN world requested registry recovery');
      chrome.runtime.sendMessage({ type: 'VFS_RECOVER_REGISTRY' }, function(backup) {
        if (backup && backup.ok && backup.data) {
          writeSlot(VFS_REGISTRY_ID, backup.data).then(function() {
            console.log('[VFS] Registry restored to cloud from local backup');
            addLog('🔄 VFS registry restored from local backup (MAIN world trigger)', 'warning');
          });
        }
      });
    });

    console.log('[Content] VFS functions + backup listeners registered in ISOLATED world');

    // autoCompress: eval_js 可调用，全自动压缩（跳过模态框和 confirm）
    window.autoCompress = async function(customSummary) {
      const btn = document.getElementById('agent-compress');
      if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
      
      let summary = customSummary;
      
      if (!summary) {
        // 自动提取对话内容，调用 AI 生成摘要
        addLog('🤖 autoCompress: 提取对话内容...', 'info');
        
        const msgs = document.querySelectorAll('.conversation-statement');
        const lines = [];
        let totalLen = 0;
        for (const msg of msgs) {
          if (totalLen > 80000) { lines.push('...(省略)'); break; }
          const isUser = msg.classList.contains('user');
          const el = msg.querySelector('.markdown-viewer') || msg.querySelector('.bubble .content') || msg.querySelector('.bubble');
          let text = (el ? el.innerText : msg.innerText) || '';
          text = text.replace(/\[执行结果\][\s\S]{300,}/g, m => m.substring(0, 300) + '...(截断)');
          if (text.length > 2000) text = text.substring(0, 2000) + '...(截断)';
          lines.push((isUser ? '【用户】' : '【AI】') + text);
          totalLen += text.length;
        }
        const conversationText = lines.join('\n\n');
        const projectId = new URLSearchParams(location.search).get('id');
        
        if (!projectId) {
          if (btn) { btn.disabled = false; btn.textContent = '🗜️ 压缩'; }
          return 'failed: no projectId';
        }
        
        const summarizePrompt = `你是一个上下文压缩专家。请根据以下对话内容生成一份结构化的压缩总结。

要求：
1. 第一行必须是: [上下文压缩总结 - ${new Date().toISOString().split('T')[0]}]
2. 包含: ## 项目/任务、## 环境、## 已完成、## 关键发现、## TODO、## 关键信息
3. 保留硬信息：路径、端口、IP，敏感值用 [REDACTED]
4. 总长度 2K-5K 字符
5. 最后必须包含以下段落（原样保留）：

## 临时上下文存储
AI 可通过 eval_js 在 genspark.ai 标签页中读写临时上下文（需先 list_tabs 找到 genspark.ai 的 tabId）：
- 存储对话 ID: 59cdb9cb-b175-4cdd-af44-e8927d7b006a
- 写入: eval_js 单行执行 return fetch('/api/project/update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'59cdb9cb-b175-4cdd-af44-e8927d7b006a',name:'要存的内容',request_not_update_permission:true})}).then(function(r){return r.json()}).then(function(d){return 'saved:'+d.data.name.length})
- 读取: eval_js 单行执行 return fetch('/api/project/update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'59cdb9cb-b175-4cdd-af44-e8927d7b006a',request_not_update_permission:true})}).then(function(r){return r.json()}).then(function(d){return d.data.name})

=== 对话内容 ===
${conversationText}

请直接输出压缩总结。`;
        
        addLog('📡 autoCompress: 调用 AI 生成摘要...', 'info');
        try {
          const r = await fetch('/api/agent/ask_proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              ai_chat_model: 'claude-opus-4-6',
              ai_chat_enable_search: false,
              ai_chat_disable_personalization: true,
              use_moa_proxy: false, moa_models: [],
              writingContent: null, type: 'ai_chat',
              project_id: projectId,
              messages: [{ id: crypto.randomUUID(), role: 'user', content: summarizePrompt }],
              user_s_input: '生成压缩总结',
              is_private: true, push_token: ''
            })
          });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const reader = r.body.getReader();
          const decoder = new TextDecoder();
          summary = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value, { stream: true });
            for (const line of text.split('\n')) {
              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.substring(6));
                  if (data.type === 'message_field_delta' && data.field_name === 'content') summary += data.delta;
                } catch(e) {}
              }
            }
          }
          if (!summary || summary.length < 100) {
            if (btn) { btn.disabled = false; btn.textContent = '🗜️ 压缩'; }
            return 'failed: summary too short (' + (summary||'').length + ')';
          }
          addLog('✅ autoCompress: 摘要 ' + summary.length + ' 字符', 'success');
        } catch(e) {
          if (btn) { btn.disabled = false; btn.textContent = '🗜️ 压缩'; }
          return 'failed: ' + e.message;
        }
      }
      
      // 备份到跨会话存储 + VFS context 槽位
      addLog('💾 autoCompress: 备份到存储...', 'info');
      const savedLen = await writeContextStorage(summary);
      addLog('💾 autoCompress: 已备份 ' + savedLen + ' 字符到跨会话存储', 'success');
      // 同步写入 VFS context 槽位（供下次对话注入）
      try {
        if (typeof window.vfs === 'object' && typeof window.vfs.write === 'function') {
          await window.vfs.write('context', summary);
          addLog('💾 autoCompress: 已同步到 VFS context 槽位', 'success');
        }
      } catch(vfsErr) {
        addLog('⚠️ autoCompress: VFS 写入失败: ' + vfsErr.message, 'error');
      }
      // 压缩（重写 messages）
      const projectId2 = new URLSearchParams(location.search).get('id');
      const firstUserBubble = document.querySelector('.conversation-statement.user .bubble');
      if (!firstUserBubble || !projectId2) {
        if (btn) { btn.disabled = false; btn.textContent = '🗜️ 压缩'; }
        return 'failed: missing projectId or first message';
      }
      const firstMsg = firstUserBubble.innerText;
      
      addLog('🗜️ autoCompress: 执行压缩...', 'info');
      try {
        const r = await fetch('/api/agent/ask_proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            ai_chat_model: 'claude-opus-4-6',
            ai_chat_enable_search: false,
            ai_chat_disable_personalization: true,
            use_moa_proxy: false, moa_models: [],
            writingContent: null, type: 'ai_chat',
            project_id: projectId2,
            messages: [
              { id: projectId2, role: 'user', content: firstMsg },
              { id: crypto.randomUUID(), role: 'assistant', content: '**[执行结果]** `run_process` ✓ 成功:\n```\nhello\n```' },
              { id: crypto.randomUUID(), role: 'user', content: summary }
            ],
            user_s_input: summary.substring(0, 200),
            is_private: true, push_token: ''
          })
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        // 读完流
        const reader = r.body.getReader();
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
        addLog('✅ autoCompress: 压缩完成，2秒后刷新', 'success');
        setTimeout(() => location.reload(), 2000);
        return 'ok: compressed ' + summary.length + ' chars, backed up ' + savedLen + ' chars';
      } catch(e) {
        if (btn) { btn.disabled = false; btn.textContent = '🗜️ 压缩'; }
        return 'failed: compress ' + e.message;
      }
    };

    // 暴露给 eval_js 调用（content script world）
    window.writeContextStorage = writeContextStorage;
    window.readContextStorage = readContextStorage;

    // NOTE: writeContextStorage/readContextStorage/autoCompress 已通过 sse-hook.js 注入 MAIN world

    // ── Fork Compress: 创建新对话，注入精简消息 ──
    document.getElementById('agent-compress').setAttribute('data-checkpoint', 'reached-1239');
    console.log('[Content] About to bind fork-compress onclick...');
    try {
    // cloneNode to clear any pre-existing listeners that block execution
    const origBtn = document.getElementById('agent-compress');
    const freshBtn = origBtn.cloneNode(true);
    origBtn.parentNode.replaceChild(freshBtn, origBtn);
    freshBtn.addEventListener('click', async (evt) => {
      document.title = 'FC_HANDLER_ENTERED|shift:' + evt.shiftKey;
      const dryRun = evt.shiftKey;
      const addLog = (msg, type='info') => {
        console.log('[fork-compress]', msg);
        const el = document.getElementById('agent-log');
        if (el) {
          const line = document.createElement('div');
          line.style.cssText = 'font-size:11px;padding:1px 4px;color:' + 
            (type==='error'?'#f66':type==='success'?'#6f6':'#aaa');
          line.textContent = msg;
          el.appendChild(line);
          el.scrollTop = el.scrollHeight;
        }
      };

      const btn = document.getElementById('agent-compress');
      btn.disabled = true;
      btn.textContent = '⏳';

      try {
        // ── Step 1: 读取当前对话 messages ──
        const convId = new URLSearchParams(window.location.search).get('id');
        addLog('📖 读取对话 ' + convId.substring(0,8) + '...', 'info');
        
        const readResp = await fetch('/api/project/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ id: convId, request_not_update_permission: true })
        });
        const readData = await readResp.json();
        const allMsgs = readData.data.session_state.messages;
        addLog('📊 当前: ' + allMsgs.length + ' 条消息', 'info');

        if (allMsgs.length <= 40) {
          addLog('⚠️ 消息数 ≤ 40，无需压缩', 'error');
          btn.disabled = false;
          btn.textContent = '🗜️';
          return;
        }

// ── Step 2: 构造精简 messages ──
        const TAIL_KEEP = 30;
        const tailMsgs = allMsgs.slice(-TAIL_KEEP);
        const midCount = allMsgs.length - TAIL_KEEP;
        const midSize = Math.round(allMsgs.slice(0, midCount).reduce((s,m) => s + (typeof m.content === 'string' ? m.content.length : 0), 0)/1024);

        const newMsgs = [];

        // ── Section 1+2: Forged Prompt (从 agent.db 加载) ──
        addLog('🔍 Loading forged prompt from agent.db...', 'info');
        let forgedCount = 0;
        let forgedSize = 0;
        try {
          const forgedResp = await fetch('http://127.0.0.1:8766/memory?slot=toolkit&key=_forged:experience-dialogues');
          const forgedRows = await forgedResp.json();
          const forgedRaw = (forgedRows && forgedRows[0]) ? forgedRows[0].content : '';
          if (forgedRaw) {
            const dialogues = JSON.parse(forgedRaw);
            if (Array.isArray(dialogues) && dialogues.length > 0 && dialogues[0].role) {
              for (const d of dialogues) {
                newMsgs.push({ id: crypto.randomUUID(), role: d.role, content: d.content });
                forgedCount++;
                forgedSize += (d.content || '').length;
              }
              addLog('✅ Forged prompt: ' + forgedCount + ' msgs (' + Math.round(forgedSize/1024) + 'K) loaded from agent.db', 'success');
            }
          }
          if (forgedCount === 0) {
            addLog('⚠️ No forged prompt found in agent.db', 'error');
          }
        } catch(e) {
          addLog('⚠️ Forged load failed: ' + e.message, 'error');
        }

        // ── Section 3: Skills (预留槽位，自动从已加载 skills 生成摘要) ──
        // TODO: 未来从 skills/ 目录读取已加载 skill 摘要
        // 暂时跳过，不注入空消息

        // ── Section 4: Context (知识注入 from agent.db) ──
        const summaryParts = [
          '[Physical Compress - ' + new Date().toISOString().split('T')[0] + ']',
          'Compressed ' + midCount + ' messages (' + midSize + 'KB) into summary.',
          ''
        ];

        // 从服务端读取动态知识
        try {
          addLog('📚 Loading knowledge from agent.db...', 'info');
          const kjResp = await fetch('http://127.0.0.1:8766/local/read?slot=inject-knowledge&key=default');
          const kjData = await kjResp.json();
          const kjContent = kjData.content || '';
          if (kjContent) {
            summaryParts.push(kjContent);
            addLog('✅ Knowledge loaded: ' + kjContent.length + ' chars', 'success');
          }
        } catch(e) {
          addLog('⚠️ Knowledge load failed: ' + e.message, 'error');
        }

        // 读 session-state 上下文
        try {
          const ctxResp = await fetch('http://127.0.0.1:8766/memory?slot=context&key=session-state');
          const ctxRows = await ctxResp.json();
          const vfsContext = (ctxRows && ctxRows[0]) ? (ctxRows[0].content || '') : '';
          if (vfsContext && !vfsContext.startsWith('[Physical Compress')) {
            summaryParts.push('## Session Context', vfsContext.substring(0, 2000));
          }
        } catch(e) {}


        const contextSummary = summaryParts.join('\n');
        newMsgs.push({ id: crypto.randomUUID(), role: 'assistant', content: contextSummary });
        newMsgs.push({ id: crypto.randomUUID(), role: 'user', content: 'Context restored. ' + midCount + ' messages compressed. Recent ' + TAIL_KEEP + ' messages preserved.\n\n请先运行以下命令恢复上下文：\ncd ~/workspace/genspark-agent/server-v2 && sqlite3 data/agent.db "SELECT timestamp,tool,CASE WHEN success=1 THEN \'✓\' ELSE \'✗ \'||substr(error,1,80) END as result,substr(params,1,200) FROM commands WHERE timestamp >= date(\'now\',\'-1 day\') ORDER BY id DESC LIMIT 80"\n\n常用查询索引（按需使用）：\n- 经验教训/工作规则: node dbfile.cjs get local_store guide cheatsheet\n- DB手册(表结构+SQL): node dbfile.cjs get local_store guide agent-db-manual\n- 可用脚本列表: node dbfile.cjs list local_store script\n- Skill模块: node dbfile.cjs list memory forged' });
        addLog('📝 Section 4: Context (' + contextSummary.length + ' chars)', 'success');

        // ── Tail: 保留最近 TAIL_KEEP 条原样 ──
        tailMsgs.forEach(m => {
          newMsgs.push({ id: crypto.randomUUID(), role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) });
        });

        const sectionCount = newMsgs.length; // all injected sections so far
        addLog('🔨 新对话: ' + newMsgs.length + ' 条 (sections:' + sectionCount + ' + tail:' + TAIL_KEEP + ')', 'info');

        // ── DryRun: 预览模式（跳过编辑器和创建） ──
        if (dryRun) {
          const roles = newMsgs.map(m => m.role);
          const totalChars = newMsgs.reduce((s, m) => s + (m.content || '').length, 0);
          const lines = [
            '🔍 [DRY RUN] 预览结果',
            '📊 消息数: ' + newMsgs.length + ' (forged: ' + forgedCount + ', tail: ' + tailMsgs.length + ')',
            '📏 总字符: ' + Math.round(totalChars/1024) + 'K',
            '🎭 Roles: ' + roles.join(',').substring(0, 200),
            '',
            '--- 前 6 条 ---'
          ];
          for (var di = 0; di < Math.min(newMsgs.length, 6); di++) {
            lines.push('[' + di + '] ' + newMsgs[di].role + ': ' + (newMsgs[di].content || '').substring(0, 100));
          }
          lines.push('', '--- Context ---');
          var ctxIdx = forgedCount;
          if (ctxIdx < newMsgs.length) lines.push('[' + ctxIdx + '] ' + newMsgs[ctxIdx].role + ': ' + (newMsgs[ctxIdx].content || '').substring(0, 200));
          lines.push('', '--- 最后 3 条 ---');
          for (var di2 = Math.max(0, newMsgs.length - 3); di2 < newMsgs.length; di2++) {
            lines.push('[' + di2 + '] ' + newMsgs[di2].role + ': ' + (newMsgs[di2].content || '').substring(0, 100));
          }
          lines.push('', '✅ Shift+点击 = 预览, 普通点击 = 执行');
          alert(lines.join('\n'));
          btn.disabled = false;
          btn.textContent = '🗜️ 压缩';
          return;
        }

        // ── Step 3: 弹出编辑器让用户确认 Context 摘要 ──
        if (!document.getElementById('compress-modal-overlay')) {
          const ov = document.createElement('div');
          ov.id = 'compress-modal-overlay';
          ov.style.cssText = 'display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:99999;justify-content:center;align-items:center;';
          ov.innerHTML = '<div id="compress-modal" style="background:#1a1a2e;border-radius:12px;padding:20px;width:80vw;max-width:800px;max-height:80vh;display:flex;flex-direction:column;"><div style="margin-bottom:10px;color:#fff;">编辑 Context 摘要 <span id="compress-modal-chars"></span></div><textarea id="compress-modal-editor" style="flex:1;min-height:300px;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:8px;padding:10px;font-size:13px;resize:none;"></textarea><div style="margin-top:10px;display:flex;gap:10px;justify-content:flex-end;"><button id="compress-modal-cancel" style="padding:8px 16px;background:#333;color:#fff;border:none;border-radius:6px;cursor:pointer;">取消</button><button id="compress-modal-confirm" style="padding:8px 16px;background:#238636;color:#fff;border:none;border-radius:6px;cursor:pointer;">确认压缩</button></div></div>';
          document.body.appendChild(ov);
        }
        const modal = document.getElementById('compress-modal-overlay');
        const editor = document.getElementById('compress-modal-editor');
        if (modal && editor) {
          editor.value = contextSummary;
          modal.style.display = 'flex';

          const confirmed = await new Promise(resolve => {
            document.getElementById('compress-modal-confirm').onclick = () => {
              const edited = editor.value.trim();
              if (edited.length < 50) {
                alert('摘要太短（最少50字符）');
                return;
              }
              modal.style.display = 'none';
              resolve(edited);
            };
            document.getElementById('compress-modal-cancel').onclick = () => {
              modal.style.display = 'none';
              resolve(null);
            };
          });

          if (!confirmed) {
            addLog('❌ 用户取消', 'error');
            btn.disabled = false;
            btn.textContent = '🗜️';
            return;
          }

          // 更新 context summary 到 newMsgs (找到 Section 4 的 assistant 消息)
          const ctxMsgIdx = newMsgs.length - TAIL_KEEP - 2; // context user msg index
          if (ctxMsgIdx >= 0) newMsgs[ctxMsgIdx].content = confirmed;
        }

        // ── Step 4: 备份摘要到 agent.db ──
        try {
          const ctxMsgIdx = newMsgs.length - TAIL_KEEP - 2;
          const finalCtx = ctxMsgIdx >= 0 ? newMsgs[ctxMsgIdx].content : contextSummary;
          await fetch('http://127.0.0.1:8766/memory', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slot: 'context', key: 'session-state', content: finalCtx })
          });
          addLog('💾 Context backed up to agent.db', 'success');
        } catch(e) {
          addLog('⚠️ Context backup failed: ' + e.message, 'error');
        }

        // ── Step 5: 创建新对话 ──
        // 读取旧对话 name，生成新名字
        const oldName = readData.data.name || '';
        const dateStr = new Date().toISOString().split('T')[0];
        const baseName = oldName.replace(/^\[Fork(?:\s*\d+)?\]\s*/, '');
        const forkNum = (oldName.match(/^\[Fork(?:\s*(\d+))?\]/) || [])[1];
        const nextNum = forkNum ? parseInt(forkNum) + 1 : (oldName.startsWith('[Fork') ? 2 : 1);
        const newName = '[Fork ' + nextNum + '] ' + (baseName || 'Agent Session') + ' - ' + dateStr;
        
        addLog('🚀 创建新对话: ' + newName, 'info');
        
        const createResp = await fetch('/api/project/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            name: newName,
            session_state: { messages: newMsgs },
            type: 'ai_chat'
          })
        });
        const createData = await createResp.json();
        
        if (createData.status !== 0 || !createData.data || !createData.data.id) {
          throw new Error('创建失败: ' + JSON.stringify(createData).substring(0, 200));
        }

        const newConvId = createData.data.id;
        addLog('✅ 新对话创建成功: ' + newConvId.substring(0, 8) + '...', 'success');
        addLog('📊 ' + allMsgs.length + ' → ' + newMsgs.length + ' 条消息', 'success');

        // ── Step 6: 删除旧对话 ──
        addLog('🗑️ 删除旧对话...', 'info');
        try {
          await fetch('/api/project/delete?project_id=' + convId, { credentials: 'include' });
          addLog('✅ 旧对话已删除', 'success');
        } catch(e) {
          addLog('⚠️ 旧对话删除失败: ' + e.message, 'error');
        }

        // ── Step 7: 跳转到新对话 ──
        addLog('🔄 2秒后跳转到新对话...', 'info');
        setTimeout(() => {
          window.location.href = '/agents?id=' + newConvId;
        }, 2000);

      } catch(err) {
        addLog('❌ ' + err.message, 'error');
        alert('Fork-compress ERROR: ' + err.message + '\n\nStack: ' + (err.stack || '').substring(0, 300));
        btn.disabled = false;
        btn.textContent = '🗜️';
      }
    });
    document.getElementById('agent-compress').setAttribute('data-checkpoint', 'bound-ok');
    console.log('[Content] Fork-compress onclick bound successfully');
    } catch(forkBindErr) {
      console.error('[Content] Fork-compress bind FAILED:', forkBindErr);
    }

    // 自动检测 __COMPRESS_SUMMARY，按钮变红闪烁
    setInterval(() => {
      const btn = document.getElementById('agent-compress');
      if (!btn || btn.disabled) return; // 正在执行时不干扰
      const hasSummary = !!(window.__COMPRESS_SUMMARY || localStorage.getItem('__COMPRESS_SUMMARY'));
      
      // 检测对话量
      let overThreshold = false;
      let nearThreshold = false;
      try {
        const allMsgs = document.querySelectorAll('.conversation-statement');
        const totalMsgs = allMsgs.length;
        let totalChars = 0;
        allMsgs.forEach(m => { totalChars += m.textContent.length; });
        const injSize = window.__injectedPromptSize || 0;
        const effChars = totalChars + injSize;
        overThreshold = effChars > 350000 || totalMsgs > 300;
        nearThreshold = effChars > 300000 || totalMsgs > 250;
      } catch(e) {}
      
      // 优先级: ready(总结就绪) > warning(超阈值) > 正常
      if (hasSummary) {
        btn.classList.add('ready');
        btn.classList.remove('warning');
        btn.title = '✅ 总结已就绪 — 点击执行压缩';
      } else if (overThreshold) {
        btn.classList.remove('ready');
        btn.classList.add('warning');
        btn.textContent = '🗜️ 压缩!';
        btn.title = '⚠️ 对话已超过压缩阈值 — 点击自动生成总结并压缩';

        // 自动触发 fork-compress
        if (!window.__autoCompressTriggered) {
          window.__autoCompressTriggered = true;
          console.log('[AutoCompress] 200+ msgs, auto-triggering fork-compress');
          setTimeout(function() { btn.click(); }, 2000);
        }
      } else if (nearThreshold) {
        btn.classList.remove('ready');
        btn.classList.add('warning');
        btn.title = '⚠️ 对话接近压缩阈值 — 建议尽快压缩';
      } else {
        btn.classList.remove('ready', 'warning');
        btn.textContent = '🗜️ 压缩';
        btn.title = '上下文压缩：用预设总结替换当前对话';
      }
    }, 5000);

    document.getElementById('agent-clear').onclick = () => {
      document.getElementById('agent-logs').innerHTML = '';
      state.executedCalls.clear();
      state.pendingCalls.clear();
      state.agentRunning = false;
        hideExecutingIndicator();
      state.lastMessageText = '';
      updateStatus();
      addLog('🗑️ 已重置', 'info');
    };
    
    // === 迷你终端 ===
    const terminalHTML = `
      <div id="mini-terminal">
        <div id="mini-terminal-header">
          <span>⌨️ Mini Terminal</span>
          <button id="mini-terminal-close">✕</button>
        </div>
        <div id="mini-terminal-output"><span class="term-dim">Welcome. Type commands and press Enter.</span>\n</div>
        <div id="mini-terminal-input-row">
          <span class="prompt">❯</span>
          <input id="mini-terminal-input" type="text" placeholder="ls, git status, node -v ..." autocomplete="off" spellcheck="false" />
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', terminalHTML);

    const termEl = document.getElementById('mini-terminal');
    const termOutput = document.getElementById('mini-terminal-output');
    const termInput = document.getElementById('mini-terminal-input');
    const termHistory = [];
    let termHistoryIndex = -1;
    let termCwd = '/Users/yay/workspace';

    // 拖拽支持
    let isDragging = false, dragOffX = 0, dragOffY = 0;
    document.getElementById('mini-terminal-header').addEventListener('mousedown', (e) => {
      isDragging = true;
      dragOffX = e.clientX - termEl.getBoundingClientRect().left;
      dragOffY = e.clientY - termEl.getBoundingClientRect().top;
    });
    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      termEl.style.left = (e.clientX - dragOffX) + 'px';
      termEl.style.top = (e.clientY - dragOffY) + 'px';
      termEl.style.right = 'auto';
      termEl.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', () => { isDragging = false; });

    document.getElementById('agent-terminal').onclick = () => {
      termEl.classList.toggle('visible');
      if (termEl.classList.contains('visible')) termInput.focus();
    };

    document.getElementById('mini-terminal-close').onclick = () => {
      termEl.classList.remove('visible');
    };

    function termAppend(html) {
      termOutput.innerHTML += html;
      termOutput.scrollTop = termOutput.scrollHeight;
    }

    // 终端结果监听器
    const termPendingCalls = new Map(); // callId -> true 或 { type: 'cd_check' }
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'tool_result' && msg.id && termPendingCalls.has(msg.id)) {
        const callInfo = termPendingCalls.get(msg.id);
        termPendingCalls.delete(msg.id);
        termInput.disabled = false;
        termInput.focus();

        // cd 验证结果
        if (callInfo && callInfo.type === 'cd_check') {
          if (msg.success) {
            const realPath = String(msg.result || '').replace(/^\[#\d+\]\s*/, '').trim();
            if (realPath) termCwd = realPath;
            termAppend(`<span class="term-dim">${termCwd}</span>\n`);
            document.querySelector('#mini-terminal-input-row .prompt').textContent = termCwd.split('/').pop() + ' ❯';
          } else {
            termCwd = '/Users/yay/workspace';
            termAppend(`<span class="term-err">cd: no such directory</span>\n`);
          }
          return;
        }

        if (msg.success) {
          // 去掉 [#xxx] 前缀
          const text = String(msg.result || '').replace(/^\[#\d+\]\s*/, '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          termAppend(`<span class="term-ok">${text}</span>\n`);
        } else {
          const err = String(msg.error || 'Unknown error').replace(/</g, '&lt;');
          termAppend(`<span class="term-err">${err}</span>\n`);
        }
      }
    });

    function termExec(cmd) {
      if (!cmd.trim()) return;
      termHistory.push(cmd);
      termHistoryIndex = termHistory.length;
      termAppend(`<span class="term-cmd">❯ ${cmd}</span>\n`);
      termInput.value = '';

      // 处理 cd 命令
      const cdMatch = cmd.trim().match(/^cd\s+(.+)/);
      if (cdMatch) {
        let target = cdMatch[1].trim().replace(/["']/g, '');
        // 解析相对路径
        if (target === '..') {
          termCwd = termCwd.replace(/\/[^\/]+$/, '') || '/';
        } else if (target === '~') {
          termCwd = '/Users/yay';
        } else if (target.startsWith('/')) {
          termCwd = target;
        } else if (target === '-') {
          // 忽略 cd - 
        } else {
          termCwd = termCwd + '/' + target;
        }
        // 验证目录是否存在
        termInput.disabled = true;
        const checkId = 'term_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        termPendingCalls.set(checkId, { type: 'cd_check' });
        chrome.runtime.sendMessage({
          type: 'SEND_TO_SERVER',
          payload: { type: 'tool_call', tool: 'run_command', params: { command: `cd ${termCwd} && pwd` }, id: checkId }
        }, (resp) => {
          if (chrome.runtime.lastError || !resp || !resp.success) {
            termPendingCalls.delete(checkId);
            termCwd = termHistory.length > 1 ? termCwd : '/Users/yay/workspace';
            termInput.disabled = false;
            termInput.focus();
            termAppend(`<span class="term-err">cd: no such directory</span>\n`);
          }
        });
        setTimeout(() => {
          if (termPendingCalls.has(checkId)) {
            termPendingCalls.delete(checkId);
            termInput.disabled = false;
            termInput.focus();
          }
        }, 10000);
        return;
      }

      // 处理 clear 命令
      if (cmd.trim() === 'clear' || cmd.trim() === 'cls') {
        termOutput.innerHTML = '';
        return;
      }

      termInput.disabled = true;

      // 实际命令：加上 cwd 前缀
      const actualCmd = `cd ${termCwd} && ${cmd}`;

      const callId = 'term_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      termPendingCalls.set(callId, true);

      // 超时保护
      setTimeout(() => {
        if (termPendingCalls.has(callId)) {
          termPendingCalls.delete(callId);
          termInput.disabled = false;
          termInput.focus();
          termAppend(`<span class="term-err">Timeout (30s)</span>\n`);
        }
      }, 30000);

      chrome.runtime.sendMessage({
        type: 'SEND_TO_SERVER',
        payload: {
          type: 'tool_call',
          tool: 'run_command',
          params: { command: actualCmd },
          id: callId
        }
      }, (resp) => {
        if (chrome.runtime.lastError) {
          termPendingCalls.delete(callId);
          termInput.disabled = false;
          termInput.focus();
          termAppend(`<span class="term-err">Send failed: ${chrome.runtime.lastError.message}</span>\n`);
          return;
        }
        if (!resp || !resp.success) {
          termPendingCalls.delete(callId);
          termInput.disabled = false;
          termInput.focus();
          termAppend(`<span class="term-err">Server not connected</span>\n`);
        }
      });
    }

    termInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        termExec(termInput.value);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (termHistoryIndex > 0) {
          termHistoryIndex--;
          termInput.value = termHistory[termHistoryIndex];
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (termHistoryIndex < termHistory.length - 1) {
          termHistoryIndex++;
          termInput.value = termHistory[termHistoryIndex];
        } else {
          termHistoryIndex = termHistory.length;
          termInput.value = '';
        }
      } else if (e.key === 'Escape') {
        termEl.classList.remove('visible');
      }
    });
    
    document.getElementById('agent-reconnect').onclick = () => {
      chrome.runtime.sendMessage({ type: 'RECONNECT' });
      addLog('🔄 重连中...', 'info');
    };

    // 切换本地/云端服务器
    document.getElementById('agent-reload-ext').onclick = () => {
      chrome.runtime.sendMessage({ type: 'RELOAD_EXTENSION' });
    };

    document.getElementById('agent-switch-server').onclick = () => {
      chrome.runtime.sendMessage({ type: 'GET_SERVER_INFO' }, (info) => {
        if (chrome.runtime.lastError) {
          addLog('❌ 获取服务器信息失败', 'error');
          return;
        }
        const newServer = info.current === 'local' ? 'cloud' : 'local';
        chrome.runtime.sendMessage({ type: 'SWITCH_SERVER', server: newServer }, (resp) => {
          if (resp?.success) {
            const btn = document.getElementById('agent-switch-server');
            btn.textContent = newServer === 'cloud' ? '🌐 云' : '💻 本地';
            addLog('✅ 已切换到 ' + newServer + ': ' + resp.url, 'success');
          } else {
            addLog('❌ 切换失败: ' + (resp?.error || '未知错误'), 'error');
          }
        });
      });
    };

    // 初始化服务器按钮状态
    chrome.runtime.sendMessage({ type: 'GET_SERVER_INFO' }, (info) => {
      if (info?.current) {
        const btn = document.getElementById('agent-switch-server');
        if (btn) btn.textContent = info.current === 'cloud' ? '🌐 云' : '💻 本地';
      }
    });
    
    document.getElementById('agent-copy-prompt').onclick = () => {
      try {
        const prompt = generateSystemPrompt();
        console.log('[Agent] prompt length:', prompt.length);
        
        // 直接在 content script 中用 textarea + execCommand 复制
        const ta = document.createElement('textarea');
        ta.value = prompt;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        ta.style.top = '-9999px';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        
        if (ok) {
          addLog('📋 提示词已复制', 'success');
        } else {
          addLog('❌ execCommand 返回 false', 'error');
        }
      } catch (err) {
        console.error('[Agent] copy-prompt error:', err);
        addLog('❌ 复制失败: ' + err.message, 'error');
      }
    };
    document.getElementById('agent-minimize').onclick = () => {
      const panel = document.getElementById('agent-panel');
      const btn = document.getElementById('agent-minimize');
      panel.classList.toggle('minimized');
      btn.textContent = panel.classList.contains('minimized') ? '➕' : '➖';
    };


    // 轮次显示点击重置
    document.getElementById('agent-round').onclick = () => {
      if (confirm('重置轮次计数？')) {
        resetRound();
      }
    };
    // 初始化显示
    updateRoundDisplay();
    makeDraggable(panel);
  }

  function makeDraggable(el) {
    const header = el.querySelector('#agent-header');
    let isDragging = false;
    let startX, startY, startLeft, startBottom;
    
    header.style.cursor = 'move';
    
    header.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON' || e.target.id === 'agent-status') return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      startLeft = el.offsetLeft;
      startBottom = window.innerHeight - el.offsetTop - el.offsetHeight;
      e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      el.style.left = (startLeft + e.clientX - startX) + 'px';
      el.style.bottom = (startBottom - e.clientY + startY) + 'px';
      el.style.right = 'auto';
    });
    
    document.addEventListener('mouseup', () => { isDragging = false; });
  }

  function updateStatus() {
    const el = document.getElementById('agent-status');
    if (!el) return;
    
    el.classList.remove('connected', 'running', 'disconnected');
    
    if (state.agentRunning) {
      el.textContent = '执行中...';
      el.classList.add('running');
    } else if (state.wsConnected) {
      el.textContent = '已就绪';
      el.classList.add('connected');
    } else {
      el.textContent = '未连接';
      el.classList.add('disconnected');
    }
  }

  function updateToolsDisplay() {
    const el = document.getElementById('agent-tools');
    if (!el) return;
    if (state.availableTools.length === 0) {
      el.style.display = 'none';
      return;
    }
    const cats = {};
    state.availableTools.forEach(t => {
      const name = t.name || t;
      const p = name.includes('_') ? name.split('_')[0] : 'other';
      cats[p] = (cats[p] || 0) + 1;
    });
    const sum = Object.entries(cats).map(([k,v]) => k + ':' + v).join(' ');
    el.style.display = 'block';
    el.innerHTML = '🔧 ' + state.availableTools.length + ' 工具 | ' + sum;
  }

  function addLog(msg, type = 'info') {
    const logs = document.getElementById('agent-logs');
    if (!logs) return;
    
    const time = new Date().toLocaleTimeString('en-US', { 
      hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' 
    });
    
    const entry = document.createElement('div');
    entry.className = `agent-log-entry ${type}`;
    entry.innerHTML = `<span class="agent-log-time">${time}</span>${msg.replace(/</g, '&lt;')}`;
    
    logs.appendChild(entry);
    logs.scrollTop = logs.scrollHeight;
    
    while (logs.children.length > CONFIG.MAX_LOGS) {
      logs.removeChild(logs.firstChild);
    }
  }

