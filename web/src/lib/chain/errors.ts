import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";
import { formatUsdc } from "@/lib/format";

/**
 * A failed chain interaction in a shape the UI can render on purpose.
 * `errorName` is the contract's custom error (see docs/escrow-interface.md).
 */
export class ChainError extends Error {
  constructor(
    public kind: "revert" | "user_rejected" | "wallet" | "network",
    message: string,
    public errorName?: string,
    public args: readonly unknown[] = [],
  ) {
    super(message);
    this.name = "ChainError";
  }
}

/** Normalizes anything thrown by viem/wagmi (or the mock chain) into a ChainError. */
export function toChainError(err: unknown): ChainError {
  if (err instanceof ChainError) return err;
  if (err instanceof BaseError) {
    if (err.walk((e) => e instanceof UserRejectedRequestError)) {
      return new ChainError("user_rejected", "Request cancelled in the wallet.");
    }
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName;
      // Arc USDC reverts with a plain Error(string), e.g. "ERC20: transfer amount exceeds allowance".
      if (name === "Error" || !name) {
        return new ChainError("revert", revert.reason ?? revert.shortMessage, "Error", [
          revert.reason ?? "",
        ]);
      }
      return new ChainError("revert", revert.shortMessage, name, revert.data?.args ?? []);
    }
    return new ChainError("network", err.shortMessage);
  }
  return new ChainError("network", err instanceof Error ? err.message : "Something went wrong.");
}

export interface ErrorCopy {
  title: string;
  body: string;
  /** The contract error as the chain reported it, shown as on-demand detail. */
  code?: string;
  /** True when the contract refused on purpose. These render as guardrails, not crashes. */
  guardrail: boolean;
}

const units = (v: unknown) => (typeof v === "bigint" ? formatUsdc(v) : String(v));

/** Plain-language copy for every way the escrow contract or the wallet can say no. */
export function describeChainError(err: ChainError): ErrorCopy {
  if (err.kind === "user_rejected") {
    return { title: "Cancelled in your wallet", body: "Nothing was sent. You can try again.", guardrail: false };
  }
  if (err.kind !== "revert") {
    return {
      title: "Couldn't reach the network",
      body: err.message || "The request did not go through. Check your connection and wallet, then try again.",
      guardrail: false,
    };
  }

  const a = err.args;
  const code = `${err.errorName}(${a.map((x) => String(x)).join(", ")})`;
  const g = (title: string, body: string): ErrorCopy => ({ title, body, code, guardrail: true });

  switch (err.errorName) {
    case "AlreadyClaimed":
      return g(
        "Duplicate claim rejected",
        "This reward was already paid. The escrow contract pays each bounty once, so a second claim is refused and no money moves.",
      );
    case "NotFunder":
      return g(
        "Only the funder can approve",
        "The escrow contract accepts an approval only from the wallet that funded this bounty. This wallet is not it.",
      );
    case "AmountExceedsBalance":
      return g(
        "Over budget",
        `The approval asked for ${units(a[1])}, but this bounty holds ${units(a[2])}. A payout can never exceed what was escrowed.`,
      );
    case "BountyExpired":
      return g(
        "This bounty has expired",
        "Approvals close at the deadline. Funds that were not approved can be refunded to the funder.",
      );
    case "NotApprovedRecipient":
      return g(
        "This wallet is not the approved recipient",
        "Only the wallet the maintainer approved can claim this reward.",
      );
    case "AlreadyApproved":
      return g("A payout was already approved", "One bounty pays one reviewer, once. This bounty already has its approval.");
    case "InvalidRecipient":
      return g("That recipient is not allowed", "The funder cannot pay themselves, and the recipient must be a real address.");
    case "ClaimIdAlreadyUsed":
      return g("This review was already paid", "Each review comment can be rewarded once, across all bounties.");
    case "NotExpired":
      return g("Not expired yet", "A refund is only possible after the deadline has passed.");
    case "AlreadyRefunded":
      return g("Already refunded", "The unapproved funds were already returned to the funder.");
    case "NothingToRefund":
      return g("Nothing to refund", "The full amount was approved for the reviewer, so there is nothing to return.");
    case "ExpiryNotInFuture":
      return g("The deadline must be in the future", "Pick a later deadline and try again.");
    case "BountyNotFound":
      return g("Bounty not found", "The escrow contract has no bounty with this number.");
    case "ZeroAmount":
    case "ZeroPrHash":
    case "ZeroClaimId":
      return g("Invalid request", "The escrow contract refused an empty value.");
    case "Error": {
      const reason = String(a[0] ?? err.message);
      if (/allowance/i.test(reason)) {
        return {
          title: "USDC spending not approved yet",
          body: "The escrow contract is not yet allowed to move this amount of your USDC. Approve the amount first, then deposit.",
          code: reason,
          guardrail: true,
        };
      }
      if (/balance/i.test(reason)) {
        return {
          title: "Not enough testnet USDC",
          body: "This wallet does not hold enough testnet USDC. Get more from the Circle faucet and try again.",
          code: reason,
          guardrail: true,
        };
      }
      return { title: "The transaction was refused", body: reason, code: reason, guardrail: true };
    }
    default:
      return { title: "The contract refused this transaction", body: err.message, code, guardrail: true };
  }
}
