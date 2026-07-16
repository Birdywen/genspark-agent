import assert from 'node:assert/strict';
import { semanticizeCandidates, summarizeCommand } from '../core/semantic-compressor.js';

const rows = [
  { id: 1, tool: 'run_process', params: '{"command_line":"printf \\"[意图] 读取解析器\\\\n\\""}', success: 1, status: 'success', result_preview: '[意图] 读取解析器\nparseOmegaPayload found', error: null },
  { id: 2, tool: 'run_process', params: '{"command_line":"sleep 2"}', success: 0, status: 'expected_failure', result_preview: '', error: 'TIMEOUT after 50ms' },
  { id: 3, tool: 'run_process', params: '{"command_line":"printf ok"}', success: 0, status: 'acceptance_failed', result_preview: 'ok', error: 'Expected output to contain TARGET' },
  { id: 4, tool: 'run_process', params: '{"command_line":"echo success"}', success: 1, status: 'success', result_preview: '成功修复了失败分类', error: null }
];

const replacements = semanticizeCandidates([
  { index: 8, commandIds: [1, 2] },
  { index: 9, commandIds: [3] },
  { index: 10, commandIds: [4] },
  { index: 11, commandIds: [999] }
], rows);

assert.equal(replacements.length, 3);
assert.match(replacements[0].content, /#1 run_process · 成功/);
assert.match(replacements[0].content, /#2 run_process · 预期失败/);
assert.doesNotMatch(replacements[0].content, /未解决失败/);
assert.match(replacements[1].content, /含未解决失败/);
assert.match(replacements[1].content, /语义验收失败/);
assert.match(replacements[2].content, /#4 run_process · 成功/);
assert.match(summarizeCommand(rows[0]), /意图: 读取解析器/);
console.log('semantic compressor tests passed');
