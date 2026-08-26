import fs from 'node:fs';

const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const FILE = process.argv[2] ?? 'evidence/results.json';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const rows = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const registry = JSON.parse(fs.readFileSync(process.env.X402_REGISTRY ?? 'cdp_all.json', 'utf8'));
const byResource = new Map(registry.map((r) => [r.resource, r]));

let filled = 0;
for (const row of rows) {
  if (row.payTo) continue;
  const listing = byResource.get(row.url);
  const info = listing?.extensions?.bazaar?.info ?? {};
  const method = (info.input?.method ?? 'GET').toUpperCase();
  const init = { method, headers: { 'User-Agent': 'delivered-probe/0.2 (research)' } };
  if (method !== 'GET') {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(info.input?.body ?? {});
  }
  await sleep(300);
  try {
    const res = await fetch(row.url, init);
    if (res.status !== 402) { console.log(`skip ${row.url} (HTTP ${res.status})`); continue; }
    const challenge = await res.json();
    const term = (challenge.accepts ?? []).find((a) => String(a.asset).toLowerCase() === USDC);
    if (!term?.payTo) { console.log(`skip ${row.url} (no Base/USDC term)`); continue; }
    row.payTo = term.payTo;
    row.quotedAtomic = String(term.amount ?? term.maxAmountRequired ?? '');
    filled++;
  } catch (e) {
    row.payToLookupError = String(e.message).slice(0, 120);
    console.error(`skip ${row.url} (${row.payToLookupError})`);
  }
}

fs.writeFileSync(FILE, JSON.stringify(rows, null, 1));
console.log(`backfilled payTo on ${filled} of ${rows.length} rows in ${FILE}`);
