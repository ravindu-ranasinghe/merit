/**
 * Where a broadcast deposit is remembered: this browser's localStorage, keyed by bounty.
 *
 * Limit: the record is per browser profile. Another browser or device does not see a deposit sent
 * from here, and while that deposit is still unindexed it would offer "Fund" again. The backend
 * records no funding hash (docs/api.md), so there is nothing shared to read instead.
 */
import type { Address, Hex } from "@/lib/api/types";
import type { DepositRecord, DepositStore } from "@/lib/chain/deposit-flow";

const key = (bountyId: string) => `merit:deposit:${bountyId}`;

export interface DepositContext {
  chainId: number;
  escrow: Address | null;
}

function read(bountyId: string): DepositRecord | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key(bountyId));
  } catch {
    return null; // storage blocked
  }
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as DepositRecord;
    return typeof r?.hash === "string" && r.bountyId === bountyId ? r : null;
  } catch {
    // Older builds stored the bare deposit hash. It still means "a deposit was sent", but without the
    // wallet and terms it cannot be checked, so it only keeps the waiting state.
    return /^0x[0-9a-fA-F]{64}$/.test(raw) ? legacy(bountyId, raw as Hex) : null;
  }
}

const legacy = (bountyId: string, hash: Hex): DepositRecord => ({
  bountyId, hash, wallet: "0x0000000000000000000000000000000000000000", chainId: 0,
  escrow: "0x0000000000000000000000000000000000000000",
  expect: { prHash: "0x", amount: "0", expiry: "0" }, fromBlock: "0", nonce: null, submittedAt: 0,
});

/** A store that only returns records for the configured chain and escrow. */
export function browserDepositStore(ctx: DepositContext): DepositStore {
  const matches = (r: DepositRecord) =>
    r.chainId === 0 || (r.chainId === ctx.chainId && !!ctx.escrow && r.escrow.toLowerCase() === ctx.escrow.toLowerCase());
  return {
    get: (bountyId) => {
      const r = read(bountyId);
      return r && matches(r) ? r : null;
    },
    set: (record) => {
      try {
        localStorage.setItem(key(record.bountyId), JSON.stringify(record));
      } catch {
        /* storage blocked: the in-page state still prevents a second broadcast until reload */
      }
    },
    clear: (bountyId) => {
      try {
        localStorage.removeItem(key(bountyId));
      } catch {
        /* nothing to clear */
      }
    },
  };
}

/** The recorded deposit hash for a bounty, if any. Read by the API adapter to show "deposit sent". */
export function recordedDepositHash(bountyId: string): Hex | null {
  return read(bountyId)?.hash ?? null;
}
