  // ============== UI ==============

  function createPanel() {
    if (document.getElementById('agent-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'agent-panel';
    panel.innerHTML = `
      <div id="agent-header">
        <span id="agent-title">🤖 Agent v34</span>
        <span id="agent-id" title="点击查看在线Agent" style="cursor:pointer;font-size:10px;color:#9ca3af;margin-left:4px"></span>
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
        <button id="agent-reload-tools" title="刷新工具列表">🔧</button>
        <button id="agent-switch-server" title="切换本地/云端">💻 本地</button>
        <button id="agent-reload-ext" title="重载扩展">♻️</button>
        <button id="agent-list" title="查看在线Agent">👥</button>
        <button id="agent-save" title="存档：保存当前进度到项目记忆">💾 存档</button>
        <button id="agent-compress" title="上下文压缩：用预设总结替换当前对话">🗜️ 压缩</button>
        <button id="agent-video" title="生成视频：选题→Opus Pro→YouTube">🎬 视频</button>
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
      #agent-save { background: #065f46 !important; }
      #agent-save:hover { background: #047857 !important; }
      #agent-compress { background: #92400e !important; }
      #agent-compress:hover { background: #b45309 !important; }
      #agent-compress.ready { background: #dc2626 !important; animation: pulse-compress 1.5s infinite; }
      #agent-compress.warning { background: #ea580c !important; animation: pulse-warning 3s infinite; }
      @keyframes pulse-compress { 0%,100%{opacity:1} 50%{opacity:0.6} }
      @keyframes pulse-warning { 0%,100%{opacity:1} 50%{opacity:0.7} }
      #agent-video { background: #dc2626 !important; }
      #agent-video:hover { background: #ef4444 !important; }
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
    document.getElementById('agent-compress').onclick = async () => {
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
        const HEAD_KEEP = 0;    // 系统提示词由 VFS 动态注入，不需要保留
        const TAIL_KEEP = 30;   // 保留最近30条
        
        let headMsgs = allMsgs.slice(0, HEAD_KEEP);
        const tailMsgs = allMsgs.slice(-TAIL_KEEP);
        
        // 清理 head 里的旧摘要，避免套娃
        headMsgs = headMsgs.filter(m => {
          const c = typeof m.content === 'string' ? m.content : '';
          return !c.startsWith('[Physical Compress');
        });
        // 确保至少保留2条 head（system prompt + first response）
        if (headMsgs.length < 2) headMsgs = allMsgs.slice(0, 2);
        const midMsgs = allMsgs.slice(HEAD_KEEP, allMsgs.length - TAIL_KEEP);

        // 精简摘要：只保留压缩头 + VFS context（最新session summary）
        const midSize = Math.round(midMsgs.reduce((s,m) => s + (typeof m.content === 'string' ? m.content.length : 0), 0)/1024);
        const summaryParts = ['[Physical Compress - ' + new Date().toISOString().split('T')[0] + ']',
          'Compressed ' + midMsgs.length + ' messages (' + midSize + 'KB) into summary.', ''];
        
        // 加入 VFS context
        let vfsContext = '';
        try {
          vfsContext = await new Promise((resolve, reject) => {
            const t = setTimeout(() => resolve(''), 5000);
            vfs.read('context').then(c => { clearTimeout(t); resolve(c || ''); }).catch(() => { clearTimeout(t); resolve(''); });
          });
        } catch(e) {}
        if (vfsContext) {
          // 只保留最新一层 context，去掉嵌套的旧 session
          var ctxLines = vfsContext.split('\n');
          var lastSessionIdx = -1;
          for (var ci = ctxLines.length - 1; ci >= 0; ci--) {
            if (ctxLines[ci].match(/^## Session \d+ Summary/) || ctxLines[ci].match(/^\[Session \d+/) || ctxLines[ci].match(/^\[Physical Compress/)) {
              lastSessionIdx = ci;
              break;
            }
          }
          var trimmedCtx = lastSessionIdx > 0 ? ctxLines.slice(lastSessionIdx).join('\n') : vfsContext;
          if (trimmedCtx.length > 2000) trimmedCtx = trimmedCtx.substring(0, 2000) + '\n...(truncated)';
          summaryParts.push('## VFS Context (Session Memory)', trimmedCtx);
        }
        
        const summary = summaryParts.join('\n');

        // 构造新消息数组：head + summary(user+assistant) + tail
        const newMsgs = [];
        
        // Head: 保留原始 role 和 content，生成新连续 id
        headMsgs.forEach(m => {
          newMsgs.push({ id: crypto.randomUUID(), role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) });
        });
        
        // Summary: 插入压缩摘要
        newMsgs.push({ id: crypto.randomUUID(), role: 'user', content: summary });
        newMsgs.push({ id: crypto.randomUUID(), role: 'assistant', content: 'Context restored. ' + midMsgs.length + ' messages compressed into summary. Recent ' + TAIL_KEEP + ' messages preserved. Ready to continue.' });
        
        // Tail: 保留原始 role 和 content，生成新连续 id
        tailMsgs.forEach(m => {
          newMsgs.push({ id: crypto.randomUUID(), role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) });
        });

        addLog('🔨 新对话: ' + newMsgs.length + ' 条 (head:' + HEAD_KEEP + ' + summary:2 + tail:' + TAIL_KEEP + ')', 'info');
        addLog('📝 摘要: ' + summary.length + ' chars', 'info');

        // ── Step 3: 弹出编辑器让用户确认摘要 ──
        // 确保 modal overlay 已创建
        if (!document.getElementById('compress-modal-overlay')) {
          const ov = document.createElement('div');
          ov.id = 'compress-modal-overlay';
          ov.style.cssText = 'display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:99999;justify-content:center;align-items:center;';
          ov.innerHTML = '<div id="compress-modal" style="background:#1a1a2e;border-radius:12px;padding:20px;width:80vw;max-width:800px;max-height:80vh;display:flex;flex-direction:column;"><div style="margin-bottom:10px;color:#fff;">编辑压缩摘要 <span id="compress-modal-chars"></span></div><textarea id="compress-modal-editor" style="flex:1;min-height:300px;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:8px;padding:10px;font-size:13px;resize:none;"></textarea><div style="margin-top:10px;display:flex;gap:10px;justify-content:flex-end;"><button id="compress-modal-cancel" style="padding:8px 16px;background:#333;color:#fff;border:none;border-radius:6px;cursor:pointer;">取消</button><button id="compress-modal-confirm" style="padding:8px 16px;background:#238636;color:#fff;border:none;border-radius:6px;cursor:pointer;">确认压缩</button></div></div>';
          document.body.appendChild(ov);
        }
        const modal = document.getElementById('compress-modal-overlay');
        const editor = document.getElementById('compress-modal-editor');
        if (modal && editor) {
          editor.value = summary;
          modal.style.display = 'flex';
          
          // 等用户确认
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

          // 更新 summary 到 newMsgs
          newMsgs[HEAD_KEEP].content = confirmed;
        }

        // ── Step 4: 备份摘要到 VFS ──
        try {
          await new Promise((resolve, reject) => {
            const t = setTimeout(() => resolve(), 5000);
            vfs.write('context', newMsgs[HEAD_KEEP].content).then(() => { clearTimeout(t); resolve(); }).catch(() => { clearTimeout(t); resolve(); });
          });
          addLog('💾 摘要已备份到 VFS context', 'success');
        } catch(e) {}

        // ── Step 4.5: 注入记忆模板 (直接 fetch，不依赖 vfs) ──
        addLog('🔍 开始 Step 4.5 经验对话注入...', 'info');
        try {
          const TOOLKIT_ID = '6034da7a-cf5d-4f6d-b9ae-2985508ba0c5';
          const tplResp = await fetch('/api/project/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ id: TOOLKIT_ID, request_not_update_permission: true })
          });
          const tplData = await tplResp.json();
          const allMsgs = tplData.data.session_state.messages || [];
          
          const injectMsgs = [];
          let totalSize = 0;
          const SIZE_LIMIT = 12000;
          
          // Source 1: 伪造经验对话 (JSON数组 [{role,content},...])
          for (const m of allMsgs) {
            const c = typeof m.content === 'string' ? m.content : '';
            if (!c.startsWith('[{"role"')) continue;
            try {
              const dialogues = JSON.parse(c);
              if (Array.isArray(dialogues) && dialogues.length > 0 && dialogues[0].role) {
                for (const d of dialogues) {
                  if (totalSize + (d.content || '').length > SIZE_LIMIT) break;
                  totalSize += (d.content || '').length;
                  injectMsgs.push({ id: crypto.randomUUID(), role: d.role, content: d.content });
                }
                addLog('🧬 经验对话: ' + dialogues.length + ' 条', 'info');
              }
            } catch(e) {}
          }
          
          // Source 2: _tpl:* 场景模板 → 独立展开，不受 SIZE_LIMIT
          const scenarioMsgs = [];
          for (const m of allMsgs) {
            const c = typeof m.content === 'string' ? m.content : '';
            if (!c.startsWith('{"name"')) continue;
            try {
              const parsed = JSON.parse(c);
              if (parsed.name && parsed.messages && Array.isArray(parsed.messages)) {
                for (const tm of parsed.messages) {
                  scenarioMsgs.push({ id: crypto.randomUUID(), role: tm.role, content: tm.content });
                }
                addLog('🎯 场景 ' + parsed.name + ': ' + parsed.messages.length + ' 条', 'info');
              }
            } catch(e) {}
          }
          
          // 先插入 forged 核心对话
          let insertIdx = HEAD_KEEP;
          if (injectMsgs.length > 0) {
            for (let i = 0; i < injectMsgs.length; i++) {
              newMsgs.splice(insertIdx + i, 0, injectMsgs[i]);
            }
            insertIdx += injectMsgs.length;
            addLog('✅ 注入 ' + injectMsgs.length + ' 条核心经验 (' + Math.round(totalSize/1024) + 'K)', 'success');
          }
          // 再插入场景模板（独立轮次，不限大小）
          if (scenarioMsgs.length > 0) {
            for (let i = 0; i < scenarioMsgs.length; i++) {
              newMsgs.splice(insertIdx + i, 0, scenarioMsgs[i]);
            }
            addLog('🎯 注入 ' + scenarioMsgs.length + ' 条场景对话', 'success');
          }
          if (injectMsgs.length === 0 && scenarioMsgs.length === 0) {
            addLog('ℹ️ 未找到经验模板', 'info');
          }
        } catch(e) {
          addLog('⚠️ 模板注入失败: ' + e.message, 'error');
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
        btn.disabled = false;
        btn.textContent = '🗜️';
      }
    };

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
        overThreshold = effChars > 200000 || totalMsgs > 800;
        nearThreshold = effChars > 180000 || totalMsgs > 600;
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

    document.getElementById('agent-save').onclick = () => {
      addLog('💾 存档中...', 'info');
      const saveBtn = document.getElementById('agent-save');
      saveBtn.disabled = true;
      saveBtn.textContent = '⏳';
      
      const historyPath = '/Users/yay/workspace/genspark-agent/server-v2/command-history.json';
      
      // 提取对话内容（最近 30 条消息）
      function extractConversation() {
        const msgs = document.querySelectorAll('.conversation-statement');
        const lines = [];
        const recent = Array.from(msgs).slice(-30);
        for (const msg of recent) {
          const isUser = msg.classList.contains('user');
          const isAI = msg.classList.contains('assistant');
          const contentEl = msg.querySelector('.markdown-viewer') || msg.querySelector('.bubble .content') || msg.querySelector('.bubble');
          let text = (contentEl ? contentEl.innerText : msg.innerText) || '';
          // 截断工具结果，只保留前 200 字符
          text = text.replace(/\[执行结果\][\s\S]{200,}/g, (m) => m.substring(0, 200) + '...(截断)');
          // 截断过长消息
          if (text.length > 1000) text = text.substring(0, 1000) + '...(截断)';
          if (isUser) lines.push('## 用户\n' + text);
          else if (isAI) lines.push('## AI\n' + text);
        }
        return lines.join('\n\n');
      }
      
      const conversation = extractConversation();
      
      // 先查活跃项目
      chrome.runtime.sendMessage({
        type: 'SEND_TO_SERVER',
        payload: {
          type: 'tool_call',
          id: 'save_check_' + Date.now(),
          tool: 'run_command',
          params: { command: 'node /Users/yay/workspace/.agent_memory/memory_manager_v2.js status' }
        }
      }, (statusResp) => {
        let project = 'genspark-agent';
        if (statusResp && statusResp.result) {
          const match = String(statusResp.result).match(/当前项目:\s*(\S+)/);
          if (match && match[1] !== '(未设置)') project = match[1];
        }
        
        const convPath = '/Users/yay/workspace/.agent_memory/projects/' + project + '/conversation_summary.md';
        const convContent = '# 对话记录 - ' + project + '\n> ' + new Date().toISOString().substring(0, 16) + '\n\n' + conversation;
        
        // 步骤1: 保存对话内容
        chrome.runtime.sendMessage({
          type: 'SEND_TO_SERVER',
          payload: {
            type: 'tool_call',
            id: 'save_conv_' + Date.now(),
            tool: 'write_file',
            params: { path: convPath, content: convContent }
          }
        }, () => {
          // 步骤2: 生成 digest
          chrome.runtime.sendMessage({
            type: 'SEND_TO_SERVER',
            payload: {
              type: 'tool_call',
              id: 'save_' + Date.now(),
              tool: 'run_command',
              params: { command: 'node /Users/yay/workspace/.agent_memory/memory_manager_v2.js digest ' + project + ' ' + historyPath }
            }
          }, (resp) => {
            saveBtn.disabled = false;
            saveBtn.textContent = '💾 存档';
            if (resp && resp.success) {
              addLog('💾 存档成功！项目: ' + project + ' (含对话记录)', 'success');
            } else {
              addLog('❌ 存档失败: ' + (resp?.error || '未知错误'), 'error');
            }
          });
        });
      });
    };

    document.getElementById('agent-video').onclick = () => {
      if (window.VideoGenerator) {
        window.VideoGenerator.showTopicDialog(addLog);
      } else {
        addLog('❌ VideoGenerator 模块未加载，请刷新页面', 'error');
      }
    };

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

    // 刷新工具列表
    document.getElementById('agent-reload-tools').onclick = () => {
      chrome.runtime.sendMessage({ type: 'RELOAD_TOOLS' }, (resp) => {
        if (chrome.runtime.lastError) {
          addLog('❌ 发送刷新请求失败', 'error');
          return;
        }
        if (resp?.success) {
          addLog('🔧 正在刷新工具列表...', 'info');
        } else {
          addLog('❌ ' + (resp?.error || '刷新失败'), 'error');
        }
      });
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
    // 查看在线 Agent 列表
    document.getElementById('agent-list').onclick = () => {
      chrome.runtime.sendMessage({ type: 'GET_REGISTERED_AGENTS' }, (resp) => {
        if (chrome.runtime.lastError) {
          addLog(`❌ 查询失败: ${chrome.runtime.lastError.message}`, 'error');
          return;
        }
        if (resp?.success && resp.agents) {
          if (resp.agents.length === 0) {
            addLog('📭 暂无在线 Agent', 'info');
          } else {
            const list = resp.agents.map(a => `${a.agentId}(Tab:${a.tabId})`).join(', ');
            addLog(`👥 在线: ${list}`, 'info');
          }
        } else {
          addLog('❌ 查询失败', 'error');
        }
      });
    };

    // 点击 Agent ID 也显示在线列表
    document.getElementById('agent-id').onclick = () => {
      document.getElementById('agent-list').click();
    };

    makeDraggable(panel);
  }

  // 更新面板上的 Agent ID 显示
  function updateAgentIdDisplay() {
    const el = document.getElementById('agent-id');
    if (el) {
      el.textContent = agentId ? `[${agentId}]` : '[未设置]';
      el.style.color = agentId ? '#10b981' : '#9ca3af';
    }
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

