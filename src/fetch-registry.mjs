/**
 * Pull the full Coinbase CDP x402 discovery registry to ./cdp_all.json.
 * Unauthenticated. Roughly 15k records at the time of writing.
 */
import fs from 'node:fs';

const OUT = process.argv[2] ?? 'cdp_all.json';
const BASE = 'https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const items = [];
let offset = 0;

for (;;) {
  const res = await fetch(`${BASE}?limit=1000&offset=${offset}`, {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) {
    console.error(`stopped at offset ${offset}: HTTP ${res.status}`);
    break;
  }
  const page = await res.json();
  const batch = page.items ?? [];
  items.push(...batch);
  const total = page.pagination?.total ?? items.length;
  offset += batch.length;
  console.log(`  ${items.length}/${total}`);
  if (!batch.length || offset >= total) break;
  await sleep(400);
}

fs.writeFileSync(OUT, JSON.stringify(items));
console.log(`wrote ${items.length} records to ${OUT}`);
