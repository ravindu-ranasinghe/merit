/**
 * Mock chain driver. It enforces the same rules, with the same custom error names, as
 * contracts/src/BountyEscrow.sol, so every guardrail renders exactly as it will live.
 */
import { PERSONAS } from "@/fixtures/seed";
import type { Address, Hex } from "@/lib/api/types";
import type { ChainDriver, EscrowCall, TxResult } from "@/lib/chain/driver";
import { ChainError } from "@/lib/chain/errors";
import { currentPersona, getDb, indexEvent, newTxHash, sleep } from "@/mock/store";

const ZERO = BigInt(0);
const nowSec = () => Math.floor(Date.now() / 1000);
const same = (a: string | null, b: string) => !!a && a.toLowerCase() === b.toLowerCase();

const revert = (name: string, args: readonly unknown[] = []) =>
  new ChainError("revert", `The contract reverted with ${name}.`, name, args);

/** Throws the error the real contract would, or returns the effect to apply. */
function check(call: EscrowCall, from: Address): () => { event: Parameters<typeof indexEvent>[0]; payload: Record<string, string>; bountyId?: bigint } {
  const d = getDb();

  if (call.fn === "createBounty") {
    const [prHash, amount, expiry] = call.args;
    if (/^0x0+$/.test(prHash)) throw revert("ZeroPrHash");
    if (amount === ZERO) throw revert("ZeroAmount");
    if (expiry <= BigInt(nowSec())) throw revert("ExpiryNotInFuture", [expiry]);
    if ((d.allowances.get(from) ?? ZERO) < amount) {
      throw new ChainError("revert", "ERC20: transfer amount exceeds allowance", "Error", [
        "ERC20: transfer amount exceeds allowance",
      ]);
    }
    return () => {
      const id = d.nextOnchainId++;
      d.allowances.set(from, (d.allowances.get(from) ?? ZERO) - amount);
      d.onchain.set(String(id), {
        funder: from, expiry: Number(expiry), paid: false, refunded: false,
        recipient: null, claimId: null, amount, approvedAmount: ZERO,
      });
      return {
        event: "BountyFunded",
        bountyId: BigInt(id),
        payload: { bountyId: String(id), funder: from, prHash, amount: amount.toString(), expiry: expiry.toString() },
      };
    };
  }

  const id = call.args[0];
  const b = d.onchain.get(id.toString());
  if (!b) throw revert("BountyNotFound", [id]);

  if (call.fn === "approveReward") {
    const [, recipient, amount, claimId] = call.args;
    if (!same(b.funder, from)) throw revert("NotFunder", [id, from]);
    if (nowSec() >= b.expiry) throw revert("BountyExpired", [id]);
    if (b.recipient) throw revert("AlreadyApproved", [id]);
    if (/^0x0+$/.test(recipient) || same(b.funder, recipient)) throw revert("InvalidRecipient", [recipient]);
    if (amount === ZERO) throw revert("ZeroAmount");
    if (amount > b.amount) throw revert("AmountExceedsBalance", [id, amount, b.amount]);
    if (/^0x0+$/.test(claimId)) throw revert("ZeroClaimId");
    if (d.usedClaimIds.has(claimId)) throw revert("ClaimIdAlreadyUsed", [claimId]);
    return () => {
      b.recipient = recipient;
      b.claimId = claimId;
      b.approvedAmount = amount;
      d.usedClaimIds.add(claimId);
      return {
        event: "RewardApproved",
        payload: { bountyId: id.toString(), recipient, amount: amount.toString(), claimId },
      };
    };
  }

  if (call.fn === "claim") {
    if (!same(b.recipient, from)) throw revert("NotApprovedRecipient", [id, from]);
    if (b.paid) throw revert("AlreadyClaimed", [id]);
    return () => {
      b.paid = true;
      return {
        event: "RewardPaid",
        payload: { bountyId: id.toString(), recipient: b.recipient as string, amount: b.approvedAmount.toString(), claimId: b.claimId as string },
      };
    };
  }

  // refundExpired
  if (nowSec() < b.expiry) throw revert("NotExpired", [id, BigInt(b.expiry)]);
  if (b.refunded) throw revert("AlreadyRefunded", [id]);
  const remainder = b.amount - b.approvedAmount;
  if (remainder === ZERO) throw revert("NothingToRefund", [id]);
  return () => {
    b.refunded = true;
    return {
      event: "BountyRefunded",
      payload: { bountyId: id.toString(), funder: b.funder, amount: remainder.toString() },
    };
  };
}

const WALLET_MS = 700;
const CONFIRM_MS = 1100;

export const mockDriver: ChainDriver = {
  async allowance(owner) {
    return getDb().allowances.get(owner) ?? ZERO;
  },

  // The "New reviewer" sample wallet is empty, so the faucet step can be seen in mock mode.
  async usdcBalance(owner) {
    return owner === PERSONAS.newReviewer.wallet ? ZERO : BigInt(25_000_000);
  },

  async approveUsdc(amount, onSubmitted): Promise<TxResult> {
    const from = currentPersona().wallet;
    await sleep(WALLET_MS);
    const hash = newTxHash();
    onSubmitted?.(hash);
    await sleep(CONFIRM_MS);
    getDb().allowances.set(from, amount);
    return { hash };
  },

  async send(call, onSubmitted): Promise<TxResult> {
    const from = currentPersona().wallet;
    await sleep(WALLET_MS);
    const apply = check(call, from);
    const hash = newTxHash();
    onSubmitted?.(hash);
    await sleep(CONFIRM_MS);
    const effect = apply();
    indexEvent(effect.event, hash, effect.payload);
    return { hash, bountyId: effect.bountyId };
  },

  async simulate(call, from) {
    await sleep(500);
    check(call, from);
  },

  async signMessage(message): Promise<Hex> {
    await sleep(WALLET_MS);
    // A placeholder signature. Mock mode verifies nothing.
    return `0x${Array.from(message.slice(0, 20), (c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("")}` as Hex;
  },
};
