import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPublicClient, http, parseAbiItem, getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';

const USDC = getAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
const TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
const SPAN = 800n;

if (process.argv.length < 4) {
  console.error('usage: node src/reconcile.mjs <fromBlock> <toBlock> [results.json]');
  process.exit(1);
}
const fromBlock = BigInt(process.argv[2]);
const toBlock = BigInt(process.argv[3]);
const FILE = process.argv[4] ?? 'evidence/results.json';

const raw = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.orion-delivered', 'wallet.json'), 'utf8'));
const account = privateKeyToAccount((Array.isArray(raw) ? raw[0] : raw).private_key);
const client = createPublicClient({ chain: base, transport: http('https://mainnet.base.org') });

const logs = [];
for (let lo = fromBlock; lo <= toBlock; lo += SPAN) {
  const hi = lo + SPAN - 1n > toBlock ? toBlock : lo + SPAN - 1n;
  logs.push(...await client.getLogs({ address: USDC, event: TRANSFER, args: { from: account.address }, fromBlock: lo, toBlock: hi }));
}
logs.sort((a, b) => Number(a.blockNumber - b.blockNumber));

const settlements = logs.map((l) => ({
  payee: getAddress(l.args.to),
  atomic: l.args.value.toString(),
  usdc: Number(l.args.value) / 1e6,
  tx: l.transactionHash,
  block: Number(l.blockNumber),
  claimedBy: null,
}));

const rows = JSON.parse(fs.readFileSync(FILE, 'utf8'));
for (const row of rows) {
  if (row.balanceDeltaAtResponse !== undefined) row.charged = row.balanceDeltaAtResponse;
  delete row.settledAmount;
  delete row.settlementTx;
  delete row.settlementBlock;
  delete row.settlementNote;
}

const groupKey = (payee, atomic) => `${getAddress(payee)}:${atomic}`;

const settlementGroups = new Map();
for (const s of settlements) {
  const k = groupKey(s.payee, s.atomic);
  if (!settlementGroups.has(k)) settlementGroups.set(k, []);
  settlementGroups.get(k).push(s);
}

const atomicOf = (row) =>
  Number.isFinite(row.livePrice) ? String(Math.round(row.livePrice * 1e6)) : row.quotedAtomic;

const rowGroups = new Map();
for (const row of rows) {
  const atomic = atomicOf(row);
  if (!row.payTo || !atomic) continue;
  const k = groupKey(row.payTo, atomic);
  if (!rowGroups.has(k)) rowGroups.set(k, []);
  rowGroups.get(k).push(row);
}

for (const [k, group] of rowGroups) {
  const paid = settlementGroups.get(k) ?? [];

  if (paid.length === 0) {
    for (const row of group) {
      row.settledAmount = 0;
      row.charged = 0;
      row.settlementAttribution = 'no settlement for this payee and amount in the window';
    }
    continue;
  }

  if (paid.length >= group.length) {
    group.forEach((row, i) => {
      const s = paid[i];
      s.claimedBy = row.url;
      row.settledAmount = s.usdc;
      row.charged = s.usdc;
      row.settlementTx = s.tx;
      row.settlementBlock = s.block;
      row.settlementAttribution = group.length === 1 ? 'exact'
        : `group-complete: ${paid.length} settlements for ${group.length} endpoint(s) at this payee and price, ` +
          `so every one was charged; which tx belongs to which endpoint is arbitrary`;
    });
    continue;
  }

  for (const row of group) {
    row.settledAmount = null;
    row.charged = null;
    row.settlementAttribution = `UNDETERMINED: payee ${row.payTo} settled ${paid.length} payment(s) of ` +
      `$${paid[0].usdc} across ${group.length} endpoint(s) probed at that price. Which were charged cannot ` +
      `be established from the transfer log alone, so no claim is made about this endpoint.`;
  }
}

for (const row of rows) {
  if (row.settlementAttribution) continue;
  if (!row.payTo) { row.settlementAttribution = 'no payTo recorded, cannot reconcile'; row.charged = null; continue; }
  row.settledAmount = 0;
  row.charged = 0;
  row.settlementAttribution = 'no settlement matched';
}

const orphans = settlements.filter((s) => !s.claimedBy);
const total = settlements.reduce((s, x) => s + x.usdc, 0);
const attributed = settlements.filter((s) => s.claimedBy).reduce((s, x) => s + x.usdc, 0);
const undetermined = rows.filter((r) => String(r.settlementAttribution).startsWith('UNDETERMINED'));
const paidNotDelivered = rows.filter((r) => !r.delivered && r.settledAmount > 0);

fs.writeFileSync(FILE, JSON.stringify(rows, null, 1));

console.log(`window blocks ${fromBlock} to ${toBlock}`);
console.log(`settlements: ${settlements.length}, totalling $${total.toFixed(6)}  <- the only figure that needs no attribution`);
console.log(`attributed to an endpoint: $${attributed.toFixed(6)}`);
console.log(`endpoints left UNDETERMINED: ${undetermined.length}`);
for (const r of undetermined) console.log(`  HTTP ${r.httpStatus} ${r.url}`);
console.log(`unattributed settlements: ${orphans.length}`);
for (const o of orphans) console.log(`  $${o.usdc.toFixed(6)} to ${o.payee} tx ${o.tx}`);
console.log(`\nCONFIRMED paid but not delivered: ${paidNotDelivered.length}, ` +
            `$${paidNotDelivered.reduce((s, r) => s + r.settledAmount, 0).toFixed(6)}`);
for (const r of paidNotDelivered)
  console.log(`  $${r.settledAmount} HTTP ${r.httpStatus} ${r.url}`);
console.log(`\nwrote ${FILE}`);
