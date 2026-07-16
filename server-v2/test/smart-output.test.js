import assert from 'assert';
import artifactStore from '../core/artifact-store.js';
import artifactDriver from '../drivers/artifact.js';
import shellDriver from '../drivers/shell.js';
import TaskEngine from '../task-engine.js';

const logger = { info(){}, warning(){}, warn(){}, error(){}, debug(){} };
let historyId = 900000;
await shellDriver.init({ processManager: null, logger, addToHistory(){ return ++historyId; } });
const trace = { span(){}, error(){}, flush(){}, duration: 0 };

const command = `node -e "process.stdout.write('A'.repeat(12000)+'SECRET_MIDDLE'+'B'.repeat(12000)+'\\nUNIQUE_END')"`;
const smart = await shellDriver.handle('run_process', { command_line: command, output: { mode: 'auto', inlineLimit: 4000 }, timeout: '10s' }, { trace });
assert.equal(smart.success, true);
assert.equal(smart.truncated, true);
assert(smart.fullOutputRef?.startsWith('artifact://'));
assert(smart.result.length < 5000);
assert(smart.result.includes('UNIQUE_END'));
assert.equal(smart._fullOutput.includes('SECRET_MIDDLE'), true);
assert.equal(Object.keys(smart).includes('_fullOutput'), false);

const read = artifactStore.read(smart.fullOutputRef, { full: true });
assert.equal(read.complete, true);
assert(read.content.includes('SECRET_MIDDLE'));
assert(read.content.includes('UNIQUE_END'));
const found = artifactStore.search(smart.fullOutputRef, { query: 'SECRET_MIDDLE' });
assert.equal(found.count, 1);

const driverRead = await artifactDriver.handle('artifact_read', { ref: smart.fullOutputRef, offset: 11990, limit: 80 }, { trace });
assert.equal(driverRead.success, true);
assert(driverRead.result.content.includes('SECRET_MIDDLE'));

const fakeDriver = { async handle(){
  const r = { success: true, result: 'preview only', exitCode: 0 };
  Object.defineProperty(r, '_fullOutput', { value: 'prefix SECRET_MIDDLE suffix', enumerable: false });
  return r;
} };
const router = { handlers: new Map([['smart_fake', fakeDriver]]) };
const safety = { async checkOperation(){ return { allowed: true }; } };
const classifier = { wrapError(error){ return { errorType: 'UNKNOWN', message: error.message }; } };
const engine = new TaskEngine(logger, { call(){ throw new Error('unexpected'); } }, safety, classifier, router);
engine.stateManager.createTask('smart-output-test', [], {});
const accepted = await engine._callToolOnce('smart-output-test', { tool: 'smart_fake', params: {}, expect: { contains: 'SECRET_MIDDLE' } }, 0, {}, '2s');
assert.equal(accepted.success, true, 'expect must inspect hidden full output, not preview');

const artifactMode = artifactStore.formatOutput('FULL DATA', '', { mode: 'artifact' });
assert.equal(artifactMode.truncated, true);
assert(artifactMode.display.includes('artifact://'));

const singleLine = JSON.stringify({ rows: Array.from({ length: 400 }, (_, i) => ({ id: i, value: 'X'.repeat(80) })) });
const singlePreview = artifactStore.formatOutput(singleLine, '', { mode: 'auto', inlineLimit: 4000 });
assert.equal(singlePreview.truncated, true, 'single-line JSON must be truncated');
assert(singlePreview.display.length <= 4000, 'single-line preview must obey the character budget');
assert(singlePreview.fullOutputRef?.startsWith('artifact://'), 'single-line JSON must be recoverable');

const noisyArtifact = artifactStore.createArtifact({
  stdout: Array.from({ length: 200 }, (_, i) => `match-${i} ${'C'.repeat(300)}`).join('\n')
});
const boundedSearch = artifactStore.search(noisyArtifact.streams.combined.ref, {
  regex: 'match-[0-9]+',
  contextChars: 500,
  maxMatches: 200,
  outputLimit: 4000
});
assert.equal(boundedSearch.limited, true, 'search must report budget limiting');
assert(boundedSearch.count <= 20, 'search must cap match count');
assert(JSON.stringify(boundedSearch).length <= 5000, 'search response must remain near its output budget');

const nativePayload = JSON.stringify({ data: 'N'.repeat(16000), marker: 'NATIVE_END' });
router.handlers.set('native_budget_fake', {
  async handle() {
    return {
      success: true,
      result: nativePayload,
      truncated: true,
      fullOutputRef: noisyArtifact.streams.combined.ref,
      outputStats: { chars: nativePayload.length, lines: 1 }
    };
  }
});
const nativeBounded = await engine._callToolOnce(
  'smart-output-test',
  { tool: 'native_budget_fake', params: {} },
  1,
  {},
  '2s'
);
assert.equal(nativeBounded.success, true);
assert.equal(nativeBounded.truncated, true);
assert(String(nativeBounded.result).length <= 4000, 'native output metadata must not bypass chat budget');
assert(nativeBounded.fullOutputRef?.startsWith('artifact://'));
console.log('✓ Smart output: single-line/search-budget/native-bypass regression');


assert.equal(accepted.result, 'preview only', 'transport envelope must not enter chat result');
const acceptedBinding = engine._buildSavedBinding(accepted);
assert(String(acceptedBinding.output).includes('SECRET_MIDDLE'), 'saveAs must bind hidden full output');

const envelopeDriver = {
  async handle() {
    const response = {
      success: true,
      result: 'VISIBLE_VALUE',
      stdout: 'DUPLICATE_STDOUT_SHOULD_NOT_APPEAR',
      stderr: '',
      exitCode: 0,
      truncated: false,
      outputStats: { chars: 13, lines: 1 }
    };
    Object.defineProperty(response, '_fullOutput', { value: 'VISIBLE_VALUE FULL_ONLY_MARKER', enumerable: false });
    return response;
  }
};
router.handlers.set('envelope_fake', envelopeDriver);
const unwrapped = await engine._callToolOnce('smart-output-test', { tool: 'envelope_fake', params: {} }, 2, {}, '2s');
assert.equal(unwrapped.result, 'VISIBLE_VALUE');
assert.equal(String(unwrapped.result).includes('DUPLICATE_STDOUT_SHOULD_NOT_APPEAR'), false);
assert(String(engine._buildSavedBinding(unwrapped).output).includes('FULL_ONLY_MARKER'));
console.log('✓ Smart output: object-envelope unwrap/saveAs regression');

console.log('✓ Smart output: lossless artifact, preview, full expect, read/search');
