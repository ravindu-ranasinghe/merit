# merit backend

Node/TypeScript API between GitHub and the Arc escrow contract: GitHub App webhooks, the review-evidence
workflow, the approval gate, wallet binding, the QuickNode Streams receiver, Postgres and the REST API the
web app uses. REST contract: [`../docs/api.md`](../docs/api.md). Testnet only (Arc, chain 5042002).

## Trust boundary

**The backend holds no key that can move money.** There is no private key, wallet client or signer in this
codebase (`src/chain/escrow.ts` only encodes calldata). It prepares an `approveReward` call from verified GitHub
evidence; the maintainer's own wallet signs and sends it, and the contract only accepts it from the bounty's funder.

- GitHub is the source of truth for reviews. The Arc contract is the source of truth for money.
  QuickNode Streams is the event pipeline the UI reads; on-chain status wins for funded / claimable / paid / refunded.
- Review qualification is a **workflow, not an oracle**. The backend flags a *candidate* (comment exists, a later commit
  touched the file near the comment, thread resolved). That is a heuristic that breaks on rebase and line movement,
  and it is labelled `heuristic` in the data. A maintainer decides. A maintainer can approve a low-quality review,
  and collusion between author, reviewer and maintainer is possible.
- Identity is the immutable numeric GitHub user id, never a login. Maintainer permission is re-fetched from the GitHub
  API on every write. Self-review, the PR author and bots are excluded.

## Stack

Fastify (pino logging built in, easy per-route raw body for HMAC checks), Zod (every inbound body, query, env),
Drizzle + drizzle-kit migrations (run at boot), viem, `@octokit/app`, Vitest against real Postgres.

## Run

```sh
cd backend
docker compose up --build        # api on :4000, Postgres on host :5433, migrations run on boot
docker compose exec api npx tsx src/db/seed.ts   # demo repo, PR #1, maintainer 1001, author 2002, reviewer 3003
curl localhost:4000/health
curl localhost:4000/bounties
```

## Vercel live deployment

The backend is a separate Vercel project with **Framework Preset Fastify**. For a
Git import, set **Root Directory `backend`**; for a CLI upload from `backend/`, leave
the project's Root Directory unset. `src/index.ts` is its entrypoint. Keep the `web` project
separate; the web app proxies `/api/merit/*` to this API so OAuth and session cookies
stay on the web origin.

1. Provision a hosted PostgreSQL database and use its connection string as
   `DATABASE_URL`. The API runs the checked-in Drizzle migrations at startup.
2. Set backend production environment variables: `DATABASE_URL`,
   `WEB_ORIGIN=https://<web-domain>`, `SESSION_SECRET` (32+ random characters),
   `QN_SECURITY_TOKEN`, `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`,
   `GITHUB_WEBHOOK_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and
   `ESCROW_ADDRESS`. Never use the development Docker Compose values on the public API.
3. Deploy and open `https://<api-domain>/health`. It must return
   `{ "ok": true, "github_mock": false }`.
4. In the GitHub App settings, set the webhook URL to
   `https://<api-domain>/webhooks/github` and the OAuth callback URL to
   `https://<web-domain>/api/merit/auth/github/callback`. Subscribe to installation,
   installation repositories, pull request, pull request review comment, and pull
   request review thread events. The installation webhook registers the repositories
   visible to the installing maintainer.
5. In the web Vercel project, set `NEXT_PUBLIC_MOCK=0`,
   `NEXT_PUBLIC_BACKEND_URL=/api/merit`, `MERIT_API_ORIGIN=https://<api-domain>`,
   and `NEXT_PUBLIC_GITHUB_APP_SLUG`. Redeploy the web project; then confirm
   `https://<web-domain>/api/merit/health` and sign in through the web UI.
6. Point QuickNode Streams at `https://<api-domain>/webhooks/streams` with the
   same `QN_SECURITY_TOKEN`. Without delivered chain events, funded and payout
   states cannot advance in the UI.

`npm run sync-abi` refreshes the bundled ABI from `docs/escrow-abi.json` after
contract interface changes. Commit the generated JSON with the source change.

Without GitHub credentials the API runs against an in-memory **mock** GitHub client (`/health` shows
`github_mock: true`; log in via `/auth/github/login`, which signs you in as user 1001).

## Environment

See `.env.example`. `DATABASE_URL` is required. `ESCROW_ADDRESS` comes from Engineer A's deploy (unset = zero
address, warned). `SESSION_SECRET` (32+ random chars), `QN_SECURITY_TOKEN` (stream settings) and the five GitHub
App values (`GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_CLIENT_ID`,
`GITHUB_CLIENT_SECRET`) are secrets. Secrets come from env only.

### Production vs dev

- **`NODE_ENV=production` requires every secret above and refuses to boot otherwise.** It never uses the mock
  client or any default secret. The mock OAuth accepts `code=mock:<id>:<login>`, which would let anyone log in as
  any GitHub user, so it must never be reachable on a public instance.
- Dev mode keeps insecure defaults and prints `DEV DEFAULT SECRETS IN USE ...` at boot.
- The `docker-compose.yml` sets `NODE_ENV=development`: it is **local-only**. Never expose that stack publicly.
- The hosted demo must run `NODE_ENV=production` with real secrets.

## Test

```sh
docker compose up -d db
npm test          # Vitest, real Postgres on :5433 in a separate merit_test database
npx tsc --noEmit  # strict
```

Tests cover: GitHub signature (valid, forged, tampered, replayed delivery, wrong repo), evidence heuristic,
wallet binding (valid, replayed, expired, wrong user, wrong signer), Streams (same event 3x, out of order,
backfill, partial refund stays claimable), SQL unique constraints, approval gate, production env refusal and
session cookie forgery.

### Replay demo

```sh
docker compose up -d db
npm run replay-demo
```

Reads every escrow log since the deploy block from Arc RPC and rebuilds a separate `merit_replay` database
through the real Streams receiver. It then replays the history three more ways and checks the state is
identical each time: a full backfill on top, every log twice in shuffled order, and a fresh database that
missed a third of the history and was then backfilled. Last, it compares the rebuilt state with the
contract's own `bounties(id)` view. It replays Arc logs through Merit's receiver; it does not call
QuickNode's backfill API. Exit code 1 means a mismatch.

## QuickNode Streams

Streams is how escrow state reaches the database and the UI. The backend never polls the chain: `funded`,
`claimable`, `paid` and `refunded` are set only from events Streams delivers.

| Setting | Value | Why |
|---|---|---|
| Network | Arc testnet (chain `5042002`) | The `BountyEscrow` contract (`0x924525bF3f3A39f9c7f298E71aFf43F4c27a4727`) is deployed there, and it is the only chain the app uses. |
| Dataset | Logs | All escrow state changes are four events: `BountyFunded`, `RewardApproved`, `RewardPaid`, `BountyRefunded`. A log carries exactly what the receiver decodes (`address`, `topics`, `data`, `transactionHash`, `logIndex`, `blockNumber`). Blocks or receipts would ship far more data for no gain. |
| Start block | `72366828` on the active Stream, inspected November 19 | The contract was deployed at `72270484`. The active Stream does not cover that earlier history; use an isolated bounded backfill when verifying it rather than rewinding production. |
| Batch size | 5 blocks; Elastic Batch on | Matches the inspected active Stream. |
| Filter | below | Drops every log not emitted by the escrow, and skips the delivery entirely when a batch has none. |
| Destination | `https://merit-backend-seven.vercel.app/webhooks/streams`, compression **none** | Matches the deployed backend. The receiver verifies QuickNode's HMAC over the uncompressed body and does not decompress gzip. |
| Timeout / retries | 30 seconds / retry after 1 second / pause after 3 failures | Actual dashboard settings inspected November 19. Retries are bounded; an exhausted retry policy pauses the Stream. |

### Filter

The revised filter is checked in at [scripts/streams-filter.js](scripts/streams-filter.js). It retains
only escrow logs and preserves `metadata` inside the signed body. Empty ordinary batches return `null`;
empty **reorg corrections** return `{ data: [], metadata }`, so orphaned payouts/refunds can be removed.
The [dated verification record](../docs/quicknode-verification.json) retains the November 19 snapshot and
November 20 update: after the receiver deployed, this filter and **Restream on reorg** were saved and
reloaded, then the Stream resumed with **CONTINUE WHERE IT LEFT OFF**. The start block, address,
destination and HMAC token were preserved. This configuration check is not fresh live-payment proof.

### Receiver (`src/streams/webhook.ts`)

1. **Signature:** checks `x-qn-signature` against hex HMAC-SHA256 of `x-qn-nonce + x-qn-timestamp + body`, keyed by
   `QN_SECURITY_TOKEN`, with a constant-time compare. On failure it returns 401 before parsing anything.
2. **Address check:** drops any log whose address isn't `ESCROW_ADDRESS`. The filter lives outside this repo, so
   the receiver doesn't rely on it.
3. **Canonical validation:** `CANONICAL_RPC_URL` defaults to the public Arc testnet RPC. Signed Streams logs
   must match the canonical block and transaction receipt. RPC supplies validation only, never new payment events.
   An unavailable/wrong-chain RPC returns 503 before a transaction commits; Streams must retry.
4. **Idempotent insert:** each decoded event is inserted into `chain_events` under the unique key
   `(chain_id, contract, tx_hash, log_index)`. Retries, replays and overlapping backfills are no-ops.
5. **Reconcile:** rebuilds each affected bounty from canonical stored events. Signed body `metadata.reorgs` /
   `metadata.blocks_reorged` trigger RPC-validated corrections. Orphan rows stay in the ledger (`removed=true`);
   re-included event versions preserve displaced facts in `reorg_history`. Approvals can regress only on a
   validated correction. Funding removal detaches the onchain id while preserving authenticated intent terms.
   Orphan rows retain the former app bounty id so a repeated empty correction can repair a failed comment update.
   All receipt, dashboard, event and comment queries exclude orphaned events. Unsigned reorg headers do nothing.

A PostgreSQL transaction advisory lock serializes comment writes per local bounty across server instances;
a competing sync defers to the active writer. No process-local map is used.
All indexing finishes before GitHub comment work. The entire comment phase shares an eight-second budget,
independent of batch size. A timeout aborts its GitHub requests and prevents later sync steps from starting writes;
it cannot undo a write GitHub already accepted. Failed or deferred comment syncs log the bounty id separately from
successful indexing. Another delivery/replay heals them; maintainers can also use **Recheck GitHub** on the bounty
to repair a missing/stale comment from already indexed events, without waiting for a new transaction. Public
non-maintainers can still refresh review evidence but cannot publish the bot comment. A comment-only failure is
reported separately in the existing error UI, and `GITHUB_PR_COMMENTS=0` is respected. The existing expiry sweep
can also repair eligible expired bounties when configured. Comments remain best effort; there is no new queue or scheduler.

All event reads additionally match the configured chain id and lowercased escrow address. Logs retained from another
context cannot bind an intent, advance an approval, supply displayed amounts or credit a reviewer. One application
database belongs to one deployment; use a separate database for another chain/escrow. No migration rewrites existing
intent ownership or historical events. Older pending rows without a verified funder remain unbound and do not block
creating a complete intent. See [the acceptance checklist](../docs/demo-checklist.md) for current local results and
the pending fresh filtered-Stream proof.

### Verified on Arc testnet (Nov 14)

- **Real deliveries:** the signature check accepted every one (996 during the backfill). The only 401s were
  QuickNode's CHECK CONNECTION ping, which doesn't sign the way real deliveries do.
- **Events received,** each matched against its tx receipt on Arc:
  - the exit test of bounty 1: `BountyFunded`, `RewardApproved`, `RewardPaid`;
  - the full demo on merit-demo-api PR #1, bounty 2:
    - `BountyFunded`, tx `0x38e88e…7a88`, block 72353534;
    - `RewardApproved`, tx `0x3e2a41…2a0b`, block 72357894;
    - `RewardPaid`, tx `0x2d8946…44ec`, block 72358114.
  - Each event moved the bounty's status: funded, then claimable, then paid.

### Limitations

- **No timestamp freshness check.** A replayed delivery is harmless because the insert is idempotent.
- **Reorgs:** QuickNode's reorg headers (`Batch-Reorgs`) are not processed.

## Expiry sweep (`src/sweep.ts`, `POST /internal/sweep`)

The contract cannot act on a clock, and before this nothing in the backend did either: a bounty became `expired`
only when someone read it. A scheduler now calls the sweep every few minutes. For every bounty that is funded
onchain, past its deadline and has no indexed `BountyRefunded`, it:

1. recomputes status (`funded` / `review_candidate` → `expired`; chain states such as `claimable` and `paid` win);
2. re-syncs the PR status comment (`src/github/pr-status.ts`) when `GITHUB_PR_COMMENTS` is on. The comment has no
   deadline stage, so this only repairs a comment a failed delivery left stale (for example a 403 before the App
   permission was granted);
3. reports `refundable`: bounties whose escrow the contract would return, `amount - approvedAmount > 0`. A paid
   bounty with a partial approval is included, because its unapproved remainder is still refundable.

```json
{ "ran": true, "checked": 2,
  "changed": [{ "bounty_id": 4, "from": "funded", "to": "expired" }],
  "refundable": [{ "bounty_id": 4, "onchain_bounty_id": "3", "refundable_units": "10000000" }],
  "comments": { "created": 0, "updated": 1, "unchanged": 1, "skipped": 0, "failed": 0 } }
```

- **No key, no transaction.** The refund itself is still sent by a person from the bounty page (anyone may send it;
  the contract only pays the funder). `refundable` is the work list an automatic refund keeper would act on; that
  needs a gas-only keeper wallet and a trust-model change in SPEC.md, so it is not built.
- **Derived, not queued.** Everything comes from stored events and the clock, so after downtime the next sweep finds
  exactly what is outstanding. Running it twice changes nothing the second time.
- **One at a time.** `pg_try_advisory_xact_lock(761496107)`: an overlapping call returns `{ "ran": false }`.
- **Locked down.** The route returns 404 unless `SWEEP_SECRET` (16+ characters) is set, and 401 without
  `Authorization: Bearer <SWEEP_SECRET>` (constant-time compare). A session cookie does not work.

**Scheduler (not committed; `.github/` is CODEOWNED).** A GitHub Actions cron is the simplest caller on Vercel's
free plan. Add the API origin and the same secret as repository secrets `MERIT_API_ORIGIN` and `SWEEP_SECRET`:

```yaml
# .github/workflows/sweep.yml
name: Expiry sweep
on:
  schedule: [{ cron: "*/5 * * * *" }] # GitHub may start scheduled runs several minutes late
  workflow_dispatch: {}
jobs:
  sweep:
    runs-on: ubuntu-latest
    timeout-minutes: 2
    steps:
      - run: |
          curl --fail-with-body -sS -X POST "$MERIT_API_ORIGIN/internal/sweep" \
            -H "Authorization: Bearer $SWEEP_SECRET"
        env:
          MERIT_API_ORIGIN: ${{ secrets.MERIT_API_ORIGIN }}
          SWEEP_SECRET: ${{ secrets.SWEEP_SECRET }}
```

## Unverified (be honest about these)

- **GitHub App**: run against github.com on Nov 14 (App `meritly`, repo `ravindu-ranasinghe/merit-demo-api`).
  - **Verified live:** webhook signatures (`pull_request`, `pull_request_review_comment`,
    `pull_request_review_thread`), OAuth sign-in, installation tokens, compare (the heuristic took the PR #1
    candidate from `pending` to `candidate`) and collaborator permission (the maintainer approval passed).
  - **Still unexercised:** the review-comment fetch used by `POST /bounties/:id/candidates/manual`.
  - **Fixtures vs real payloads:** the fixtures are hand-written. Real `pull_request_review_comment` payloads leave
    out `comment.in_reply_to_id` on top-level comments and `pull_request.merged` entirely; the schema accepts both.
    `upsertPr` reads a closed PR without the flag as `closed`, but keeps a PR already recorded as `merged`
    (a merge is final on GitHub), so a later review-comment or thread event no longer downgrades it.
- **QuickNode dashboard inspected November 19:** the existing Stream was active and advancing, with Arc Testnet
  Logs, the expected escrow filter and current backend destination. The known historical payout block still returns
  one correct escrow log in the preview. An empty preview's Send Payload action displayed `Stream test successful`,
  but no matching backend response was captured; this is not proof of a fresh authenticated escrow delivery. The
  last-day metrics showed blocks processed and zero webhook requests/errors. No Stream settings or credentials
  were changed. See the sanitized [verification record](../docs/quicknode-verification.json).
- **QuickNode Streams with the filter on:** a fresh real escrow lifecycle through the filtered Stream is still
  pending. The historical pre-filter deliveries above and the dashboard preview/test do not satisfy that gate.
- **Escrow**: deployed and source-verified on Arc testnet at `0x924525bF3f3A39f9c7f298E71aFf43F4c27a4727` (deploy
  block `72270484`). Set it as `ESCROW_ADDRESS`. `src/chain/escrow.ts` reads A's published `docs/escrow-abi.json`.
  Both hashes match the on-chain values for bounty 2:
  - `prHash = keccak256(abi.encode(uint256 repoId, uint256 prNumber))`;
  - `claimId = keccak256(abi.encode(uint256 githubCommentId))`.
- No transaction has been sent from this code on any chain.
- **Expiry sweep:** tested against Postgres with simulated Streams events; no scheduler is deployed, so it has not
  run against the live API.

## Known shortcuts

- GitHub delivery dedupe is an in-memory bounded set (only 7 tables are allowed); handlers are idempotent upserts.
- Streams timestamps are not freshness-checked; replays are harmless because ingestion is idempotent.
- The api image keeps dev dependencies (for `tsx` seeding).
