// Omega Bookmarklet - 点击执行 AI 输出的命令
// 使用方法：复制下面压缩版代码，创建书签，粘贴为 URL

(async function() {
    // 1. 找到最后一条 AI 消息中的 Omega 命令
    const messages = document.querySelectorAll('[data-message-author-role="assistant"]');
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg) { alert('No AI message found'); return; }
    
    const text = lastMsg.innerText;
    const match = text.match(/Ω\{.*?\}ΩSTOP/s) || text.match(/Œ©\{.*?\}Œ©STOP/s);
    if (!match) { alert('No Omega command found'); return; }
    
    const command = match[0];
    console.log('Found command:', command);
    
    // 2. 发送到本地服务器执行
    try {
        const resp = await fetch('http://localhost:7749/exec', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command })
        });
        const data = await resp.json();
        
        if (data.success) {
            // 3. 填入输入框
            const input = document.querySelector('textarea, [contenteditable="true"]');
            if (input) {
                if (input.tagName === 'TEXTAREA') {
                    input.value = data.result;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                } else {
                    input.innerText = data.result;
                }
                // 4. 可选：自动发送
                // document.querySelector('button[type="submit"]')?.click();
                alert('Result pasted! Press Enter to send.');
            }
        } else {
            alert('Error: ' + data.error);
        }
    } catch (e) {
        alert('Server not running? Error: ' + e.message);
    }
})();
