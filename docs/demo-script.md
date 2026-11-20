# Merit demo script — target 2:45

This is a recording draft, not a record of a completed live run. Use the same real bounty, reviewer, claim and payment throughout. Fill [the proof inventory](demo-checklist.md#proof-inventory-for-the-fresh-run) first. Read payment claims only once supported by the captured explorer and filtered-Stream evidence. Rewards are **testnet USDC**.

## Timed shot list and narration

| Time | Existing screen / shot | Narration draft |
| --- | --- | --- |
| 0:00–0:18 | Public `/open-source` board; open the chosen PR bounty | “A careful code review can catch a real bug, but the reviewer often gets no credit. Merit lets a maintainer fund a review reward before the work begins. This is testnet USDC on Arc.” |
| 0:18–0:40 | Funding panel; original funder wallet; funding explorer transaction. Cut wallet waiting time while keeping the real actions and hashes. | “The maintainer deposits ten USDC into escrow. The contract holds the reward. Merit shows it as funded only after QuickNode Streams delivers its funding event. A broadcast waiting for confirmation stays attached to that submission.” |
| 0:40–1:10 | Actual GitHub inline review, relevant line/diff in a later commit, resolved thread; Merit evidence timeline | “Here is the human review, the specific issue it identifies, and the author's later change. The thread is resolved. GitHub supplies these signals, and Merit brings them together. They help the maintainer assess the review; they are not automatic proof of quality.” |
| 1:10–1:35 | Maintainer approval page: read the review, confirm recipient and four-USDC amount; show approval explorer reference | “The maintainer decides this review earned four USDC and signs the approval from the wallet that funded the bounty. The backend prepares the call, but holds no key that can spend the escrow. The contract reserves this amount for the linked reviewer.” |
| 1:35–1:55 | Separate reviewer session; Claim; matching Arc payout transaction | “The reviewer claims from the approved wallet. This explorer transaction is the actual Arc transfer. The recipient and amount match the maintainer's decision. An approval alone is not counted as paid earnings.” |
| 1:55–2:20 | Sanitized filtered-Stream delivery reference, `/events`, then `/bounties/[id]/receipt`; highlight the same hash/log index | “QuickNode Streams delivers the escrow log to the signed webhook destination. The app records it once and uses it to update the receipt and history. This payment hash and log index match the explorer. Arc enforces the payment; Streams supplies the confirmed state the product reads.” |
| 2:20–2:35 | Existing duplicate-claim refusal; dashboard four paid, six held. If showing a later refund, visibly label it “after expiry.” | “A second claim is refused. Four USDC was paid, and six remains in escrow. After expiry, the unapproved remainder can return only to the original funder. The reviewer's approved reward stays protected even if the remainder is refunded first.” |
| 2:35–2:45 | Receipt beside the original review link | “GitHub supplies evidence, the maintainer makes the judgment, and Arc enforces the USDC payout. Merit gives useful human review work a funded reward and a traceable receipt.” |

The target is 165 seconds including screen changes and short pauses. Rehearse aloud before recording and adjust the cuts to the measured duration; word count is not a playback measurement. If the real decision uses a different amount, update narration, captions and dashboard shots together from the actual integer units.

## Capture and edit notes

1. Capture the real review/change and explicit judgment before any animation or title sequence. Use the existing application screens; do not build another animation system. Keep identities, bounty ids, addresses, amounts and transaction hashes consistent across cuts.
2. Wallet owners operate their own wallets. Keep private keys, recovery phrases, cookies, tokens, credential-bearing RPC URLs and private Stream settings offscreen. Ravi supplies a sanitized delivery/configuration capture; teammates do not need his account key.
3. Cut waiting time honestly. Label an elapsed-expiry jump and any simulated illustration. Do not imply an RPC replay was QuickNode delivery, a simulation refusal was an onchain reverted transaction, or a mocked hash was a live payment. Say a measured delay only when its start/end timestamps and sources were recorded.
4. Retain the existing walkthrough. Export the final capture to a new name such as `output/video/merit-live-demo-2026-11-18-v1.mp4`; do not overwrite assets. Confirm 120–180 seconds with `ffprobe`, then play the whole export and check narration, captions, legible proof, and signed-out video access. Record the actual final path, duration and URL in the checklist.
5. Show subjective judgment honestly: the maintainer can approve a poor review and collusion remains possible. Put a short limitation caption beside the evidence/decision shot if it does not fit the spoken timing. Do not promise automatic quality scoring or fraud prevention.

## Recording status and missing inputs

November 19 rehearsal export: `output/video/merit-non-quicknode-rehearsal-2026-11-19-v1.mp4`, **172.333 seconds (2:52)**, H.264 video, AAC narration and embedded English captions. It records the actual local mock UI, includes explicit sample approval and both recovery/refund explanations, and keeps a permanent simulation label. The source capture, narration/caption assets, poster and full-decode result are beside the export or under `output/verification/`. This is preparation for the live cut, not a completed live payment demonstration. The original 87.004-second `merit-new-features.mp4` was preserved.

Missing shots: real review and fixing diff (PR author/reviewer), funding and maintainer approval (funder), claim/refusal and payout explorer (reviewer), filtered provider delivery and matching indexed log (Ravi), final receipt/dashboard and optional expired remainder refund (recorder/wallet owners). Capture them after live acceptance; a simulated replacement would not establish the missing proof.
