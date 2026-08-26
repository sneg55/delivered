import fs from 'node:fs';

const reg = JSON.parse(fs.readFileSync(process.env.X402_REGISTRY ?? 'cdp_all.json', 'utf8'));
const clean = JSON.parse(fs.readFileSync(process.env.X402_CLEAN ?? 'evidence/clean-endpoints.json', 'utf8'));
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const CAP = 0.15;
const N = Number(process.argv[2] ?? 24);

const byResource = new Map(reg.map((r) => [r.resource, r]));
const seenHost = new Map();

// Spread across distinct hosts so one seller's quirk does not dominate the sample.
const picked = [];
for (const c of clean.sort((a, b) => a.price - b.price)) {
  if (c.price > CAP) continue;
  const host = new URL(c.url).host;
  const n = seenHost.get(host) ?? 0;
  if (n >= 2) continue;
  const listing = byResource.get(c.url);
  const info = listing?.extensions?.bazaar?.info ?? {};
  picked.push({ url: c.url, method: info.input?.method ?? 'GET', body: info.input?.body ?? undefined });
  seenHost.set(host, n + 1);
  if (picked.length >= N) break;
}

fs.writeFileSync('targets.json', JSON.stringify(picked, null, 1));
const total = picked.reduce((s, p) => s + (clean.find((c) => c.url === p.url)?.price ?? 0), 0);
console.log(`${picked.length} targets across ${seenHost.size} hosts`);
console.log(`worst-case spend if all pay: $${total.toFixed(4)}`);
for (const p of picked) console.log(`  ${p.method.padEnd(5)} ${p.url.slice(0, 70)}`);
