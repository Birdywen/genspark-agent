// content.js — Giz.AI Agent Bridge Content Script
// Built from content-src/ modules. DO NOT EDIT directly — run build.sh
(function() {
  'use strict';

  if (window.__GIZ_AGENT_LOADED__) { console.log('[GizAgent] Already loaded, skipping'); return; }
  window.__GIZ_AGENT_LOADED__ = true;

  const DISABLED_KEY = 'giz_agent_disabled_' + location.pathname;
  const isDisabled = localStorage.getItem(DISABLED_KEY) === 'true';

  setTimeout(() => {
    const btn = document.createElement('div');
    btn.id = 'giz-agent-toggle';
    btn.innerHTML = isDisabled ? '🔴' : '🟢';
    btn.title = isDisabled ? 'GizAgent: OFF (click to enable)' : 'GizAgent: ON (click to disable)';
    btn.style.cssText = 'position:fixed;bottom:70px;right:12px;z-index:99999;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:16px;background:#1a1a2e;border:1px solid #333;box-shadow:0 2px 8px rgba(0,0,0,0.3);opacity:0.7;transition:opacity 0.2s;';
    btn.onmouseenter = () => btn.style.opacity = '1';
    btn.onmouseleave = () => btn.style.opacity = '0.7';
    btn.onclick = () => {
      const cur = localStorage.getItem(DISABLED_KEY) === 'true';
      localStorage.setItem(DISABLED_KEY, cur ? 'false' : 'true');
      btn.innerHTML = cur ? '🟢' : '🔴';
      if (!cur) {
        const n = document.createElement('div');
        n.textContent = 'Agent disabled. Refresh to take effect.';
        n.style.cssText = 'position:fixed;bottom:110px;right:12px;z-index:99999;background:#333;color:#fff;padding:8px 12px;border-radius:8px;font-size:12px;';
        document.body.appendChild(n); setTimeout(() => n.remove(), 3000);
      }
    };
    document.body.appendChild(btn);
  }, 1500);

  if (isDisabled) { console.log('[GizAgent] Disabled on this page'); return; }

  const CONFIG = {
    SCAN_INTERVAL: 300, TIMEOUT_MS: 600000, MAX_RESULT_LENGTH: 50000, MAX_LOGS: 50, DEBUG: false,
    SELECTORS: {
      INPUT: 'textarea.q-field__native[placeholder*="Message"], div[contenteditable="true"], textarea[placeholder*="Message"]',
      SEND_BTN: 'button.q-btn[title="Send"], button[aria-label*="Send"]',
      AI_MESSAGE: '.assistant-message, [class*="assistant-message"]',
      STOP_BTN: 'button[title*="Stop"], button[aria-label*="Stop"], button[class*="stop"]'
    }
  };

  const state = {
    wsConnected: false, agentRunning: false, availableTools: [],
    executedCalls: new Set(), // Fresh each page load — dedup is per-message now
    pendingCalls: new Map(), lastMessageText: '', lastStableTime: 0,
    generatingFalseCount: 0, messageQueue: [], isProcessingQueue: false,
    roundCount: parseInt(localStorage.getItem('giz_agent_round_count') || '0'),
    totalCalls: 0, sessionStart: Date.now(),
    wsState: { currentSubscribeId: null, currentText: '', executedInCurrentMessage: false, lastMessageTime: 0, processedCommands: new Set() }
  };

  function addExecutedCall(hash) {
    state.executedCalls.add(hash);
    localStorage.setItem('giz_agent_executed_calls', JSON.stringify(Array.from(state.executedCalls).slice(-500)));
  }
  function log(...args) { if (CONFIG.DEBUG) console.log('[GizAgent]', ...args); }
