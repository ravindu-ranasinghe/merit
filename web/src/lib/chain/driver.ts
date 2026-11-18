import { encodeAbiParameters, getAbiItem, keccak256, toEventSelector, type AbiEvent } from "viem";
import type { Address, ChainEventType, Hex } from "@/lib/api/types";
import { escrowAbi } from "@/lib/chain/escrow-abi";

/** The four state-changing calls on BountyEscrow, in the frozen SPEC.md argument order. */
export type EscrowCall =
  | { fn: "createBounty"; args: readonly [prHash: Hex, amount: bigint, expiry: bigint] }
  | { fn: "approveReward"; args: readonly [bountyId: bigint, recipient: Address, amount: bigint, claimId: Hex] }
  | { fn: "claim"; args: readonly [bountyId: bigint] }
  | { fn: "refundExpired"; args: readonly [bountyId: bigint] };

/** One log from a transaction receipt, as read from Arc RPC. */
export interface TxLog {
  address: Address;
  logIndex: number;
  topics: readonly Hex[];
}

/** What Arc says about a mined transaction. Read straight from RPC, not from the indexer. */
export interface TxDetails {
  success: boolean;
  blockNumber: bigint;
  /** Unix seconds. Block timestamps have one-second precision. */
  blockTimestamp: number;
  gasUsed: bigint;
  /** Wei of native USDC (18 decimals) per gas. Arc charges gas in USDC. */
  effectiveGasPrice: bigint;
  logs: TxLog[];
}

export interface TxResult {
  hash: Hex;
  /** Set for createBounty: the id read from the BountyFunded event in the receipt. */
  bountyId?: bigint;
}

/**
 * Everything the app asks of a wallet and the chain. hooks.ts picks the wagmi-backed
 * driver, or the in-memory mock driver when NEXT_PUBLIC_MOCK=1.
 */
export interface ChainDriver {
  /** Current USDC allowance from `owner` to the escrow contract. */
  allowance(owner: Address): Promise<bigint>;
  /** USDC balance of `owner`. Arc charges gas in USDC, so zero means the wallet cannot send anything. */
  usdcBalance(owner: Address): Promise<bigint>;
  /** USDC.approve(escrow, amount). Resolves once the transaction is confirmed. */
  approveUsdc(amount: bigint, onSubmitted?: (hash: Hex) => void): Promise<TxResult>;
  /** Sends an escrow transaction. Resolves once confirmed; rejects with a ChainError. */
  send(call: EscrowCall, onSubmitted?: (hash: Hex) => void): Promise<TxResult>;
  /** Dry-runs a call as `from` without sending anything. Rejects with the contract's error. */
  simulate(call: EscrowCall, from: Address): Promise<void>;
  /** Receipt and block for a mined transaction, or null if Arc does not know the hash. */
  txDetails(hash: Hex): Promise<TxDetails | null>;
  signMessage(message: string): Promise<Hex>;
}

/** prHash = keccak256(abi.encode(uint256 github_repo_id, uint256 github_pr_number)). */
export function computePrHash(githubRepoId: string, prNumber: number): Hex {
  return keccak256(
    encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [BigInt(githubRepoId), BigInt(prNumber)]),
  );
}

/** topic0 of an escrow event, from the generated ABI. */
export function eventTopic(name: ChainEventType): Hex {
  return toEventSelector(getAbiItem({ abi: escrowAbi, name }) as AbiEvent);
}
