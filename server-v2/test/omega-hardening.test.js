import assert from 'assert';
import TaskEngine from '../task-engine.js';
import shellDriver from '../drivers/shell.js';

const logger = { info(){}, error(){}, warn(){}, debug(){} };
const safety = { async checkOperation(){ return { allowed: true }; } };
const errorClassifier = { wrapError(error){ return { errorType: error.message.includes('timeout') ? 'TIMEOUT' : 'UNKNOWN' }; } };
const fakeDriver = { async handle(){ return { success: true, result: 'download complete\nChecksum check failed', exitCode: 0, timedOut: false, historyId: -999999 }; } };
const router = { handlers: new Map([['fake_tool', fakeDriver]]) };
const engine = new TaskEngine(logger, { call(){ throw new Error('unexpected hub call'); } }, safety, errorClassifier, router);

assert.equal(engine._parseDuration(300000), 300000);
assert.equal(engine._parseDuration(300, 0, true), 300000);
assert.equal(engine._parseDuration('300ms'), 300);
assert.equal(engine._parseDuration('300s'), 300000);
assert.equal(engine._parseDuration('5m'), 300000);
assert.equal(engine._parseDuration('1h'), 3600000);
assert.throws(() => engine._parseDuration('tomorrow'), /Invalid duration/);

const accepted = engine._evaluateExpect({ contains: 'complete', exitCode: 0 }, 'download complete', { exitCode: 0, success: true });
assert.equal(accepted.passed, true);
const rejected = engine._evaluateExpect({ notContains: 'Checksum check failed' }, 'Checksum check failed', { success: true });
assert.equal(rejected.passed, false);

engine.stateManager.createTask('expect-test', [], {});
const semanticStarted = Date.now();
const semanticResult = await engine._callToolOnce('expect-test', {
  tool: 'fake_tool', params: {}, expect: { notContains: 'Checksum check failed', exitCode: 0 }
}, 0, {}, '30s');
assert(Date.now() - semanticStarted < 1000, 'successful tool call must clear its timeout timer');
assert.equal(semanticResult.success, false);
assert.equal(semanticResult.errorType, 'EXPECTATION_FAILED');
assert.equal(semanticResult.acceptance.passed, false);
assert.equal(semanticResult.exitCode, 0);
assert.equal(semanticResult.commandStatus, 'acceptance_failed');
assert.equal(semanticResult.historyId, -999999);

router.handlers.set('planned_failure', { async handle(){ return { success: false, error: 'planned failure', historyId: -999998 }; } });
const planned = await engine._callToolOnce('expect-test', { tool: 'planned_failure', params: {}, expectedFailure: true }, 1, {}, '30s');
assert.equal(planned.success, false);
assert.equal(planned.commandStatus, 'expected_failure');
assert.equal(planned.historyId, -999998);

let historyId = -1000000;
await shellDriver.init({ processManager: null, logger, addToHistory(){ return --historyId; } });
const trace = { span(){}, error(){}, flush(){}, duration: 0 };
const timeoutStarted = Date.now();
const timed = await shellDriver.handle('run_process', { command_line: 'sleep 5; echo SHOULD_NOT_PASS', timeout: '50ms' }, { trace });
const timeoutElapsed = Date.now() - timeoutStarted;
assert.equal(timed.success, false);
assert.equal(timed.timedOut, true);
assert.equal(timed.exitCode, null);
assert.equal(timed.timeoutMs, 50);
assert(timeoutElapsed < 1000, `process tree timeout took ${timeoutElapsed}ms`);
assert(!timed.result.includes('SHOULD_NOT_PASS'), 'timed out child process must not continue');

router.handlers.set('run_process', shellDriver);
const classifiedTimeout = await engine._callToolOnce('expect-test', {
  tool: 'run_process',
  params: { command_line: 'sleep 5; echo SHOULD_NOT_PASS' },
  timeout: '50ms',
  expectedFailure: true
}, 2, {}, '50ms');
assert.equal(classifiedTimeout.success, false);
assert.equal(classifiedTimeout.timedOut, true);
assert.equal(classifiedTimeout.commandStatus, 'expected_failure');
assert(classifiedTimeout.historyId < -1000000);

const normal = await shellDriver.handle('run_process', { command_line: 'printf OK', timeout: '2s' }, { trace });
assert.equal(normal.success, true);
assert.equal(normal.result, 'OK');
assert.equal(normal.exitCode, 0);
assert.equal(normal.timedOut, false);

console.log('✓ Omega hardening: duration, semantic expect, timeout status');
