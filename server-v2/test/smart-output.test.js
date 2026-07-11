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
console.log('✓ Smart output: lossless artifact, preview, full expect, read/search');
