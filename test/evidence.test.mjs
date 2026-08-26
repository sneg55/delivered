import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
const merged = read('../evidence/results.json');
const run1 = read('../evidence/results-2026-08-26-v1client.json');
const raw1 = read('../evidence/results-2026-08-26-raw.json');
const run2 = read('../evidence/results-2026-08-26-run2-xpayment.json');
const run3 = read('../evidence/results-2026-08-26-run3.json');
const doc = fs.readFileSync(new URL('../docs/PAID-PROOF.md', import.meta.url), 'utf8');

const tally = (list) => list.reduce((t, r) => ({ ...t, [r.verdict]: (t[r.verdict] ?? 0) + 1 }), {});
const CONTRACT = ['CONFORMS', 'VIOLATION', 'UNCHECKABLE'];

for (const [name, rows] of [['merged', merged], ['run 1', run1], ['run 2', run2], ['run 3', run3]]) {
  test(`${name}: no non-200 response carries a contract verdict`, () => {
    for (const r of rows) {
      if (typeof r.httpStatus === 'number' && r.httpStatus !== 200)
        assert.ok(!CONTRACT.includes(r.verdict), `${r.url} returned HTTP ${r.httpStatus} but is scored ${r.verdict}`);
    }
  });

  test(`${name}: the delivered set is exactly the HTTP 200 set`, () => {
    assert.deepEqual(
      rows.filter((r) => r.delivered).map((r) => r.url).sort(),
      rows.filter((r) => r.httpStatus === 200).map((r) => r.url).sort(),
    );
  });
}

test('the merged state matches the tally published in PAID-PROOF.md', () => {
  assert.equal(merged.length, 47);
  const delivered = merged.filter((r) => r.delivered);
  assert.equal(delivered.length, 33);
  assert.deepEqual(tally(delivered), { CONFORMS: 19, VIOLATION: 10, UNCHECKABLE: 4 });
  assert.equal(merged.filter((r) => r.verdict === 'PAYMENT_REJECTED').length, 1);
  assert.match(doc, /46 paid attempts, 33 delivered, 29 checkable/);
  assert.match(doc, /19 `CONFORMS` \(65\.5%\), 10 `VIOLATION` \(34\.5%\)/);
});

test('the published conformance rate uses the checkable set as its denominator', () => {
  const checkable = merged.filter((r) => r.delivered && r.verdict !== 'UNCHECKABLE');
  assert.equal(checkable.length, 29);
  const conforms = checkable.filter((r) => r.verdict === 'CONFORMS').length;
  assert.equal(conforms, 19);
  assert.equal(((conforms / checkable.length) * 100).toFixed(1), '65.5');
});

test('run 3 is exactly the retry of run 2 rejects, and its wins are auditable', () => {
  const rejectedInRun2 = run2.filter((r) => r.verdict === 'PAYMENT_REJECTED');
  assert.equal(rejectedInRun2.length, 13);
  assert.equal(run3.length, 13);
  assert.deepEqual(run3.map((r) => r.url).sort(), rejectedInRun2.map((r) => r.url).sort());
  const delivered3 = run3.filter((r) => r.delivered);
  assert.equal(delivered3.length, 10);
  assert.deepEqual(tally(delivered3), { CONFORMS: 10 });
  const settled3 = run3.reduce((s, r) => s + (r.settledAmount ?? 0), 0);
  assert.equal(settled3.toFixed(6), '0.349000');
  assert.match(doc, /\| Settled spend \| \$0\.053954 \| \$0\.889971 \| \$0\.349000 \|/);
});

test('every merged row that superseded a rejection says so', () => {
  const replaced = merged.filter((r) => r.previousAttempt);
  assert.equal(replaced.length, 13);
  const rejectedUrls = new Set(run2.filter((r) => r.verdict === 'PAYMENT_REJECTED').map((r) => r.url));
  for (const r of replaced) {
    assert.ok(rejectedUrls.has(r.url), `${r.url} claims a previous rejection run 2 does not record`);
    assert.equal(r.previousAttempt.verdict, 'PAYMENT_REJECTED');
  }
});

test('run 1 keeps the tally it published, so the older claims stay checkable', () => {
  const delivered = run1.filter((r) => r.delivered);
  assert.equal(delivered.length, 7);
  assert.deepEqual(tally(delivered), { CONFORMS: 2, VIOLATION: 3, UNCHECKABLE: 2 });
  assert.equal(run1.filter((r) => r.verdict === 'PAYMENT_REJECTED').length, 15);
});

test('run 1 reclassification stays auditable against the raw run', () => {
  for (const r of run1.filter((x) => x.supersededVerdict))
    assert.ok(raw1.some((x) => x.url === r.url && x.verdict === r.supersededVerdict),
      `${r.url} claims a superseded verdict not present in the raw run`);
});

test('spend is reconciled from settlements and totals what the doc says', () => {
  const attributed = merged.reduce((s, r) => s + (r.settledAmount ?? 0), 0);
  assert.equal(attributed.toFixed(6), '1.018971');
  for (const r of merged.filter((x) => typeof x.settledAmount === 'number'))
    assert.equal(r.charged, r.settledAmount, `${r.url} charge disagrees with its settlement`);
  assert.match(doc, /Total settled across all runs:\s*\$1\.292925/);
});

test('an endpoint whose settlement cannot be attributed makes no charge claim', () => {
  const undetermined = merged.filter((r) => String(r.settlementAttribution).startsWith('UNDETERMINED'));
  assert.ok(undetermined.length > 0);
  for (const r of undetermined) {
    assert.equal(r.charged, null);
    assert.equal(r.settledAmount, null);
  }
});

test('only uniquely attributed settlements support a paid-but-not-delivered claim', () => {
  const claims = merged.filter((r) => !r.delivered && r.settledAmount > 0);
  assert.equal(claims.length, 2);
  assert.deepEqual(claims.map((r) => r.url).sort(), [
    'https://portfolio.lonestaroracle.xyz/analyze',
    'https://property.payapi.market/sold-prices',
  ]);
  for (const r of claims) assert.ok(r.settlementTx, `${r.url} claims a charge with no settlement tx`);
});
