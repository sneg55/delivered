import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chainIdOf, termAmount, buildAuthorization, typedData, envelope, encodeHeader, decodeSettlement,
  payAndFetch,
} from '../src/x402-v2.mjs';

const V2_TERM = {
  scheme: 'exact',
  network: 'eip155:8453',
  amount: '1000',
  asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  payTo: '0x209693Bc6afc0C5328bA36FaF03C514EF312287C',
  maxTimeoutSeconds: 60,
  extra: { name: 'USDC', version: '2' },
};
const V1_TERM = { ...V2_TERM, network: 'base', maxAmountRequired: '1000', amount: undefined };

test('CAIP-2 and named identifiers resolve to the same chain', () => {
  assert.equal(chainIdOf('eip155:8453'), 8453);
  assert.equal(chainIdOf('base'), 8453);
  assert.equal(chainIdOf('eip155:84532'), 84532);
  assert.throws(() => chainIdOf('solana:mainnet'), /unsupported network/);
});

test('amount is read from either the v2 or the v1 field name', () => {
  assert.equal(termAmount(V2_TERM), '1000');
  assert.equal(termAmount(V1_TERM), '1000');
});

test('the signing domain is identical for v1 and v2 terms of the same chain', () => {
  const auth = buildAuthorization('0x857b06519E91e3A54538791bDbb0E22373e36b66', V2_TERM, 1_740_672_089);
  const a = typedData(auth, V2_TERM);
  const b = typedData(auth, V1_TERM);
  assert.deepEqual(a.domain, b.domain);
  assert.deepEqual(a.types, b.types);
  assert.equal(a.primaryType, 'TransferWithAuthorization');
  assert.equal(a.domain.chainId, 8453);
  assert.equal(a.domain.verifyingContract, V2_TERM.asset);
});

test('the validity window brackets the quoted timeout', () => {
  const now = 1_740_672_089;
  const auth = buildAuthorization('0xabc', V2_TERM, now);
  assert.equal(auth.validAfter, String(now - 600));
  assert.equal(auth.validBefore, String(now + 60));
  assert.equal(auth.value, '1000');
  assert.equal(auth.to, V2_TERM.payTo);
  assert.match(auth.nonce, /^0x[0-9a-f]{64}$/);
});

test('a term with no parseable amount is refused before any signing', () => {
  assert.throws(() => buildAuthorization('0xabc', { ...V2_TERM, amount: 'free' }), /no parseable amount/);
});

test('the v2 envelope carries accepted and resource, the v1 envelope carries neither', () => {
  const auth = buildAuthorization('0xabc', V2_TERM, 1_740_672_089);
  const v2 = envelope({ version: 2, term: V2_TERM, signature: '0xsig', authorization: auth, url: 'https://x.test/a' });
  assert.equal(v2.x402Version, 2);
  assert.equal(v2.accepted.network, 'eip155:8453');
  assert.equal(v2.accepted.amount, '1000');
  assert.equal(v2.resource.url, 'https://x.test/a');
  assert.deepEqual(v2.extensions, {});
  assert.deepEqual(v2.payload, { signature: '0xsig', authorization: auth });

  const v1 = envelope({ version: 1, term: V1_TERM, signature: '0xsig', authorization: auth, url: 'https://x.test/a' });
  assert.equal(v1.x402Version, 1);
  assert.equal(v1.network, 'base');
  assert.equal(v1.accepted, undefined);
  assert.equal(v1.resource, undefined);
  assert.deepEqual(v1.payload, { signature: '0xsig', authorization: auth });
});

test('the v2 envelope prefers the resource block the seller published', () => {
  const auth = buildAuthorization('0xabc', V2_TERM, 1);
  const v2 = envelope({
    version: 2, term: V2_TERM, signature: '0x', authorization: auth, url: 'https://fallback.test',
    challenge: { resource: { url: 'https://declared.test/a', description: 'd', mimeType: 'text/plain' } },
  });
  assert.equal(v2.resource.url, 'https://declared.test/a');
  assert.equal(v2.resource.mimeType, 'text/plain');
});

test('the payment header is base64 JSON that round-trips', () => {
  const payload = { x402Version: 2, payload: { signature: '0xsig' } };
  const header = encodeHeader(payload);
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64').toString('utf8')), payload);
});

test('a term above the cap is refused before the wallet is ever asked to sign', async () => {
  let signCalls = 0;
  const client = { signTypedData: async () => { signCalls++; return '0xsig'; } };
  await assert.rejects(
    payAndFetch({
      url: 'https://x.test/a',
      init: { method: 'GET', headers: {} },
      challenge: { x402Version: 2 },
      term: { ...V2_TERM, amount: '150001' },
      client,
      account: { address: '0xabc' },
      maxAtomic: 150000,
    }),
    /exceeds cap 150000; refusing to sign/,
  );
  assert.equal(signCalls, 0);
});

test('a term at exactly the cap is allowed to sign', async () => {
  let signed = null;
  const client = { signTypedData: async (d) => { signed = d; return '0xsig'; } };
  const originalFetch = globalThis.fetch;
  let sentHeaders = null;
  globalThis.fetch = async (u, init) => { sentHeaders = init.headers; return new Response('{}', { status: 200 }); };
  try {
    const { payload, version } = await payAndFetch({
      url: 'https://x.test/a',
      init: { method: 'GET', headers: {} },
      challenge: { x402Version: 2 },
      term: { ...V2_TERM, amount: '150000' },
      client,
      account: { address: '0x857b06519E91e3A54538791bDbb0E22373e36b66' },
      maxAtomic: 150000,
      nowSeconds: 1_740_672_089,
    });
    assert.ok(signed);
    assert.equal(version, 2);
    assert.equal(payload.accepted.amount, '150000');
    assert.equal(payload.payload.signature, '0xsig');
    assert.ok(sentHeaders['X-PAYMENT']);
    assert.equal(sentHeaders['PAYMENT-SIGNATURE'], sentHeaders['X-PAYMENT']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('an absent or unreadable settlement receipt is null, not a throw', () => {
  assert.equal(decodeSettlement(null), null);
  assert.equal(decodeSettlement('not-base64-json'), null);
  assert.deepEqual(decodeSettlement(encodeHeader({ success: true, transaction: '0xdead' })),
    { success: true, transaction: '0xdead' });
});
