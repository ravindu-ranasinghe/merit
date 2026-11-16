# Merit: submission and demo

Based on the supplied **Hackathon Guide UBC 26**, especially Consumer Applications (page 8), Best use of Arc (page 10), QuickNode Streams (page 13), submission requirements (page 16), and judging criteria (page 18). This is a recommended entry strategy; prizes are determined by the judges.

## Recommended entries

Select **Consumer Applications** as the one main track, **Best use of Arc** as the one chain award, and **QuickNode Streams** as the sponsor bounty. The guide permits those prizes to stack with an overall award. Do not select a second main track or the Solana chain award.

Merit fits Consumer Applications because maintainers and reviewers use a familiar GitHub workflow, with stablecoin escrow supporting an everyday developer task. Arc performs the core payment work. Streams supplies the state behind discovery, receipts, and reviewer earnings. These integrations are necessary to the product rather than optional decorations.

The guide lists Consumer Applications at $2,000, Arc at $1,000 within the chosen track, and QuickNode Streams at $500. That is $3,500 in compatible category prizes, with overall awards considered separately. No prize or eligibility outcome is guaranteed.

## Devpost copy

**Name:** Merit

**Short description:** A little credit for a good catch. Fund a GitHub review reward before the review happens, then pay the reviewer whose feedback helped land a fix.

**What we built:** A GitHub-connected code-review reward application with USDC escrow on Arc. Maintainers fund a pull request, reviewers discover open rewards, and explicit maintainer approval unlocks a single reviewer payout. The product connects original comments, later code changes, resolved threads, and indexed payments in one timeline.

**Problem:** Valuable review work is often invisible. A contributor who catches an authorization bug may prevent real harm without writing the patch or receiving any credit. A reward promised after the work also leaves the reviewer unsure whether it will be funded.

**How it works:** The maintainer deposits USDC into an escrow contract. GitHub App events capture inline review comments and resolution. The backend compares the reviewed revision with a later revision and flags candidates using disclosed heuristics. The maintainer assesses the evidence and signs a payout approval; the reviewer claims it. QuickNode Streams indexes contract events into the UI, reviewer profiles, and shareable receipts.

**What makes it useful:** The reward is funded before the review begins. Discovery shows funded public opportunities, PR badges bring reviewers into the workflow, and the final receipt connects useful feedback with a payment. GitHub IDs, recipient binding, explicit approval, and one-time claims connect identity and payment without letting the backend spend funds.

**Technologies:** Next.js, React, GitHub Apps, Fastify, PostgreSQL, Drizzle, Solidity, Foundry, viem, wagmi, Circle Arc, USDC, and QuickNode Streams. Sample mode is explicitly labelled and does not use real transactions.

**What we would build next:** Easier wallet onboarding, paginated discovery, production security review, stronger handling of rebases and event reorganizations, and feedback from open-source maintainers. These are future work, not current capabilities.

## A 2–3 minute video

- **0:00–0:20 — Problem.** Open the public rewards board: “Maintainers need careful reviews. Reviewers need a credible reward. Merit locks the reward before the work starts.” Show reward amounts and funded status.
- **0:20–0:45 — Discover.** Search for the demo repository, open a bounty, and copy its PR badge. Show the actual GitHub review text and the specific line awaiting a fix.
- **0:45–1:15 — Evidence.** Show the inline review, an actual subsequent fixing commit, and the resolved thread on GitHub. Recheck in Merit and point to the timeline. Say: “These are signals for the maintainer; we do not automatically judge review quality.”
- **1:15–1:45 — Approval and claim.** As the maintainer, approve from the funding wallet. As the reviewer, claim. Show the new Streams event advancing the money state. Edit out wallet setup delays while preserving the real actions.
- **1:45–2:10 — Proof.** Open the payout receipt and explorer transaction, then the reviewer profile. Show that earnings count only a confirmed payout. If practical, demonstrate the existing duplicate-claim refusal.
- **2:10–2:30 — Why these tools.** “Arc holds and transfers the USDC. QuickNode Streams makes the UI reflect confirmed escrow activity. GitHub supplies evidence, and the maintainer makes the decision.” Finish on the receipt.

Use separate GitHub accounts and wallets for the maintainer, PR author, and reviewer as required by the existing rules. A normal PR approval is insufficient: use an inline comment, a later relevant fix, and a resolved thread. Do not fabricate a live event or present sample-mode transactions as onchain evidence.

## Evidence to prepare before recording

1. A public repository and PR with a review that identifies a concrete issue, followed by a visible fix.
2. A real funded Arc testnet bounty and distinct linked reviewer wallet.
3. A Streams configuration showing Arc testnet, Logs, the escrow-address filter, and the deployed webhook destination.
4. A fresh escrow event delivered with the filter enabled. The historical backend notes distinguish pre-filter live deliveries from filter-runner tests; do not claim the filter was exercised live until it has been.
5. Funding, approval, and payout transactions with full explorer links, plus the receipt URL. Existing reference transactions are in `docs/escrow-interface.md`; capture the actual transactions from the recorded run.
6. Successful build and test output for the submitted revision.

## Submission details still supplied by the team

The guide requires team members, a public source repository with setup instructions, a working deployment, a judge-accessible 2–3 minute video, written product answers, sponsor tools used, and technical documentation. The root README supplies the architecture, Arc contract address, and Streams configuration reference; fill in the actual team, public repository URL, and video URL in Devpost.

The supplied guide sets the submission deadline at **Friday, November 20, 2026, at noon CST**. It requires teams to be present in person at the November 21 closing ceremony for any prize. Finalist presentations are five minutes plus two minutes of questions. Check organizer updates before submission.
