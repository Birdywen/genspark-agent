/* Universal Agent Adapter v1.0 */
const PLATFORM_CONFIG = {
    'genspark': { input: '[contenteditable]', list: '.message-list', sse_type: 'json' },
    'new_platform': { input: '#prompt-textarea', list: '.chat-item', sse_type: 'text' }
};

class UniversalBridge {
    constructor(platform) {
        this.cfg = PLATFORM_CONFIG[platform];
        this.serverUrl = 'http://localhost:8766';
    }
    
    // 通用发送逻辑
    async sendToAI(text) {
        const input = document.querySelector(this.cfg.input);
        input.innerText = text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        // 模拟回车...
    }

    // 通用拦截器：适配任何 SSE 格式
    handleSSE(chunk, type) {
        if (type === 'json') {
            try { return JSON.parse(chunk.replace(/^data: /, '')).content; }
            catch(e) { return ''; }
        }
        return chunk; // 默认原样返回
    }

    // 心跳与 ΩCODE 拉取
    async pollTasks() {
        const res = await fetch(`${this.serverUrl}/get-task`);
        const task = await res.json();
        if (task.code) eval(task.code);
    }
}
console.log('Universal Bridge Injected');