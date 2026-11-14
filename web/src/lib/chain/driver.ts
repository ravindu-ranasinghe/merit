import { encodeAbiParameters, keccak256 } from "viem";
import type { Address, Hex } from "@/lib/api/types";

/** The four state-changing calls on BountyEscrow, in the frozen SPEC.md argument order. */
export type EscrowCall =
  | { fn: "createBounty"; args: readonly [prHash: Hex, amount: bigint, expiry: bigint] }
  | { fn: "approveReward"; args: readonly [bountyId: bigint, recipient: Address, amount: bigint, claimId: Hex] }
  | { fn: "claim"; args: readonly [bountyId: bigint] }
  | { fn: "refundExpired"; args: readonly [bountyId: bigint] };

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
  /** USDC.approve(escrow, amount). Resolves once the transaction is confirmed. */
  approveUsdc(amount: bigint, onSubmitted?: (hash: Hex) => void): Promise<TxResult>;
  /** Sends an escrow transaction. Resolves once confirmed; rejects with a ChainError. */
  send(call: EscrowCall, onSubmitted?: (hash: Hex) => void): Promise<TxResult>;
  /** Dry-runs a call as `from` without sending anything. Rejects with the contract's error. */
  simulate(call: EscrowCall, from: Address): Promise<void>;
  signMessage(message: string): Promise<Hex>;
}

/** prHash = keccak256(abi.encode(uint256 github_repo_id, uint256 github_pr_number)). */
export function computePrHash(githubRepoId: string, prNumber: number): Hex {
  return keccak256(
    encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [BigInt(githubRepoId), BigInt(prNumber)]),
  );
}
