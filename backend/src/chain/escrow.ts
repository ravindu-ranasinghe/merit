// The ONLY chain-facing module. ABI, address, chain id, id derivation, log decoding, calldata.
//
// TRUST BOUNDARY: the backend holds NO key that can move money. There is no private key, wallet
// client or signer anywhere in this codebase. It only encodes calldata for the maintainer's own
// wallet to sign (approveReward can only be sent by the bounty's funder wallet on-chain).
// Do not add a signer here.
import { decodeEventLog, encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, type Hex } from "viem";

// Mirrors SPEC.md "Contract surface". Swap for docs/escrow-abi.json here when Engineer A publishes it.
export const escrowAbi = parseAbi([
  "function createBounty(bytes32 prHash, uint256 amount, uint64 expiry) returns (uint256 bountyId)",
  "function approveReward(uint256 bountyId, address recipient, uint256 amount, bytes32 claimId)",
  "function claim(uint256 bountyId)",
  "function refundExpired(uint256 bountyId)",
  "event BountyFunded(uint256 indexed bountyId, address indexed funder, bytes32 indexed prHash, uint256 amount, uint64 expiry)",
  "event RewardApproved(uint256 indexed bountyId, address indexed recipient, uint256 amount, bytes32 claimId)",
  "event RewardPaid(uint256 indexed bountyId, address indexed recipient, uint256 amount, bytes32 claimId)",
  "event BountyRefunded(uint256 indexed bountyId, address indexed funder, uint256 amount)",
]);
const erc20Abi = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);

const pair = [{ type: "uint256" }, { type: "uint256" }] as const;

/** keccak256(abi.encode(uint256 repoId, uint256 prNumber)); repoId is the GitHub repository id. */
export const prHash = (repoId: number | bigint, prNumber: number | bigint): Hex =>
  keccak256(encodeAbiParameters(pair, [BigInt(repoId), BigInt(prNumber)]));

/** keccak256(abi.encode(uint256 onchainBountyId, uint256 githubCommentId)). Single use on-chain. */
export const claimId = (onchainBountyId: bigint | string, githubCommentId: number | bigint): Hex =>
  keccak256(encodeAbiParameters(pair, [BigInt(onchainBountyId), BigInt(githubCommentId)]));

export type DecodedEvent =
  | { eventName: "BountyFunded"; bountyId: string; args: { funder: string; prHash: string; amount: string; expiry: string } }
  | { eventName: "RewardApproved"; bountyId: string; args: { recipient: string; amount: string; claimId: string } }
  | { eventName: "RewardPaid"; bountyId: string; args: { recipient: string; amount: string; claimId: string } }
  | { eventName: "BountyRefunded"; bountyId: string; args: { funder: string; amount: string } };

/** Decode a raw log; null if it is not one of our four events. All values are lowercase strings. */
export function decodeLog(log: { topics: string[]; data: string }): DecodedEvent | null {
  try {
    const d = decodeEventLog({ abi: escrowAbi, topics: log.topics as [Hex, ...Hex[]], data: log.data as Hex });
    const a = d.args as Record<string, unknown>;
    const s = (v: unknown) => String(v).toLowerCase();
    const { bountyId, ...rest } = a;
    return {
      eventName: d.eventName,
      bountyId: s(bountyId),
      args: Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, s(v)])),
    } as DecodedEvent;
  } catch {
    return null;
  }
}

export interface PreparedTx {
  chainId: number;
  to: string;
  functionName: string;
  args: string[];
  data: Hex;
}

export const encodeApproveReward = (cfg: { chainId: number; escrow: string }, a: { bountyId: string; recipient: string; amount: string; claimId: string }): PreparedTx => ({
  chainId: cfg.chainId,
  to: cfg.escrow,
  functionName: "approveReward",
  args: [a.bountyId, a.recipient, a.amount, a.claimId],
  data: encodeFunctionData({ abi: escrowAbi, functionName: "approveReward", args: [BigInt(a.bountyId), a.recipient as Hex, BigInt(a.amount), a.claimId as Hex] }),
});

export const encodeCreateBounty = (cfg: { chainId: number; escrow: string; usdc: string }, a: { prHash: string; amount: string; expiry: number }) => ({
  // The funder must first approve the escrow to pull the USDC, then call createBounty.
  approve_usdc: {
    chainId: cfg.chainId,
    to: cfg.usdc,
    functionName: "approve",
    args: [cfg.escrow, a.amount],
    data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [cfg.escrow as Hex, BigInt(a.amount)] }),
  } satisfies PreparedTx,
  create_bounty: {
    chainId: cfg.chainId,
    to: cfg.escrow,
    functionName: "createBounty",
    args: [a.prHash, a.amount, String(a.expiry)],
    data: encodeFunctionData({ abi: escrowAbi, functionName: "createBounty", args: [a.prHash as Hex, BigInt(a.amount), BigInt(a.expiry)] }),
  } satisfies PreparedTx,
});
