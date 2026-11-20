# Final hardening checks — November 20, 2026

The revised source covers four remaining code tasks: funder-scoped claim IDs, cross-instance bot-comment
serialization, canonical reorg corrections, and an optional 45-minute testnet demo deadline.
The active immutable escrow cannot receive a source-code patch; [owner deployment remains separate](escrow-upgrade.md).

| Check from repo root | Observed result |
| --- | --- |
| `forge test --summary` from `contracts/` | 33 passed, including stranger-first claim-ID consumption; three fuzz tests at 1,000 runs each |
| `make -C contracts abi` plus both packages' `run sync-abi` | Published and consumed ABI includes additive `claimIdUsedBy` getter; transaction/event signatures unchanged |
| `npm --prefix backend run typecheck` | Passed |
| `TEST_DATABASE_URL=postgres://merit:merit@127.0.0.1:5433/merit_test npm --prefix backend test` | 163 passed locally after a clean disposable migration; 164 passed in full GitHub CI including the final overlap regression |
| `npm --prefix web run typecheck` and `npm --prefix web run lint` | Passed |
| `npm --prefix web run check:deposit` | 16 passed; one broadcast through receipt failure/retry/refresh |
| `npm --prefix web run check:accounting` | 8 passed; both $10/$4/$6 orderings |
| `NEXT_PUBLIC_DEMO_DEADLINES=1 npm --prefix web run build` | Passed; 10 pages generated |
| Local mock UI: command below | Two fresh sessions passed, no page errors, optional 45-minute window/default seven days, both partial-refund orderings and 390px controls |
| Public Arc RPC, historical payout `0x2d8946…44ec` | Receipt block 72358114 matches canonical block hash; read-only validation, not fresh Stream evidence |

```sh
NEXT_PUBLIC_MOCK=1 npm --prefix web run dev
# In a second terminal, with an already installed Playwright Core:
PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs node web/scripts/demo-qa.mjs
```

Local artifacts remain under `output/verification/final-hardening/`: successful UI run
`non-qn-u9Nb0r/results.json` and screenshots, `public-rpc-check.json`, and an **unsigned** deployment
transaction in `unsigned-escrow-deployment.json`. No transaction was broadcast by the agent.
The first UI attempt at 127.0.0.1 hit Next dev-origin blocking; the successful runs use localhost.

## Regression evidence

`backend/test/streams.test.ts` uses signed synthetic payloads plus an independently controlled fake canonical
chain. It covers empty corrected payout/refund blocks, approval rollback, funding detachment and wrong-funder
replacement, same-transaction re-inclusion with displaced history, stale signed replay, ignored unsigned headers,
RPC failure/wrong network, legacy hashless records, busy-transaction retry/overlap, and duplicate empty correction healing after a bot failure.
These fixtures are not live provider evidence. `backend/test/streams-filter.test.ts` exercises the exact filter
source, including metadata-only delivery. `backend/test/pr-status.test.ts` uses separate database pools to prove
one initial comment; cancellation releases locks before a stalled GitHub read returns. The manual refresh test
also repairs an old comment after its onchain link has detached.

## Migration and live boundary

One additive migration adds nullable `block_hash` / `app_bounty_id`, `removed=false`, and empty `reorg_history`.
It preserves all existing records. Legacy block hashes remain unknown until their block is replayed or corrected;
validation uses the canonical receipt rather than inventing old ownership or rewriting terms. Orphan rows remain
in the ledger, while product views exclude them. Pending intents with incomplete ownership still cannot auto-bind.

The compatible release was observed on the public backend and web aliases after PR #33 merged.
Backend deployment `dpl_GDKmR7YjFHvuvkp3u9eM64bHWKkb` and web deployment
`dpl_44MuEexoApdfKDEsxnaZBhNMoTur` use code commit `9a8ee25`. Eight public API/proxy checks passed
(health/config/bounties 200, signed-out me 401); legacy app bounty IDs still map to onchain 3 and 4.
The public create form shows **45 min**, with **7 days** still selected by default.

QuickNode accepted the tested filter and Restream on reorg, which survived a settings reload. The Stream
resumed using **CONTINUE WHERE IT LEFT OFF** at block 73151531 and was observed Active at 73151856.
The configured start remains 72366828; destination and legacy address are unchanged. The historical
provider filter preview passed without sending that payload to the live destination. See
[the dated configuration evidence](quicknode-verification.json) and local `release.json` artifact. Preserve the active Stream cursor, security token, destination and
legacy escrow. Do not replay synthetic fixtures into the live database. A fresh wallet-owned lifecycle, actual
provider correction/replay evidence, and a signed revised-contract deployment are not established by local tests.
