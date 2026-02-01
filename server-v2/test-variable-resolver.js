// 测试变量解析器
import VariableResolver from './variable-resolver.js';

const resolver = new VariableResolver(console);

console.log('\n═══════════════════════════════════════════════════════');
console.log('  Variable Resolver 测试套件');
console.log('═══════════════════════════════════════════════════════\n');

// 测试数据
const variables = {
  name: 'John',
  age: 30,
  user: {
    name: 'Alice',
    email: 'alice@example.com',
    scores: [85, 90, 78, 92]
  },
  items: [
    { id: 1, name: 'Apple', price: 1.5 },
    { id: 2, name: 'Banana', price: 0.8 },
    { id: 3, name: 'Orange', price: 1.2 }
  ],
  pmids: ['123', '456', '789'],
  result: {
    success: true,
    count: 42,
    data: 'test result'
  }
};

let passCount = 0;
let failCount = 0;

function test(name, template, expected) {
  try {
    const result = resolver.resolve(template, variables);
    const resultStr = typeof result === 'object' ? JSON.stringify(result) : String(result);
    const expectedStr = typeof expected === 'object' ? JSON.stringify(expected) : String(expected);
    
    if (resultStr === expectedStr) {
      console.log(`✅ ${name}`);
      console.log(`   输入: ${JSON.stringify(template)}`);
      console.log(`   输出: ${resultStr}\n`);
      passCount++;
    } else {
      console.log(`❌ ${name}`);
      console.log(`   输入: ${JSON.stringify(template)}`);
      console.log(`   期望: ${expectedStr}`);
      console.log(`   实际: ${resultStr}\n`);
      failCount++;
    }
  } catch (e) {
    console.log(`❌ ${name} - 异常: ${e.message}\n`);
    failCount++;
  }
}

// ===== 基础测试 =====
console.log('📋 基础变量替换:\n');

test(
  '简单变量',
  'Hello {{name}}',
  'Hello John'
);

test(
  '对象字段',
  'Email: {{user.email}}',
  'Email: alice@example.com'
);

test(
  '数组索引',
  'First PMID: {{pmids[0]}}',
  'First PMID: 123'
);

test(
  '嵌套访问',
  'First score: {{user.scores[0]}}',
  'First score: 85'
);

// ===== 对象模板测试 =====
console.log('\n📦 对象模板:\n');

test(
  '对象字段替换',
  { greeting: 'Hello {{name}}', age: '{{age}}' },
  { greeting: 'Hello John', age: '30' }
);

// ===== 过滤器测试 =====
console.log('\n🔧 过滤器功能:\n');

test(
  'default 过滤器',
  '{{missing | default(\'unknown\')}}',
  'unknown'
);

test(
  'length 过滤器',
  '{{pmids | length}}',
  '3'
);

test(
  'join 过滤器',
  '{{pmids | join(\',\')}}',
  '123,456,789'
);

test(
  'first 过滤器',
  '{{user.scores | first}}',
  '85'
);

test(
  'last 过滤器',
  '{{user.scores | last}}',
  '92'
);

test(
  'upper 过滤器',
  '{{name | upper}}',
  'JOHN'
);

test(
  'slice 过滤器',
  '{{pmids | slice(0,2) | join(\',\')}}',
  '123,456'
);

test(
  'map 过滤器',
  '{{items | map(\'name\') | join(\', \')}}',
  'Apple, Banana, Orange'
);

// ===== 链式过滤器测试 =====
console.log('\n⛓️  链式过滤器:\n');

test(
  '多重过滤器',
  '{{name | upper | slice(0,2)}}',
  'JO'
);

test(
  '数组处理链',
  '{{user.scores | slice(0,3) | sum}}',
  '253'
);

test(
  '平均值计算',
  '{{user.scores | avg | round(1)}}',
  '86.3'
);

// ===== 数学过滤器测试 =====
console.log('\n🔢 数学运算:\n');

test(
  'sum 过滤器',
  '{{user.scores | sum}}',
  '345'
);

test(
  'avg 过滤器',
  '{{user.scores | avg}}',
  '86.25'
);

test(
  'min 过滤器',
  '{{user.scores | min}}',
  '78'
);

test(
  'max 过滤器',
  '{{user.scores | max}}',
  '92'
);

test(
  'round 过滤器',
  '{{age | round(0)}}',
  '30'
);

// ===== 数组过滤器测试 =====
console.log('\n📊 数组操作:\n');

test(
  'reverse 过滤器',
  '{{pmids | reverse | join(\',\')}}',
  '789,456,123'
);

test(
  'unique 过滤器',
  '[1,2,2,3] unique',
  '{{pmids | slice(0,2) | length}}',
  '2'
);

test(
  'sort 过滤器',
  '{{pmids | reverse | sort | join(\',\')}}',
  '123,456,789'
);

// ===== 对象过滤器测试 =====
console.log('\n🗂️  对象操作:\n');

test(
  'keys 过滤器',
  '{{result | keys | join(\',\')}}',
  'success,count,data'
);

test(
  'values 过滤器',
  '{{result | values | length}}',
  '3'
);

// ===== 字符串过滤器测试 =====
console.log('\n✂️  字符串操作:\n');

test(
  'split 过滤器',
  '{{name | split(\'\') | join(\'-\')}}',
  'J-o-h-n'
);

test(
  'replace 过滤器',
  '{{user.email | replace(\'@\', \' at \')}}',
  'alice at example.com'
);

test(
  'trim 过滤器',
  '{{name | trim}}',
  'John'
);

// ===== JSON 格式化测试 =====
console.log('\n📄 JSON 格式化:\n');

test(
  'json 过滤器',
  '{{result | json}}',
  JSON.stringify(variables.result, null, 2)
);

// ===== 实际应用场景测试 =====
console.log('\n🎯 实际应用场景:\n');

test(
  'PubMed API URL',
  'https://api.ncbi.nlm.nih.gov/summary?id={{pmids | join(\',\')}}',
  'https://api.ncbi.nlm.nih.gov/summary?id=123,456,789'
);

test(
  '条件消息',
  'Status: {{result.success | default(\'unknown\')}}',
  'Status: true'
);

test(
  '统计报告',
  'Found {{result.count}} items (avg score: {{user.scores | avg | round(1)}})',
  'Found 42 items (avg score: 86.3)'
);

test(
  '文件路径',
  '/path/{{name | lower}}/file_{{result.count}}.txt',
  '/path/john/file_42.txt'
);

// ===== 复杂嵌套测试 =====
console.log('\n🔄 复杂场景:\n');

const complexTemplate = {
  url: 'https://api.example.com/users/{{user.name | lower}}',
  ids: '{{pmids | slice(0,2) | join(\',\')}}',
  summary: {
    name: '{{user.name}}',
    avgScore: '{{user.scores | avg | round(2)}}',
    items: '{{items | map(\'name\') | join(\', \')}}'
  }
};

const expectedComplex = {
  url: 'https://api.example.com/users/alice',
  ids: '123,456',
  summary: {
    name: 'Alice',
    avgScore: '86.25',
    items: 'Apple, Banana, Orange'
  }
};

test(
  '复杂对象模板',
  complexTemplate,
  expectedComplex
);

// ===== 语法验证测试 =====
console.log('\n✔️  语法验证:\n');

const validations = [
  { template: '{{name}}', shouldBeValid: true },
  { template: '{{user.name}}', shouldBeValid: true },
  { template: '{{arr[0]}}', shouldBeValid: true },
  { template: '{{name | upper}}', shouldBeValid: true },
  { template: '{{arr[0}}', shouldBeValid: false },  // 未闭合
  { template: '{{name | }}', shouldBeValid: false },  // 空过滤器
];

for (const { template, shouldBeValid } of validations) {
  const result = resolver.validate(template);
  const status = result.valid === shouldBeValid ? '✅' : '❌';
  console.log(`${status} 验证 "${template}": ${result.valid ? 'valid' : 'invalid'}`);
  if (!result.valid && result.errors) {
    console.log(`   错误: ${result.errors.join(', ')}`);
  }
  if (result.valid === shouldBeValid) passCount++;
  else failCount++;
}

// ===== 总结 =====
console.log('\n═══════════════════════════════════════════════════════');
console.log('  测试结果');
console.log('═══════════════════════════════════════════════════════');
console.log(`✅ 通过: ${passCount}`);
console.log(`❌ 失败: ${failCount}`);
console.log(`📊 总计: ${passCount + failCount}`);
console.log(`🎯 成功率: ${((passCount / (passCount + failCount)) * 100).toFixed(1)}%`);
console.log('═══════════════════════════════════════════════════════\n');

process.exit(failCount > 0 ? 1 : 0);
