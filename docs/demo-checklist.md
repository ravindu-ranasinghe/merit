# Merit acceptance and recording checklist

Status: November 19, 2026. The combined backend checks cover `origin/main` at `fcd1438` plus payment hardening; the browser runs used the same web code based on `c524f67`. They do not verify a new live payment. Entry: **Consumer Applications + Best use of Arc + QuickNode Streams**, subject to the final provider evidence and organizer rules.

## Before a rehearsal

1. Follow [backend setup](../backend/README.md#run) and [web setup](../web/README.md#setup). Use a Node release with TypeScript stripping for the executable regression checks (this run used `v26.7.0`), PostgreSQL 16, and the installed package locks. Docker is needed only for the local database. Keep the public backend in production mode with real GitHub authentication.
2. Match backend `GET /config`, the web escrow setting, and the explorer: Arc testnet `5042002`, six-decimal ERC-20 USDC, escrow [`0x924525bF3f3A39f9c7f298E71aFf43F4c27a4727`](https://explorer.testnet.arc.io/address/0x924525bF3f3A39f9c7f298E71aFf43F4c27a4727). These are the repository's documented settings; Ravi must confirm the active Stream uses the same deployment. A database belongs to one deployment; use a separate database for a different chain/escrow rather than reassigning existing bounty ids.
3. Prepare distinct maintainer and human reviewer GitHub accounts and team-owned test wallets. The PR author must not receive their own review reward; use a separate author if needed. Wallet owners sign their own messages and transactions. **Both funder and reviewer must link their wallets before starting**; the existing wallet-link screen is at `/reviewer`, including for a maintainer. Connecting a wallet alone does not prove ownership to the API.
4. Select a real public demo PR, an inline review identifying a specific issue, its later relevant fix, and its resolved thread. Record the immutable GitHub IDs and comment URL. Heuristic evidence assists the maintainer; it does not prove quality or prevent collusion.
5. Have testnet USDC for escrow and gas, working browser storage, and time before the funding deadline for approval. Keep the funding tab and browser data until indexing finishes. Hide notifications and secret-bearing settings before recording. Never capture cookies, private keys, security tokens, or credential-bearing RPC URLs.

## Deterministic local checks — simulated evidence

Run from the repository root. This exact test URL targets only the disposable local **`merit_test`** database; setup truncates its tables. Never substitute a shared or live database. These commands do not need Ravi's QuickNode key.

```sh
docker compose -f backend/docker-compose.yml up -d db
npm --prefix backend run typecheck
TEST_DATABASE_URL=postgres://merit:merit@127.0.0.1:5433/merit_test npm --prefix backend test
npm --prefix web run check:deposit
npm --prefix web run check:accounting
npm --prefix web run typecheck
npm --prefix web run lint
NEXT_PUBLIC_MOCK=1 npm --prefix web run build
```

| Check | Fixture / expected result | Latest result |
| --- | --- | --- |
| Funding identity | `backend/test/intent.test.ts`: wrong wallet arrives first; wrong amount/expiry; mixed address case; early funding; concurrent creation; legacy null-funder intent. Only the matching intent binds. | Passed in full backend suite |
| Event context and attribution | Same file: other chain/escrow with the same bounty id stays in the ledger but cannot bind, advance an approval, name a reviewer, or enter detail/list/feed/profile/payment facts. Foreign claim ids and recipient/amount mismatches cannot credit the local reviewer. | Passed |
| Expiry sweep context | `backend/test/sweep.test.ts`: a foreign refund cannot hide due work, and a foreign approval cannot change the reserved/refundable amount. | Both chain and contract isolation cases passed |
| Order, overlap, replay, signatures | `backend/test/streams.test.ts`, `intent.test.ts`, `approvals.test.ts`, `pr-status.test.ts`: reordered events converge; duplicates leave one event identity; bad signatures and unauthorized actions fail. | Passed |
| Sparse merged PR | `backend/test/github-webhook.test.ts`: merge, then sparse comment/thread; status stays merged, head SHA still updates, closed/reopened unmerged cases work. | Passed |
| Deposit recovery | `web/scripts/deposit-recovery.test.mjs`: broadcast then receipt failure, retry, actual browser-store module reload, delayed indexing, reverted/cancelled/funded replacements, receipt identity, allowance failure, double clicks, wrong wallet, storage failure, and account/network change during allowance. | 16/16 passed November 19; simulated driver |
| Partial payout | `web/scripts/accounting.test.mjs`: `$10 = 10000000` units; approve/pay `$4 = 4000000`; refund `$6 = 6000000`. Claim-first and refund-first both end with zero held, four paid, six refunded. | 8/8 passed; arithmetic/state |

Backend: **143 assertions across 12 files passed** against local `merit_test` after integrating the teammate's expiry sweep and isolating its event reads. Backend and web typechecks, web lint, and the mock production build passed. The first November 19 backend attempt reached no assertions because Docker was stopped; the result above came after starting only the local db service. Synthetic addresses/hashes and the test `qnSign` token are fixture inputs, never provider-delivery evidence. Node emitted module-type warnings for the executable web checks and a server-side `localStorage` warning during prerendering; the passing commands exited 0. These are not live-wallet results.

Optional recovery demonstration: [replay demo](../backend/README.md#replay-demo) rebuilds a separate `*_replay` database from public Arc logs and exercises the receiver with a local token. This is an RPC replay through the receiver, **not** proof of QuickNode delivery. Do not run it against a live database or modify the active Stream.

## Mock screen rehearsal — two fresh sessions passed

November 19: [machine-readable results](non-quicknode-verification.json) record two separate headless Chrome contexts against the production mock build. Both passed funding timeout/retry, known revert/retry, new bounty identity, both `$10/$4/$6` orderings, duplicate-claim refusal, dashboard totals and the 390px refund control. Each run saved nine screenshots and reported zero uncaught page errors. This replaces the November 18 browser-host blocker for **mock** checks. It does not replace the live acceptance below.

To repeat, start the production mock build and use the installed Playwright Core module; no project test framework dependency was added:

```sh
NEXT_PUBLIC_MOCK=1 npm --prefix web run build
npm --prefix web run start -- --hostname 127.0.0.1 --port 3000
# In another terminal; point this at your installed Playwright Core index.mjs:
PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs node web/scripts/demo-qa.mjs
```

The script uses a new browser context per run, refuses non-local test targets, and keeps the sample-data label visible. The raw screenshots are under the unique `output/verification/non-qn-*` directory printed by the command. Initial failed attempts were retained separately: one checked stale cached dashboard data too early, and another used an external dependency symlink that Turbopack could not resolve. The final production build used local dependencies and the test waited for the displayed totals to refresh.

Start `NEXT_PUBLIC_MOCK=1 npm --prefix web run dev` in a separate terminal and keep the sample-data bar visible. The mock chain/database resets on a full reload; browser-refresh persistence is covered by the executable recovery check rather than a pretend persistent mock chain.

1. Reset sample data, choose **Maintainer**, and open the draft `/bounties/b-110`. Before Fund, run `sessionStorage.setItem("merit.mock.fault", "receipt-timeout")` in this local mock page's console. Fund once. The deposit hash must remain visible through the simulated receipt failure; the panel must wait/check that submission and then show indexed funding. Record one `BountyFunded` for this attempt. Repeat after a reset with `"revert-after-broadcast"`; a known revert must permit Fund again.
2. Open `/bounties/b-111` as Maintainer: `$10` funded, `$4` approved, expired. Refund exactly `$6`; switch to **Reviewer** with the mock persona bar and claim `$4`. Follow app links rather than refreshing. The claim remains reachable after the remainder refund. Final accounting: `$4` paid, `$6` refunded, `$0` held.
3. Reset sample data. On `/bounties/b-111`, switch to Reviewer and claim first. After indexing, switch to Maintainer and refund `$6`. Check the dashboard changes by `$4` paid and `$10` less held from its starting total; this fixture ends at `$0` held. `/bounties/b-112` separately starts with the `$4` already paid and `$6` still refundable. The full-approval example must offer no remainder refund.
4. Check pending/confirmed links, switch personas during allowance confirmation, and try rapid double clicks. A changed funding identity must stop the deposit. A successful deposit awaiting indexing must offer no second funding signature.
5. Capture the exact screens and any errors, labelled **simulated**. Do not substitute HTTP responses for click-through acceptance. November 19's two successful headless runs supply the interactive mock evidence.

## Live acceptance — Ravi and wallet owners

1. **Ravi: inspect the filtered Stream.** Record sanitized Arc network, Logs dataset, escrow-address filter, start block, uncompressed webhook destination, and the rationale from [Streams setup](../backend/README.md#quicknode-streams). Record a fresh successful delivery with the filter enabled, provider delivery/batch reference, and its matching decoded log. Do not expose the HMAC token. Old pre-filter deliveries and the filter test runner do not satisfy this check.
2. **Maintainer/reviewer: walk the same bounty.** Create the authenticated intent, fund from its linked wallet, observe indexed `BountyFunded`, show the actual review/change/thread, record explicit maintainer judgment and approval, then claim as the approved recipient. Match chain id, escrow, bounty id, claim id, recipient, integer amount, hashes and log indices across explorer, event API, GitHub status comment, and app receipt. A client hash or receipt success alone must not advance app money state.
3. **Wallet owners: verify refusals and the remainder.** A second claim must be rejected; record whether the refusal was a simulation or an actual reverted transaction. For `$10/$4/$6`, check both claim/refund orderings using two test bounties, approval before expiry, and refund after expiry. Anyone may submit `refundExpired`; funds must return to the original funder. Check no repeated remainder refund is offered.
4. **Ravi: replay only into isolated staging.** Use a sanitized provider delivery against staging with staging's token to verify duplicate/overlap/order recovery. Never truncate a live DB, rewind the active Stream, disable production delivery, or present locally signed fixtures as provider-origin proof. Record funded/paid state and ledger count before/after replay.
5. **Recorder: preserve the result.** Measure actual observed intervals if recording settlement/indexing delay: note each timestamp and its source. Browser receipt wait, block time, and provider/app ingestion are different measurements. Keep failures and blockers; do not silently switch to mock mode. Fill the inventory below before describing the run as verified.

## Proof inventory for the fresh run

Public reference inspected November 19: the [repository](https://github.com/ravindu-ranasinghe/merit) is public and GitHub reports creation at `2026-11-14T04:12:29Z`. The real [inline review](https://github.com/ravindu-ranasinghe/merit-demo-api/pull/1#discussion_r4575848692), by GitHub user `62352785` (`ravindu1123`), flags missing authentication and ownership checks in `server.js` at revision `6ce8f8afcb53618c085f17f3dfe63e3ffe5cfc20`. PR #1 is closed, not merged; its current head is `862c61961d77a270d9327b8a9885276db0eb8f4d`. These are reference facts, not a new end-to-end acceptance run or a claim that a specific new payout earned this review.

The public application's `/config` reports the documented Arc chain/escrow/USDC settings. Its current public app bounties are `1` → onchain `3` and `2` → onchain `4`, both funded at inspection. Do not present these as a fresh paid receipt or silently substitute historical bounty ids from the November 14 notes.

No fresh live values were supplied during this preparation. Fill these from the **same bounty**; record partial-refund ordering on separate acceptance bounties when needed.

| Required fact | Recorded value / evidence | Owner |
| --- | --- | --- |
| Submitted commit, frontend URL and API URL | Pending final deployment/revision; current public landing page is [Merit](https://merit-theta-beige.vercel.app) | Release owner |
| PR URL, inline review URL/comment id, reviewer GitHub id | Pending fresh run | Reviewer |
| Relevant fixing commit/diff and resolved-thread evidence | Pending fresh run | PR author |
| Maintainer GitHub id, funder wallet, recipient wallet, wallet-link confirmation | Pending fresh run; include public identities only | Wallet owners |
| App bounty id, onchain bounty id, PR hash, claim id, expiry | Pending fresh run | Maintainer |
| Actual chain id and escrow | Expected `5042002` and documented address above; pending active configuration confirmation | Ravi |
| Funded / approved / paid / refunded / held integer units | Pending fresh run; suggested partial example `10000000 / 4000000 / 4000000 / 6000000 / 0` after expiry/refund | Recorder |
| Funding, approval, payment and refund hashes + full explorer URLs | Pending fresh run | Wallet owners |
| Log indices, block numbers, indexed event references and transaction-hash matches | Pending fresh run | Ravi |
| Filtered provider delivery reference, sanitized configuration/destination proof | Pending fresh run | Ravi |
| GitHub status-comment URL, app receipt URL and final dashboard capture | Pending fresh run | Recorder |
| Observed timing, measurement sources, failures/recovery | Not measured; do not quote a latency claim | Recorder |
| Duplicate-claim refusal, partial-refund orderings and staging replay results | Pending fresh run | Wallet owners / Ravi |

Historical references exist in [escrow-interface.md](escrow-interface.md#nov-14-exit-test-live-run-on-arc-testnet) and [backend live-delivery notes](../backend/README.md#verified-on-arc-testnet-nov-14). They are not the fresh filtered lifecycle required above.

## Two cold rehearsals and judge access

Each cold run starts with fresh application sessions and empty test-specific funding storage, **after every prior deposit is resolved**. Do not erase an unresolved live deposit's record. Restart the local app only for local rehearsals; leave production and the active Stream running. Use separate browser profiles for maintainer and reviewer. A complete run covers funding through receipt and the same identity/hash checks above.

| Run | Date, revision, bounty ids, evidence and outcome | Status |
| --- | --- | --- |
| Cold rehearsal 1 | Pending live session and browser access | Not run |
| Cold rehearsal 2 | Pending a separate fresh session; record any recurrence | Not run |

- [x] November 18: anonymous HTTP GET of the public [source repository](https://github.com/ravindu-ranasinghe/merit) and [landing page](https://merit-theta-beige.vercel.app) returned 200 at their expected URLs.
- [x] November 18: public `/api/merit/health` returned `{"ok":true,"github_mock":false}`. This establishes reachability, not a verified payment or deployed hardening revision.
- [ ] Open the deployed product, relevant public PR, receipt, and final video from a signed-out browser; verify no deployment protection or sharing restriction interrupts judges. No final video URL has been supplied.
- [x] Record a **mock rehearsal export**: `output/video/merit-non-quicknode-rehearsal-2026-11-19-v1.mp4`, 172.333 seconds, with narration, captions and a persistent simulation label. It includes sample approval, deposit recovery, refund-first claim, duplicate refusal and receipt screens. Full audio/video decode passed; playback checks are recorded separately. The original 87.004-second walkthrough remains untouched.
- [ ] Replace the mock rehearsal with the final live capture using [demo-script.md](demo-script.md), then upload and check the judge-accessible URL. The rehearsal is not fresh wallet or provider evidence, and no final public video URL is claimed.
- [ ] Confirm team members, repo creation/originality eligibility, category choices, current organizer notices, and a named attendee for the November 21 closing ceremony. The supplied guide says submission is **November 20, 2026 at noon CST** and attendance is required for a prize. Team confirmation is still pending.

## Remaining shots and account actions

Ravi supplies sanitized filtered-Stream configuration and fresh delivery/replay evidence. Wallet owners supply actual funding, approval, claim, refusal and partial-refund results. The recorder replaces the labelled rehearsal with the real GitHub judgment and matching transaction/explorer/event/receipt shots, completes both live cold runs and checks public video access. Team membership and the closing-ceremony attendee still need the team's confirmation. No Devpost submission has been made.
