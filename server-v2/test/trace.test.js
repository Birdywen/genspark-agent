import { TraceContext, createTrace } from '../core/trace.js';
import assert from 'assert';

// Test 1: TraceContext 基本功能
const t1 = createTrace('run_command', { command: 'bash', stdin: 'echo hi' });
assert(t1.traceId.startsWith('T-'), 'traceId should start with T-');
assert(t1.tool === 'run_command', 'tool should be run_command');
assert(t1.metadata.paramsKeys.includes('command'), 'should have command key');

// Test 2: span 记录
t1.span('Router', { action: 'dispatch' });
t1.span('shell', { action: 'start' });
t1.span('shell', { action: 'done', exitCode: 0 });
assert(t1.spans.length === 3, 'should have 3 spans');
assert(t1.spans[0].world === 'Router', 'first span should be Router');
assert(t1.spans[1].world === 'shell', 'second span should be shell');

// Test 3: error span
t1.error('shell', new Error('command not found'));
assert(t1.spans.length === 4, 'should have 4 spans after error');
assert(t1.spans[3].detail.status === 'error', 'error span should have error status');
assert(t1.spans[3].detail.message === 'command not found', 'error message should match');

// Test 4: toChain
const chain = t1.toChain();
assert(chain.includes('Router'), 'chain should include Router');
assert(chain.includes('shell'), 'chain should include shell');
assert(chain.includes('✗'), 'chain should include error marker');

// Test 5: toJSON
const json = t1.toJSON();
assert(json.traceId === t1.traceId, 'JSON traceId should match');
assert(json.duration >= 0, 'duration should be non-negative');
assert(json.chain.length > 0, 'chain should not be empty');

// Test 6: flush (写入文件)
t1.flush();
import fs from 'fs';
const logContent = fs.readFileSync('/private/tmp/omega-trace.log', 'utf8');
assert(logContent.includes(t1.traceId), 'trace log should contain traceId');

// Test 7: file + line 解析
const t2 = createTrace('test', {});
t2.span('Test', 'hello');
assert(t2.spans[0].file !== 'unknown', 'file should be parsed from stack: got ' + t2.spans[0].file);
assert(t2.spans[0].line > 0, 'line should be parsed from stack: got ' + t2.spans[0].line);

console.log('ALL TRACE TESTS PASSED (' + 7 + ' tests)');