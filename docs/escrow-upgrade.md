# Revised escrow deployment handoff

The claim-ID fix is in source and the published ABI. It is **not installed at the active immutable address**
`0x924525bF3f3A39f9c7f298E71aFf43F4c27a4727`. Existing deposits, claims and refunds stay there.
Another funder can still consume a public claim ID on that legacy contract; this is denial of approval,
not evidence of escrow principal theft.

The revised contract checks `claimIdUsedBy(funder, claimId)` instead of global `claimIdUsed(claimId)`.
A stranger's approval cannot block the legitimate funder. The same funder cannot pay that review twice.
The old getter remains aggregate history for compatibility; event fields and transaction signatures are unchanged.
There is no owner upgrade function, automatic migration, or transfer of existing principal.

## Owner-signed deployment

From the repository root:

```sh
git submodule update --init --recursive
make -C contracts test
make -C contracts abi
npm --prefix backend run sync-abi
npm --prefix web run sync-abi
```

The wallet owner deploys using their own encrypted Foundry account or hardware wallet. Keep keys out of
shell arguments, recordings, repository files and chat. Example with an already imported local account:

```sh
cd contracts
forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://rpc.testnet.arc.io --account merit-deployer \
  --broadcast --verify --verifier blockscout \
  --verifier-url https://explorer.testnet.arc.io/api/
```

The script refuses any chain other than Arc testnet (5042002), uses the existing six-decimal USDC token,
and deploys the tested bytecode. Record the new address, creation transaction and block; verify source on
[Arc testnet explorer](https://explorer.testnet.arc.io). No deployment has been signed by the agent.

## Preserve the existing application and funds

The current backend models **one chain/escrow deployment per database**. Its local bounty IDs and contract
bounty IDs are not globally interchangeable. Do not point the old database at the new escrow, clear tables,
reuse old receipts as new proof, or change the existing Stream's address/cursor to hide old deposits.

Use a separate backend database and matching frontend deployment for the revised escrow. Run the additive
migrations there, configure the same new address in backend/web, and use a separate filtered Stream preserving
signed reorg metadata. Keep the legacy app/Stream running until every legacy claim/refund is settled.
This avoids a multi-contract schema rewrite during submission preparation.

On the new deployment, owners verify: stranger-first same-claim approval still permits legitimate approval;
same-funder reuse reverts; normal funding/approval/claim and partial refund work; the new Stream supplies
matching canonical app receipts. The read-only claim check uses:

```sh
ESCROW_ADDRESS=<new-address> FUNDER_ADDRESS=<funding-wallet> \
  node docs/demo-prs/check-claim-ids.mjs <review-comment-id>
```

Without overrides it intentionally checks the legacy global guard. Do not declare the active legacy contract
fixed merely because the revised contract tests pass.
