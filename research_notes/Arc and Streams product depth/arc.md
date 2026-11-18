# Deeper Arc integration for Merit

## Which Arc feature adds concrete value without changing escrow?

### Takeaway
Best immediate upgrade: one atomic approval-and-funding transaction using Arc's sender-preserving Multicall3From. It removes one wallet prompt and the intermediate allowance-only state while keeping the deployed escrow, immutable funder, existing events and backend authority intact.

### Cited Findings
- Arc predeploy Multicall3From routes target calls through CallFrom, preserving the original EOA as msg.sender. Ordinary multicall changes the sender. aggregate3 supports allowFailure:false for atomic failure; only direct EOA calls are supported, and value forwarding is unsupported. — [Arc batched transactions](https://docs.arc.io/arc/concepts/batched-transactions)
- The Arc Testnet tutorial explicitly lists Multicall3From at 0x522fAf9A91c41c443c66765030741e4AaCe147D0 and USDC at 0x3600000000000000000000000000000000000000. — [Arc batch tutorial](https://docs.arc.io/arc/tutorials/batch-usdc-transfers)
- Merit's current createBounty stores msg.sender as funder and calls usdc.safeTransferFrom(msg.sender,address(this),amount). Its funder is the only approver. — [Local source](/Users/ravi/Documents/merit/contracts/src/BountyEscrow.sol)
- Current frontend sends USDC approve and createBounty as separate wallet transactions, waits for each receipt, and reads BountyFunded from receipt logs. — [Local hooks](/Users/ravi/Documents/merit/web/src/lib/chain/hooks.ts)
- Read-only RPC verification on 2026-11-15: code exists at the documented testnet predeploy (3180 bytes). An eth_call from documented existing funder 0x9795dAbD74F724c22C8293123b9E266E3b15f177 with initial USDC allowance 0 and balance 4968317 base units executed approve(escrow,1000000), createBounty(...,1000000,future expiry), then bounties(nextId=5). All subcalls succeeded. The decoded transient bounty had the original EOA as funder and amount 1000000. This is a simulation against the live deployed escrow, not a submitted transaction. Zero transactions sent and no state persisted. — [RPC endpoint](https://rpc.testnet.arc.io), [Escrow explorer](https://explorer.testnet.arc.io/address/0x924525bF3f3A39f9c7f298E71aFf43F4c27a4727)
- USDC gas has 18-decimal native precision while the ERC20 interface has six decimals and shares the underlying balance. — [Arc contract addresses](https://docs.arc.io/arc/references/contract-addresses)

### Inferences
- Implement aggregate3 with exact approval to the existing escrow, allowFailure:false for both calls, and unchanged createBounty payload. Do not approve the multicall as token spender. Subsequent internal transferFrom must see escrow as spender, which the simulation verified implicitly by successful transfer with allowance zero before the batch.
- Keep individual flow as fallback for unsupported wallets; EOA only for this Arc feature. Use the existing BountyFunded receipt parser; new transaction target is multicall but emitted escrow event remains unchanged. Backend could continue consuming existing events without contract or ABI changes.
- This is specifically deeper Arc use: uses its CallFrom execution capability, rather than deploying generic Solidity on an EVM network.
- Rough engineering estimate 4–8 hours including wallet handling, failure UX, mock compatibility, and focused tests. Exact wallet signing and a fresh Streams delivery still need a real testnet run before shipping.

### Gaps
- No real transaction submitted or browser wallet tested. No proof captured that the new batched transaction's event reaches the currently configured live filtered Stream. No source edits, secrets or deployment changes made.
- Existing allowance overwrite semantics should be documented: approve sets exact amount, and createBounty consumes it; batch rollback must retain the preexisting allowance on failure. Both success and rollback should have focused checks before shipping. Simulation tested initial zero allowance only.

### Reproducing the read-only check
Chain ID 5042002, RPC https://rpc.testnet.arc.io, block tag latest. Exact block number was not recorded, so treat this as a point-in-time simulation, not a pinned historical fixture. Run the following from the repository root with node --input-type=module; this script has no signer and never broadcasts a transaction:

```js
import {createPublicClient,http,encodeFunctionData,decodeFunctionResult,parseAbi,erc20Abi,keccak256,stringToHex} from './backend/node_modules/viem/_esm/index.js';
import {readFileSync} from 'node:fs';
const client=createPublicClient({transport:http('https://rpc.testnet.arc.io')});
const escrow='0x924525bf3f3a39f9c7f298e71aff43f4c27a4727';
const usdc='0x3600000000000000000000000000000000000000';
const multicall='0x522faf9a91c41c443c66765030741e4aace147d0';
const sender='0x9795dabd74f724c22c8293123b9e266e3b15f177';
const abi=JSON.parse(readFileSync('docs/escrow-abi.json','utf8'));
const batchAbi=parseAbi(['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) external returns ((bool success,bytes returnData)[])']);
const next=await client.readContract({address:escrow,abi,functionName:'nextBountyId'});
const calls=[
 {target:usdc,allowFailure:false,callData:encodeFunctionData({abi:erc20Abi,functionName:'approve',args:[escrow,1000000n]})},
 {target:escrow,allowFailure:false,callData:encodeFunctionData({abi,functionName:'createBounty',args:[keccak256(stringToHex('Merit research eth_call only')),1000000n,BigInt(Math.floor(Date.now()/1000)+3600)]})},
 {target:escrow,allowFailure:false,callData:encodeFunctionData({abi,functionName:'bounties',args:[next]})}
];
const {data}=await client.call({account:sender,to:multicall,data:encodeFunctionData({abi:batchAbi,functionName:'aggregate3',args:[calls]})});
const result=decodeFunctionResult({abi:batchAbi,functionName:'aggregate3',data});
const bounty=decodeFunctionResult({abi,functionName:'bounties',data:result[2].returnData});
if(!result.every(x=>x.success)||bounty[0].toLowerCase()!==sender||bounty[7]!==1000000n)throw Error('batch mismatch');
console.log({passed:true,funder:bounty[0],amount:String(bounty[7]),transactionsSent:0});
```

## Are sponsored claims or crosschain funding feasible?

### Takeaway
Second-best substantive option is optional user-controlled Circle smart-wallet onboarding with sponsored claim gas. It does not require changing BountyEscrow, but does require backend signature verification and frontend wallet integration. A generic relayer cannot automatically claim today's rewards for an existing EOA reviewer.

### Cited Findings
- claim checks msg.sender==b.recipient, marks paid, emits RewardPaid with msg.sender and transfers USDC to msg.sender. refundExpired, in contrast, is callable by anyone and always pays the immutable funder. — [Local escrow](/Users/ravi/Documents/merit/contracts/src/BountyEscrow.sol)
- Circle Wallets officially supports EOA and SCA on Arc and ARC-TESTNET. — [Supported blockchains](https://developers.circle.com/wallets/supported-blockchains)
- Gas Station lists Arc Testnet support and requires an ERC-4337 SCA for EVM sponsorship; sponsored fees are developer-paid. — [Gas Station](https://developers.circle.com/wallets/gas-station)
- The gasless quickstart expressly lists Arc Testnet and user-controlled as well as developer-controlled wallets. — [Gasless transaction quickstart](https://developers.circle.com/wallets/gas-station/send-a-gasless-transaction)
- Current wallet linking imports the standalone viem verifyMessage utility. Viem says this utility verifies EOAs only; publicClient.verifyMessage supports deployed ERC-1271 and predeployed ERC-6492 accounts. — [Local wallet linking](/Users/ravi/Documents/merit/backend/src/routes/wallet.ts), [Viem utility](https://viem.sh/docs/utilities/verifyMessage), [Viem client action](https://viem.sh/docs/actions/public/verifyMessage)
- Gateway's current supported-chain matrix includes Arc Testnet, Base Sepolia and other EVM testnets. — [Gateway supported chains](https://developers.circle.com/gateway/references/supported-blockchains)
- CCTP current matrix includes Arc and says listed chains' official testnets are supported. — [CCTP chain support](https://developers.circle.com/cctp/concepts/supported-chains-and-domains)
- Unified Balance aggregates funds deposited across chains, then spends to a destination recipient; it is built on Gateway. Circle SCA spends need an authorized EOA delegate; SCA deposits require onchain approval. — [Arc Unified Balance](https://docs.arc.io/app-kit/unified-balance)

### Inferences
- A user-controlled SCA can call claim as the approved SCA recipient through its execution path, while Gas Station covers fees. This is sponsored execution, not permissionless third-party claiming, and the user still authorizes the operation. Keep the injected wallet path for existing bounties and reviewers.
- Existing approved EOA rewards cannot simply migrate to an SCA because recipient is immutable after approval. Support smart wallets for new approvals, not a rewrite of recipient ownership.
- Never claim the backend can autonomously pay existing EOA recipients without new signing authority or contract changes. Private key custody would change the stated trust model; do not propose developer-controlled reviewer wallets as an invisible substitution.
- Rough estimate for user-controlled SCA + signature verification + sponsored claim + tests and old-wallet compatibility: 1–2 focused days, subject to Circle account/API setup and SDK readiness. This is a stretch feature compared with atomic EOA funding.
- Crosschain funding can meaningfully solve 'my USDC is on Base': bridge or spend Gateway balance to the maintainer's own Arc wallet, then approve/fund from that wallet. Do not mint/send directly into escrow expecting a bounty: createBounty pulls from its caller and binds funder. A helper contract calling createBounty would become funder and break current authorization assumptions. Rough estimate 1–3 days with recovery paths, not a quick hackathon addition.

### Gaps
- Circle SDK integration, SCA execution of this exact claim and ERC-1271/6492 linking are docs-supported designs, not tested in Merit. Gas Station overview lists mainnet while quickstart only lists Arc Testnet; testnet support is consistent and sufficient for this project. No billing or account readiness checked.

## Why does Arc matter beyond a generic EVM deployment?

### Takeaway
Current escrow logic is portable to other EVM networks. Arc's useful differences are USDC-denominated fees, deterministic settlement and the sender-preserving batch capability that can simplify the actual funding flow. Build and measure those benefits rather than claiming Arc exclusivity for generic escrow.

### Cited Findings
- Arc fees are USDC-denominated and smoothed using EWMA; actual transaction cost varies with execution, and transfer target costs must not be quoted as a measured escrow fee. — [Stable fee design](https://docs.arc.io/arc/concepts/stable-fee-design)
- Arc documentation describes deterministic finality under one second and allows offchain effects after committed blocks. This is chain finality, not end-to-end frontend latency; Streams delivery and application processing add delay. — [Deterministic finality](https://docs.arc.io/arc/concepts/deterministic-finality)
- Arc sender-preserving batching is available at a predeployed contract and has EOA call-context restrictions. — [Batched transactions](https://docs.arc.io/arc/concepts/batched-transactions)

### Inferences
- Strong demo: show exactly one funding signature, correct original funder on explorer, a funded opportunity appearing from Streams, then explain USDC covers reward and fees. Measure observed approval-to-claimable and payment-to-receipt times rather than promising sub-second whole-app updates.
- Avoid yield on escrow, new custody or complex crosschain orchestration this week: those expand trust and recovery requirements without directly improving review reward credibility.

### Gaps
- No exact fee benchmark captured. No claim about guaranteed hackathon score or prize eligibility beyond the provided guide. All effort ranges are engineering estimates.
