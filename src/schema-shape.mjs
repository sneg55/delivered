import fs from 'node:fs';

const reg = JSON.parse(fs.readFileSync(process.env.X402_REGISTRY ?? 'cdp_all.json', 'utf8'));
const tally = new Map();
const bump = (k) => tally.set(k, (tally.get(k) ?? 0) + 1);

let withOutput = 0;
let exampleKeyCounts = [];

for (const r of reg) {
  const out = r.extensions?.bazaar?.info?.output;
  if (!out) {
    bump('no output declared');
    continue;
  }
  withOutput++;
  if (typeof out !== 'object') {
    bump('output not an object');
    continue;
  }
  const hasJsonSchema =
    out.properties || out.$schema || out.required || out.items ||
    (out.type && !out.example && out.type !== 'json');
  const hasExample = out.example !== undefined;

  if (hasJsonSchema && hasExample) bump('BOTH json-schema and example');
  else if (hasJsonSchema) bump('formal JSON Schema');
  else if (hasExample) {
    bump('EXAMPLE object only');
    if (out.example && typeof out.example === 'object' && !Array.isArray(out.example)) {
      exampleKeyCounts.push(Object.keys(out.example).length);
    }
  } else bump('declared but neither (opaque)');
}

console.log('registry size      :', reg.length);
console.log('declare an output  :', withOutput, `(${((withOutput / reg.length) * 100).toFixed(1)}%)`);
console.log('');
for (const [k, v] of [...tally.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(30)} ${String(v).padStart(6)}  ${((v / reg.length) * 100).toFixed(1)}%`);
}

if (exampleKeyCounts.length) {
  exampleKeyCounts.sort((a, b) => a - b);
  const med = exampleKeyCounts[Math.floor(exampleKeyCounts.length / 2)];
  console.log('\nexample objects: median top-level keys =', med,
    '| min', exampleKeyCounts[0], '| max', exampleKeyCounts.at(-1));
  console.log('example objects with >=1 key:',
    exampleKeyCounts.filter((n) => n >= 1).length, 'of', exampleKeyCounts.length);
}
