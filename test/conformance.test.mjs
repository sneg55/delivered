import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  contractFrom, checkConformance, findNested, nestingReport, semanticCheck, classifyPaidResponse,
} from '../src/conformance.mjs';

const inlineTerm = {
  outputSchema: {
    type: 'object',
    properties: { schema: { type: 'string' }, n: { type: 'integer' }, is_prime: { type: 'boolean' } },
  },
};
const exampleListing = {
  extensions: { bazaar: { info: { output: { example: { schema: 'x', n: 1, is_prime: true } } } } },
};

test('inline challenge schema wins over the registry example', () => {
  const c = contractFrom(inlineTerm, exampleListing);
  assert.equal(c.kind, 'inline JSON Schema (from live challenge)');
});

test('registry example is used only when no inline schema exists', () => {
  const c = contractFrom({}, exampleListing);
  assert.equal(c.kind, 'registry example object');
  assert.deepEqual(c.keys, [['schema', 'string'], ['n', 'number'], ['is_prime', 'boolean']]);
});

test('a seller with no declared output is UNCHECKABLE, never a violation', () => {
  const c = contractFrom({}, {});
  assert.equal(c.kind, 'none');
  assert.equal(checkConformance({ anything: 1 }, c).verdict, 'UNCHECKABLE');
});

test('all declared fields present with matching types conforms', () => {
  const c = contractFrom(inlineTerm, null);
  const r = checkConformance({ schema: 'delx/is-prime/v1', n: 97, is_prime: true }, c);
  assert.equal(r.verdict, 'CONFORMS');
});

test('integer declared, number received is not a type mismatch', () => {
  const c = contractFrom(inlineTerm, null);
  assert.equal(checkConformance({ schema: 'x', n: 97.0, is_prime: true }, c).verdict, 'CONFORMS');
});

test('a wrong type is a violation and names the field', () => {
  const c = contractFrom(inlineTerm, null);
  const r = checkConformance({ schema: 'x', n: 'ninety-seven', is_prime: true }, c);
  assert.equal(r.verdict, 'VIOLATION');
  assert.match(r.detail, /n: declared integer, got string/);
});

test('a non-object body violates an object contract', () => {
  const c = contractFrom(inlineTerm, null);
  assert.equal(checkConformance(['a'], c).verdict, 'VIOLATION');
  assert.equal(checkConformance(null, c).verdict, 'VIOLATION');
});

test('findNested stops at depth 4 rather than recursing forever', () => {
  const deep = { a: { b: { c: { d: { e: { target: 1 } } } } } };
  assert.equal(findNested(deep, 'target'), undefined);
  assert.equal(findNested({ a: { b: { target: 1 } } }, 'target'), 1);
});

test('a wrapper envelope is reported as nesting, not as a wrong answer', () => {
  const c = contractFrom(inlineTerm, null);
  const body = { tool_name: 'util_is_prime', result: { schema: 'delx/is-prime/v1', n: 97, is_prime: true } };
  const conf = checkConformance(body, c);
  assert.equal(conf.verdict, 'VIOLATION');
  const note = nestingReport(body, c, conf.verdict);
  assert.match(note, /schema, n, is_prime/);
  assert.equal(semanticCheck(body, { is_prime: true, n: 97 }), 'values correct (searched at any depth)');
});

test('a nested but wrong value is reported as a wrong value', () => {
  const body = { result: { n: 97, is_prime: false } };
  assert.match(semanticCheck(body, { is_prime: true }), /WRONG VALUE/);
});

test('a 402 re-challenge is a client fault, never a seller contract violation', () => {
  const c = contractFrom(inlineTerm, null);
  const r = classifyPaidResponse({ httpStatus: 402, parsed: { x402Version: 2, accepts: [] }, contract: c });
  assert.equal(r.verdict, 'PAYMENT_REJECTED');
  assert.equal(r.delivered, false);
});

test('a 4xx refusal is not delivery and is not scored against the contract', () => {
  const c = contractFrom(inlineTerm, null);
  for (const status of [400, 422, 500]) {
    const r = classifyPaidResponse({ httpStatus: status, parsed: { error: 'missing param' }, contract: c });
    assert.equal(r.verdict, 'NOT_DELIVERED');
    assert.equal(r.delivered, false);
  }
});

test('only an HTTP 200 produces a contract verdict', () => {
  const c = contractFrom(inlineTerm, null);
  const r = classifyPaidResponse({
    httpStatus: 200,
    parsed: { schema: 'x', n: 97, is_prime: true },
    contract: c,
  });
  assert.equal(r.verdict, 'CONFORMS');
  assert.equal(r.delivered, true);
});

test('every recorded non-200 in the evidence file reclassifies away from a contract verdict', () => {
  const rows = JSON.parse(fs.readFileSync(new URL('../evidence/results.json', import.meta.url), 'utf8'));
  const scored = rows.filter((r) => typeof r.httpStatus === 'number');
  assert.ok(scored.length > 0);
  for (const row of scored) {
    const contract = { kind: 'stub', required: new Set(['x']), keys: [['x', 'string']] };
    const r = classifyPaidResponse({ httpStatus: row.httpStatus, parsed: row.body, contract });
    if (row.httpStatus !== 200)
      assert.ok(!['CONFORMS', 'VIOLATION', 'UNCHECKABLE'].includes(r.verdict),
        `${row.url} (HTTP ${row.httpStatus}) must not receive a contract verdict, got ${r.verdict}`);
  }
});
