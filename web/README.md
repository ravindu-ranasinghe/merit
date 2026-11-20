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
| `npm run check:accounting` | Regression check: partial payouts, refunds and dashboard totals in integer units |
| `npm run check:deposit` | Regression check: a broadcast deposit plus a receipt failure never leads to a second deposit |

CI runs lint, typecheck and build with `NEXT_PUBLIC_MOCK=1`.

## Mock mode

`NEXT_PUBLIC_MOCK=1` renders every screen and every state with no backend, no Arc RPC and
no GitHub. It is the development path while the API lands, the way to see error states that
are hard to reproduce live, and the demo-day contingency.

- A dark bar at the top says the data is sample data, and switches between four sample
  people: **Maintainer** (funds and approves), **Reviewer** (linked wallet, can claim),
  **New reviewer** (no wallet linked yet) and **No access** (blocked from approving).
- There is one sample bounty in each of the ten states, `b-101` to `b-110`. `/states` links
  to each. `b-111` and `b-112` are partial payouts ($10 funded, $4 approved, deadline passed):
  `b-111` is unclaimed (refund the $6 remainder first, then claim), `b-112` is already paid.
- The mock chain (`src/mock/chain.ts`) enforces the same rules as `BountyEscrow.sol` and
  throws the same custom error names, so refusals look exactly as they will live.
- Money states change only when the mock indexer delivers an event, about 1.6 seconds after
  a transaction confirms. The UI never flips a money state on its own, in mock or live.
- State is in memory. A full page reload, or the reset button in the mock bar, restores the
  fixtures. Move between pages with the app's own links to keep what you did.
- The event feed labels itself "Sample events (mock mode)". It never claims to be Streams.

Suggested walk-through: `/maintainer/new` → create and fund → open `/bounties/b-107` →
"Review and approve payout" → switch to **Reviewer** → Claim → "Try a second claim".

## Where the money is

Every amount shown for a bounty comes from its indexed events through `src/lib/accounting.ts`, never from
its status label. Held is funded minus paid minus refunded. An approval reserves its amount: after the
deadline only funded minus approved is refundable, and the approved recipient can still claim whether or
not that remainder was refunded first. Prepared or signed approvals reserve nothing until `RewardApproved`
is indexed. The dashboard's "Held in escrow" and "Paid to reviewers" are sums of these amounts, which is why
`GET /bounties` rows carry their events.

## Funding recovery

A deposit (`createBounty`) is recorded the moment the wallet broadcasts it, with its wallet, chain, escrow
and terms (`src/lib/chain/deposit-flow.ts`). If the receipt lookup then fails, or the page is refreshed, the
panel checks that same deposit against Arc instead of offering another one:

- its receipt succeeded, or a replacement from the same wallet emitted the matching `BountyFunded`: confirmed,
  wait for indexing, nothing more to sign;
- its receipt reverted, or its nonce was used by a transaction that did not fund the bounty: "Fund again";
- otherwise it is still pending: "Check the deposit again", which never sends a transaction.

The USDC approval is never recorded as a deposit. Funding must come from `bounty.funder_wallet`, the wallet
recorded when the bounty was created; the panel blocks funding from any other wallet.

Limit: the record lives in this browser's `localStorage`. Another browser or device does not see a deposit
sent from here and, while it is unindexed, would offer "Fund" again. The backend records no funding hash.
Funding checks that storage can save recovery data before opening the wallet and again after the allowance step.
Blocked/full storage prevents a deposit. If storage disappears after broadcast, the hash remains available in this
tab and the panel warns to keep it open until indexing; a full reload can lose that memory-only record. Do not clear
browser data while a deposit is unresolved. Account/network changes during allowance stop the deposit, and the real
driver pins the signing account across simulation and broadcast.

`npm run check:deposit` runs the orchestration under Node with a fake chain: one deposit after a receipt
failure and retry, resume after refresh, revert and replacement, rejection before broadcast, allowance-only
failure, double clicks and another wallet. In mock mode, set a one-shot fault in the browser console before
clicking Fund: `sessionStorage.setItem("merit.mock.fault", "receipt-timeout")` (mined, but the receipt
lookup throws) or `"revert-after-broadcast"`. The executable check also covers unavailable storage and wallet/network
changes while allowance confirms. See [the acceptance checklist](../docs/demo-checklist.md) for both refund orderings
and the remaining interactive/live checks.

Receipt recovery checks the actual escrow event and intended terms. A successful cancellation receipt is not funding.
When viem reports a replacement, its hash is saved through the same submission callback; a funded replacement stays
waiting for indexing, while a confirmed replacement with no matching deposit permits another attempt. CI runs both
`check:deposit` and `check:accounting`. The optional `scripts/demo-qa.mjs` runs browser checks with an installed
Playwright Core module; its two November 19 mock sessions passed with no uncaught page errors.

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_MOCK` | browser | `1` turns on mock mode |
| `NEXT_PUBLIC_DEMO_DEADLINES` | browser | `1` adds a 5-minute deadline to the new-bounty form, to demo expiry and refund on testnet. Always on in mock mode; leave unset otherwise |
| `NEXT_PUBLIC_ESCROW_ADDRESS` | browser | Deployed `BountyEscrow` address |
| `NEXT_PUBLIC_GITHUB_APP_SLUG` | browser | GitHub App slug for the install link |
| `NEXT_PUBLIC_ARC_RPC_URL` | browser | Optional override of the SPEC RPC URL |
| `NEXT_PUBLIC_ARC_EXPLORER_URL` | browser | Optional override of the SPEC explorer URL |
| `NEXT_PUBLIC_BACKEND_URL` | browser | Engineer B's API, default `http://localhost:4000` |

The web app holds no secrets. Sign-in is the backend's GitHub OAuth (`/auth/github/login`),
which sets an httpOnly `merit_session` cookie; every API call sends it with
`credentials: "include"`.

## Live mode

Set `NEXT_PUBLIC_MOCK=0` in `.env.local`, start the backend on port 4000 and run
`npm run dev` on port 3000 (the backend's CORS allows only that origin).

For Vercel, set `NEXT_PUBLIC_BACKEND_URL=/api/merit` and
`MERIT_API_ORIGIN=https://<backend-vercel-domain>` on the web project. The rewrite
in `next.config.ts` keeps API requests and the GitHub OAuth callback on the web
origin. See `backend/README.md` for the backend database, secrets, and webhook setup.

The backend enriches PR titles and GitHub identities from GitHub, with bounded display caches.
Review comment text is retained with qualification evidence. Use **Recheck GitHub** on a bounty
to backfill comments and thread state that predate deployment or arrived in missed webhooks.
Comparison failures remain pending and are labelled as unverified rather than a missing fix.
The new-bounty page lists open pull requests from GitHub's public API, so it only works
for public repositories.

## Route map

| Route | Screen |
|---|---|
| `/` | Landing page: the distinction, how it works, trust model, limitations |
| `/maintainer` | Maintainer dashboard: stat tiles, bounties, connected repositories |
| `/maintainer/new` | Pick a repository and PR, choose $5 to $10 and a deadline, rules up front |
| `/bounties/[id]` | One bounty: status rail, next step (fund, claim, refund), evidence, events, guardrails |
| `/bounties/[id]/approve/[candidateId]` | The approval screen: recipient, amount and the review being paid for |
| `/reviewer` | Reviewer dashboard: link a payout wallet, bounties on PRs you reviewed |
| `/open-source` | Public, funded, open rewards with search, language filtering, and value/deadline sorting |
| `/reviewers/[id]` | Public review contributions, confirmed acceptances, and paid earnings |
| `/bounties/[id]/receipt` | Shareable payout record, available only after an indexed payment |
| `/events` | The indexed event feed with block and transaction references |
| `/states` | Reference: all ten states and every refusal |

## Where things live

| Path | Role |
|---|---|
| `src/lib/api/client.ts` | **The one backend module.** Exports `api`; mock or HTTP |
| `src/lib/api/http.ts` | Real routes from `docs/api.md`, mapped onto `types.ts`. The only file that knows a URL |
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
- **`docs/api.md` changed:** edit `src/lib/api/http.ts` (and `types.ts` if a UI shape must change).

## Design notes

The landing page and every app route share linen, warm stone, taupe and charcoal, sharp corners,
Geist interface text and Geist Mono for code and ledger values. Tokens live in
`src/app/globals.css`; the homepage uses the same tokens through `home.module.css`.
The reference palette is `#EBE2CC`, `#DED6C1`, `#CFC6B1`, `#B7B09E`, with darker
ink for readable text and restrained semantic colors for statuses.

`AmbientField` mounts one persistent `asciify-engine/field` canvas in the root layout.
A custom GPU effect draws three moving, branching character streams. It targets 60 fps,
caps pixel ratio at 1 and uses a 96-cell pointer simulation. A warm browser measurement
on Apple M4 / Chrome at 1440×1000 and DPR 1 recorded 330 frames in 5.5 seconds (60 fps).
Other hardware and power settings affect actual frame rate.

The renderer survives client navigation, pauses in hidden tabs and follows reduced
motion. The motion control freezes both the scene and pointer response. Text clear
zones are cached on layout/scroll changes, and data panels have solid surfaces. The
CSS fallback at `public/art/currents.svg` remains without WebGL or JavaScript;
regenerate it with `node scripts/generate-homepage-art.mjs`.

The four-step walkthrough is a 26-second, 60 fps Remotion composition in
`src/components/how-it-works-video.tsx`. It demonstrates funding in Merit, an inline
GitHub review, the author's fix, then explicit maintainer approval and a separate
reviewer claim. It is an illustration using sample data, not live activity.
`review-film.tsx` lazy-loads near the viewport, pauses offscreen and in hidden tabs,
and supplies play/pause, replay and keyboard-accessible scrubbing. Chapter buttons
seek the player and track playback. Reduced motion selects readable still frames.
The mobile composition rearranges the same scene at a taller aspect ratio.
All composition motion derives from the current frame; matched horizontal scene
transitions preserve the browser frame and return smoothly to the opening scene.

Status colors are reserved for state and always come with a label and icon.
The design applies Anthropic’s
[frontend-design skill](https://github.com/anthropics/skills/tree/main/skills/frontend-design), the
[unslop skill by Damir Sokolovsky](https://heydamir.design/unslop), licensed CC BY 4.0,
and [Asciify Engine](https://github.com/ayangabryl/asciify-engine).
Motion guidance also comes from [Emil Kowalski's improve-animations](https://github.com/emilkowalski/skills),
[mblode's ui-animation](https://github.com/mblode/agent-skills), and the
[Hyperframes motion-doctrine and seam-craft skills](https://github.com/heygen-com/hyperframes).
