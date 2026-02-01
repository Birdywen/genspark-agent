// 测试完整的变量传递流水线
import StateManager from './state-manager.js';
import Logger from './logger.js';

const logger = new Logger({ level: 'info' });
const stateManager = new StateManager(logger);

console.log('\n═══════════════════════════════════════════════════════');
console.log('  变量传递流水线测试');
console.log('═══════════════════════════════════════════════════════\n');

// 模拟批量任务
const taskId = 'test_pipeline_' + Date.now();
const steps = [
  {
    tool: 'run_command',
    params: { command: 'echo {\"ids\":[\"123\",\"456\",\"789\"]}' },
    saveAs: 'searchResult'
  },
  {
    tool: 'run_command',
    params: { command: 'curl https://api.example.com/details?id={{searchResult.ids | join(\",\")}}' },
    saveAs: 'detailsResult'
  },
  {
    tool: 'write_file',
    params: {
      path: '/tmp/result_{{searchResult.ids[0]}}.txt',
      content: 'Found {{searchResult.ids | length}} items'
    }
  }
];

// 创建任务
const task = stateManager.createTask(taskId, steps);
console.log('✅ 任务已创建:', taskId);
console.log('');

// 模拟步骤1执行
console.log('📋 步骤 1: 搜索数据');
const step1Result = {
  success: true,
  result: '{"ids":["123","456","789"]}',
  tool: 'run_command'
};
stateManager.recordStepResult(taskId, 0, step1Result);

const vars1 = stateManager.getAllVariables(taskId);
console.log('   变量:', JSON.stringify(vars1, null, 2));
console.log('');

// 测试步骤2的模板解析
console.log('📋 步骤 2: 解析模板');
const step2Params = stateManager.resolveTemplate(taskId, steps[1].params);
console.log('   原始:', JSON.stringify(steps[1].params));
console.log('   解析:', JSON.stringify(step2Params));
console.log('');

// 测试步骤3的模板解析
console.log('📋 步骤 3: 解析多个模板');
const step3Params = stateManager.resolveTemplate(taskId, steps[2].params);
console.log('   原始:', JSON.stringify(steps[2].params));
console.log('   解析:', JSON.stringify(step3Params));
console.log('');

// 测试条件判断
console.log('🔍 测试条件判断:');
const conditions = [
  { var: 'searchResult', exists: true },
  { var: 'searchResult', success: true },
  { var: 'searchResult.ids', exists: true },
  { var: 'missing', exists: false }
];

for (const cond of conditions) {
  const result = stateManager.evaluateCondition(taskId, cond);
  console.log(`   ${JSON.stringify(cond)}: ${result ? '✅' : '❌'}`);
}
console.log('');

// 获取统计
const stats = stateManager.getStats(taskId);
console.log('📊 任务统计:');
console.log('   总步骤:', stats.total);
console.log('   已完成:', stats.completed);
console.log('   失败:', stats.failed);
console.log('   跳过:', stats.skipped);
console.log('   待执行:', stats.pending);
console.log('   进度:', stats.progress + '%');
console.log('');

// 清理
stateManager.cleanup(taskId);

console.log('═══════════════════════════════════════════════════════');
console.log('  ✅ 测试完成');
console.log('═══════════════════════════════════════════════════════\n');
