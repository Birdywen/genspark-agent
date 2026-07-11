import fs from "fs";
import Router from '../core/router.js';
import assert from 'assert';

// mock logger
const logs = [];
const logger = {
  info: (m) => logs.push(['info', m]),
  warn: (m) => logs.push(['warning', m]),
  warning: (m) => logs.push(['warning', m]),
  error: (m) => logs.push(['error', m])
};

// mock driver
const testDriver = {
  name: 'test-driver',
  tools: ['test_tool_a', 'test_tool_b'],
  async handle(tool, params, context) {
    context.trace.span('test-driver', { tool });
    return { success: true, result: 'handled_' + tool, params };
  }
};

// mock ws
const sent = [];
const mockWs = { send: (data) => sent.push(JSON.parse(data)) };

async function runTests() {
  const router = new Router(logger);

  // Test 1: register
  const ok = router.register(testDriver);
  assert(ok === true, 'register should return true');
  assert(router.handlers.size === 2, 'should have 2 tools registered');
  assert(router.drivers.size === 1, 'should have 1 driver');

  // Test 2: dispatch to registered tool
  const result = await router.dispatch('test_tool_a', { foo: 'bar' }, mockWs, { id: '1', tool: 'test_tool_a' });
  assert(result.success === true, 'dispatch should succeed');
  assert(result.result === 'handled_test_tool_a', 'result should match');

  // Test 3: dispatch unknown tool with fallback
  let fallbackCalled = false;
  router.setFallback(async (ws, msg) => {
    fallbackCalled = true;
    return { success: true, result: 'fallback' };
  });
  await router.dispatch('unknown_tool', {}, mockWs, { id: '2', tool: 'unknown_tool' });
  assert(fallbackCalled === true, 'fallback should be called for unknown tool');

  // Test 4: dispatch unknown tool without fallback throws
  const router2 = new Router(logger);
  try {
    await router2.dispatch('no_such_tool', {}, mockWs, { id: '3', tool: 'no_such_tool' });
    assert(false, 'should have thrown');
  } catch (e) {
    assert(e.message.includes('TOOL_NOT_FOUND'), 'error should mention TOOL_NOT_FOUND');
  }

  // Test 5: listTools
  const tools = router.listTools();
  assert(tools['test-driver'].length === 2, 'should list 2 tools');
  assert(tools['test-driver'].includes('test_tool_a'), 'should include test_tool_a');

  // Test 6: register invalid driver
  const bad = router.register({ name: 'bad' });
  assert(bad === false, 'invalid driver should return false');

  // Test 7: duplicate tool warning
  const dup = { name: 'dup-driver', tools: ['test_tool_a'], async handle() {} };
  router.register(dup);
  const warnings = logs.filter(l => l[0] === 'warning' && l[1].includes('overwritten'));
  assert(warnings.length > 0, 'should warn about duplicate tool');

  // Test 8: trace is generated and flushed

  const traceLog = fs.readFileSync('/private/tmp/omega-trace.log', 'utf8');
  assert(traceLog.includes('test_tool_a'), 'trace log should contain dispatched tool');

  console.log('ALL ROUTER TESTS PASSED (8 tests)');
}

runTests().catch(e => { console.error('TEST FAILED:', e.message); process.exit(1); });