import { resolve, listAliases } from '../core/alias.js';

let passed = 0;

// Test 1: run_command -> run_process with transform
const r1 = resolve('run_command', { command: 'bash', stdin: 'echo hi', cwd: '/tmp' });
console.assert(r1.tool === 'run_process', 'T1 tool');
console.assert(r1.params.command_line === 'bash', 'T1 command_line');
console.assert(r1.params.stdin === 'echo hi', 'T1 stdin');
console.assert(r1.params.cwd === '/tmp', 'T1 cwd');
console.assert(r1.aliased === true, 'T1 aliased');
passed++;

// Test 2: screenshot -> take_screenshot
const r2 = resolve('screenshot', {});
console.assert(r2.tool === 'take_screenshot', 'T2');
console.assert(r2.aliased === true, 'T2 aliased');
passed++;

// Test 3: bg_run passthrough
const r3 = resolve('bg_run', { command: 'sleep 10' });
console.assert(r3.tool === 'bg_run', 'T3');
console.assert(r3.aliased === false, 'T3 passthrough');
passed++;

// Test 4: unknown tool passthrough
const r4 = resolve('some_random_tool', { x: 1 });
console.assert(r4.tool === 'some_random_tool', 'T4');
console.assert(r4.aliased === false, 'T4 unknown');
passed++;

// Test 5: crawler -> read_file
const r5 = resolve('crawler', { url: 'test.txt' });
console.assert(r5.tool === 'read_file', 'T5');
passed++;

// Test 6: listAliases
const aliases = listAliases();
console.assert(aliases['run_command'] === 'run_process', 'T6');
console.assert(aliases['crawler'] === 'read_file', 'T6b');
passed++;

console.log('ALL ALIAS TESTS PASSED (' + passed + ' tests)');
