# 服务器重启问题诊断

## 问题描述

服务器重启后，Extension 无法接收新指令。

## 诊断步骤

### 1. 检查 Extension 连接状态

打开 Extension 的 Background Service Worker：
1. Chrome → 扩展程序 → Genspark Agent → 服务工作进程
2. 在 Console 中输入：
```javascript
// 查看连接状态
chrome.runtime.sendMessage({type: 'CHECK_CONNECTION'}, (resp) => {
  console.log('Connection:', resp);
});
```

### 2. 查看 WebSocket 状态

在 Background Service Worker Console 中：
```javascript
// 查看 socket 变量
socket

// 查看 readyState
socket?.readyState
// 0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED

// 查看重连次数
reconnectAttempts
```

### 3. 手动测试发送消息

```javascript
// 发送 ping
socket?.send(JSON.stringify({type: 'ping'}));

// 发送工具调用
chrome.runtime.sendMessage({
  type: 'TOOL_CALL',
  tool: 'run_command',
  params: {command: 'echo test'}
});
```

### 4. 检查服务器日志

```bash
# 查看连接日志
tail -f /tmp/agent-server.log | grep -E '连接|connection|断开'

# 查看消息日志
tail -f /Users/yay/workspace/genspark-agent/server-v2/logs/agent.log | grep -E 'message|工具调用'
```

## 可能的问题和解决方案

### 问题1：Extension 没有重连

**症状**：
- `socket.readyState === 3` (CLOSED)
- 没有看到重连日志

**解决**：
```javascript
// 手动重连
chrome.runtime.sendMessage({type: 'RECONNECT'});
```

### 问题2：连接成功但消息无响应

**症状**：
- `socket.readyState === 1` (OPEN)
- 服务器收到连接但没有消息

**可能原因**：
- Content script 没有刷新
- 消息队列卡住

**解决**：
```javascript
// 刷新页面
location.reload();

// 或者重新注入 content script
chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
  chrome.tabs.reload(tabs[0].id);
});
```

### 问题3：服务器启动太慢

**症状**：
- Extension 重连多次失败
- `reconnectAttempts` 很大

**解决**：
使用新的重启脚本：
```bash
/Users/yay/workspace/genspark-agent/server-v2/restart.sh
```

该脚本会：
1. 安全杀死旧进程
2. 确认端口释放
3. 启动新服务器
4. 验证启动成功

### 问题4：多个服务器实例

**症状**：
- 端口被占用
- 多个 node 进程

**检查**：
```bash
# 查看所有 node 进程
ps aux | grep 'node index.js'

# 查看端口占用
lsof -i :8765
```

**解决**：
```bash
# 杀死所有占用端口的进程
lsof -ti :8765 | xargs kill -9

# 使用重启脚本
/Users/yay/workspace/genspark-agent/server-v2/restart.sh
```

## 增强方案

### 方案1：添加连接状态检查

在 background.js 中添加：
```javascript
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CHECK_CONNECTION') {
    sendResponse({
      connected: socket && socket.readyState === WebSocket.OPEN,
      readyState: socket?.readyState,
      reconnectAttempts: reconnectAttempts,
      serverUrl: SERVERS[currentServer]
    });
    return true;
  }
  // ... 其他消息处理
});
```

### 方案2：改进重连策略

```javascript
function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectAttempts++;
  
  // 前5次快速重连（1秒）
  // 之后逐渐增加延迟
  const delay = reconnectAttempts <= 5 
    ? 1000 
    : Math.min(1000 * reconnectAttempts, 10000);
  
  console.log(`[BG] 第${reconnectAttempts}次重连，${delay}ms 后尝试`);
  
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWebSocket();
  }, delay);
}
```

### 方案3：自动刷新页面

服务器重启后，自动刷新所有使用 Agent 的页面：

```javascript
socket.onopen = () => {
  console.log('[BG] 已连接');
  reconnectAttempts = 0;
  
  // 如果之前断开过（有重连次数），刷新所有标签页
  if (reconnectAttempts > 0) {
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        if (tab.url?.includes('genspark.ai')) {
          chrome.tabs.reload(tab.id);
        }
      });
    });
  }
  
  broadcastToAllTabs({ type: 'WS_STATUS', connected: true });
  startPing();
};
```

## 快速修复流程

当遇到"重启后无法接收指令"时：

1. **检查服务器**：
   ```bash
   lsof -i :8765  # 确认服务器在运行
   ```

2. **检查 Extension**：
   - 打开 Background Service Worker
   - 查看 Console 是否有错误
   - 查看是否有"已连接"日志

3. **手动重连**：
   - 点击 Extension 的🔄按钮
   - 或刷新页面 (F5)

4. **重启服务器**：
   ```bash
   /Users/yay/workspace/genspark-agent/server-v2/restart.sh
   ```

5. **重启 Extension**：
   - Chrome → 扩展程序
   - 关闭再开启 Genspark Agent

## 监控脚本

创建监控脚本检测连接状态：

```bash
#!/bin/bash
# monitor.sh

while true; do
  # 检查服务器
  if lsof -i :8765 > /dev/null 2>&1; then
    echo "✅ 服务器运行中"
  else
    echo "❌ 服务器未运行"
  fi
  
  # 检查最近的连接日志
  LAST_LOG=$(tail -1 /tmp/agent-server.log)
  echo "📋 最后日志: $LAST_LOG"
  
  sleep 5
done
```

使用：
```bash
chmod +x monitor.sh
./monitor.sh
```
