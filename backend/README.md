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

The backend is a separate Vercel project with **Root Directory `backend`** and
**Framework Preset Fastify**. `src/index.ts` is its entrypoint. Keep the `web` project
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

## Unverified (be honest about these)

- **GitHub App**: never run against github.com; everything goes through the `GitHubClient` interface, tested with
  the mock. Octokit calls (installation tokens, collaborator permission, compare, review comment) and the real OAuth
  exchange are unverified. Webhook payload fixtures are hand-written to GitHub's documented shape.
- **QuickNode Streams**: the signature scheme (`x-qn-nonce`, `x-qn-timestamp`, `x-qn-signature`, hex HMAC-SHA256 over
  nonce + timestamp + body, keyed by the security token) is taken from QuickNode's docs, but no real stream has
  delivered to this code. The Logs payload shape is not confirmed, so the receiver accepts any JSON that contains
  log objects (`{data:[...]}`, a bare array, nested arrays). Whether QuickNode supports Arc is the Nov 18 go/no-go;
  until a stream delivers, the QuickNode bounty is **unproven**.
- **Escrow ABI**: `src/chain/escrow.ts` reads A's published `docs/escrow-abi.json` directly; the contract is not
  deployed yet, so `ESCROW_ADDRESS` stays unset until A's deploy PR. `prHash = keccak256(abi.encode(uint256 repoId, uint256 prNumber))` and
  `claimId = keccak256(abi.encode(uint256 githubCommentId))` match `docs/escrow-interface.md`.
- No transaction has been sent from this code on any chain.

## Known shortcuts

- GitHub delivery dedupe is an in-memory bounded set (only 7 tables are allowed); handlers are idempotent upserts.
- Streams timestamps are not freshness-checked; replays are harmless because ingestion is idempotent.
- The api image keeps dev dependencies (for `tsx` seeding).
