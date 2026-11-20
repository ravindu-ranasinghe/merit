# Merit demo participants and GitHub review story

Working record for **Prompt 1** (real identities and GitHub evidence). Prepared November 19, 2026 against `main` at `3a51bdf` and the deployed product. It contains **public facts only**: GitHub logins and immutable user ids, public URLs, public wallet addresses and readiness. Never add cookies, auth/challenge messages, tokens, private keys or seed phrases.

Hand-off target: the Prompt 2 (real-wallet acceptance) owner. The submission owner later merges final evidence into [demo-checklist.md](demo-checklist.md); this file is not that checklist.

**What this record is, today:** preparation only. **No public GitHub action, wallet signature or transaction has been performed** for the fresh run. Every "proposed" item below needs the named person's confirmation.

## 1. Participants

Roles follow the application rules: the approver must have live `admin`/`maintain` permission on the demo repository; the paid reviewer must differ from the PR author and the approver (numeric GitHub id comparison); the recipient wallet must differ from the funding wallet. The maintainer may also be the PR author.

| Role | Proposed account | Immutable GitHub id | Basis | Confirmed by the person? |
| --- | --- | --- | --- | --- |
| Maintainer / approver / funder | `ravindu-ranasinghe` | `200846133` | Owns `merit-demo-api`; Merit records `maintainer_github_id: 200846133` for that repository (public API, bounties 1–2). | Pending |
| PR author (both PRs) | `ravindu-ranasinghe` | `200846133` | Only confirmed account with push access to `merit-demo-api` (`omar-elbanna` gets 403 on the collaborators API). Author = maintainer is allowed. A teammate may author from a fork instead. | Pending |
| Reviewer, PR A | `omar-elbanna` | `211588453` | Team member; not the author or approver. | Pending |
| Reviewer, PR B | `HeEric2007` *or* `Max-Suslov` | `123344551` / `215323667` | Team members; not the author or approver. Pick one human. | Pending |

- `ravindu1123` (`62352785`) wrote the November 14 reference review. It is **not proposed** as a paid reviewer: if it is a second account of the maintainer, paying it would be self-payment. Use it only if its owner confirms it is a different human.
- Each reviewer must be a real person writing their own review. Do not post a review on another person's behalf or from a borrowed account.

## 2. Wallets (Arc testnet `5042002`)

Wallet ownership is proven only through the existing wallet-link flow at **`/reviewer`** (maintainers use the same page): connect, then sign the server's challenge. Connecting alone is not proof. Each owner signs their own message; nobody else may sign for them.

| Person | Public address | Linked in Merit (signed challenge)? | Testnet USDC for escrow / gas | Evidence |
| --- | --- | --- | --- | --- |
| `ravindu-ranasinghe` (funder) | `0xdf86a79a5af2d76c02acbcb83b033f8250c89325` | **Was linked** when bounties 1–2 were created (Merit takes `funder_wallet` from the caller's linked wallet). Re-check before funding: re-linking replaces it. | Pending owner check. Needs ≥ $20 + gas for two $10 bounties. | Funder of onchain bounties 3 and 4 ([public API](https://merit-theta-beige.vercel.app/api/merit/bounties/1)) |
| Reviewer, PR A | Pending | Pending: sign at `/reviewer` | Gas only (claim is paid in USDC gas on Arc) | — |
| Reviewer, PR B | Pending | Pending: sign at `/reviewer` | Gas only | — |

Recipient ≠ funder: each reviewer's linked address must differ from `0xdf86…9325`. Faucet: `https://faucet.circle.com`.

## 3. Repository and GitHub App readiness

| Fact | Value | How checked |
| --- | --- | --- |
| Demo repository | [`ravindu-ranasinghe/merit-demo-api`](https://github.com/ravindu-ranasinghe/merit-demo-api), public, created `2026-11-14T19:59:55Z` (inside the build window) | `gh repo view` |
| Default branch head | `main` at `e08c625` | Cloned read-only |
| Merit GitHub App installed and repository registered | Yes: Merit repository record `github_repo_id 1458126539`, maintainer `200846133` | Public `GET /api/merit/bounties/{1,2}` |
| Existing PRs | [#1](https://github.com/ravindu-ranasinghe/merit-demo-api/pull/1) closed (not merged); [#2](https://github.com/ravindu-ranasinghe/merit-demo-api/pull/2) merged | `gh pr list` |
| Existing live bounties | App bounty 1 → onchain 3 (PR #1), app bounty 2 → onchain 4 (PR #2); both `funded`, $10, deadlines 2026-11-22 | Public API |
| Push access for `omar-elbanna` | **No** (403 on collaborators) | `gh api` |

**Do not reuse PR #1 or #2.** Each already holds a live bounty, and the backend allows one live bounty per PR. Both PRs are closed or merged, and their reviews predate this run. The two new PRs below are needed.

## 4. Two planned PRs (drafts ready, nothing published)

Both use honest, specific, **non-security** bugs in the harmless demo API (not the deployed product), each with a one-line fix on the reviewed line so the evidence heuristic ("a later commit touched the context, thread resolved") can follow it. Both were reproduced locally: the bug shows, and the one-line fix removes it.

| | PR A: claim-first ordering | PR B: refund-first ordering |
| --- | --- | --- |
| Title | Hide archived projects from `GET /projects` by default | Add task counts to `GET /projects/:id` |
| Patch (against `e08c625`) | [pr-a-hide-archived-projects.patch](demo-prs/pr-a-hide-archived-projects.patch) | [pr-b-project-task-counts.patch](demo-prs/pr-b-project-task-counts.patch) |
| Files | `server.js`, `README.md` | `server.js`, `README.md` |
| Line to review | `server.js:46`: `const includeArchived = Boolean(req.query.includeArchived);` | `server.js:60`: `return { ...project, taskCount: tasks.size, … }` |
| The real issue | `Boolean("false")` is `true`, so `?includeArchived=false` still returns archived projects | `tasks.size` counts every project's tasks, not this project's |
| Local reproduction | as drafted: `?includeArchived=false` → 2 projects (want 1); after fix → 1 | as drafted: new project with 1 task → `taskCount=2`; after fix → `1` |
| Expected author fix (only **after** the review is posted) | compare to the string: `req.query.includeArchived === "true"` | use the filtered list: `taskCount: projectTasks.length` |
| Planned money path | $10 funded → approve **$4** → reviewer **claims** → after expiry, refund **$6** | $10 funded → approve **$4** → after expiry, refund **$6** → reviewer **claims** |

The reviewer verifies the issue and writes the comment in their own words; this record does not script review text. A normal PR "Approve" is not enough: it must be an **inline** comment on the line above.

## 5. Sequence and click steps

The order matters: **an indexed `BountyFunded` must exist before the reviewer comments.** Record every timestamp below as it happens (GitHub timestamps for GitHub actions, explorer block time for transactions, Merit's indexed event for funding).

1. **PR author** (repo owner authorization required): on a branch off `main`, `git apply docs/demo-prs/pr-a-hide-archived-projects.patch` (in a clone of `merit-demo-api`), commit, push, open PR A as a normal PR. Repeat with PR B on a separate branch. Do not include the fix.
2. **Maintainer**: sign in to [Merit](https://merit-theta-beige.vercel.app), confirm the wallet link at `/reviewer`, then **Maintainer → New review bounty**, pick PR A, $10, and the deadline window agreed in §6. Allow USDC, deposit. Wait until the bounty shows **Funded** (indexed event). Record app bounty id, onchain id, funding tx. Repeat for PR B.
3. **Prompt 2 owner** confirms both indexed `BountyFunded` events. **Only then:**
4. **Reviewer A / Reviewer B**: link their wallet at `/reviewer` (sign the challenge). Open the PR on GitHub → *Files changed* → comment inline on the line in §4, explaining the issue in their own words → *Add single comment* (or start a review and submit).
5. **PR author**: push a separate commit with the fix, then *Resolve conversation* on that thread.
6. **Maintainer**: on the Merit bounty page, *Recheck GitHub*; the candidate should show the later change and resolved thread. If the heuristic cannot follow it, use the manual evidence link (`…/pull/<n>#discussion_r<id>`) and record that the evidence was **manual**. Decide explicitly whether the review was useful; if so approve **$4** to the reviewer before the deadline.
7. Continue with the Prompt 2 claim/refund ordering for each PR. Do not merge or close a PR just to make the story look finished; follow the maintainer's actual decision.

## 6. Blocker: deadline window for the partial-refund runs

The partial-refund orderings need an approval **before** expiry and a refund **after** expiry. On production:

- The new-bounty form offers **3 / 7 / 14 days** only. `NEXT_PUBLIC_DEMO_DEADLINES` is not set in the deployed web bundle (checked November 19), so the 5-minute option is hidden.
- Even if enabled, **5 minutes is too short** to fund, review, push a fix, resolve and approve before expiry.
- Submission is due **November 20, 12:00 PM CST**, so a 3-day bounty cannot expire in time.

Decision needed (Ravindu / Prompt 2 owner), pick one:
1. Change the demo window from 5 minutes to e.g. **45 minutes** (one constant in `web/src/app/maintainer/new/page.tsx`), set `NEXT_PUBLIC_DEMO_DEADLINES=1` on the web project, redeploy. Small reviewed PR; testnet only.
2. Run the full lifecycle on a 3-day bounty (fund → review → fix → approve → claim) and show the refund orderings only from the mock rehearsal, clearly labelled **simulated**.

The backend accepts any future expiry, so no backend change is needed for option 1.

## 7. Claim-id hygiene

`claimId = keccak256(abi.encode(uint256 reviewCommentId))`, single-use across all bounties on the escrow. Fresh inline comments get new ids; check each one before approval:

```sh
npm --prefix backend ci        # once, provides viem
node docs/demo-prs/check-claim-ids.mjs <commentA> <commentB>
```

Read-only (public RPC `eth_call`, no key). Checked November 19 against escrow `0x924525bF3f3A39f9c7f298E71aFf43F4c27a4727`, `nextBountyId` = 5:

| Historical comment | Where | Claim id | Status |
| --- | --- | --- | --- |
| `4575848692` (`ravindu1123`, Nov 14) | PR #1 `server.js:71` | `0xce0ab7fc…a917` | **Used.** Never reuse. |
| `4580413290` (`HeEric2007`, Nov 15) | PR #2 `server.js:71`, pending heuristic candidate on app bounty 2 | `0x2c9a8699…e62f` | Unused, but historical. **Do not use** for the fresh run. |

## 8. Evidence to capture (fill as it happens)

Save sanitized captures under `output/verification/demo-participants-<date>/` (not committed; nothing captured yet).

| Fact | PR A | PR B |
| --- | --- | --- |
| PR URL / number | pending | pending |
| Merit app bounty id / onchain id / PR hash | pending | pending |
| Funding tx + indexed `BountyFunded` time | pending | pending |
| Inline review URL / comment id / time | pending | pending |
| Reviewed SHA (comment's commit) | pending | pending |
| Fixing commit SHA / diff URL / time | pending | pending |
| File / line | `server.js:46` (planned) | `server.js:60` (planned) |
| Thread resolution evidence / time | pending | pending |
| Author id / reviewer id | `200846133` / pending | `200846133` / pending |
| Evidence method (heuristic or manual) | pending | pending |
| Claim id checked unused | pending | pending |
| Maintainer's explicit usefulness decision | pending | pending |

## 9. Prepared vs performed

**Prepared (this record):** participant proposal with immutable ids; repository/installation/push-access check; two reproduced PR drafts with patches; claim-id check script and historical results; click steps; the deadline-window blocker.

**Performed publicly:** nothing. No PR, comment, commit, wallet signature or transaction for the fresh run.

## 10. Remaining actions by owner

| Owner | Action |
| --- | --- |
| Team | Confirm the four roles in §1 (especially which human reviews PR B). |
| Ravindu (repo owner) | Authorize and open PR A and PR B from the patches. Confirm the funder wallet link and USDC balance. Decide the §6 deadline option. |
| Reviewer A, Reviewer B | Link a wallet at `/reviewer` (own signature, address ≠ funder). Wait for the funding confirmation, then post the inline review. |
| PR author | After each review, push the fix as a later commit and resolve the thread. Record SHAs and times. |
| Maintainer | Recheck evidence in Merit, record an explicit usefulness decision, approve $4 before expiry. |
| Prompt 2 owner | Confirm indexed funding before reviews. Run `check-claim-ids.mjs` on both new comment ids. Run the claim/refund orderings. |

## November 20 update: practical testnet deadline

The revised new-bounty form offers an optional **45 min** window with `NEXT_PUBLIC_DEMO_DEADLINES=1`;
mock mode always includes it. The default remains seven days. The short deadline is calculated at creation,
so time spent choosing the PR does not consume the 45-minute window. Deployment of the new bundle/flag must
be recorded before treating the option as available on the public site. Existing funded deadlines cannot change.
