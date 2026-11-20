# Merit real-wallet acceptance

Working record for **Prompt 2** (real-wallet acceptance and two fresh sessions). Prepared November 19, 2026, 23:25 CST (2026-11-20 05:25 UTC) against `main` at `3a51bdf` and the deployed product. Submission is due **November 20, 12:00 PM CST**.

Participants, the two planned demo PRs and the claim-id rules come from the Prompt 1 record ([PR #28](https://github.com/ravindu-ranasinghe/merit/pull/28), `docs/demo-participants.md`). The submission owner later merges final evidence into [demo-checklist.md](demo-checklist.md).

**Status: preparation and key-free live checks only.** No wallet signature or transaction has been sent for the fresh run. Final app-state acceptance also needs Ravi's filtered-Stream delivery evidence, which he supplies separately. A mock rehearsal is not a substitute for any row below.

## 1. Verified live today (key-free)

Tool: [`docs/acceptance/verify-bounty.mjs`](acceptance/verify-bounty.mjs). It reads the public API, Arc transaction receipts and escrow storage, and can run `eth_call` simulations. It has no key and sends nothing. Machine-readable results are saved locally under `output/verification/acceptance-2026-11-20/` (not committed).

| Check | Result | Kind |
| --- | --- | --- |
| API `/config` = RPC chain id = `5042002`; escrow `0x924525bF…4727`; USDC `0x3600…0000`, 6 dp | PASS | live read |
| App bounty 1 (onchain 3, `merit-demo-api#1`): indexed `BountyFunded` matches its Arc receipt (event, bounty id, block `72479574`, log `74`, args); storage matches app funder, amount `10000000`, PR hash, expiry; not approved/paid/refunded in both | 13/13 PASS | live read |
| App bounty 2 (onchain 4, `merit-demo-api#2`): same, block `72479874`, log `27` | 13/13 PASS | live read |
| Claim on bounties 3/4 from the funder (not an approved recipient) | refused `NotApprovedRecipient` | **simulation** (eth_call) |
| Refund of bounties 3/4 before expiry | refused `NotExpired` | **simulation** |
| Second claim on Nov 14's paid onchain bounties 1 and 2, from their paid recipients | refused `AlreadyClaimed` | **simulation** on historical bounties |
| Duplicate claim [`0x1a5c9c…69dc`](https://explorer.testnet.arc.io/tx/0x1a5c9cf6c3871a167fa2c666ba8fe28bf0946d4abdacb9583c167a94989069dc), 2026-11-14 05:15:51 UTC, block `72270602`, from bounty 1's paid recipient | `status: reverted`, 0 logs | **actual reverted transaction, historical**, not the fresh run |

Bounties 3 and 4 are on PRs #1 (closed) and #2 (merged) and expire November 22, after submission. They prove the indexing path is consistent today; they are **not** the fresh funded → reviewed → approved → claimed run.

## 2. Blockers before the fresh run

| # | Blocker | Owner | Needed |
| --- | --- | --- | --- |
| 1 | **Funder balance.** `0xdf86a79a…9325` holds **9.982938 USDC** (gas on Arc is paid from the same USDC balance). One $10 bounty plus gas does not fit; two need ≥ $20 + gas. | Ravindu (funder wallet owner) | Faucet at `https://faucet.circle.com`, then re-check |
| 2 | **Deadline window.** Production offers 3 / 7 / 14 days only (`NEXT_PUBLIC_DEMO_DEADLINES` unset in the deployed bundle). The partial-refund orderings need approval before expiry and a refund after it, before noon Nov 20. Options are in `docs/demo-participants.md` §6 (PR #28). | Ravindu / this owner | Decision, plus a deploy if option 1 |
| 3 | **Reviewer wallets.** No reviewer wallet is linked yet. | Reviewer A, Reviewer B | Sign the challenge at `/reviewer`; address ≠ funder |
| 4 | **Demo PRs.** PR A / PR B are drafted but not opened on `merit-demo-api` (`omar-elbanna` has no push access). | Ravindu (repo owner) | Open from the patches in PR #28 |
| 5 | **Stream evidence.** Fresh filtered-Stream delivery and provider reference. | Ravi | Sanitized config + delivery reference |
| 6 | **Expiry sweep is off** (`POST /internal/sweep` → 404, no `SWEEP_SECRET`). Not required: expiry is applied when a bounty is read, and the refund is sent from the bounty page. | — | None for acceptance |

## 3. Runbook: one bounty, end to end

Each wallet owner signs their own transactions in their own browser profile. Run the cross-check after every step and keep its output:

```sh
npm --prefix backend ci     # once
node docs/acceptance/verify-bounty.mjs <appBountyId> --simulate --json output/verification/acceptance-<date>/bounty-<id>-<step>.json
```

`PENDING` means the chain has something the app has not indexed yet. Wait for the Stream and re-run; do not treat a client receipt as app state.

| Step | Who | Action | Expect from `verify-bounty` | Record |
| --- | --- | --- | --- | --- |
| 0 | Funder, reviewers | Link wallets at `/reviewer` (signed challenge). Funder balance ≥ $10 + gas per bounty. | — | addresses, link time |
| 1 | Maintainer | New review bounty on the fresh PR, $10, agreed window. Allow USDC, Deposit. Wait for **Funded**. | `BountyFunded` PASS; storage funder/amount/expiry PASS | app id, onchain id, PR hash, funding tx + explorer URL, block, log index, indexed time |
| 2 | Reviewer → author | **Only after step 1 is indexed:** inline review, later fix commit, resolved thread (Prompt 1). | — | GitHub URLs, ids, SHAs, times |
| 3 | Maintainer | Recheck GitHub, record an explicit usefulness decision, approve **$4** (`4000000`) to the reviewer **before expiry**. Sign `approveReward` from the funding wallet. | `RewardApproved` PASS; approval recipient/amount PASS; claim id used PASS | claim id (check with `docs/demo-prs/check-claim-ids.mjs` first), approval tx, block, log |
| 4a | Reviewer (PR A) | Claim $4 from the approved wallet. | `RewardPaid` PASS; paid in both | payout tx, recipient, amount |
| 5a | Anyone (PR A) | **After expiry**, refund. Must return `6000000` to the original funder only. | `BountyRefunded` PASS; held `0` | refund tx, funder balance before/after |
| 4b / 5b | PR B | Same, but **refund first** after expiry, then claim. The claim must still succeed after the remainder refund. | both PASS; held `0` | as above |
| 6 | Reviewer | Second claim on a paid bounty. Run `--simulate` first; if a wallet will still send it, the reverted tx is the actual proof. State which one you have. | `AlreadyClaimed` | simulation output and/or reverted tx hash |
| 7 | Maintainer | Bounty page and dashboard after each ordering: no second remainder refund offered. | refunded in both; no `PENDING` | screenshots |
| 8 | Recorder | GitHub status comment, `/events`, `/bounties/<id>/receipt` show the same hashes and log indices as the explorer and the cross-check. | — | URLs |

Expected integer units for each ordering: funded `10000000`, approved `4000000`, paid `4000000`, refunded `6000000`, held `0`.

## 4. Fresh-run results (fill as it happens)

| Fact | PR A: claim first | PR B: refund first |
| --- | --- | --- |
| App bounty id / onchain id / PR hash | pending | pending |
| Funder / recipient wallet | `0xdf86…9325` / pending | `0xdf86…9325` / pending |
| Funding tx, block, log index | pending | pending |
| Approval tx, claim id, amount | pending | pending |
| Payout tx, block, log index | pending | pending |
| Refund tx, block, log index, amount | pending | pending |
| Final funded / approved / paid / refunded / held | pending | pending |
| `verify-bounty` final result | pending | pending |
| Duplicate-claim refusal (simulation or reverted tx) | pending | pending |
| Ravi's provider delivery reference for each event | pending | pending |

## 5. Two fresh sessions (cold runs)

Each run: new browser profiles for maintainer and reviewer, no prior Merit session, empty test-specific funding storage, **every earlier deposit already resolved** (never clear an unresolved deposit's record). Production and the active Stream keep running. Each covers funding through receipt with the same cross-check.

| Run | Date/time, revision, bounty ids, `verify-bounty` result, failures/recovery | Status |
| --- | --- | --- |
| Fresh session 1 | pending | Not run |
| Fresh session 2 | pending (record any recurrence from run 1) | Not run |

## 6. Prepared vs performed

**Prepared:** read-only cross-check tool; live consistency checks for app bounties 1–2; refusal simulations; historical reverted duplicate-claim confirmation; funder balance; blockers; runbook; results templates.

**Performed:** reads and simulations only. No signature, transaction, GitHub write or Stream change.
