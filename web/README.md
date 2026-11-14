# Merit web

The Next.js frontend for Merit: maintainer and reviewer dashboards, the bounty status
machine, the indexed event feed and the landing page. Owned by Engineer C. Read `SPEC.md`
at the repo root first.

Testnet prototype. Rewards are testnet USDC on Arc and have no monetary value.

## Setup

Requires Node 22 or newer.

```bash
cd web
npm install
cp .env.example .env.local   # mock mode is on by default in the example
npm run dev                  # http://localhost:3000
```

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint (must be clean) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run sync-abi` | Regenerates `src/lib/chain/escrow-abi.ts` from `docs/escrow-abi.json` |

CI runs lint, typecheck and build with `NEXT_PUBLIC_MOCK=1`.

## Mock mode

`NEXT_PUBLIC_MOCK=1` renders every screen and every state with no backend, no Arc RPC and
no GitHub. It is the development path while the API lands, the way to see error states that
are hard to reproduce live, and the demo-day contingency.

- A dark bar at the top says the data is sample data, and switches between four sample
  people: **Maintainer** (funds and approves), **Reviewer** (linked wallet, can claim),
  **New reviewer** (no wallet linked yet) and **No access** (blocked from approving).
- There is one sample bounty in each of the ten states, `b-101` to `b-110`. `/states` links
  to each.
- The mock chain (`src/mock/chain.ts`) enforces the same rules as `BountyEscrow.sol` and
  throws the same custom error names, so refusals look exactly as they will live.
- Money states change only when the mock indexer delivers an event, about 1.6 seconds after
  a transaction confirms. The UI never flips a money state on its own, in mock or live.
- State is in memory. A full page reload, or the reset button in the mock bar, restores the
  fixtures. Move between pages with the app's own links to keep what you did.
- The event feed labels itself "Sample events (mock mode)". It never claims to be Streams.

Suggested walk-through: `/maintainer/new` → create and fund → open `/bounties/b-107` →
"Review and approve payout" → switch to **Reviewer** → Claim → "Try a second claim".

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_MOCK` | browser | `1` turns on mock mode |
| `NEXT_PUBLIC_ESCROW_ADDRESS` | browser | Deployed `BountyEscrow` address |
| `NEXT_PUBLIC_GITHUB_APP_SLUG` | browser | GitHub App slug for the install link |
| `NEXT_PUBLIC_ARC_RPC_URL` | browser | Optional override of the SPEC RPC URL |
| `NEXT_PUBLIC_ARC_EXPLORER_URL` | browser | Optional override of the SPEC explorer URL |
| `BACKEND_URL` | server only | Engineer B's API base URL |
| `GITHUB_ID`, `GITHUB_SECRET` | server only | GitHub OAuth app for sign-in |
| `NEXTAUTH_SECRET`, `NEXTAUTH_URL` | server only | NextAuth session |

No secret ever goes in a `NEXT_PUBLIC_*` variable. The GitHub access token stays in the
encrypted session cookie and is attached server-side by the `/api/backend` proxy.

## Route map

| Route | Screen |
|---|---|
| `/` | Landing page: the distinction, how it works, trust model, limitations |
| `/maintainer` | Maintainer dashboard: stat tiles, bounties, connected repositories |
| `/maintainer/new` | Pick a repository and PR, choose $5 to $10 and a deadline, rules up front |
| `/bounties/[id]` | One bounty: status rail, next step (fund, claim, refund), evidence, events, guardrails |
| `/bounties/[id]/approve/[candidateId]` | The approval screen: recipient, amount and the review being paid for |
| `/reviewer` | Reviewer dashboard: link a payout wallet, bounties on PRs you reviewed |
| `/events` | The indexed event feed with block and transaction references |
| `/states` | Reference: all ten states and every refusal |
| `/api/auth/[...nextauth]` | GitHub sign-in |
| `/api/backend/[...path]` | Server-side proxy to the backend API |

## Where things live

| Path | Role |
|---|---|
| `src/lib/api/client.ts` | **The one backend module.** Exports `api`; mock or HTTP |
| `src/lib/api/http.ts` | Real routes and wire shapes. The only file that knows a URL |
| `src/lib/api/types.ts` | Shapes the UI reads, following the SPEC tables |
| `src/lib/api/queries.ts` | React Query hooks over `api` |
| `src/lib/chain/hooks.ts` | **The one contract module.** Wallet, funding, approve, claim, refund, dry runs |
| `src/lib/chain/escrow-abi.ts` | Generated from `docs/escrow-abi.json` |
| `src/lib/chain/errors.ts` | Contract errors to plain-language copy |
| `src/lib/format.ts` | The only place 6-decimal units become `$10.00 USDC` |
| `src/lib/status.ts` | The status machine and its rail |
| `src/mock/`, `src/fixtures/` | Mock backend, mock chain and sample data |

## Adopting the real interfaces

- **ABI changed:** `npm run sync-abi`. If a call's arguments changed, edit `src/lib/chain/hooks.ts`.
- **`docs/api.md` published:** edit `src/lib/api/http.ts` (and `types.ts` if a shape differs).
  The routes in `http.ts` today are assumptions made before `api.md` existed, listed below.

Assumed backend routes, all under `BACKEND_URL`, authenticated with
`Authorization: Bearer <GitHub user token>`:

```
GET  /repositories
GET  /repositories/:id/pulls
GET  /bounties?scope=funded-by-me|reviewed-by-me
GET  /bounties/:id
POST /bounties                               { repoId, prNumber, amountUnits, deadline }
POST /bounties/:id/funding-tx                { txHash }
POST /bounties/:id/candidates/:cid/reject
POST /bounties/:id/approvals                 { candidateId, amountUnits } -> approveReward args
POST /bounties/:id/approval-tx               { txHash }
GET  /wallet-link
POST /wallet-link/challenge                  { address } -> { nonce, message }
POST /wallet-link/verify                     { address, nonce, signature }
GET  /events?bountyId=
```

## Design notes

Light, GitHub-adjacent, wallet-last. The visual language (off-white page, grey trays with
white cards, one blue accent, spring motion, rolling digits) follows the team's bento
reference. Status colors are reserved for state and always come with a label and icon.
Motion respects `prefers-reduced-motion`.
