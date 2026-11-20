# Backend REST API v1 (Engineer B)

Base URL in dev: `http://localhost:4000`. JSON in, JSON out. Testnet only (Arc, chain `5042002`).
This is the contract for the web app. Breaking changes are announced to C the same hour.

## Conventions

- **Amounts and onchain ids are decimal strings** of integer 6-decimal USDC units (`"10000000"` = $10.00).
  Never numbers, never floats. Format for humans in the UI only.
- **GitHub ids are JSON numbers** (`github_user_id`, `github_repo_id`, `github_comment_id`). Ids are immutable;
  display logins never determine access. Review evidence retains the signed comment body and reviewer display
  metadata; PR titles and other identities are fetched from GitHub with short display caches.
- Timestamps are ISO-8601 UTC strings. `deadline` is the onchain expiry.
- Addresses and hashes are lowercase `0x` hex.
- Event reads and reconciliation are scoped to the configured chain id and escrow address, including list/detail
  amounts, reviewer profiles, GitHub status comments and the event feed. Other deployment logs remain in the ledger
  but cannot supply this deployment's facts. Each app database belongs to one chain/escrow deployment; do not point
  an existing bounty database at a different deployment and reuse its contract-local bounty ids.
- **Errors**: `{ "error": "message" }` with 400 (bad input; also carries `issues`), 401 (no/invalid session),
  403 (not allowed), 404, 409 (conflict, e.g. duplicate), 5xx.
- **Auth**: an httpOnly signed cookie `merit_session`, set by the OAuth callback. Call with
  `fetch(url, { credentials: "include" })`. CORS allows only `WEB_ORIGIN` with credentials.
  When `WEB_ORIGIN` is https the cookies are `SameSite=None; Secure` (web and API on different hosts), otherwise `Lax`.
  A non-GET request carrying an `Origin` other than `WEB_ORIGIN` gets 403.
  The browser never asserts a role: maintainer rights are re-checked against GitHub on every write.
- **Money state is chain-confirmed.** `funded`, `claimable`, `paid`, `refunded` come only from QuickNode Streams
  events. The backend never sends a transaction; routes marked "prepares a tx" return calldata that the user's
  own wallet signs and sends. Response shape for a prepared tx (`PreparedTx`):
  `{ "chainId": 5042002, "to": "0x..", "functionName": "approveReward", "args": ["..."], "data": "0x.." }`.
  All `args` are strings. Use `data` directly with `eth_sendTransaction`, or `functionName` + `args` with viem
  and A's ABI.

## Bounty status

`funding_pending -> funded -> review_candidate -> approved -> claimable -> paid`, plus `expired`, `refunded`.
(`draft` exists in the enum but the API never returns it.)

Precedence: `paid > claimable > refunded > funded`, decided by chain events only. A `RewardApproved` followed by
a partial `BountyRefunded` (the contract refunds `amount - approvedAmount`) stays `claimable`.
Offchain overlays apply only while the chain says `funded`: `review_candidate` (a candidate or confirmed
candidate exists), `approved` (an approval was prepared/signed but `RewardApproved` is not yet seen), `expired`
(`deadline` passed, not yet refunded). Streams delivery is eventually consistent: poll `GET /bounties/:id`.

## Shapes

```ts
Bounty = {
  id: number,                         // backend id, used in URLs
  onchain_bounty_id: string | null,   // null until BountyFunded is seen
  status: "funding_pending"|"funded"|"review_candidate"|"approved"|"claimable"|"paid"|"expired"|"refunded",
  amount_units: string, funder_wallet: string | null, deadline: string, created_at: string,
  pr: { github_pr_number: number, head_sha: string, status: "open"|"closed"|"merged", author_github_id: number, pr_hash: string },
  repo: { github_repo_id: number, name: string /* owner/repo */, maintainer_github_id: number },
}
BountyDetail = Bounty & { candidates: Candidate[], approvals: Approval[], events: ChainEvent[] }

Candidate = {
  id: number, pr_id: number, github_comment_id: number, github_reviewer_id: number,
  file_path: string, diff_hunk: string, commit_sha: string, thread_resolved: boolean,
  status: "pending"|"candidate"|"confirmed"|"rejected",
  // Evidence, NOT proof of quality. Always show `limitations` next to it in the UI.
  qualification_evidence: { method: "heuristic"|"manual", limitations: string, [k: string]: unknown },
  reviewer_wallet: string | null,     // linked wallet of the reviewer; approval needs it
  created_at: string,
}
Approval = {
  id: number, bounty_id: number, candidate_id: number, reviewer_id: number, approver_github_id: number,
  amount_units: string, approved_recipient: string, claim_id: string,
  chain_tx_hash: string | null, status: "prepared"|"signed"|"paid", created_at: string,
}
ChainEvent = {
  id: number, chain_id: number, contract: string, tx_hash: string, log_index: number, block_number: number,
  event_type: "BountyFunded"|"RewardApproved"|"RewardPaid"|"BountyRefunded",
  onchain_bounty_id: string | null, payload: object, ingestion_timestamp: string, explorer_url: string,
}
```

`qualification_evidence.method` is `"heuristic"` (comment, later commit touched the file near the comment, thread
resolved; breaks on rebase and line movement) or `"manual"` (maintainer supplied the evidence URL).

### Discovery, review display, and recovery

`Bounty.pr` also includes optional `title` and `author: { id, login, avatar_url? }`.
`Bounty.repo` includes `maintainer` in the same identity shape. Candidates and approvals carry
reviewer identities; approvals also carry the approver identity. These are display fields only.

`qualification_evidence` can include `comment_body`, `commented_at`, `reviewer`, `line`,
`checked_at`, `resolved_at`, `compared_head`, and `later_commit_touched: boolean | null`.
`resolved_at` is when Merit observed the resolution, not an asserted GitHub event timestamp.
`check_reason` is one of `waiting_for_commit`, `waiting_for_fix`, `waiting_for_resolution`,
`github_unavailable`, `missing_line`, or `ready`. A null touched signal means unverified.

- `GET /open-source` returns `{ bounties }`: public repositories verified live through GitHub,
  with an open PR, indexed funding, an unexpired deadline, and no pending/committed payout.
  Rows include `description` and `language` from GitHub. Failed visibility checks exclude the repository.
- `GET /reviewers/:id` returns `{ user, bounties }`: public contributions by numeric GitHub ID,
  including their candidates, committed approvals, and indexed events. The UI counts earnings only
  with a `RewardPaid` event, not a prepared approval or unclaimed reward. Paid approvals must belong to
  the bounty the payment event is linked to and match its claim ID, recipient and amount; the display amount
  is taken from that payment event. The Streams receiver and the PR status comment apply the same rule.
- `GET /bounties/:id/badge.svg` returns a live SVG reward/status badge for a verified public
  repository, with a 30-second public cache. Amounts are explicitly test USDC. Private badges return 404.
- `POST /bounties/:id/refresh` requires a signed session. Public repositories can be rechecked
  by any signed-in user; private repositories require live maintainer permission. It fetches the
  current head, all review comments, and paginated review threads, then reevaluates the heuristics.
  It backfills missing events while preserving rejected/manual decisions. Response:
  `{ ok: true, checked_at, comment_sync }`. A maintainer recheck also repairs the PR's Merit status comment
  from existing indexed events; no new chain event is needed. Public non-maintainers still refresh reviews
  but do not publish comments. `comment_sync` is `created`, `updated`, `unchanged`, `disabled`, or `skipped`
  (no linked/confirmed bounty or no maintainer permission). Comment work shares the existing eight-second
  timeout/cancellation protection. A comment failure returns 502 with an explicit message that review evidence
  was refreshed; no payment state is manufactured. Concurrent or repeated checks within ten seconds return 429,
  including after a comment-only failure. Other unavailable GitHub requests return 502. A failed file comparison
  is recorded as unverified pending evidence.

The bounty listing and detail/candidate reads verify visibility. Private repositories require
a signed session and current repository read access. Unauthorized detail reads return 404.
No new table or database migration is needed; review display metadata stays in the existing evidence JSON.

## Routes

### Public

| Method, path | Response |
|---|---|
| `GET /health` | `{ ok: true, github_mock: boolean }`. `github_mock: true` means the GitHub App is not configured. |
| `GET /config` | `{ chain_id: number, escrow_address: string, usdc_address: string, usdc_decimals: 6, explorer_url: string }` |
| `GET /bounties?status=&repo=` | `{ bounties: (Bounty & { events: ChainEvent[] })[] }`, newest first. Each row carries its indexed events (newest first), so a list can show confirmed funded, approved, paid and refunded amounts. `repo` is `owner/repo`. Both filters optional. |
| `GET /bounties/:id` | `BountyDetail`. 404 if unknown. |
| `GET /bounties/:id/candidates` | `{ candidates: Candidate[] }` |
| `GET /events?bounty_id=&limit=50&before=` | `{ events: ChainEvent[], next_before: number \| null }`, newest first. `bounty_id` is the backend id. `before` is an event `id` for paging. `limit` max 200. |

### Auth and session

| Method, path | Notes |
|---|---|
| `GET /auth/github/login` | 302 to GitHub OAuth (sets a short-lived state cookie). In mock mode it redirects straight to the callback as user 1001. |
| `GET /auth/github/callback?code&state` | Verifies state, sets `merit_session`, 302 to `WEB_ORIGIN`. 400 on bad state/code. |
| `POST /auth/logout` | 204, clears the cookie. |
| `GET /me` | Session required. Response below. |

`GET /me` returns:
```ts
{
  github_user_id: number, login: string,
  wallet: { address: string, verified_at: string } | null,
  maintains: { github_repo_id: number, name: string }[],   // repos where this user is the registered maintainer
  as_reviewer: { candidate: Candidate, bounty: Bounty, approval: Approval | null }[],
}
```
`maintains` is only a UI hint. Every maintainer action is re-checked live against GitHub.

### Wallet binding (reviewer)

Session required. The reviewer proves control of an address by signing a challenge (EIP-191 `personal_sign`).

| Method, path | Request | Response |
|---|---|---|
| `GET /wallet/challenge` | - | `{ message: string, expires_at: string }`. `message` is a multi-line text containing `github_user_id`, `nonce`, `issued_at`, `expires_at` (5 minutes) and a server `mac` line. Sign it exactly as returned. |
| `POST /wallet/link` | `{ address, message, signature }` | `{ wallet_address, verified_at }` |

`POST /wallet/link` failures: 400 malformed; 401 no session; 403 message was not issued by the server (bad mac),
expired, issued for a different user, replayed (not newer than the last link), or the signature does not recover
to `address`. Re-linking a new address later replaces the old one. A maintainer can only ever approve a linked address.

### Maintainer actions

All need a session and re-check, at call time and against the GitHub API, that the caller has `admin` or
`maintain` on the repository. Otherwise 403.

| Method, path | Request | Response |
|---|---|---|
| `POST /bounties` | `{ github_repo_id: number, pr_number: number, amount_units: string, expiry: number }` (`expiry` = unix seconds, must be in the future) | 201 `{ bounty: Bounty, funding: { approve_usdc: PreparedTx, create_bounty: PreparedTx } }`. Creates a `funding_pending` row: the **funding intent**. Its `funder_wallet` is the caller's verified wallet from `POST /wallet/link`, never an address from the request. That wallet sends `approve_usdc` then `create_bounty`; Streams' `BountyFunded` flips it to `funded` (see "Funding intent" below). 404 if the PR is unknown to the backend, 409 if the caller has no linked wallet or a live bounty already exists for that PR. |
| `POST /bounties/:id/candidates/manual` | `{ evidence_url: string }` (a `https://github.com/<owner>/<repo>/pull/<n>#discussion_r<commentId>` link) | 201 `Candidate` with `method: "manual"`, status `candidate`. The comment is fetched from GitHub and must belong to this PR. 400 bad URL, 404 comment not found, 409 if that comment is already a candidate, confirmed or rejected (a `pending` heuristic candidate is upgraded to manual). |
| `POST /candidates/:id/confirm` | - | `Candidate` with status `confirmed`. Only from `candidate`. |
| `POST /candidates/:id/reject` | - | `Candidate` with status `rejected`. |
| `POST /bounties/:id/approvals` | `{ candidate_id: number, amount_units?: string }` (defaults to the full bounty amount) | 201 `{ approval: Approval, tx: PreparedTx, funder_wallet: string }`. Prepares `approveReward`. See rules below. |
| `POST /approvals/:id/tx` | `{ tx_hash: string }` | `Approval` with status `signed`. Records the hash the wallet reports. Streams' `RewardApproved` is what confirms it. 409 if another approval for the bounty is already signed or paid. |

#### Funding intent

The PR hash is public, so anyone can fund a bounty for any PR on the contract. A `BountyFunded` event binds to a
pending Merit bounty only when **all** of these match the intent: PR hash, funder (`funder_wallet`, compared
case-insensitively), integer `amount`, and `expiry` (unix seconds equal to `deadline`). A non-matching event is kept
in the event ledger but attached to no bounty, and never changes the intent's terms. A matching event indexed before
the intent existed is bound when the intent is created. Pending rows created before this rule (no `funder_wallet`)
are never bound and do not block a new bounty for the PR.

For the web app: fund from the wallet in `bounty.funder_wallet`. Funding from any other wallet, or changing the
amount or expiry in the prepared calldata, produces an event Merit will not attach to the bounty. The backend does
not record a client-reported funding hash; only the indexed `BountyFunded` marks a bounty funded.

The web app saves a deposit hash at broadcast in browser storage, together with its wallet, chain, escrow and terms.
Retry/refresh checks that submission. New funding is blocked if recovery storage is unavailable. If storage disappears
after broadcast, the page retains the hash in memory and warns the user to keep the tab open until indexing. This is
browser-local protection; another browser/device or clearing browser data loses the record. No funding-hash endpoint
or schema migration is introduced by this hardening.

Approval rules (each failure is 403 or 409 with an explanatory `error`):
- caller is a repo maintainer per live GitHub check;
- the bounty is `funded` (or `review_candidate`) onchain, not paid or refunded;
- the candidate belongs to the bounty's PR and is `candidate` or `confirmed`;
- reviewer is neither the PR author nor the approver (numeric id comparison);
- the reviewer has a linked wallet, and `approved_recipient` is exactly that address (the client cannot choose it);
- `amount_units` is at most the bounty amount;
- `claim_id = keccak256(abi.encode(uint256 github_comment_id))` (as in `docs/escrow-interface.md`). The contract makes it single-use across all bounties, so one review comment is paid at most once ever.

The transaction must be sent by the bounty's **funder wallet** (`funder_wallet`); the contract rejects anyone else.

### Reviewer actions

After `RewardApproved` the bounty is `claimable` and the reviewer's linked wallet calls
`claim(onchain_bounty_id)` itself. The backend does not prepare that call: encode it with A's ABI
(`docs/escrow-abi.json`). `RewardPaid` arrives via Streams and the bounty becomes `paid`.

### Webhooks (not for the browser)

| Method, path | Caller | Auth |
|---|---|---|
| `POST /webhooks/github` | GitHub App | `X-Hub-Signature-256` HMAC on the raw body; 401 forged, 403 repo not registered, 200 no-op on a replayed `X-GitHub-Delivery`. |
| `POST /webhooks/streams` | QuickNode Streams | `x-qn-nonce`, `x-qn-timestamp`, `x-qn-signature` HMAC; 401 on mismatch. Idempotent on `(chain_id, contract, tx_hash, log_index)`. |

## Transaction reverts (for the UI)

The backend never sends or simulates a transaction, so it decodes no reverts: the wallet in the browser sees them.
A revert from a prepared tx comes in **two shapes**, and the UI must handle both:

1. **Escrow custom errors** (`AlreadyClaimed`, `NotFunder`, `AmountExceedsBalance`, ...). They are all in
   `docs/escrow-abi.json`; viem gives the name via `err.walk(e => e instanceof ContractFunctionRevertedError)?.data?.errorName`.
2. **Plain `Error(string)` from Arc USDC.** On a short allowance or balance, the real Arc USDC (`0x3600…0000`) reverts
   with a string, e.g. `"ERC20: transfer amount exceeds allowance"`. That is **not** an ABI custom error: viem puts the
   text in `ContractFunctionRevertedError.reason` and leaves `data` undefined. It can surface from `createBounty`
   (escrow pulls the USDC), so show "approve the escrow for the full amount first" rather than a generic failure.
   Do not match on `ERC20InsufficientAllowance`: that is OpenZeppelin v5, used only by the test mock.

```ts
const r = err.walk((e) => e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | undefined;
const message = r?.data?.errorName ?? r?.reason ?? err.shortMessage; // custom error, then string revert, then fallback
```

## Local demo

`docker compose up --build` in `backend/`, then `npm run seed`. Seed data: repo `merit-demo/demo-repo`
(id 900001), PR #1, maintainer user 1001, PR author 2002, reviewer 3003. With no GitHub credentials the
backend runs in mock mode (`/health` shows `github_mock: true`); log in as the maintainer by opening
`/auth/github/login`.
