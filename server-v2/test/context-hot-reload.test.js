import assert from 'node:assert/strict';
import { applyContextHotReload } from '../core/context-hot-reload.js';

const latest = [
  {role:'user',content:'以下是JSON格式的经验教训和工作规则，严格遵守。'},
  {role:'assistant',content:'{"philosophy":"new","sys_tools":{}}'},
  {role:'user',content:'rules已加载。new'}
];

const serialized = [
  {id:'keep-0',role:'user',content:JSON.stringify([
    {role:'user',content:'以下是JSON格式的经验教训和工作规则，严格遵守。old'},
    {role:'assistant',content:'old'},
    {role:'user',content:'old'}
  ])},
  {id:'keep-1',role:'assistant',content:'conversation'},
  {id:'old-restore',role:'user',content:'Context restored. 10 messages compressed.\n## DB表结构'}
];
const serializedResult = applyContextHotReload(serialized, latest, 'fresh restore');
assert.equal(serializedResult.forgedHotReload, true);
assert.equal(serializedResult.forgedLayout, 'serialized-single-message');
assert.equal(serializedResult.restoreReplaced, true);
assert.equal(serializedResult.beforeMessages, serializedResult.totalMsgs);
assert.equal(serializedResult.messages[0].id, 'keep-0');
assert.deepEqual(JSON.parse(serializedResult.messages[0].content), latest);
assert.equal(serializedResult.messages[2].id, 'old-restore');
assert.match(serializedResult.messages[2].content, /^\[OMEGA_CONTEXT_RESTORE_V5\]/);

const separate = [
  {id:'a',role:'user',content:'以下是JSON格式的经验教训和工作规则，严格遵守。'},
  {id:'b',role:'assistant',content:'{"philosophy":"old","sys_tools":{}}'},
  {id:'c',role:'user',content:'rules已加载。old'},
  {id:'r1',role:'user',content:'[OMEGA_CONTEXT_RESTORE_V5]\nold'},
  {id:'r2',role:'user',content:'元数据索引 (compress v5 — duplicate)'}
];
const separateResult = applyContextHotReload(separate, latest, 'new restore');
assert.equal(separateResult.forgedLayout, 'separate-messages');
assert.equal(separateResult.messages[0].id, 'a');
assert.equal(separateResult.messages[1].content, latest[1].content);
assert.equal(separateResult.restoreDuplicatesRemoved, 1);
assert.equal(separateResult.totalMsgs, 4);

const absent = [{id:'x',role:'user',content:'ordinary'}];
const absentResult = applyContextHotReload(absent, latest, 'restore');
assert.equal(absentResult.forgedHotReload, false);
assert.equal(absentResult.restoreReplaced, false);
assert.equal(absentResult.totalMsgs, 2);

console.log('context hot reload tests passed');
