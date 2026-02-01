// 守护服务器客户端 - 用于测试和控制
import WebSocket from 'ws';

const DAEMON_URL = 'ws://localhost:8766';

function sendCommand(command) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(DAEMON_URL);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('连接超时'));
    }, 5000);
    
    ws.on('open', () => {
      console.log(`📤 发送命令: ${command}`);
      ws.send(JSON.stringify({ command }));
    });
    
    ws.on('message', (data) => {
      clearTimeout(timeout);
      const response = JSON.parse(data.toString());
      console.log('📥 响应:', JSON.stringify(response, null, 2));
      ws.close();
      resolve(response);
    });
    
    ws.on('error', (err) => {
      clearTimeout(timeout);
      console.error('❌ 连接错误:', err.message);
      reject(err);
    });
  });
}

async function main() {
  const command = process.argv[2] || 'status';
  
  console.log('═══════════════════════════════════════════════════════');
  console.log('  🛡️  守护服务器客户端');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');
  
  try {
    const result = await sendCommand(command);
    console.log('');
    
    if (result.success) {
      console.log('✅ 命令执行成功');
      if (result.pid) {
        console.log(`   主服务器 PID: ${result.pid}`);
      }
      if (result.running !== undefined) {
        console.log(`   主服务器状态: ${result.running ? '运行中' : '已停止'}`);
      }
    } else {
      console.log('❌ 命令执行失败');
      console.log(`   错误: ${result.error}`);
    }
  } catch (e) {
    console.error('❌ 操作失败:', e.message);
    process.exit(1);
  }
  
  console.log('');
  console.log('可用命令:');
  console.log('  status  - 查看主服务器状态');
  console.log('  start   - 启动主服务器');
  console.log('  stop    - 停止主服务器');
  console.log('  restart - 重启主服务器');
  console.log('');
}

main();
