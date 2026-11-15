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

Fields the backend does not store are placeholders in live mode: pull request titles
("Pull request #n"), other people's logins ("user <id>") and review comment text.
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

The landing page and every app route share a graphite and mint theme, sharp corners,
Geist interface text and Geist Mono for code and ledger values. Tokens live in
`src/app/globals.css`; the homepage uses the same tokens through `home.module.css`.

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

The four-step bounty walkthrough remains interactive and labels its data as illustrative.
Status colors are reserved for state and always come with a label and icon.
The original Remotion composition remains in `src/components/how-it-works-video.tsx`.
The design applies Anthropic’s
[frontend-design skill](https://github.com/anthropics/skills/tree/main/skills/frontend-design), the
[unslop skill by Damir Sokolovsky](https://heydamir.design/unslop), licensed CC BY 4.0,
and [Asciify Engine](https://github.com/ayangabryl/asciify-engine).
