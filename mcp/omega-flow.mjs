// Small JSON orchestration runtime. No eval, interpolation, nested flows or retries.
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const READ = new Set(['omega_read', 'omega_grep', 'omega_guard_check', 'omega_health',
  'omega_quota', 'omega_sqlite', 'omega_batch_status', 'artifact_read', 'artifact_search']);
const EFFECT = new Set(['omega_edit', 'omega_undo', 'omega_batch', 'omega_batch_cancel']);
const BAD = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_BYTES = 256_000;
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const object = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const bytes = (v) => Buffer.byteLength(JSON.stringify(v));

function safe(value, depth = 0) {
  if (depth > 24) throw Error('JSON nesting exceeds 24');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (!value || typeof value !== 'object') throw Error('JSON values only');
  for (const [key, child] of Object.entries(value)) {
    if (BAD.has(key)) throw Error(`forbidden key: ${key}`);
    safe(child, depth + 1);
  }
}

function reference(path, context) {
  if (typeof path !== 'string' || !/^(vars|steps)(\.[A-Za-z0-9_-]+)+$/.test(path)) throw Error(`invalid ref: ${path}`);
  let value = context;
  for (const part of path.split('.')) {
    if (BAD.has(part) || value === null || typeof value !== 'object' || !own(value, part)) throw Error(`missing ref: ${path}`);
    value = value[part];
  }
  // Copy: a called tool cannot mutate the stored result or input variables.
  return structuredClone(value);
}

function resolve(value, context, budget = { left: MAX_BYTES }) {
  const charge = (v) => {
    budget.left -= bytes(v);
    if (budget.left < 0) throw Error('resolved value exceeds 256 KB');
    return v;
  };
  if (Array.isArray(value)) { charge([]); return value.map((v) => resolve(v, context, budget)); }
  if (!object(value)) return charge(value);
  if (own(value, '$literal')) {
    if (Object.keys(value).length !== 1) throw Error('$literal must be the only key');
    charge(value.$literal);
    return structuredClone(value.$literal);
  }
  if (own(value, '$ref')) {
    if (Object.keys(value).length !== 1) throw Error('$ref must be the only key');
    return charge(reference(value.$ref, context));
  }
  charge(Object.keys(value));
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v, context, budget)]));
}

function condition(test, context) {
  const left = resolve(test.left, context), right = resolve(test.right, context);
  if (test.op === 'eq') return isDeepStrictEqual(left, right);
  if (test.op === 'ne') return !isDeepStrictEqual(left, right);
  if (test.op === 'contains') {
    if (typeof left === 'string' && typeof right === 'string') return left.includes(right);
    if (Array.isArray(left)) return left.some((v) => isDeepStrictEqual(v, right));
    throw Error('contains requires strings or a left array');
  }
  if (typeof left !== 'number' || typeof right !== 'number') throw Error('ordered comparisons require numbers');
  return test.op === 'gt' ? left > right : test.op === 'gte' ? left >= right : test.op === 'lt' ? left < right : left <= right;
}

function validate(args, allowEffects) {
  safe(args);
  const keys = (obj, names) => {
    if (Object.keys(obj).some((key) => !names.includes(key))) throw Error('unknown field in flow plan');
  };
  keys(args, ['action', 'vars', 'steps', 'allowEffects', 'stopOnError', 'outputs', 'verbose', 'waitMs']);
  if (bytes(args) > MAX_BYTES) throw Error('flow input exceeds 256 KB');
  if (!Array.isArray(args.steps) || !args.steps.length || args.steps.length > 32) throw Error('steps must contain 1..32 entries');
  if (args.vars !== undefined && !object(args.vars)) throw Error('vars must be an object');
  if (args.stopOnError !== undefined && typeof args.stopOnError !== 'boolean') throw Error('stopOnError must be boolean');
  const effects = args.allowEffects ?? [];
  if (!Array.isArray(effects) || effects.some((v) => !EFFECT.has(v))) throw Error('invalid allowEffects');
  const seen = new Set();
  const refs = (value) => {
    if (Array.isArray(value)) return value.forEach(refs);
    if (!object(value)) return;
    if (own(value, '$literal')) {
      if (Object.keys(value).length !== 1) throw Error('$literal must be the only key');
      return;
    }
    if (own(value, '$ref')) {
      if (Object.keys(value).length !== 1 || typeof value.$ref !== 'string' || !/^(vars|steps)(\.[A-Za-z0-9_-]+)+$/.test(value.$ref)) throw Error('invalid $ref');
      const [root, id, ...parts] = value.$ref.split('.');
      if ([id, ...parts].some((p) => BAD.has(p))) throw Error('forbidden ref key');
      if (root === 'steps' && !seen.has(id)) throw Error(`forward or unknown step ref: ${id}`);
      if (root === 'vars') reference(value.$ref, { vars: args.vars ?? {} });
      return;
    }
    Object.values(value).forEach(refs);
  };
  const checkCondition = (value) => {
    if (!object(value) || !['eq', 'ne', 'contains', 'gt', 'gte', 'lt', 'lte'].includes(value.op) || !own(value, 'left') || !own(value, 'right')) throw Error('invalid condition');
    keys(value, ['left', 'op', 'right']);
  };
  for (const step of args.steps) {
    if (!object(step) || typeof step.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,47}$/.test(step.id) || BAD.has(step.id) || seen.has(step.id)) throw Error('step IDs must be unique safe names');
    keys(step, ['id', 'tool', 'args', 'set', 'assert', 'when', 'parseJson']);
    if (['tool', 'set', 'assert'].filter((key) => own(step, key)).length !== 1) throw Error(`${step.id}: choose exactly one of tool/set/assert`);
    if (step.when !== undefined) checkCondition(step.when);
    if (own(step, 'assert')) checkCondition(step.assert);
    if (own(step, 'tool')) {
      if (!READ.has(step.tool) && !EFFECT.has(step.tool)) throw Error(`tool not composable: ${step.tool}`);
      if (EFFECT.has(step.tool) && (!allowEffects || !effects.includes(step.tool))) throw Error(`${step.tool} needs server OMEGA_FLOW_ALLOW_EFFECTS=1 and explicit allowEffects`);
      if (step.args !== undefined && !object(step.args)) throw Error('tool args must be an object');
      if (step.parseJson !== undefined && typeof step.parseJson !== 'boolean') throw Error('parseJson must be boolean');
    }
    refs(step);
    seen.add(step.id);
  }
  if (args.outputs !== undefined) refs(args.outputs);
}

export function createFlowRuntime(dispatch, { allowEffects = false, maxJobs = 16, ttlMs = 1_800_000 } = {}) {
  const jobs = new Map();
  const snapshot = (job, verbose) => {
    const result = { id: job.id, state: job.state, done: job.done, total: job.total,
      cancelRequested: job.cancelRequested, results: job.results,
      ...(job.outputs !== undefined ? { outputs: job.outputs } : {}),
      ...(job.error ? { error: job.error } : {}) };
    if (!verbose) result.results = job.results.map(({ text, data, ...r }) => ({ ...r, ...(text ? { preview: text.slice(0, 240) } : {}) }));
    return { isError: ['failed', 'cancelled'].includes(job.state), text: JSON.stringify(result), data: result };
  };
  const finish = (job) => { job.finished = Date.now(); job.resolve(); };
  async function run(job, args) {
    const context = { vars: structuredClone(args.vars ?? {}), steps: {} };
    let retained = bytes(context), failed = false;
    try {
      for (const step of args.steps) {
        if (job.cancelRequested || (failed && args.stopOnError !== false)) {
          const row = { id: step.id, status: 'skipped', reason: job.cancelRequested ? 'cancelled' : 'halted' };
          job.results.push(row); context.steps[step.id] = row;
          continue;
        }
        let row;
        try {
          if (step.when && !condition(step.when, context)) row = { id: step.id, status: 'skipped', reason: 'condition' };
          else if (own(step, 'set')) row = { id: step.id, status: 'passed', data: resolve(step.set, context) };
          else if (own(step, 'assert')) {
            if (!condition(step.assert, context)) throw Error('assertion failed');
            row = { id: step.id, status: 'passed', data: true };
          } else {
            const input = resolve(step.args ?? {}, context);
            if (!object(input)) throw Error('resolved args must be an object');
            const value = await dispatch(step.tool, input);
            if (!value || typeof value.text !== 'string' || typeof value.isError !== 'boolean') throw Error('invalid tool result');
            row = { id: step.id, tool: step.tool, status: value.isError ? 'failed' : 'passed', isError: value.isError, text: value.text };
            if (value.data !== undefined) { safe(value.data); row.data = structuredClone(value.data); }
            if (step.parseJson) { row.data = JSON.parse(value.text); safe(row.data); }
          }
          if (retained + bytes(row) > MAX_BYTES) throw Error('flow result storage exceeds 256 KB; underlying action may have completed');
        } catch (error) {
          row = { id: step.id, status: 'failed', error: String(error.message).slice(0, 2000) };
        }
        retained += bytes(row);
        job.results.push(row); context.steps[step.id] = row;
        if (row.status !== 'skipped') job.done++;
        if (row.status === 'failed') failed = true;
      }
      job.state = job.cancelRequested ? 'cancelled' : failed ? 'failed' : 'success';
      if (args.outputs !== undefined && job.state === 'success') {
        job.outputs = resolve(args.outputs, context);
        if (bytes(job.outputs) > MAX_BYTES) { delete job.outputs; throw Error('outputs exceed 256 KB'); }
      }
    } catch (error) { job.state = 'failed'; job.error = String(error.message).slice(0, 2000); }
    finally { finish(job); }
  }
  return async function omegaFlow(args = {}) {
    try {
      for (const [id, job] of jobs) if (job.finished && Date.now() - job.finished > ttlMs) jobs.delete(id);
      const action = args.action ?? 'start';
      if (!['start', 'status', 'cancel'].includes(action)) throw Error('action must be start/status/cancel');
      if (args.waitMs !== undefined && (!Number.isInteger(args.waitMs) || args.waitMs < 0 || args.waitMs > 50000)) throw Error('waitMs must be 0..50000');
      let job;
      if (action === 'start') {
        validate(args, allowEffects);
        if (jobs.size >= maxJobs) throw Error('flow capacity reached; completed jobs expire after 30 minutes');
        job = { id: `flow-${randomUUID()}`, state: 'running', total: args.steps.length, done: 0, results: [], cancelRequested: false };
        job.promise = new Promise((resolve) => { job.resolve = resolve; });
        jobs.set(job.id, job);
        // Defer: even a fully synchronous plan returns a real tracked job.
        const plan = structuredClone(args);
        setImmediate(() => void run(job, plan));
      } else {
        job = jobs.get(args.id);
        if (!job) throw Error('unknown or expired flow; running flows do not survive MCP restart');
        if (action === 'cancel' && job.state === 'running') job.cancelRequested = true;
      }
      const wait = args.waitMs ?? (action === 'cancel' ? 0 : 20000);
      if (job.state === 'running' && wait) {
        let timer;
        try { await Promise.race([job.promise, new Promise((resolve) => { timer = setTimeout(resolve, wait); })]); }
        finally { clearTimeout(timer); }
      }
      return snapshot(job, args.verbose === true);
    } catch (error) { return { isError: true, text: JSON.stringify({ state: 'rejected', error: String(error.message) }) }; }
  };
}

const conditionSchema = { type: 'object', required: ['left', 'op', 'right'], additionalProperties: false,
  properties: { left: {}, op: { enum: ['eq', 'ne', 'contains', 'gt', 'gte', 'lt', 'lte'] }, right: {} } };
export const FLOW_TOOL = {
  name: 'omega_flow',
  description: 'Bounded JSON micro-runtime composing omega tools. Actions start/status/cancel; 1..32 sequential tool/set/assert steps. Typed refs {"$ref":"vars.x"} or {"$ref":"steps.id.data"}; no interpolation/eval/retries. when uses {left,op,right}. Defaults to read-only; effect tools require OMEGA_FLOW_ALLOW_EFFECTS=1 AND request allowEffects. Calls reuse original guards but MCP checks only omega_flow permission, not nested tool permissions. Async batch launch is NOT batch success: use its data.jobId with omega_batch_status + parseJson and assert data.state. waitMs max50000; flows are memory-only, retained 30min, max16. Cancel stops future steps, not running tools or launched batches. No automatic rollback. outputs resolve only on success; verbose returns full retained step results.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {
    action: { enum: ['start', 'status', 'cancel'] }, id: { type: 'string' },
    vars: { type: 'object', additionalProperties: true },
    steps: { type: 'array', minItems: 1, maxItems: 32, items: { type: 'object', required: ['id'], additionalProperties: false,
      properties: { id: { type: 'string' }, tool: { enum: [...READ, ...EFFECT] }, args: { type: 'object', additionalProperties: true },
        set: {}, assert: conditionSchema, when: conditionSchema, parseJson: { type: 'boolean' } } } },
    allowEffects: { type: 'array', items: { enum: [...EFFECT] }, description: 'Explicit effect capability list; server must also opt in. Not a replacement for host approval.' },
    stopOnError: { type: 'boolean' }, outputs: {}, verbose: { type: 'boolean' },
    waitMs: { type: 'integer', minimum: 0, maximum: 50000 },
  } },
};
