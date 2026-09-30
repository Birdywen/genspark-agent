// Shared input contract and bounded reference diagnostics for omega_flow.
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const keys = (value) => value && typeof value === 'object'
  ? Object.keys(value).filter((key) => !forbidden.has(key)).slice(0, 20).map((key) => key.slice(0, 80)) : [];

export const outputsSchema = {
  type: 'object',
  description: 'Output projection: named object, {"$ref":"steps.id.data"}, or {"$literal":<any JSON>}. Bare scalars/arrays are invalid. Result values may have any JSON type.',
  oneOf: [
    { required: ['$ref'], additionalProperties: false, properties: { $ref: { type: 'string', pattern: '^(vars|steps)(\\.[A-Za-z0-9_-]+)+$' } } },
    { required: ['$literal'], additionalProperties: false, properties: { $literal: {} } },
    { not: { anyOf: [{ required: ['$ref'] }, { required: ['$literal'] }] }, additionalProperties: true },
  ],
};

export function validateOutputs(value) {
  if (!object(value)) throw Error('outputs must be an object projection, {"$ref":"steps.id.data"}, or {"$literal":<JSON>}; bare scalars/arrays are invalid');
  if (own(value, '$ref') && (Object.keys(value).length !== 1 || typeof value.$ref !== 'string'
    || !/^(vars|steps)(\.[A-Za-z0-9_-]+)+$/.test(value.$ref))) throw Error('outputs.$ref must be the only key and a valid reference string');
  if (own(value, '$literal') && Object.keys(value).length !== 1) throw Error('outputs.$literal must be the only key');
}

export function reference(path, context) {
  if (typeof path !== 'string' || !/^(vars|steps)(\.[A-Za-z0-9_-]+)+$/.test(path)) throw Error(`invalid ref: ${path}`);
  let value = context;
  const parts = path.split('.'), traversed = [];
  for (const part of parts) {
    if (forbidden.has(part) || value === null || typeof value !== 'object' || !own(value, part)) {
      const parent = traversed.join('.') || '<root>';
      const availableKeys = keys(value);
      const step = parts[0] === 'steps' && own(context.steps ?? {}, parts[1]) ? context.steps[parts[1]] : undefined;
      const details = { ref: path.slice(0, 240), parent: parent.slice(0, 240), availableKeys,
        ...(step ? { stepKeys: keys(step), dataKeys: keys(step.data), handleKeys: keys(step.handles) } : {}) };
      const hint = parts[0] === 'vars' ? 'set stores only steps.<id>.data; it never changes vars.'
        : step && !own(step, 'data') && own(step, 'text') ? `Use steps.${parts[1]}.text; data exists only if returned by the tool or parseJson:true succeeds.` : '';
      throw Object.assign(new Error(`missing ref: ${path.slice(0, 160)}; available at ${parent.slice(0, 100)}: ${availableKeys.slice(0, 8).join(', ') || '(none)'}. ${hint}`),
        { code: 'missing_ref', details: { ...details, ...(hint ? { hint } : {}) } });
    }
    value = value[part]; traversed.push(part);
  }
  return structuredClone(value);
}
