// Read-only check: has the escrow already used the claim id derived from each GitHub review-comment id?
// claimId = keccak256(abi.encode(uint256 commentId)), as in backend/src/chain/escrow.ts. The contract makes a claim id
// global on the active legacy escrow; revised deployments check claimIdUsedBy for a specific funder.
// No key, no transaction: one eth_call per id against the public Arc testnet RPC.
//
//   npm --prefix backend ci            # once, for viem
//   node docs/demo-prs/check-claim-ids.mjs <reviewCommentId> [...]
import { createPublicClient, encodeAbiParameters, http, keccak256, parseAbi } from "../../backend/node_modules/viem/_esm/index.js";

const LEGACY = "0x924525bF3f3A39f9c7f298E71aFf43F4c27a4727";
const ESCROW = process.env.ESCROW_ADDRESS || LEGACY;
const FUNDER = process.env.FUNDER_ADDRESS;
const legacy = ESCROW.toLowerCase() === LEGACY.toLowerCase();
if (!/^0x[0-9a-fA-F]{40}$/.test(ESCROW) || (!legacy && !/^0x[0-9a-fA-F]{40}$/.test(FUNDER ?? ""))) {
  throw new Error("A revised ESCROW_ADDRESS requires a valid FUNDER_ADDRESS; the legacy address uses its global guard");
}
const RPC = "https://rpc.testnet.arc.io";
const ids = process.argv.slice(2);
if (!ids.length || ids.some((x) => !/^\d+$/.test(x))) {
  console.error("usage: node docs/demo-prs/check-claim-ids.mjs <numeric review comment id> [...]");
  process.exit(2);
}
const client = createPublicClient({ transport: http(RPC) });
const abi = parseAbi(["function claimIdUsed(bytes32) view returns (bool)", "function claimIdUsedBy(address,bytes32) view returns (bool)"]);
const chainId = await client.getChainId();
if (chainId !== 5042002) throw new Error("wrong chain");
console.log(`chain ${chainId}  escrow ${ESCROW}  guard ${legacy ? "legacy global" : `funder ${FUNDER}`}`);
for (const id of ids) {
  const claimId = keccak256(encodeAbiParameters([{ type: "uint256" }], [BigInt(id)]));
  const used = legacy
    ? await client.readContract({ address: ESCROW, abi, functionName: "claimIdUsed", args: [claimId] })
    : await client.readContract({ address: ESCROW, abi, functionName: "claimIdUsedBy", args: [FUNDER, claimId] });
  console.log(`comment ${id}  claimId ${claimId}  ${used ? "USED - do not use" : "unused"}`);
}
