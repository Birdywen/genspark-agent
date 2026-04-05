// ws-hook.js — WebSocket interceptor for Giz.AI (runs at document_start in MAIN world)
// Hooks WebSocket to capture Socket.IO messages before DOM rendering
// Communicates with content.js via CustomEvent on document.

(function() {
    'use strict';
    
    if (window.__GIZ_WS_HOOK_ACTIVE__) return;
    window.__GIZ_WS_HOOK_ACTIVE__ = true;

    console.log('[Giz-WS-Hook] WebSocket interceptor loaded');

    // ── Hook WebSocket ─────────────────────────────────────────
    const OrigWebSocket = window.WebSocket;
    window.WebSocket = function(url, protocols) {
        const ws = new OrigWebSocket(url, protocols);
        const isGizSocket = url && (url.includes('giz.ai') || url.includes('socket.io'));
        
        if (isGizSocket) {
            console.log('[Giz-WS-Hook] Intercepting WebSocket:', url);
            
            // 通知 content.js 连接建立
            document.dispatchEvent(new CustomEvent('__giz_ws_connected__', {
                detail: { url: url, timestamp: Date.now() }
            }));

            // 拦截所有消息
            ws.addEventListener('message', (event) => {
                const msg = event.data;
                
                // 只处理 notifications 消息 (42/notifications,...)
                if (typeof msg === 'string' && msg.startsWith('42/notifications,')) {
                    try {
                        // 解析 Socket.IO 消息格式
                        const jsonPart = msg.replace('42/notifications,', '');
                        const [eventName, payloadStr] = JSON.parse(jsonPart);
                        
                        if (eventName === 'notification') {
                            let notification;
                            try {
                                notification = typeof payloadStr === 'string' ? JSON.parse(payloadStr) : payloadStr;
                            } catch (e) {
                                // 非标准 JSON，尝试修复
                                try {
                                    const normalized = payloadStr.replace(/(\{|,)\s*(\w+)\s*:/g, '$1"$2":');
                                    notification = JSON.parse(normalized);
                                } catch (e2) {
                                    // 最后尝试正则提取
                                    notification = parseFallback(payloadStr);
                                }
                            }
                            
                            if (notification) {
                                document.dispatchEvent(new CustomEvent('__giz_message__', {
                                    detail: {
                                        subscribeId: notification.subscribeId,
                                        output: notification.output || notification.message?.output || '',
                                        status: notification.status || notification.message?.status || 'processing',
                                        timestamp: Date.now()
                                    }
                                }));
                            }
                        }
                    } catch (e) {
                        console.error('[Giz-WS-Hook] Parse error:', e.message);
                    }
                }
                
                // 处理连接确认
                if (msg.startsWith('40/notifications,{"sid"')) {
                    console.log('[Giz-WS-Hook] Connected to notifications namespace');
                    document.dispatchEvent(new CustomEvent('__giz_ws_ready__', {
                        detail: { timestamp: Date.now() }
                    }));
                }
            });

            // 拦截关闭
            ws.addEventListener('close', (event) => {
                document.dispatchEvent(new CustomEvent('__giz_ws_closed__', {
                    detail: { code: event.code, reason: event.reason, timestamp: Date.now() }
                }));
            });
        }
        
        return ws;
    };
    
    window.WebSocket.prototype = OrigWebSocket.prototype;
    window.WebSocket.CONNECTING = OrigWebSocket.CONNECTING;
    window.WebSocket.OPEN = OrigWebSocket.OPEN;
    window.WebSocket.CLOSED = OrigWebSocket.CLOSED;

    // Fallback parser for non-standard JSON
    function parseFallback(str) {
        const subscribeIdMatch = str.match(/subscribeId[":]+([^"',}\s]+)/);
        const outputMatch = str.match(/output[":]+([^"']*?)(?:"|,\s*\w+:|}\s*})/);
        const statusMatch = str.match(/status[":]+([^"',}\s]+)/);
        
        if (subscribeIdMatch) {
            let output = outputMatch?.[1] || '';
            output = output
                .replace(/\\n/g, '\n')
                .replace(/\\t/g, '\t')
                .replace(/\\"/g, '"')
                .replace(/\\\\/g, '\\');
            
            return {
                subscribeId: subscribeIdMatch[1],
                output: output,
                status: statusMatch?.[1] || 'processing'
            };
        }
        return null;
    }

    console.log('[Giz-WS-Hook] WebSocket hook installed');
})();