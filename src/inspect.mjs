import fs from 'node:fs';

const reg = JSON.parse(fs.readFileSync(process.env.X402_REGISTRY ?? 'cdp_all.json', 'utf8'));
const needle = process.argv[2] || '/x402/is-prime';
const hit = reg.find((r) => String(r.resource).includes(needle));

if (!hit) {
  console.log('not found:', needle);
  process.exit(1);
}

const info = hit.extensions?.bazaar?.info ?? {};
console.log('resource   :', hit.resource);
console.log('description:', (hit.description || '').slice(0, 200));
console.log('accepts    :', JSON.stringify(hit.accepts?.[0], null, 1).slice(0, 700));
console.log('\nINPUT schema :', JSON.stringify(info.input, null, 1).slice(0, 1200));
console.log('\nOUTPUT schema:', JSON.stringify(info.output, null, 1).slice(0, 1500));
