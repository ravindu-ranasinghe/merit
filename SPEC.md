# ReviewBounty — shared build spec

**Every engineer reads this file before writing code. It is the contract between the three
workstreams.** If something here is wrong, change it in a PR and tell the team — do not
silently diverge, because two other people are coding against it.

---

## The product

Paid code reviews on GitHub, backed by USDC escrow on Circle Arc.

Maintainers fund a code-review reward *before* the work begins. A reviewer who leaves
feedback that the maintainer verifies led to an accepted improvement claims the USDC. The
experience is GitHub-native; the blockchain is not in the user's face.

**Why this is not an issue-bounty clone:** normal bounties pay someone for writing code.
ReviewBounty pays for *review feedback a maintainer verified led to a fix*, with the money
escrowed before the reviewer starts.

## Hackathon facts

| | |
|---|---|
| Event | University Blockchain Conference (UBC) Hackathon 2026, UT Austin |
| Build window | Nov 12 6:00 PM CST → Nov 20 12:00 PM CST |
| Submission | **Fri Nov 20, 12:00 PM CST** on Devpost |
| Finals | Sat Nov 21, in person at UT Austin — **required for any prize, bounties included** |
| Main track | **Track 03 — Consumer Applications** (submit to this one only) |
| Chain award | **Best Use of Arc — $1,000** (not Solana; a team cannot win both) |
| Sponsor bounty | **Best Use of QuickNode Streams — $500** |
| Originality | All code written during the hackathon. Public GitHub repo created during the event. |

Judging: technical execution, product/UX, innovation, impact, demo quality.

## The go/no-go criterion

> If a GitHub review can be verified by a maintainer, funded with real testnet USDC, paid
> exactly once on Arc, and indexed through QuickNode Streams before the deadline, the
> project is ready. **Everything else is optional.**

Priority order, absolute: **P0 money works → P1 GitHub verification works → P2 UI + Streams → P3 polish.**

## Scope discipline — DO NOT BUILD

These were in the original proposal and are deliberately cut. Building any of them before
the core flow is done and tested is the main way this project fails:

- automatic review quality scoring
- multi-reviewer splitting
- 48-hour auto-approval / objection timers
- walletless or gas-sponsored claiming, embedded wallet creation
- contract upgradeability, multi-tenant treasury
- delegated claims

Testnet USDC only. **No real-money claims anywhere in the product or the pitch.**

### Discovery and evidence presentation

The application includes discovery of funded, open bounties on verified public repositories,
GitHub reward badges, public reviewer profiles, a review-to-payment timeline, and shareable
receipts backed by indexed payments. A signed-in user can recheck public review evidence to
recover missed GitHub events; private repository reads require current repository access.
These views reuse the existing escrow rules and seven database tables. They do not score
reviews, automatically approve rewards, or count unclaimed approvals as earnings.

---

## Repo layout and ownership

```
contracts/   Solidity + Foundry            → Engineer A
backend/     Node/TS API, GitHub App,      → Engineer B
             Streams receiver, Postgres
web/         Next.js dashboards            → Engineer C
docs/        frozen interfaces, shared notes (see below for who writes what)
```

**You write only inside your own directory**, plus the specific `docs/` files assigned to
you. Never edit another engineer's directory — open an issue or message them instead.
Branch per engineer (`eng-a/...`), PR into `main`, no direct pushes to `main`.

## Frozen interfaces

These are fixed on day one so all three workstreams can start in parallel. Changing one
requires telling the other two.

### Arc testnet config

| Parameter | Value |
|---|---|
| Chain ID | `5042002` |
| JSON-RPC | `https://rpc.testnet.arc.io` |
| Explorer | `https://explorer.testnet.arc.io` |
| USDC (ERC-20 predeploy) | `0x3600000000000000000000000000000000000000` |
| USDC decimals | **6** |
| Faucet | `https://faucet.circle.com` |

All amounts everywhere — Solidity, Postgres, API JSON — are **integer 6-decimal USDC
units**. `$10.00` is `10000000`. No floats in contracts or ledger accounting, ever. Only
the UI formats for humans.

### Contract surface — `BountyEscrow`

```solidity
function createBounty(bytes32 prHash, uint256 amount, uint64 expiry)
    external returns (uint256 bountyId);

function approveReward(uint256 bountyId, address recipient, uint256 amount, bytes32 claimId)
    external;

function claim(uint256 bountyId) external;

function refundExpired(uint256 bountyId) external;

event BountyFunded   (uint256 indexed bountyId, address indexed funder, bytes32 indexed prHash, uint256 amount, uint64 expiry);
event RewardApproved (uint256 indexed bountyId, address indexed recipient, uint256 amount, bytes32 claimId);
event RewardPaid     (uint256 indexed bountyId, address indexed recipient, uint256 amount, bytes32 claimId);
event BountyRefunded (uint256 indexed bountyId, address indexed funder, uint256 amount);
```

Engineer A may refine argument order or add fields **only by updating this block in a PR
and notifying B and C.** A publishes `docs/escrow-abi.json` (machine-readable ABI) and
`docs/escrow-interface.md` (every signature, event, custom error, units worked example)
by **Nov 14 EOD** — B and C are blocked on these.

### Bounty status machine

```
Draft → Funding pending → Funded → Review candidate → Approved → Claimable → Paid
                            ↓
                         Expired → Refunded
         Review candidate → Rejected
```

**Onchain status dominates for Funded, Paid, Refunded.** GitHub + backend own the
intermediate stages. The UI never shows a money state the chain has not confirmed.

### Database tables

| Table | Key fields |
|---|---|
| `repositories` | `github_repo_id`, `installation_id`, `name`, `maintainer_github_id` |
| `pull_requests` | `repo_id`, `github_pr_number`, `head_sha`, `status` |
| `bounties` | `onchain_bounty_id`, `pr_id`, `funder_wallet`, `amount_units`, `deadline`, `status` |
| `review_candidates` | `github_comment_id`, `github_reviewer_id`, `file_path`, `diff_hunk`, `commit_sha`, `qualification_evidence`, `status` |
| `wallet_links` | `github_user_id`, `wallet_address`, `signed_challenge`, `verified_at` |
| `approvals` | `bounty_id`, `reviewer_id`, `approver_github_id`, `amount_units`, `approved_recipient`, `chain_tx_hash` |
| `chain_events` | `chain_id`, `contract`, `tx_hash`, `log_index`, `event_type`, `payload`, `ingestion_timestamp` |

`chain_events` has a **unique constraint on (chain_id, contract, tx_hash, log_index)** —
this is what makes Streams replays harmless. Engineer B publishes `docs/api.md` (every
REST route with request/response shapes) by **Nov 15 EOD** — C is blocked on it.

---

## Trust model — state this honestly in the README, the UI and the pitch

- **GitHub** is the source of truth for reviews.
- **The Arc contract** is the source of truth for money.
- **QuickNode Streams** is the indexed event pipeline the UI reads.
- The backend joins these domains. It **does not** establish that a comment was useful, and
  it **holds no key that can move money**. It prepares an approval; a maintainer signs it
  onchain.

Review qualification is a **workflow, not an oracle.** The backend flags a *candidate* when
(a) a review comment exists, (b) a later commit touched the relevant file/line context, and
(c) the thread is resolved. These are heuristics and they break on rebase and line movement.
Label them as heuristics in the data and in the UI.

What we can responsibly claim:
- Arc secured the reward in advance and performed a real testnet payout.
- A maintainer verified a review deserved payment; GitHub metadata assisted the evidence workflow.
- QuickNode Streams delivered the events used to reconcile and display funding and payouts.
- This is a payment-coordination prototype — not production tax, fraud, identity or labor compliance.

Known, disclosed limitations: a registered maintainer can approve a low-quality review, and
collusion between author, reviewer and maintainer remains possible. Blockchain does not
solve subjective review assessment. Say so; do not oversell.

## Security non-negotiables

- Verify `X-Hub-Signature-256` on every GitHub webhook with a timing-safe compare, on the
  **raw body, before parsing**. Cross-check sensitive actions against the GitHub API.
- Installation-scoped GitHub App. Re-check repo maintainer permission **at approval time**.
  Never trust a role asserted by the browser.
- Compare immutable **GitHub user IDs**, never usernames.
- No payout for self-review or for the PR author.
- One bounty pays at most one reviewer, at most once.
- Idempotent webhook processing keyed on `(chain_id, contract, tx_hash, log_index)`.
  Backfills, retries and out-of-order delivery must not double-pay or double-transition.
- Secrets (GitHub OAuth, App private key, signing keys, deployer key) stay server-side.
  **Never in `NEXT_PUBLIC_*`.**

## Invariants the contract must guarantee

- No withdrawal by anyone except payout to an approved recipient, or expired refund to the
  original funder.
- No payout larger than the funded amount. No double claims. No overflow/negative accounting.
- Approval and refund cannot spend the same balance.
- A reviewer cannot approve their own bounty.
- Expiry and refund require a submitted transaction — the contract cannot act on a clock.

---

## Schedule — exit test is what "done" means

| Date | Deliverable | Exit test |
|---|---|---|
| Nov 13 | Repo, UI skeleton, Arc/Foundry env, contract spec | testnet wallet funded; local contract tests pass |
| Nov 14 | Escrow code, deploy script, verified deployment | real USDC funding + manual claim succeed on Arc |
| Nov 15 | GitHub App, webhook sig verification, repo/PR select | a review event maps to the right PR and GitHub user |
| Nov 16 | Review evidence pipeline, approval gate, wallet binding | approved reviewer is the only recipient; duplicates rejected |
| Nov 17 | Dashboards + full contract integration | live end-to-end bounty and payout with explorer links |
| Nov 18 | QuickNode Streams filter, destination, indexed state | funding + payout events reach DB and UI **via Streams** |
| Nov 19 | Security regression, polish, README, 2–3 min video | cold-start demo passes **twice**; contingencies ready |
| Nov 20 | Final smoke test, Devpost submit before 12 PM CST | live app + public repo + video + contract address submitted |

**Nov 19 is a hard feature freeze.** Everything after is testing, docs, video, rehearsal.

## Integration checkpoints and fallbacks

| By | Decision |
|---|---|
| Nov 14 | If Circle wallet onboarding is unstable → explicit wallet connect + signed GitHub↔wallet linking. Never block contract work on it. |
| Nov 16 | If line-change heuristics are unreliable → keep a manual review-evidence URL + confirm button, and be transparent that it is manual. |
| Nov 18 | If Streams does not reliably deliver Arc data → preserve the Arc MVP and **mark the QuickNode bounty unproven.** Do not claim qualification we did not earn. |
| Nov 19 | Freeze. All stretch features become post-hackathon roadmap. |

## Acceptance criteria for the submission

- At least one real funding transaction and one real USDC claim/payout on Arc testnet.
- One eligible GitHub review linked to a real PR, with explicit maintainer approval recorded.
- Duplicate claim rejected onchain; unauthorized approver cannot award; over-budget payout rejected.
- Streams drives persisted onchain event state — not an RPC polling screen.
- A judge can understand and replay the flow in 2–3 minutes.

## Demo script (2–3 min) — build toward this

| Time | Beat |
|---|---|
| 0:00–0:20 | Problem: code is rewarded, careful review is not. Introduce the pre-funded $10 review bounty. |
| 0:20–0:45 | Real GitHub PR + funded bounty; open the Arc explorer funding transaction. |
| 0:45–1:20 | Reviewer leaves a meaningful inline comment; author fixes it; UI shows candidate evidence. |
| 1:20–1:55 | Maintainer approves; reviewer claims; USDC transfer finalizes on Arc. |
| 1:55–2:20 | Streams indexes `RewardPaid`; dashboard updates from the event feed. |
| 2:20–2:40 | Guardrails and the value of USDC escrow; show a **rejected duplicate claim.** |

## Submission checklist

- [ ] Main track: Track 03 — Consumer Applications (do not also select Track 1)
- [ ] Chain award: Best Use of Arc
- [ ] Bounty: QuickNode Streams — **only if** Streams is genuinely a core onchain data source
- [ ] Public GitHub repo created during the hackathon
- [ ] README: setup, contracts, chain + contract address, architecture, trust assumptions
- [ ] Working hosted app + seeded demo repo / test credentials
- [ ] Public judge-accessible 2–3 min demo video
- [ ] Written answers: what you built, problem solved, how it works, what's unique, what's next
- [ ] Technologies and sponsor tools listed; team members listed
- [ ] **Someone physically present at the Nov 21 closing ceremony**
