/* Universal Agent Core v1.1 - The Soul Transfer */
(function() {
    const CONFIG = {
        // 只要修改这里，即可适配新平台
        target: { 
            input: 'textarea, [contenteditable="true"]', 
            send: 'button[type="submit"], [class*="send"], svg[class*="send"]',
            message: '.message, [class*="Message"], .chat-item' 
        },
        server: 'http://localhost:8766'
    };

    // 1. 通用输入发送函数
    window.agent_send = async (text) => {
        const el = document.querySelector(CONFIG.target.input);
        if (!el) return console.error('Input not found');
        if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') el.value = text;
        else el.innerText = text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        setTimeout(() => {
            const btn = document.querySelector(CONFIG.target.send);
            if (btn) btn.click();
        }, 500);
    };

    // 2. 劫持 Fetch 拦截 SSE (核心武器)
    const origFetch = window.fetch;
    window.fetch = async (...args) => {
        const res = await origFetch(...args);
        if (res.headers.get('content-type')?.includes('text/event-stream')) {
            const reader = res.body.getReader();
            return new Response(new ReadableStream({
                async start(controller) {
                    while (true) {
                        const {done, value} = await reader.read();
                        if (done) break;
                        const chunk = new TextDecoder().decode(value);
                        // 转发给本地服务器进行解析，不在此处写死解析逻辑
                        origFetch(CONFIG.server + '/trace-sse', { method: 'POST', body: chunk });
                        controller.enqueue(value);
                    }
                    controller.close();
                }
            }));
        }
        return res;
    };

    // 3. ΩCODE 轮询执行器
    setInterval(async () => {
        try {
            const res = await origFetch(CONFIG.server + '/poll-command');
            const cmd = await res.json();
            if (cmd && cmd.code) {
                console.log('Executing ΩCODE Task...');
                new Function(cmd.code)();
            }
        } catch(e) {}
    }, 2000);

    console.log('Universal Agent Core: ARMED');
})();