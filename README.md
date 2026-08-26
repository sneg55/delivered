# Delivered

[![tests](https://github.com/sneg55/delivered/actions/workflows/test.yml/badge.svg)](https://github.com/sneg55/delivered/actions/workflows/test.yml)
[![evidence ledger](https://img.shields.io/badge/evidence-delivered--f0d.pages.dev-2775CA)](https://delivered-f0d.pages.dev)
[![network](https://img.shields.io/badge/network-Base%20mainnet-0052FF)](https://basescan.org/address/0xc3Dd3dEe328831fe12F259Fa20725c2Ce312BF3D)
[![settled on-chain](https://img.shields.io/badge/settled%20on--chain-%241.292925-101418)](docs/PAID-PROOF.md)
[![x402](https://img.shields.io/badge/x402-v1%20%2B%20v2-666C75)](https://github.com/coinbase/x402)

Caller-observed delivery proof for paid x402 endpoints.

Everyone else measures the endpoint before the money moves. Delivered measures the goods after.

It calls a paid endpoint as a real buyer, then checks the response against the contract the
seller published itself, and records what a paying caller actually received.

## Why this exists

x402 settles payment and ERC-8004 settles identity. Neither says anything about whether what
came back was what was promised. The payment finalises whether or not you got anything, and
there is no protocol-level recovery path.

Existing tools stop at the paywall, because going past it costs money:

| Tool | Measures | Sees delivery? |
|---|---|---|
| Coinbase CDP registry `quality` | `l30DaysTotalCalls`, `l30DaysUniquePayers`, `lastCalledAt` | No, settlement history only |
| `nohumans.directory` | Reachability of the 402 challenge, re-probed every 15 min | No, never pays |
| `x402.fuchss.app` | Reachability at scale | No, never pays |
| `the402.ai` | Test purchases, then escrow and human arbitration on dispute | Partly, and it adjudicates a judgment |

Delivered pays, and checks a promise the seller wrote down, so there is nothing to adjudicate.

## Status

Working prober with a v2-native payment client, measured against live Base mainnet endpoints.

**Of 29 paid responses checkable against a contract the seller published itself, 19 matched and 10
did not.** Denominator 29, from 46 paid attempts: 33 returned a response, and 4 of those sellers
published no contract to check. $1.29 of real USDC across three runs, every settlement reconciled
against the token transfer log.

One bug accounts for nine of the ten violations: the declared fields exist but sit below the
declared path, under a wrapper envelope. The wallet also caught two endpoints that took payment
and returned no data at all. And the client side is measurably broken too: the official x402
library cannot pay v2 sellers at all, and a v2 payload under the legacy `X-PAYMENT` header name
is rejected by 13 of 46; this client sends both header names and reaches all but one.

See `docs/PAID-PROOF.md` for the full measurement log and its stated limits, and
[delivered-f0d.pages.dev](https://delivered-f0d.pages.dev) for the browsable evidence ledger.

## The finding, in one screen

`api.delx.ai/api/v1/x402/is-prime` declares this in its own live 402 challenge:

```json
{"type":"object","properties":{"schema":{"type":"string"},
 "n":{"type":"integer"},"is_prime":{"type":"boolean"}}}
```

Paid response, HTTP 200, payment settled:

```json
{"tool_name":"util_is_prime","result":{"schema":"delx/is-prime/v1","n":97,"is_prime":true}}
```

The answer is right. The shape is not the one published. A caller reading `response.is_prime`
per the contract gets `undefined`, silently. Cost to find: $0.001.

## Run it

```bash
npm install
npm test                                    # 46 tests, no wallet, no network, no money

node src/fetch-registry.mjs                 # pull the registry to ./cdp_all.json (~15k records)
node src/build-targets.mjs 24               # pick targets, spread across hosts

node src/probe.mjs targets.json --no-pay    # unpaid tier: reads challenges, spends nothing
node src/probe.mjs targets.json             # pays, checks, records to evidence/results.json
node src/reconcile.mjs <from> <to>          # correct the spend against the USDC transfer log
```

The reconcile step is not optional if you intend to quote a cost. The probe's own running total is
a balance delta read at response time, and settlement is asynchronous, so it under-counts. The
probe prints the block range and the exact reconcile command to run when it finishes.

Only the probe line spends money. It and the reconcile step are the only ones that read the
wallet file; everything above them runs from a fresh clone with no key present.

The registry path is `./cdp_all.json` by default and is overridable with `X402_REGISTRY`. It is
gitignored at ~50 MB. The spending wallet lives at `~/.orion-delivered/wallet.json`, outside this
repo on purpose, and is loaded only when a paid run is actually requested.

## Spending safety

The prober spends real USDC. Caps are enforced in code before any signature, in `src/probe.mjs`:

| Guard | Value |
|---|---|
| Per call | $0.15 |
| Hard refusal, no override | above $1.00 |
| Per run total | $5.00 |
| Per endpoint | one paid call per run |
| Price source | the live 402 challenge, never the registry listing |

The registry's price distribution has a $1,000 maximum against a $0.010 median, so an unguarded
call can drain a wallet. Treat the caps as load-bearing, not hygiene.

The per-call cap is checked twice: once in `src/probe.mjs` against the live price, and again in
`payAndFetch` in `src/x402-v2.mjs`, which refuses to sign a term whose value exceeds the cap it
was handed. A test covers the second one, so a caller that forgets the first still cannot
overspend.
