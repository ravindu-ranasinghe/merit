// Read-only check: has the escrow already used the claim id derived from each GitHub review-comment id?
// claimId = keccak256(abi.encode(uint256 commentId)), as in backend/src/chain/escrow.ts. The contract makes a claim id
// single-use across ALL bounties, so a comment that was ever approved can never be paid again.
// No key, no transaction: one eth_call per id against the public Arc testnet RPC.
//
//   npm --prefix backend ci            # once, for viem
//   node docs/demo-prs/check-claim-ids.mjs <reviewCommentId> [...]
import { createPublicClient, encodeAbiParameters, http, keccak256, parseAbi } from "../../backend/node_modules/viem/_esm/index.js";

const ESCROW = "0x924525bF3f3A39f9c7f298E71aFf43F4c27a4727";
const RPC = "https://rpc.testnet.arc.io";
const ids = process.argv.slice(2);
if (!ids.length || ids.some((x) => !/^\d+$/.test(x))) {
  console.error("usage: node docs/demo-prs/check-claim-ids.mjs <numeric review comment id> [...]");
  process.exit(2);
}
const client = createPublicClient({ transport: http(RPC) });
const abi = parseAbi(["function claimIdUsed(bytes32) view returns (bool)"]);
console.log(`chain ${await client.getChainId()}  escrow ${ESCROW}`);
for (const id of ids) {
  const claimId = keccak256(encodeAbiParameters([{ type: "uint256" }], [BigInt(id)]));
  const used = await client.readContract({ address: ESCROW, abi, functionName: "claimIdUsed", args: [claimId] });
  console.log(`comment ${id}  claimId ${claimId}  ${used ? "USED - do not use" : "unused"}`);
}
