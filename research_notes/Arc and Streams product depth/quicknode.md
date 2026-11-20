# QuickNode Streams value in Merit

Research date: November 15, 2026. Read-only source inspection and current official QuickNode documentation; no live dashboard configuration, deliveries, transactions, or credentials inspected.

## Does Streams actually matter today?

### Takeaway
Streams is a real core integration in the current architecture: it is the only backend ingestion path for confirmed escrow events. It is replaceable infrastructure, rather than a unique primitive the escrow contract requires. That is an honest and credible sponsor story, but the visible product mostly treats it as an indexer today.

### Cited Findings
- The receiver checks HMAC and escrow address, decodes logs, inserts with a unique event identity, and reconciles every touched bounty even on duplicate deliveries. [Receiver](/Users/ravi/Documents/merit/backend/src/streams/webhook.ts:43), [event uniqueness](/Users/ravi/Documents/merit/backend/src/db/schema.ts:87).
- Funding linkage, amounts, deadline, approval state, and final bounty status derive from stored events. `RewardPaid` > `RewardApproved` > refund > funded projection; no confirmed funding event means `funding_pending`. [Reconciliation](/Users/ravi/Documents/merit/backend/src/streams/webhook.ts:80), [projection](/Users/ravi/Documents/merit/backend/src/streams/project.ts:17).
- A newly funded reward cannot enter discovery until it has an onchain bounty ID and funded/review-candidate status. Receipts require an indexed payout matched to an approval, recipient, and claim. Reviewer earnings count paid contributions. [Discovery](/Users/ravi/Documents/merit/backend/src/routes/public.ts:25), [matching](/Users/ravi/Documents/merit/backend/src/routes/view.ts:67), [receipt](/Users/ravi/Documents/merit/web/src/app/bounties/[id]/receipt/page.tsx:19), [earnings](/Users/ravi/Documents/merit/web/src/app/reviewers/[id]/page.tsx:14).
- The browser still polls Merit's API: 1.2 seconds while awaiting indexing, 8 seconds otherwise on bounty details; discovery is 30 seconds. Streams avoids backend chain polling; it does not currently push directly into the browser. [Queries](/Users/ravi/Documents/merit/web/src/lib/api/queries.ts:35).
- Contract funding, approval, claim, and refund contain no QuickNode dependency. The contract keeps enforcing permissions and holding/transferring funds if ingestion goes down. [Escrow](/Users/ravi/Documents/merit/contracts/src/BountyEscrow.sol:82).
- `eth_getLogs` exposes block-range, address, and topic filtering, so the same log feed can be constructed from RPC. [QuickNode eth_getLogs](https://www.quicknode.com/docs/ethereum/eth_getLogs).

### Inferences
- Removing Streams without a replacement leaves new funding stuck pending and new approvals/payments/refunds stale in the app; discovery and payment proof stop advancing. Existing indexed records remain readable. Users can still transact directly with the escrow; the current UI may not expose the right action because its indexed state is stale.
- A checkpointed `eth_getLogs` poller could replace this at current small volume. Doing it correctly needs block cursors, overlapping ranges, retries, deduplication, catch-up, and a canonical-chain policy. Streams buys managed delivery/replay instead of impossible-to-replace functionality. Do not claim “payments cannot happen without QuickNode.”
- Duplicate-payout prevention belongs to the escrow's `paid` check, not to Streams or the database. Ingestion uniqueness prevents duplicate ledger entries/earnings; replay-safe projection keeps app state consistent. These are separate guarantees. [One-time claim](/Users/ravi/Documents/merit/contracts/src/BountyEscrow.sol:124).

### Gaps
- No live account usage or exact Arc credit multiplier was queried; no cost comparison can be stated quantitatively.

## What deeper integration has the best value?

### Takeaway
Build a settlement inbox plus demonstrable recovery, then an expiry watchdog if time permits. These use events to drive useful work and make the sponsor integration observable without touching the deployed escrow.

### Cited Findings
- Streams webhook batches advance after 2xx acknowledgement; failed deliveries retry and can pause the stream after the configured limit. The documented default pause threshold is three retries, not an unlimited guarantee. [Webhook destination](https://www.quicknode.com/docs/streams/destinations/webhooks).
- Streams supports filtered historical ranges, then continuous tip streaming when no end range is supplied. It handles transport retries and ordering. [Backfilling](https://www.quicknode.com/docs/streams/backfilling).
- Filters can reshape, aggregate, and narrow the payload before it reaches the backend. They reduce downstream bandwidth/storage/work, not the number of billed processed blocks. [Filters](https://www.quicknode.com/docs/streams/filters), [Billing](https://www.quicknode.com/docs/streams/billing).
- `refundExpired` is callable by anyone after expiry. It transfers only `amount - approvedAmount` to the original funder, preserving approved rewards. Time passing does not execute a transaction. [Escrow refund](/Users/ravi/Documents/merit/contracts/src/BountyEscrow.sol:136).
- `claim` explicitly requires `msg.sender == recipient`, then pays `msg.sender`; a generic relayer cannot claim for the recipient. [Escrow claim](/Users/ravi/Documents/merit/contracts/src/BountyEscrow.sol:122).

### Inferences
1. **Settlement inbox (rough estimate 4–8 hours):** `RewardApproved` produces “$10 ready to claim”; `RewardPaid` produces a receipt/paid notification; `BountyRefunded` closes the maintainer's refund action. Derive the in-app inbox from existing indexed events for the smallest version. External delivery needs a durable outbox, stable event job IDs, retries, and suppression of repeated/historical notifications; don't send mail or GitHub comments inline before acknowledging a webhook. Clearly distinguish a GitHub candidate from an onchain approved payout. GitHub updates require explicit user/product authorization and must not leak private repo content into public comments.
2. **Recovery proof (rough estimate 4–8 hours):** expose last processed stream range/cursor, delivery state, and replay verification. Demonstrate recovery in isolated staging: replay an overlapping historical range and recover the exact same payment ledger and balances without duplicate earnings or notifications. Rebuild chain-derived projections, not the whole app: GitHub review evidence and approval identity mappings remain separate data. This turns the indexing choice into a visible technical demonstration.
3. **Expiry watchdog (rough estimate 8–16 hours):** `BountyFunded` schedules a durable delayed job at expiry. At execution, reread contract state and simulate the refund; a tightly restricted service wallet sponsors `refundExpired`. `BountyRefunded` confirms the outcome. No contract change is needed, but this adds a funded signing key, gas budget, nonce coordination, monitoring, and durable retries. A safe smaller version is an expiry/refund-ready inbox with the existing wallet performing the transaction. Streams alone is not a timer; it cannot notice a deadline with no new event.
- Strong combined demo: funding event appears while browser was closed; reviewer receives claim-ready action after approval; payment event issues proof; a replay restores the same ledger without a second notification. This shows an actual operational role rather than a sponsor logo.
- Do not promise generic sponsored auto-claim on the existing escrow: it would revert. A wallet/account execution system that makes the reviewer address the caller may enable sponsorship, but compatibility belongs to the Arc/Wallets research and implementation review.

### Gaps
- No QuickNode Functions transaction-signing capability was verified, so it is not recommended as a signer. A durable scheduler/worker and transaction sender are separate from Streams ingestion.

## What should be fixed or proved before the pitch?

### Takeaway
The strongest near-term improvement is to prove filtered live delivery and recovery honestly. The current receiver is replay-safe, but replay-safe does not mean canonical-chain/reorg-safe or exactly-once side effects.

### Cited Findings
- The README records real pre-filter deliveries but says a fresh escrow event through the enabled filter is still pending. It also says reorg metadata is not processed. [Verification gap](/Users/ravi/Documents/merit/backend/README.md:189), [limitation](/Users/ravi/Documents/merit/backend/README.md:174).
- Streams reorg support can restream corrected ranges; webhook consumers must replace previously processed affected data. Current docs describe `reorgs`, `blocks_reorged`, and batch range metadata. [Reorg handling](https://www.quicknode.com/docs/streams/reorg-handling).
- Multiple destinations share progress: one failed destination stops the stream, and restart can redeliver to destinations which already succeeded. [Destination delivery](https://www.quicknode.com/docs/streams/destinations).
- Merit's filter emits null for empty escrow batches. The DB stores event block numbers and ingestion timestamps, but not a processed empty-block watermark. [Filter](/Users/ravi/Documents/merit/backend/README.md:121), [event schema](/Users/ravi/Documents/merit/backend/src/db/schema.ts:87).

### Inferences
- A “last escrow event was 20 minutes ago” badge is not an indexer outage signal; the contract may be quiet. Health needs stream cursor/status or an independently defined heartbeat, not merely event age.
- Do not advertise automatic reorg safety until the consumer handles replacement/removal and recomputes projections; today orphan events can remain forever. Arc's finality properties reduce a chain-specific concern, but do not change what the receiver implements.
- Keep webhook acknowledgement fast; persist work before acknowledgement and process separately. The current set-based reconciliation is a good foundation, not a full durable side-effect runner.
- Filters should be pitched as cutting irrelevant payloads and backend load. Never claim they lower Streams block credits.

### Gaps
- Live filter settings, reorg options, stream cursor, balance, and actual latency were not checked. No transaction or delivery was sent. The backend README has some stale wording; treat dated evidence precisely rather than inferring a current account configuration.
