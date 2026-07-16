const assert = require('assert');
const core = require('./conversation-cache-core.js');

const first = core.normalizeConversation({
  id: 'conv-1',
  name: 'Omega Cache',
  session_state: {
    messages: [
      { id: 'm1', role: 'user', content: '好的' },
      { id: 'm2', role: 'user', content: '关键根因：package.json 发生并发修改，必须重新读取。' },
      { id: 'm3', role: 'assistant', content: '已验证：重新读取后测试通过，command #71667。' }
    ]
  }
}, 'conv-1', {
  savedAt: '2026-07-06T10:00:00.000Z',
  reason: 'test'
});

const same = core.normalizeConversation({
  id: 'conv-1',
  name: 'Omega Cache',
  session_state: {
    messages: [
      { id: 'm1', role: 'user', content: '好的' },
      { id: 'm2', role: 'user', content: '关键根因：package.json 发生并发修改，必须重新读取。' },
      { id: 'm3', role: 'assistant', content: '已验证：重新读取后测试通过，command #71667。' }
    ]
  }
}, 'conv-1', {
  savedAt: '2026-07-06T11:00:00.000Z',
  reason: 'test'
});

assert.equal(first.messageCount, 3);
assert.equal(first.snapshotHash, same.snapshotHash);
assert.equal(core.diffSnapshots(first, same).identical, true);

const changed = core.normalizeConversation({
  id: 'conv-1',
  name: 'Omega Cache',
  session_state: {
    messages: [
      { id: 'm1', role: 'user', content: '好的' },
      { id: 'm2', role: 'user', content: '关键根因：package.json 发生并发修改，必须重新读取最新文件。' },
      { id: 'm3', role: 'assistant', content: '已验证：重新读取后测试通过，command #71667。' },
      { id: 'm4', role: 'user', content: '下一步：检查 Git working tree，不要混入无关文件。' }
    ]
  }
}, 'conv-1', {
  savedAt: '2026-07-13T10:00:00.000Z',
  reason: 'test'
});

const diff = core.diffSnapshots(first, changed);
assert.equal(diff.identical, false);
assert.equal(diff.added.length, 1);
assert.equal(diff.changed.length, 1);
assert.equal(diff.removed.length, 0);

const handoff = core.buildHandoff(changed);
assert.ok(handoff.text.includes('关键根因'));
assert.ok(handoff.text.includes('source_snapshot:'));
assert.ok(handoff.text.includes('message_id: m4'));
assert.ok(!handoff.selectedMessageIds.includes('m1'));

const search = core.searchSnapshot(first, 'package.json 并发');
assert.ok(search.length >= 1);
assert.equal(search[0].messageId, 'm2');
assert.equal(search[0].savedAt, '2026-07-06T10:00:00.000Z');

assert.equal(core.searchSnapshot(first, '').length, 0);
assert.equal(core.scoreMessage({ role: 'user', content: '好的' }, 0, 3), -100);

console.log('conversation cache core tests passed');