# Merit sponsor and prize strategy

## Which deeper feature has the strongest product and judging value?

### Takeaway
Build a reliable reward-delivery experience: a confirmed approval becomes an actionable claim notification, and a confirmed payout becomes a receipt and earned history. Pair it with a visible catch-up/replay demonstration. Gas-sponsored claims are a strong Arc follow-up, but automatic claims by an unrelated relayer are impossible under the current escrow.

### Cited Findings
- Consumer Applications explicitly values hiding gas/seed-phrase/bridging complexity, repeated use, and intentional UX; the judging rubric also includes technical execution, innovation, impact, and demo. Arc encourages Circle tools plus simple stable fees. QuickNode encourages event-driven actions and historical analytics, while requiring a core data source plus filter and destination. — [Supplied guide, pp. 8, 10, 13, 18](/Users/ravi/Downloads/Hackathon%20Guide%20UBC%2026.pdf)
- Existing profiles and receipts already show indexed earnings and matched payouts. Recommending those as new features would repeat shipped work. — [README](/Users/ravi/Documents/merit/README.md)
- Current `claim` requires `msg.sender == b.recipient`; the caller is also the transfer recipient. A sponsor EOA cannot simply call claim for a reviewer. `refundExpired`, in contrast, allows any caller but only transfers the uncommitted amount to the original funder. — [Escrow](/Users/ravi/Documents/merit/contracts/src/BountyEscrow.sol:124)
- Circle Gas Station supports Arc testnet and Arc mainnet. Its current developer documentation says EVM sponsorship uses Circle ERC-4337 smart contract accounts, not arbitrary existing EOAs. Fees are developer-paid; Gas Station is not the same product as Circle Paymaster. — [Gas Station](https://developers.circle.com/wallets/gas-station)
- Streams webhooks deliver sequentially and wait for 2xx acknowledgment before advancing. Non-2xx responses retry, then pause after configured maximum attempts; saying unlimited delivery is automatic would overstate the promise. — [Webhook destination](https://www.quicknode.com/docs/streams/destinations/webhooks)
- Backfill can select a range, filter server-side and continue into live streaming when no end range is supplied; historical processing consumes API credits. — [Backfilling](https://www.quicknode.com/docs/streams/backfilling)

### Inferences
- Best near-term scope: a personal action inbox derived from existing approved/paid events, an honest settlement status, and a protected operational view of latest indexed block/delivery/catch-up progress. Estimate 1 working day including meaningful integration checks, not a promised quote. User value: rewards do not depend on remembering to revisit the site; failures become visible and recoverable.
- Best deeper Arc scope: a user-authorized claim from a Circle SCA whose gas Merit sponsors. This can preserve existing Solidity if the approved recipient is that SCA, but wallet identity/signature linking and transaction flows need compatibility work. Do not market it as fully automatic or as working for already-approved EOA recipients. Estimate 2–3 days after a short compatibility spike; existing reviewers keep their current path.
- Conditional on the Arc researcher's verification: an Arc-native sender-preserving batch could combine USDC allowance and escrow funding into one transaction/confirmation without redeploying escrow. This would remove a concrete maintainer friction point and is preferable to a new wallet stack for a short hackathon timeline. Standard multicall is unsafe for this purpose because the escrow records `msg.sender` as funder and pulls funds from that sender. This note does not independently confirm the specific predeploy or call semantics; see arc.md for sources and verification status.
- A simple block-triggered relayer cannot impersonate a reviewer. A new permissionless `claimFor` contract function would require a new deployment because this escrow has no upgrade path. That conflicts with the user's preference to preserve the contract and should not be the default hackathon change.
- Automatic expiry refunds are technically possible without changing the contract, with a bounded sponsor gas wallet and a scheduler. Expiry emits no event, so Streams alone is not a clock. This is a useful treasury feature but has weaker reviewer-facing demo value than sponsored claims plus reward notifications.
- Historical data makes stronger proof of confirmed payouts and payment timing, but never proves a review was useful or that identities did not collude. Avoid a fabricated review-quality score or dollars-saved estimate.

### Gaps
- Circle SCA contract-call support, recipient onboarding and backend signature verification need a working spike before any implementation estimate is relied on. Other researchers cover this in detail.
- No live Circle API call, new wallet, new transaction, or fresh payout was attempted in this research.

## Does the current QuickNode use earn a credible sponsor story?

### Takeaway
The use is real as an application read/indexing dependency, but not technically irreplaceable. At current scale RPC log polling could replace it. A stronger story demonstrates reliable settlement, catch-up and useful reactions rather than pretending QuickNode enforces escrow security.

### Cited Findings
- The receiver authenticates payloads, filters the escrow address, stores unique chain/contract/transaction/log events and reconciles affected bounties even on duplicates. — [Webhook receiver](/Users/ravi/Documents/merit/backend/src/streams/webhook.ts:40)
- Frontend pages still poll Merit's API every 1.2–30 seconds depending on view. Chain-to-backend push does not currently mean browser push or no polling anywhere. — [Query hooks](/Users/ravi/Documents/merit/web/src/lib/api/queries.ts:14)
- A live escrow event delivered with the filter enabled remains marked unverified in the backend notes, despite historical real deliveries and filter-runner tests. — [Backend evidence](/Users/ravi/Documents/merit/backend/README.md:189)
- Stream retry/pause and replay functionality support a meaningful outage/catch-up demonstration. — [Webhook destination](https://www.quicknode.com/docs/streams/destinations/webhooks); [Backfill](https://www.quicknode.com/docs/streams/backfilling)

### Inferences
- Minimum compelling demo: show an onchain approval reaching the filtered receiver and a claim-ready item; send the claim from the actual approved reviewer; show the paid event, receipt and profile update; replay the same batch and show one payment/history record. For an outage/recovery segment use an isolated demonstration backend and real historical logs rather than breaking production.
- Precise pitch: Arc enforces funded, recipient-bound, single-use payouts; Streams keeps the product's payment state and recovery history aligned with Arc. GitHub supplies evidence and the maintainer judges usefulness. Each system has a distinct role.
- Cross-chain treasury funding with Gateway/CCTP can eventually remove funding friction, but is a worse immediate tradeoff: additional routing, balances and recovery states, without fixing the remaining live-demo proof gap. Multi-chain funding also does not entitle a team to select both chain awards.

### Gaps
- This is a strategy assessment, not a sponsor eligibility ruling. Judges decide prizes; the PDF is the supplied guide rather than a live organizer update.
- Fresh filtered event proof and an independent useful review/maintainer pilot remain the highest-confidence gaps to close before adding a broad integration.
