import fs from 'node:fs';
import { classifyPaidResponse } from './conformance.mjs';

const IN = process.argv[2] ?? 'evidence/results-2026-08-26-raw.json';
const OUT = process.argv[3] ?? 'evidence/results.json';

const CONTRACT_VERDICTS = new Set(['CONFORMS', 'VIOLATION', 'UNCHECKABLE']);

const rows = JSON.parse(fs.readFileSync(IN, 'utf8'));
const out = rows.map((row) => {
  if (typeof row.httpStatus !== 'number') return { ...row, delivered: false };
  if (row.httpStatus === 200) return { ...row, delivered: true };
  const { verdict, detail, delivered } = classifyPaidResponse({
    httpStatus: row.httpStatus,
    parsed: row.body,
    contract: { kind: 'none', required: new Set(), keys: [] },
  });
  return {
    ...row,
    verdict,
    detail,
    delivered,
    supersededVerdict: CONTRACT_VERDICTS.has(row.verdict) ? row.verdict : undefined,
    supersededDetail: CONTRACT_VERDICTS.has(row.verdict) ? row.detail : undefined,
  };
});

const tally = {};
for (const r of out) tally[r.verdict] = (tally[r.verdict] ?? 0) + 1;
const delivered = out.filter((r) => r.delivered);
const deliveredTally = {};
for (const r of delivered) deliveredTally[r.verdict] = (deliveredTally[r.verdict] ?? 0) + 1;

fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(`read ${IN}, wrote ${OUT}`);
console.log('all attempts:', JSON.stringify(tally));
console.log(`delivered (HTTP 200): ${delivered.length} of ${out.length}`, JSON.stringify(deliveredTally));
console.log(`reclassified away from a contract verdict: ${out.filter((r) => r.supersededVerdict).length}`);
