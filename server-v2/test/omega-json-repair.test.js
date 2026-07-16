import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcPath = path.resolve(__dirname, '../../extension/content-src/01-omega-json.js');
const src = fs.readFileSync(srcPath, 'utf8');
const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext('var window = this;\n' + src + '\nthis.parseOmegaPayload = parseOmegaPayload;\nthis.omegaRepairJsonBrackets = omegaRepairJsonBrackets;\nthis.omegaRepairJsonTrailingCommas = omegaRepairJsonTrailingCommas;\nthis.omegaRepairJsonMissingCommas = omegaRepairJsonMissingCommas;', sandbox);
const { parseOmegaPayload, omegaRepairJsonMissingCommas, omegaRepairJsonTrailingCommas } = sandbox;

function actions(p) {
  return (p && p.__omegaRepair && p.__omegaRepair.actions) || [];
}
function hasAction(p, type) {
  return actions(p).some(a => a.type === type);
}

// brackets
{
  const p = parseOmegaPayload('{"tool":"run_process","params":{"command_line":"echo ok"');
  assert.equal(p.params.command_line, 'echo ok');
  assert.ok(hasAction(p, 'append_missing_brackets'));
}
{
  const p = parseOmegaPayload('{"tool":"run_process","params":{"command_line":"echo ok"},"saveAs":"t"}}');
  assert.equal(p.saveAs, 't');
  assert.ok(hasAction(p, 'remove_trailing_extra_brackets'));
}

// trailing commas
{
  const p = parseOmegaPayload('{"tool":"run_process","params":{"command_line":"echo ok",},"saveAs":"t"}');
  assert.equal(p.saveAs, 't');
  assert.ok(hasAction(p, 'remove_trailing_commas'));
}
{
  const p = parseOmegaPayload('{"a":1,"b":[1,2,],"c":{"d":true,},}');
  assert.deepEqual(p, { a: 1, b: [1, 2], c: { d: true } });
}

// missing commas (lesson)
{
  const p = parseOmegaPayload('{"steps":[{"tool":"run_process","params":{"command_line":"echo a"}} {"tool":"run_process","params":{"command_line":"echo b"}}]}');
  assert.equal(p.steps.length, 2);
  assert.ok(hasAction(p, 'insert_missing_commas'));
}
{
  const p = parseOmegaPayload('{"tool":"run_process" "params":{"command_line":"echo ok"}}');
  assert.equal(p.tool, 'run_process');
  assert.equal(p.params.command_line, 'echo ok');
}
{
  const p = parseOmegaPayload('{"steps":[{"tool":"run_process","params":{"command_line":"echo a"}} {"tool":"run_process","params":{"command_line":"echo b"}}');
  assert.equal(p.steps.length, 2);
  assert.ok(hasAction(p, 'insert_missing_commas'));
  assert.ok(hasAction(p, 'append_missing_brackets'));
}

// control chars
{
  const raw = '{"tool":"run_process","params":{"command_line":"line1' + String.fromCharCode(10) + 'line2"},"saveAs":"t"}';
  const p = parseOmegaPayload(raw);
  assert.equal(p.params.command_line, 'line1\nline2');
  assert.ok(hasAction(p, 'escape_control_characters'));
}

// valid untouched
{
  const p = parseOmegaPayload('{"tool":"run_process","params":{"command_line":"echo ok"},"saveAs":"t"}');
  assert.equal(p.tool, 'run_process');
  assert.equal(p.__omegaRepair, undefined);
}

// safety: do not invent structure for junk / mismatch / single quotes
for (const bad of [
  '{"tool":"run_process","params":{"command_line":"echo ok"}},"saveAs":"t"}',
  '{\'tool\':\'run_process\'}',
  '{"steps":{"tool":"x"}]}',
  '{"a":1} }x'
]) {
  assert.throws(() => parseOmegaPayload(bad));
}

// helper cleanliness: comma sits after token, not before whitespace blob
{
  const r = omegaRepairJsonMissingCommas('{"steps":[{} {}]}');
  assert.equal(r.text, '{"steps":[{}, {}]}');
  assert.equal(r.actions[0].count, 1);
}
{
  const r = omegaRepairJsonTrailingCommas('{"a":1,}');
  assert.equal(r.text, '{"a":1}');
}

// string safety
{
  const p = parseOmegaPayload('{"tool":"run_process","params":{"command_line":"echo {a} [b]"},"saveAs":"t"}');
  assert.equal(p.params.command_line, 'echo {a} [b]');
  assert.equal(p.__omegaRepair, undefined);
}

console.log('✓ Omega JSON repair: brackets, trailing commas, missing commas, control chars, safety');
