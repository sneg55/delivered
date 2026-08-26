# Paid proof runs

**Provenance of every figure in this file [S1]:** all numbers are first-hand measurements taken by
`src/probe.mjs` on Base mainnet on 2026-08-26. Dollar amounts are USDC settlements read from the
token's `Transfer` log, not quoted prices and not estimates. Nothing here is sourced from a vendor
claim. Wallet `0xc3Dd3dEe328831fe12F259Fa20725c2Ce312BF3D`, funded with 25.000000 USDC and
0.001 ETH. ETH balance unchanged and nonce still 0 across all three runs, so every settlement was
submitted by a facilitator against a signed EIP-3009 authorization; the wallet never sent a
transaction itself.

Three runs are recorded here, each one resolving the previous run's biggest unknown. The current
state, `evidence/results.json`, is run 2 with run 3's retries merged in; every replaced row keeps
its earlier rejected verdict under `previousAttempt`.

| | Run 1 | Run 2 | Run 3 (retry of run 2's rejects) |
|---|---|---|---|
| Client | `x402-fetch@1.2.0` + v2-to-v1 shim | v2-native, `X-PAYMENT` header | v2-native, both header names |
| Endpoints attempted | 24 | 46 | 13 |
| Delivered (HTTP 200) | 7 | 23 | 10 |
| Rejected by the seller's payment check | 15 | 13 | **1** |
| Settled spend | $0.053954 | $0.889971 | $0.349000 |
| Evidence | `…-v1client.json` | `…-run2-xpayment.json` | `…-run3.json` |

**Current merged state: 46 paid attempts, 33 delivered, 29 checkable against a seller-published
contract. 19 `CONFORMS` (65.5%), 10 `VIOLATION` (34.5%).** Total settled across all runs:
$1.292925.

---

# Run 2, 2026-08-26, v2-native client

47 targets across 40 hosts, chosen by `src/build-targets.mjs` from the clean-endpoint list, capped
at two per host. One was `UNPAYABLE` (no Base/USDC term), leaving 46 paid attempts.

**Settled spend: $0.889971** across 25 settlements, blocks 50482742 to 50482876. Reconciled with
`src/reconcile.mjs` against the USDC `Transfer` log.

## The first conformance rate this project could honestly quote

*(Superseded by the merged state above once run 3 landed; kept as measured.)*

Of 46 attempts, 23 returned a response. Of those 23, four sellers published no output contract at
all, which leaves **19 responses checkable against a contract the seller wrote itself**:

| Verdict | n | Share of checkable |
|---|---|---|
| `CONFORMS` | 9 | 47.4% |
| `VIOLATION` | 10 | **52.6%** |

**More than half of the paid responses that could be checked did not match the interface the
seller published.** The denominator is 19 and is stated everywhere the rate is, because the other
27 attempts never produced a response to check.

**Nine of the ten violations are the same bug**: the declared fields exist but sit one level below
the declared path, under a wrapper envelope such as `{tool_name, result: {...}}`. A caller reading
the contract's path gets `undefined` while the data sits one level down. This is a wrapper-envelope
defect, not fraud, and the tool reports shape separately from values for exactly that reason.

## Paid, and nothing delivered

Two endpoints took money and returned no data. Both are confirmed by a settlement transaction
matched uniquely to that endpoint by payee and amount:

| Endpoint | Settled | Response |
|---|---|---|
| `portfolio.lonestaroracle.xyz/analyze` | **$0.100000** | HTTP 422, `tickers` field required |
| `property.payapi.market/sold-prices` | $0.001000 | HTTP 500, upstream Land Registry failure |

The first is the sharpest instance of the thesis in the whole project. The payment settled, the
seller returned a settlement receipt for it, and then rejected the request as malformed. The money
moved and nothing came back, with no protocol-level recovery path.

Both deserve a caveat: the request bodies came from the registry's own declared input example, and
in both cases that example did not produce a request the seller would accept. That is itself a
finding about the registry's input declarations, and it does not change what happened to the money.

**The contrast is what makes this reportable.** Other sellers hit with the same malformed input
refused *without* charging. `aeml-x402.zeabur.app` returned HTTP 422 with a body reading
`"no_charge": true` and no settlement to its payee at that price. Correct behaviour exists, it is
just not universal.

## What run 2 could not explain, and run 3 did

**13 of 46 attempts were rejected at the seller's payment check** (`PAYMENT_REJECTED`), down from
15 of 24. Eleven were v2 challenges answered with a v2 payload and two were v1 answered with v1,
so the envelope version was not the cause. Per this project's own rule they stayed attributed to
our client, excluded from every rate, until evidence said otherwise. Run 3 below found the cause,
and the rule was vindicated: 12 of the 13 were indeed our client's fault.

## Attribution limits, stated because they bound the claims

`src/reconcile.mjs` matches settlements to endpoints on payee *and* exact amount, and refuses to
guess:

- $0.669971 of the $0.889971 is attributed to a specific endpoint.
- **Four endpoints are left `UNDETERMINED`.** One payee (`0x50ab2018…`) serves seven probed
  endpoints and settled two payments of $0.100000; which two of the four $0.10 endpoints were
  charged cannot be established from the transfer log. No claim is made about any of them. An
  earlier pass of this reconciliation did guess, by settlement order, and produced three false
  accusations of charge-without-delivery before the check was tightened.
- **$0.020000 went to `0x54ebFCF3…`, an address no probed endpoint declared as its `payTo`.**
  Unexplained. The most likely reading is a seller rotating its payout address between the run and
  the reconciliation, which would itself be worth knowing.

Only the run total, $0.889971, needs no attribution at all: it is the wallet's own outflow.

## The accounting bug this run exposed

Run 2 first reported **$0.452971**. The true figure is **$0.889971**, and the wallet balance
confirms it: 24.946046 before, 24.056075 after.

The prober was reading the wallet balance immediately after each HTTP response and calling the
difference the price of that call. Settlement is asynchronous: the facilitator's transaction lands
seconds later, so each read captured the *previous* call's settlement or nothing at all, and every
settlement still in flight when the run exited was never counted. The method under-reported by 49%.

This matters more than a wrong total, because "measure, never quote" is design rule 1 of this
project and the measurement itself was wrong. Spend is now reconciled from the USDC `Transfer`
log, `charged` carries the settled amount, and the old figure is retained per row as
`balanceDeltaAtResponse` so the size of the error stays visible. A balance delta sampled at
response time is not a measurement of what a call cost, and any caller-side ledger built that way
will not reconcile.

---

# Run 3, 2026-08-26, the header rename

The lead came from reading another seller's integration docs (the Orion Agents gateway), which
describe the v2 payment header as `PAYMENT-SIGNATURE`, with `X-PAYMENT` as a legacy alias. Three
of run 2's rejection bodies then turned out to say it outright: `"PAYMENT-SIGNATURE header is
required"`. Our client sent only `X-PAYMENT`, the v1 name.

The fix is one line: send the identical base64 payload under both names in the same request.
Sellers read whichever they know. Same wallet, same signing, same envelope.

**Result of retrying run 2's 13 rejects: 12 accepted the payment.**

| Outcome | n | Detail |
|---|---|---|
| `CONFORMS` | 10 | every delivered response matched its seller's published contract |
| `NOT_DELIVERED`, not charged | 2 | `api.invoket.com` HTTP 400, `vedetta.dethboy.com` HTTP 500, $0 settled either time |
| `PAYMENT_REJECTED` | 1 | `api.glianalabs.com`, a v1 seller, still re-challenges; cause unknown, stays ours |

All 10 settlements ($0.349000) reconciled against the transfer log with zero ambiguity: every
(payee, amount) pair was unique. The two refusals charged nothing.

Two observations worth keeping:

1. **The v2 client interop story is now measured in three states.** The official library cannot
   pay v2 sellers at all (run 1). A v2 envelope under the v1 header name was accepted by 33 of
   46 sellers (run 2). Both header names together reach all but one (run 3). Every state
   cost real money to discover, and no public client library currently ships the third.
2. **The header-name cohort is disjoint from the violation cohort.** All 10 newly reached sellers
   conform. The wrapper-envelope violations of run 2 all sit among sellers that accepted
   `X-PAYMENT`. Strict header validation and a kept output contract appear to travel together,
   consistent with both being properties of newer, spec-faithful server frameworks.

---

# Run 1, 2026-08-26, x402-fetch with a v2-to-v1 shim

Counts below are over the 24 endpoints attempted, recorded in
`evidence/results-2026-08-26-v1client.json`. Dollar amounts here are balance deltas, which for this
run happen to total correctly against the transfer log ($0.053954 by both methods) because its
calls were slow and cheap enough for each settlement to land before the next read.

First real money through the Delivered path. **Total spent: $0.053954.**

Caps enforced on both runs: $0.15 per call, hard refusal above $1.00, $5.00 per run, one paid call
per endpoint per run, price read from the live 402 challenge and never from the listing.

## What is proven

**The central claim of the run is confirmed: a settled payment can return a response that
violates the contract the seller published itself.**

The cleanest instance, found on the first paid call for $0.001:
`api.delx.ai/api/v1/x402/is-prime`. Its own live 402 challenge carries an inline JSON Schema
declaring top-level `{schema: string, n: integer, is_prime: boolean}`. The paid response was:

```json
{"tool_name":"util_is_prime","result":{"schema":"delx/is-prime/v1","n":97,"is_prime":true}}
```

The values are correct (97 is prime). The shape is not what was published: the declared fields
sit one level below the declared path, so a caller reading `response.is_prime` per the contract
gets `undefined`. HTTP 200, payment settled, no error anywhere. Reproduced on two sibling
endpoints from the same seller (`hex-to-int`, `caa-issue-hosts`).

This is a contract violation, not fraud. That distinction matters and should be kept in any
write-up: the data is present and correct, the published interface is wrong, and only a caller
that actually pays and checks can see it.

## Delivery observations, and the honest denominator

Of 24 endpoints attempted, **only 7 actually returned a response** (HTTP 200):

| Verdict | n | Detail |
|---|---|---|
| CONFORMS | 2 | `library.forgemesh.io`, all 5 declared fields present with matching types |
| VIOLATION | 3 | 2 x `api.delx.ai` (fields nested below declared path); 1 x `voice.forgemesh.io` (declared a JSON object, returned non-JSON) |
| UNCHECKABLE | 2 | `animica.dev`, seller published no output contract at all |

**No rate should be quoted from this.** The sample is 7, and the reason it is 7 is below.

## What is NOT proven, and why

**15 of 24 attempts failed on my own client, not on the seller.** Those returned HTTP 402
re-challenges, meaning the payment was rejected before any delivery could be observed. Cause:
`x402-fetch@1.2.0` emits an x402 **v1** payment payload, and most of these sellers verify against
**v2** semantics. My shim downgrades a v2 challenge to v1 so the library can read it, which is
enough for some sellers (delx.ai settles fine) and not others.

Affected hosts: keyronne.com, finance.payapi.market, property.payapi.market,
web-production-18a32.up.railway.app, api.glianalabs.com, x402.aispace.bot, energy.halowerk.com,
api.magentlab.com, api.invoket.com, api.printmoneylab.com, api.myceliasignal.com,
api.macaroonnetwork.com, orcpin.dev.

**A real conformance rate needs a v2-native payment client.** *Written during the run, and since
overtaken. That client now exists at `src/x402-v2.mjs`, and it was an envelope swap rather than a
reimplementation, because v1 and v2 sign identically. The sizing in the original sentence was
wrong; see `docs/SPEC.md` for the corrected account. Every figure in this file still stands as
recorded, because it measures what the old client did on 2026-08-26. What is still missing is a
paid re-run on the new client.*

## Findings that hold regardless of the client gap

**1. The client-side interop gap is real and measured.** 29 of 40 live challenges sampled use
CAIP-2 `eip155:8453`; 11 use the named `base`. The official `x402-fetch@1.2.0` accepts only the
named form, so it cannot pay 72.5% of a sample drawn from Coinbase's own registry without a shim.
`1.2.0` is the latest published version.

**2. What you are charged is routinely not what you were quoted.** Verified against on-chain
balance deltas:

| Endpoint | Quoted | Actually charged |
|---|---|---|
| `animica.dev/x402/security/injection` | $0.005808 listed | **$0.005894** |
| `animica.dev/x402/chain/holders` | $0.007 listed | **$0.007073** |
| `api.magentlab.com/api/calc/killip` | $0.005 listed | **$0.007 quoted live** |
| `library.forgemesh.io` (one of two identical-shaped calls) | $0.003 | **$0.000, data delivered free** |
| `api.delx.ai/caa-issue-hosts` | $0.001 | **$0.000, data delivered free** |

A caller's own ledger built from quoted prices does not reconcile against the wallet. My first
batch illustrated this directly: the script's quote-based total said $0.0613 while the on-chain
delta was $0.027987. The prober now treats the balance delta as the source of truth.

**3. Sellers frequently do not return the settlement receipt.** `X-PAYMENT-RESPONSE` was absent
on most paid calls, including ones that settled. Where it was returned (forgemesh, animica) it
carried a real Base transaction hash. Without it the caller cannot tie a response to a payment
from the response alone, and has to reconcile against chain state.

**4. Some sellers refuse cleanly and do not charge.** `x402.shizu.me` returned HTTP 400 and
`aeml-x402.zeabur.app` returned HTTP 422 for missing input parameters, both with $0 charged and
one explicitly saying "Not charged". Worth crediting in any write-up: this is the correct
behaviour and it is not universal.

## Corrections made during this run

Recorded because each one changed a number, and the earlier figure was wrong:

1. Classified x402 v2 challenges as malformed because they lack a v1 `accepts` array. Fixed.
2. Truncated response bodies at 3,000 bytes, so long valid JSON failed to parse and was counted
   as non-JSON. Fixed by reading full bodies.
3. Counted spend from quoted prices, which over-stated it by more than 2x. Fixed by measuring
   the on-chain balance delta.
4. Reported "WRONG ANSWER" where the values were correct but nested below the declared path.
   Fixed by searching nested and reporting shape and value separately.
5. Attributed 15 payment rejections to sellers before checking the HTTP status. They were my
   shim. Fixed by splitting HTTP 200 delivery observations from HTTP 402 re-challenges.

## Correction 5 landed in the code later than in this file

Correction 5 was written up here on 2026-08-26 but not applied to `src/probe.mjs` at the time, so
the committed `evidence/results.json` kept scoring 402 re-challenges as seller contract
violations and disagreed with the table above. The fix is now in the code, as a
`PAYMENT_REJECTED` state that only an HTTP 200 can bypass.

The recorded run was reclassified rather than re-measured, because every row already carried its
`httpStatus` and full response body, which makes the correction deterministic:

- `evidence/results-2026-08-26-raw.json` is the original run output, kept verbatim.
- `evidence/results.json` is that file with the blame split applied, by `src/reclassify.mjs`.
  Each changed row keeps its previous verdict in `supersededVerdict`, so the correction is
  auditable rather than a silent overwrite.
- The reclassification reproduces the table above exactly: 15 `PAYMENT_REJECTED`, 7 delivered,
  split 2 `CONFORMS` / 3 `VIOLATION` / 2 `UNCHECKABLE`. That agreement is what confirms the
  written analysis was right and only the code lagged.

`test/evidence.test.mjs` now fails if the evidence file and the tally in this document ever
diverge again.
