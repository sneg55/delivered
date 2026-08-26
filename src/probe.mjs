import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWalletClient, http, publicActions } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { contractFrom, classifyPaidResponse } from './conformance.mjs';
import { payAndFetch, decodeSettlement, termAmount, chainIdOf } from './x402-v2.mjs';

const PER_CALL_CAP_USDC = 0.15;
const HARD_REFUSE_ABOVE = 1.0;
const PER_RUN_TOTAL_CAP = 5.0;
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

const argv = process.argv.slice(2);
const noPay = argv.includes('--no-pay');
const outFlag = argv.indexOf('--out');
const targetsPath = argv.filter((a, i) => !a.startsWith('--') && !(outFlag !== -1 && i === outFlag + 1))[0];
const OUT = outFlag !== -1 ? argv[outFlag + 1]
  : noPay ? 'evidence/unpaid.json' : 'evidence/results.json';
if (!targetsPath) {
  console.error('usage: node src/probe.mjs <targets.json> [--no-pay] [--out path]');
  process.exit(1);
}

function loadWallet() {
  const walletPath = path.join(os.homedir(), '.orion-delivered', 'wallet.json');
  const raw = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
  const account = privateKeyToAccount((Array.isArray(raw) ? raw[0] : raw).private_key);
  const client = createWalletClient({ account, chain: base, transport: http('https://mainnet.base.org') })
    .extend(publicActions);
  return { account, client };
}

const registry = JSON.parse(fs.readFileSync(process.env.X402_REGISTRY ?? 'cdp_all.json', 'utf8'));
const byResource = new Map(registry.map((r) => [r.resource, r]));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pickTerm = (accepts) =>
  accepts.find((a) => {
    if (String(a.asset).toLowerCase() !== USDC.toLowerCase()) return false;
    try { return chainIdOf(a.network) === base.id; } catch { return false; }
  }) ?? null;

async function usdcBalance(client, who, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      return await client.readContract({
        address: USDC,
        abi: [{ name: 'balanceOf', type: 'function', stateMutability: 'view',
                inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] }],
        functionName: 'balanceOf',
        args: [who],
      });
    } catch {
      await sleep(700 * 2 ** i);
    }
  }
  return null;
}

const delta = (before, after) => (before === null || after === null ? null : Number(before - after) / 1e6);

async function probe(target, spent, wallet) {
  const { url, body: bodyOverride, expect } = target;
  const listing = byResource.get(url);
  const info = listing?.extensions?.bazaar?.info ?? {};
  const method = (target.method ?? info.input?.method ?? 'GET').toUpperCase();

  const init = { method, headers: { 'User-Agent': 'delivered-probe/0.2 (research)' } };
  if (method !== 'GET') {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(bodyOverride ?? info.input?.body ?? {});
  }

  let challenge;
  try {
    const unpaid = await fetch(url, init);
    if (unpaid.status !== 402) return { url, verdict: 'NO_PAYWALL', delivered: false, detail: `unpaid request returned ${unpaid.status}` };
    challenge = await unpaid.json();
  } catch (e) { return { url, verdict: 'UNREACHABLE', delivered: false, detail: String(e.message).slice(0, 120) }; }

  const accepts = Array.isArray(challenge?.accepts) ? challenge.accepts : [];
  if (!accepts.length) return { url, verdict: 'UNPAYABLE', delivered: false, detail: '402 carried no spec-conformant payment terms' };

  const term = pickTerm(accepts);
  if (!term) return { url, verdict: 'UNPAYABLE', delivered: false, detail: 'no Base/USDC payment term offered' };

  const atomic = termAmount(term);
  const livePrice = Number(atomic) / 1e6;
  if (!atomic || !Number.isFinite(livePrice)) return { url, verdict: 'UNPAYABLE', delivered: false, detail: 'no parseable price in challenge' };

  const declared = listing?.accepts?.find((a) => String(a.asset).toLowerCase() === USDC.toLowerCase());
  const listedPrice = declared ? Number(declared.amount) / 1e6 : null;
  const drift = listedPrice !== null && Math.abs(livePrice - listedPrice) > 1e-9;

  const contract = contractFrom(term, listing);
  const head = {
    url, listedPrice, livePrice, drift,
    payTo: term.payTo ?? null,
    quotedAtomic: atomic,
    x402Version: challenge.x402Version,
    contractKind: contract.kind,
    declaredFields: contract.keys.map(([k, t]) => `${k}:${t}`),
  };

  if (noPay)
    return { ...head, verdict: 'PAYABLE', delivered: false,
             detail: 'unpaid tier: challenge is machine-payable, no payment attempted' };

  const skip = (d) => ({ ...head, verdict: 'SKIPPED', delivered: false, detail: d });
  if (livePrice > HARD_REFUSE_ABOVE) return skip(`$${livePrice} above hard refusal $${HARD_REFUSE_ABOVE}`);
  if (livePrice > PER_CALL_CAP_USDC) return skip(`$${livePrice} above per-call cap $${PER_CALL_CAP_USDC}`);
  if (spent.total + livePrice > PER_RUN_TOTAL_CAP) return skip('per-run total cap reached');

  const before = await usdcBalance(wallet.client, wallet.account.address);
  spent.attempts++;

  let res, payloadVersion, text;
  try {
    const out = await payAndFetch({
      url, init, challenge, term,
      client: wallet.client,
      account: wallet.account,
      maxAtomic: Math.round(PER_CALL_CAP_USDC * 1e6),
    });
    res = out.res;
    payloadVersion = out.version;
    text = await res.text();
  } catch (e) {
    const leaked = delta(before, await usdcBalance(wallet.client, wallet.account.address));
    spent.total += leaked ?? 0;
    return { ...head, verdict: 'PAYMENT_FAILED', delivered: false, charged: leaked,
             detail: String(e.message ?? e).slice(0, 200) };
  }

  const charged = delta(before, await usdcBalance(wallet.client, wallet.account.address));
  spent.total += charged ?? 0;

  const hdr = res.headers.get('x-payment-response') ?? res.headers.get('payment-response');
  const settlement = decodeSettlement(hdr);
  const receiptState = !hdr ? 'NO RECEIPT HEADER' : settlement ? 'receipt returned' : 'receipt header unreadable';

  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }

  const result = classifyPaidResponse({ httpStatus: res.status, parsed, contract, expect });
  if (result.delivered) spent.delivered++;

  return {
    ...head,
    charged,
    quotedVsCharged: charged === null ? 'charge unknown (RPC unavailable)'
      : Math.abs(charged - livePrice) < 1e-9 ? 'matches quote'
      : charged === 0 ? `QUOTED $${livePrice}, CHARGED NOTHING`
      : `QUOTED $${livePrice}, CHARGED $${charged}`,
    payloadVersion,
    httpStatus: res.status,
    bytes: text.length,
    delivered: result.delivered,
    settled: Boolean(settlement?.success),
    receiptState,
    txHash: settlement?.transaction ?? null,
    verdict: result.verdict,
    detail: result.detail,
    extraKeys: result.extra ?? [],
    semantic: result.semantic ?? null,
    nesting: result.nesting ?? null,
    body: typeof parsed === 'string' ? parsed.slice(0, 300) : parsed,
  };
}

const targets = JSON.parse(fs.readFileSync(targetsPath, 'utf8'));
const spent = { total: 0, attempts: 0, delivered: 0 };
const results = [];
const wallet = noPay ? null : loadWallet();
const startBlock = wallet ? await wallet.client.getBlockNumber() : null;

if (noPay) console.log('--no-pay: unpaid tier only, no wallet loaded, no money at risk\n');
else {
  console.log(`wallet ${wallet.account.address}`);
  console.log(`caps: $${PER_CALL_CAP_USDC}/call, $${PER_RUN_TOTAL_CAP}/run, hard refuse > $${HARD_REFUSE_ABOVE}\n`);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const persist = () => fs.writeFileSync(OUT, JSON.stringify(results, null, 1));

for (const t of targets) {
  await sleep(400);
  const r = await probe(t, spent, wallet);
  results.push(r);
  persist();
  console.log(`${r.verdict.padEnd(17)} $${(r.livePrice ?? 0).toFixed(4)}  v${r.x402Version ?? '?'}  ${r.url.slice(0, 58)}`);
  if (r.detail) console.log(`                  ${r.detail}`);
  if (r.contractKind) console.log(`                  contract: ${r.contractKind}  [${r.declaredFields?.join(', ')}]`);
  if (r.receiptState) console.log(`                  ${r.receiptState}${r.txHash ? ' tx ' + r.txHash : ''}`);
  if (r.quotedVsCharged && r.quotedVsCharged !== 'matches quote') console.log(`                  ${r.quotedVsCharged}`);
  if (r.verdict === 'PAYMENT_FAILED' && r.charged > 0) console.log(`                  CHARGED $${r.charged} DESPITE FAILURE`);
  if (r.nesting) console.log(`                  ${r.nesting}`);
  if (r.semantic) console.log(`                  ${r.semantic}`);
  if (r.body && typeof r.body === 'object') console.log(`                  body ${JSON.stringify(r.body).slice(0, 200)}`);
  if (r.drift) console.log(`                  PRICE DRIFT: listed $${r.listedPrice}, live $${r.livePrice}`);
  console.log('');
}

const tally = {};
for (const r of results) tally[r.verdict] = (tally[r.verdict] ?? 0) + 1;
console.log(JSON.stringify(tally));
console.log(`${spent.delivered} of ${spent.attempts} paid attempt(s) returned a response; ` +
            `conformance is measured over ${spent.delivered}, never over ${results.length}`);

if (!noPay) {
  const endBlock = await wallet.client.getBlockNumber();
  console.log(`\nbalance-delta spend $${spent.total.toFixed(6)} (UNDER-COUNTS: settlement is async)`);
  console.log(`settlement window: blocks ${startBlock} to ${endBlock}`);
  console.log(`reconcile the real total with:  node src/reconcile.mjs ${startBlock} ${endBlock}`);
}

persist();
console.log(`wrote ${OUT}`);
