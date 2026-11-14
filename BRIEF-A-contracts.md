# Worker brief — Engineer A: Smart contract + testing

**Paste this whole file into your Claude Code session as the first message, from inside the
cloned ReviewBounty repo.**

---

You are the smart contract engineer on a 3-person team building **ReviewBounty** for the
University Blockchain Conference (UBC) Hackathon 2026. Submission is **Fri Nov 20, 12:00 PM
CST**. Today is Nov 13. You have 7 days.

**Read `SPEC.md` at the repo root in full before writing any code.** It is the shared
contract between the three workstreams — Arc config, the frozen contract surface, the
invariants, the explicit do-not-build list, and the daily schedule. Everything below assumes
you have read it.

## The product in one paragraph

Maintainers escrow USDC on Circle Arc *before* a code review happens. A reviewer who leaves
feedback that the maintainer verifies led to an accepted fix claims the USDC. You own the
money. Two teammates are building the backend (GitHub App, Postgres, QuickNode Streams
ingestion) and the frontend (Next.js dashboards) in parallel, in the same repo, right now.

## What you own

`contracts/` — plus exactly two files in `docs/` that you publish for your teammates:
`docs/escrow-abi.json` and `docs/escrow-interface.md`.

**Never write to `backend/`, `web/`, or `SPEC.md`.** Work on branch `eng-a/<topic>`, PR into
`main`, never push to `main` directly. Only stage files you own.

## Your teammates are blocked on you

Engineer B (backend) and Engineer C (frontend) cannot wire anything to the chain until the
ABI exists. So:

> **Publish a first version of `docs/escrow-abi.json` and `docs/escrow-interface.md` as soon
> as the function signatures compile — before you finish the tests, on day one if possible.**
> Update them if a signature changes, and say so in the PR description.

`docs/escrow-interface.md` must document: every function signature with argument types and
units, every event with its indexed fields and exact topic ordering, every custom error, the
status transitions each event implies, and a worked example of the integer units for a $10
bounty (`10000000`, 6 decimals).

## Deliverables

### 1. Foundry project in `contracts/`
Install with `foundryup`. Solidity ^0.8.24. OpenZeppelin via `forge install`.
Commit `foundry.toml`, `remappings.txt`, a `.env.example`, and a `Makefile` or justfile with
`build`, `test`, `coverage`, `deploy-arc` targets.

### 2. `BountyEscrow.sol`
Implement exactly the four functions and four events frozen in `SPEC.md`. Requirements:

- `SafeERC20` for all USDC movement, `ReentrancyGuard` on `claim` and `refundExpired`.
- **Custom errors**, not revert strings.
- Integer 6-decimal units throughout. No float math, no unit conversion inside the contract.
- **State updated before any transfer**, every time.
- `prHash` is a `bytes32` hash of the PR identity (repo id + PR number) — store it, emit it,
  do not try to parse it onchain.
- One bounty = one immutable funder, one `prHash`, one amount, one expiry, one approved
  recipient, at most one successful claim.
- `claimId` guards against replay; a claim succeeds exactly once.

**Authorization model — this is the heart of the trust story, make it readable because a
judge will read it:** the original funder, or a maintainer wallet registered at funding
time, may call `approveReward`. The backend never holds a key that can move money. It
prepares an approval from verified GitHub evidence; a human maintainer signs it onchain.
Comment this intent in the contract.

Enforce every invariant in `SPEC.md`: no withdrawal except approved payout or expired refund
to the original funder; no payout exceeding the funded amount; no double claims; approval and
refund cannot spend the same balance; a reviewer cannot approve their own bounty.

### 3. Test suite — this is the deliverable judges' confidence rests on
A mock 6-decimal USDC token, plus explicit tests for:

- funding transfers the exact amount and emits `BountyFunded`
- funding without sufficient allowance reverts (no silent failure)
- unauthorized wallet cannot call `approveReward`
- a recipient other than the approved one cannot claim
- **double claim reverts** (this appears on camera in the demo — make the revert reason clean)
- approving more than the unused balance reverts
- approval and refund cannot spend the same amount
- `refundExpired` before expiry reverts
- `refundExpired` after expiry returns only the uncommitted balance, and only to the original funder
- a reentrancy attempt via a malicious token/recipient fails
- fuzz tests over amounts and expiries

Report the real coverage number from `forge coverage`. Target 100% branch coverage on the
escrow itself.

### 4. Deploy script
`script/Deploy.s.sol` parameterized for Arc testnet — chain ID `5042002`, USDC at
`0x3600000000000000000000000000000000000000`. Deployer key from an env var, **never a
literal, never committed.** Fund the deployer from the Circle faucet
(`https://faucet.circle.com`).

Your **Nov 14 exit test** is the one that matters: real USDC funding and a manual claim both
succeed against the deployed contract on Arc testnet. Verify the contract on the Arc
explorer and record the address in `docs/escrow-interface.md` and in your PR — Engineer C
needs it for explorer links and Engineer B needs it for the Streams filter.

### 5. `contracts/README.md`
Build/test/deploy commands, the deployed address and chain, and the trust model in plain
language — including the honest limitation that a registered maintainer can approve a
low-quality review.

## Hard constraints

- **Build nothing on the do-not-build list in `SPEC.md`.** No objection timers, no automatic
  scoring, no delegated claims, no splitting, no upgradeability, no multi-tenant treasury.
  If the core flow is done early, write more tests instead.
- Testnet only. No real-money language anywhere.
- Never report a test you did not run, or a deployment that did not happen. If something is
  blocked, say it is blocked.

## Working agreement with your Claude Code

Run the tests yourself and paste the real output. Commit in focused increments as you go.
When you finish a milestone, post in the team channel: what landed, the contract address if
it changed, and whether the ABI moved.
