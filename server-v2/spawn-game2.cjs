const Database = require('better-sqlite3');
const crypto = require('crypto');
const db = new Database('/Users/yay/workspace/genspark-agent/server-v2/data/agent.db');
const row = db.prepare("SELECT content FROM memory WHERE slot='agent' AND key='agent-opus-planner'").get();
const agent = JSON.parse(row.content);
const task = [
  '设计一个物理解压游戏的单文件HTML应用。要求：',
  '1. 核心玩法：屏幕上有各种物体（玻璃瓶、陶瓷盘、木箱、气泡、冰块），用户点击/拖拽来打碎、挤压、摔碎它们，带满意的物理碎片效果',
  '2. 碎片物理：真实的重力、弹跳、碰撞，碎片大小不一，有旋转',
  '3. 音效反馈：打碎时的清脆声（用Web Audio API合成，不用外部文件）',
  '4. 视觉风格：不要暗黑风，要明亮治愈的柔和粉彩色系',
  '5. 连击系统：快速连续打碎触发combo，屏幕震动+粒子爆发',
  '6. 无限模式：打碎完自动补充新物体',
  '7. 触摸+鼠标都支持',
  '8. 要有满足感，碎裂动画要夸张一点',
  '请输出完整的9段式设计蓝图。'
].join('\n');
const msgs = agent.messages.concat([{role:'user', content:task}]);
const id = crypto.randomUUID();
const payload = {project_type:'spark', session_state:{messages:msgs}, project_id:id};
console.log(JSON.stringify(payload));
console.log('---URL---');
console.log('https://www.genspark.ai/agents/' + id);
db.close();
