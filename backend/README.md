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

## QuickNode Streams

Streams is how escrow state reaches the database and the UI. The backend never polls the chain: `funded`,
`claimable`, `paid` and `refunded` are set only from events Streams delivers.

| Setting | Value | Why |
|---|---|---|
| Network | Arc testnet (chain `5042002`) | The `BountyEscrow` contract (`0x924525bF3f3A39f9c7f298E71aFf43F4c27a4727`) is deployed there, and it is the only chain the app uses. |
| Dataset | Logs | All escrow state changes are four events: `BountyFunded`, `RewardApproved`, `RewardPaid`, `BountyRefunded`. A log carries exactly what the receiver decodes (`address`, `topics`, `data`, `transactionHash`, `logIndex`, `blockNumber`). Blocks or receipts would ship far more data for no gain. |
| Start block | `72270484` | The escrow's deploy block. Backfill from there covers the contract's whole history, and no earlier block can hold an escrow log. |
| Batch size | 5 blocks | Small batches keep delivery latency low. |
| Filter | below | Drops every log not emitted by the escrow, and skips the delivery entirely when a batch has none. |
| Destination | Webhook, `POST /webhooks/streams`, compression **none** | Push delivery with retries. The receiver verifies QuickNode's HMAC over the uncompressed body and does not decompress gzip, so a gzipped body would fail verification. |
| Retries | terminate after 10 failures (QuickNode's max) | Survives a tunnel or api restart without the stream stopping. |

### Filter

Pasted into the stream's Filtering section. The dashboard holds the live copy: keep this one in sync.

```js
function main(stream) {
  var ESCROW = "0x924525bf3f3a39f9c7f298e71aff43f4c27a4727";
  var logs = [];
  // Walk any nesting depth (block -> receipt -> log, or block -> log): keep log objects from the escrow only.
  function walk(x) {
    if (Array.isArray(x)) { for (var i = 0; i < x.length; i++) walk(x[i]); return; }
    if (x && typeof x === "object") {
      if (typeof x.address === "string" && Array.isArray(x.topics)) {
        if (x.address.toLowerCase() === ESCROW) logs.push(x);
        return;
      }
      for (var k in x) walk(x[k]);
    }
  }
  walk(stream && stream.data);
  return logs.length ? { logs: logs } : null;
}
```

- **Address match:** lowercased on both sides, so the checksummed and lowercase forms are treated the same.
- **Any nesting:** `stream.data` holds one entry per block in the batch, and the logs are nested inside each entry.
  The walk doesn't assume a depth, so a layout change on QuickNode's side can't silently drop events.
- **Logs passed through unchanged:** the receiver's `extractLogs` finds log objects anywhere in the body, so
  `{ logs: [...] }` decodes exactly as a raw payload would.
- **`null` on an empty batch:** QuickNode then makes no delivery. QuickNode still charges API credits for every
  block it processes, so this saves requests to the api, not QuickNode credits.
- **Tested in QuickNode's runner:** block `72358114` returns exactly one log, the escrow's `RewardPaid`. The runner
  only evaluates the first block of a range, so test the event's block on its own.

### Receiver (`src/streams/webhook.ts`)

1. **Signature:** checks `x-qn-signature` against hex HMAC-SHA256 of `x-qn-nonce + x-qn-timestamp + body`, keyed by
   `QN_SECURITY_TOKEN`, with a constant-time compare. On failure it returns 401 before parsing anything.
2. **Address check:** drops any log whose address isn't `ESCROW_ADDRESS`. The filter lives outside this repo, so
   the receiver doesn't rely on it.
3. **Idempotent insert:** each decoded event is inserted into `chain_events` under the unique key
   `(chain_id, contract, tx_hash, log_index)`. Retries, replays and overlapping backfills are no-ops.
4. **Reconcile:** rebuilds each affected bounty's status from all of its stored events, so delivery order doesn't
   matter.

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

## Unverified (be honest about these)

- **GitHub App**: run against github.com on Nov 14 (App `meritly`, repo `ravindu-ranasinghe/merit-demo-api`).
  - **Verified live:** webhook signatures (`pull_request`, `pull_request_review_comment`,
    `pull_request_review_thread`), OAuth sign-in, installation tokens, compare (the heuristic took the PR #1
    candidate from `pending` to `candidate`) and collaborator permission (the maintainer approval passed).
  - **Still unexercised:** the review-comment fetch used by `POST /bounties/:id/candidates/manual`.
  - **Fixtures vs real payloads:** the fixtures are hand-written. Real `pull_request_review_comment` payloads leave
    out `comment.in_reply_to_id` on top-level comments and `pull_request.merged` entirely; the schema accepts both.
    `upsertPr` therefore computes `closed` for a review-comment event on an already-merged PR, overwriting `merged`.
- **QuickNode Streams with the filter on:** the filter output is verified in QuickNode's test runner. A real escrow
  event delivered through the filtered stream is still pending; all the deliveries above came before the filter.
- **Escrow**: deployed and source-verified on Arc testnet at `0x924525bF3f3A39f9c7f298E71aFf43F4c27a4727` (deploy
  block `72270484`). Set it as `ESCROW_ADDRESS`. `src/chain/escrow.ts` reads A's published `docs/escrow-abi.json`.
  Both hashes match the on-chain values for bounty 2:
  - `prHash = keccak256(abi.encode(uint256 repoId, uint256 prNumber))`;
  - `claimId = keccak256(abi.encode(uint256 githubCommentId))`.
- No transaction has been sent from this code on any chain.

## Known shortcuts

- GitHub delivery dedupe is an in-memory bounded set (only 7 tables are allowed); handlers are idempotent upserts.
- Streams timestamps are not freshness-checked; replays are harmless because ingestion is idempotent.
- The api image keeps dev dependencies (for `tsx` seeding).
