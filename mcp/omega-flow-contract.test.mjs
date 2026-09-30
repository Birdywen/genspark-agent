import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reference, validateOutputs, outputsSchema } from './omega-flow-contract.mjs';
import { createFlowRuntime, FLOW_TOOL } from './omega-flow.mjs';
test('missing data names actual text/data/handle keys without exposing values', () => {
  const context = { steps: { g: { text: 'SECRET_VALUE', handles: { jobId: 'job-private' } } } };
  assert.throws(() => reference('steps.g.data', context), (error) => {
    assert.equal(error.code, 'missing_ref'); assert.deepEqual(error.details.availableKeys, ['text', 'handles']);
    assert.deepEqual(error.details.handleKeys, ['jobId']); assert.match(error.message, /steps.g.text/);
    assert(!JSON.stringify(error.details).includes('SECRET_VALUE')); return true;
  });
  context.steps.g.data = { notes: [] };
  assert.throws(() => reference('steps.g.data.nope', context), (error) => {
    assert.deepEqual(error.details.availableKeys, ['notes']); return true;
  });
});
test('missing vars explain set storage; valid refs remain isolated copies', () => {
  assert.throws(() => reference('vars.mykey', { vars: {} }), /set stores only steps.<id>.data/);
  const context = { steps: { s: { data: { ready: true } } } };
  const result = reference('steps.s.data', context); result.ready = false;
  assert.equal(context.steps.s.data.ready, true);
});
test('outputs object schema rejects wrong types and malformed reserved forms', () => {
  assert.equal(outputsSchema.type, 'object');
  for (const bad of [null, false, 4, 'steps.g.text', [], { $ref: 1 }, { $ref: 'steps.g.text', extra: 1 }, { $literal: 1, extra: 1 }])
    assert.throws(() => validateOutputs(bad), /outputs/);
  for (const good of [{}, { result: 2 }, { $ref: 'steps.g.text' }, { $literal: ['any', 'JSON'] }]) validateOutputs(good);
});

test('missing refs retain structured available keys in steps and outputs', async () => {
  const flow = createFlowRuntime(async () => ({ isError: false, text: 'plain text result' }));
  const stepFailure = await flow({ steps: [
    { id: 'g', tool: 'omega_grep' }, { id: 's', set: { $ref: 'steps.g.data' } },
  ] });
  assert.equal(stepFailure.data.results[1].code, 'missing_ref');
  assert(stepFailure.data.results[1].details.availableKeys.includes('text'));
  const outputFailure = await flow({ steps: [{ id: 'g', tool: 'omega_grep' }], outputs: { $ref: 'steps.g.data' } });
  assert.equal(outputFailure.data.failure.code, 'missing_ref');
  assert(outputFailure.data.failure.details.availableKeys.includes('text'));
  assert.match(outputFailure.data.error, /steps.g.text/);
});

test('set never mutates vars and the documented when reference works', async () => {
  const flow = createFlowRuntime(async () => { throw Error('unexpected dispatch'); });
  const r = await flow({ vars: { mykey: false }, steps: [
    { id: 's', set: { mykey: true } },
    { id: 'yes', set: 'ran', when: { left: { $ref: 'steps.s.data.mykey' }, op: 'eq', right: true } },
    { id: 'no', set: 'never', when: { left: { $ref: 'vars.mykey' }, op: 'eq', right: true } },
  ], outputs: { original: { $ref: 'vars.mykey' }, computed: { $ref: 'steps.s.data.mykey' } } });
  assert.deepEqual(r.data.outputs, { original: false, computed: true });
  assert.equal(r.data.results[1].status, 'passed'); assert.equal(r.data.results[2].reason, 'condition');
  assert.equal(r.data.done, 2); assert.equal(r.data.passed, 2); assert.equal(r.data.failed, 0);
  assert.equal(r.data.skipped, 1); assert.equal(r.data.pending, 0);
  assert.deepEqual(r.data.skippedByReason, { condition: 1, halted: 0, cancelled: 0 });
  const bad = await flow({ steps: [{ id: 's', set: { mykey: true } },
    { id: 'bad', set: 1, when: { left: { $ref: 'vars.mykey' }, op: 'eq', right: true } }] });
  assert.equal(bad.data.state, 'rejected'); assert.match(bad.data.error, /set stores only/);
});

test('failed and halted counts are distinct from condition skips', async () => {
  const flow = createFlowRuntime(async () => { throw Error('unexpected dispatch'); });
  const r = await flow({ steps: [
    { id: 'skip', set: 1, when: { left: 1, op: 'eq', right: 2 } },
    { id: 'bad', assert: { left: 1, op: 'eq', right: 2 } },
    { id: 'halt', set: 1 },
  ] });
  assert.equal(r.data.done, 1); assert.equal(r.data.passed, 0); assert.equal(r.data.failed, 1);
  assert.equal(r.data.skipped, 2); assert.equal(r.data.pending, 0);
  assert.deepEqual(r.data.skippedByReason, { condition: 1, halted: 1, cancelled: 0 });
  assert.equal(r.data.passed + r.data.failed + r.data.skipped + r.data.pending, r.data.total);
});

test('effect rejection identifies server environment and request example, before dispatch', async () => {
  let calls = 0;
  for (const allowEffects of [false, true]) {
    const flow = createFlowRuntime(async () => { calls++; }, { allowEffects });
    const r = await flow({ steps: [{ id: 'b', tool: 'omega_batch' }] });
    assert.equal(r.data.code, 'invalid_request'); assert.equal(r.data.cause, 'effect_denied');
    assert.equal(r.data.details.serverEnabled, allowEffects); assert.equal(r.data.details.requestEnabled, false);
    assert.match(r.data.details.serverEntry, /mcp\/server.mjs$/);
    assert.deepEqual(r.data.details.example, { allowEffects: ['omega_batch'] });
    assert.match(r.data.error, /mcp.<name>.environment/); assert.match(r.data.error, /restart MCP/);
  }
  assert.equal(calls, 0);
});

test('invalid outputs fail preflight; literals and references preserve arbitrary result types', async () => {
  let calls = 0;
  const flow = createFlowRuntime(async () => { calls++; return { isError: false, text: 'ok' }; });
  assert.deepEqual(FLOW_TOOL.inputSchema.properties.outputs, outputsSchema);
  for (const outputs of [null, 5, false, 'steps.g.text', [], { nested: { $ref: 4 } }, { $literal: 1, x: 2 }]) {
    const r = await flow({ steps: [{ id: 'g', tool: 'omega_read' }], outputs });
    assert.equal(r.data.state, 'rejected'); assert.equal(r.data.code, 'invalid_request');
  }
  assert.equal(calls, 0);
  for (const value of [null, false, 5, 'text', [1, 2]]) {
    const r = await flow({ steps: [{ id: 's', set: value }], outputs: { $literal: value } });
    assert.equal(r.data.state, 'success'); assert.deepEqual(r.data.outputs, value);
  }
});

test('retained handles are addressable and included in reference diagnostics', async () => {
  const flow = createFlowRuntime(async () => ({ isError: false, text: 'started', data: { jobId: 'job-test' } }), { allowEffects: true });
  const r = await flow({ allowEffects: ['omega_batch'], steps: [{ id: 'b', tool: 'omega_batch' }],
    outputs: { $ref: 'steps.b.handles.jobId' } });
  assert.equal(r.data.outputs, 'job-test');
  const bad = await flow({ allowEffects: ['omega_batch'], steps: [{ id: 'b', tool: 'omega_batch' }],
    outputs: { $ref: 'steps.b.handles.nope' } });
  assert.deepEqual(bad.data.failure.details.handleKeys, ['jobId']);
});
