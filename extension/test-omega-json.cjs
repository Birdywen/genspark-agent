const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync(__dirname + '/content-src/01-omega-json.js', 'utf8');
vm.runInThisContext(source);

const LF = String.fromCharCode(10);
const slash = String.fromCharCode(92);

const valid = JSON.stringify({ tool: 'run_process', params: { stdin: 'line1' + LF + 'line2' } });
const invalid = valid.replace('line1' + slash + 'nline2', 'line1' + LF + 'line2');
const controlRepaired = parseOmegaPayload(invalid);
assert.equal(controlRepaired.params.stdin, 'line1' + LF + 'line2');
assert.equal(controlRepaired.__omegaRepair.repaired, true);
assert.equal(controlRepaired.__omegaRepair.actions[0].type, 'escape_control_characters');

const missingObject = parseOmegaPayload('{"tool":"run_process","params":{"command_line":"echo ok"}');
assert.equal(missingObject.tool, 'run_process');
assert.equal(missingObject.params.command_line, 'echo ok');
assert.equal(missingObject.__omegaRepair.actions[0].type, 'append_missing_brackets');
assert.equal(missingObject.__omegaRepair.actions[0].value, '}');

const missingNested = parseOmegaPayload('{"steps":[{"tool":"run_process","params":{"command_line":"echo ok"}}');
assert.equal(missingNested.steps[0].tool, 'run_process');
assert.equal(missingNested.__omegaRepair.actions[0].value, ']}');

const extraObject = parseOmegaPayload('{"tool":"run_process","params":{}}}}');
assert.equal(extraObject.tool, 'run_process');
assert.equal(extraObject.__omegaRepair.actions[0].type, 'remove_trailing_extra_brackets');
assert.equal(extraObject.__omegaRepair.actions[0].count, 2);

const bracketsInString = parseOmegaPayload('{"tool":"run_process","params":{"command_line":"echo \\"{ [ ] }\\""}}');
assert.equal(bracketsInString.params.command_line, 'echo "{ [ ] }"');
assert.equal(bracketsInString.__omegaRepair, undefined);

const combined = parseOmegaPayload('{"tool":"run_process","params":{"stdin":"line1' + LF + 'line2"}');
assert.equal(combined.params.stdin, 'line1' + LF + 'line2');
assert.deepEqual(combined.__omegaRepair.actions.map(x => x.type), ['escape_control_characters', 'append_missing_brackets']);

assert.throws(
  () => parseOmegaPayload('{"tool":"run_process","params":[1,2}}'),
  /JSON|position|line|Expected/i
);
assert.throws(
  () => parseOmegaPayload('{"tool":"run_process","params":{"stdin":"unterminated}}'),
  /JSON|position|line/i
);
assert.throws(
  () => parseOmegaPayload('{"tool":"run_process",,"params":{}}'),
  /JSON|position|line|Expected/i
);

assert.equal(Object.keys(missingObject).includes('__omegaRepair'), false);
assert.equal(JSON.stringify(missingObject).includes('__omegaRepair'), false);

const raw = JSON.stringify({ tool: 'run_process', params: { stdin: { $raw: 'patch' } } }) +
  LF + 'ΩRAW patch' + LF + 'print("hello")' + LF + '中文' + LF + 'ΩRAWEND patch';
assert.equal(parseOmegaPayload(raw).params.stdin, 'print("hello")' + LF + '中文');

assert.throws(
  () => parseOmegaPayload(JSON.stringify({ tool: 'run_process', params: { stdin: { $raw: 'missing' } } })),
  /not found/
);
assert.throws(
  () => parseOmegaPayload(JSON.stringify({ tool: 'x', params: { stdin: { $raw: 'p' } } }) + LF + 'ΩRAW p' + LF + 'x'),
  /Unclosed/
);

console.log('omega json parser tests passed');