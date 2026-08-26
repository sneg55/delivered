import fs from 'node:fs';

const targets = JSON.parse(fs.readFileSync(process.env.X402_CLEAN ?? 'clean.json', 'utf8')).slice(0, 40);
const tally = new Map();
const bump = (k) => tally.set(k, (tally.get(k) ?? 0) + 1);
const samples = [];

for (const t of targets) {
  const init = { method: t.method, headers: { 'User-Agent': 'delivered-probe/0.1 (research)' } };
  if (t.method !== 'GET') {
    init.headers['Content-Type'] = 'application/json';
    init.body = '{}';
  }
  try {
    const r = await fetch(t.url, init);
    if (r.status !== 402) { bump(`non-402: ${r.status}`); continue; }
    const j = await r.json();
    const acc = j?.accepts;
    if (!Array.isArray(acc) || !acc.length) { bump('402 without accepts[]'); continue; }
    for (const a of acc.slice(0, 1)) {
      const net = String(a.network ?? 'MISSING');
      bump(net.startsWith('eip155:') || net.startsWith('solana:') ? `CAIP-2 (${net})` : `named (${net})`);
      if (samples.length < 3) samples.push({ url: t.url, x402Version: j.x402Version, network: a.network, scheme: a.scheme, priceField: a.maxAmountRequired ?? a.amount });
    }
  } catch (e) {
    bump(`error: ${String(e.message).slice(0, 30)}`);
  }
}

console.log('live 402 challenge `network` field, 40 endpoints:\n');
for (const [k, v] of [...tally.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)}  ${k}`);
console.log('\nsample challenges:');
for (const s of samples) console.log(' ', JSON.stringify(s));
