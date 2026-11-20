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
const submitted = new Map<string, DepositRecord>();

export interface DepositContext {
  chainId: number;
  escrow: Address | null;
}

function read(bountyId: string): DepositRecord | null {
  const inPage = submitted.get(bountyId);
  if (inPage) return inPage;
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
    assertWritable: () => {
      const probe = "merit:deposit:storage-check";
      const value = "0".repeat(1024); // leave room for the full recovery record, not just a one-byte probe
      try {
        localStorage.setItem(probe, value);
        if (localStorage.getItem(probe) !== value) throw new Error("storage did not save");
        localStorage.removeItem(probe);
      } catch {
        const error = new Error("Enable browser storage before funding. Merit must save your deposit to prevent a second payment after a refresh.");
        error.name = "DepositStorageError";
        throw error;
      }
    },
    get: (bountyId) => {
      const r = read(bountyId);
      return r && matches(r) ? r : null;
    },
    set: (record) => {
      submitted.set(record.bountyId, record);
      try {
        const value = JSON.stringify(record);
        localStorage.setItem(key(record.bountyId), value);
        return localStorage.getItem(key(record.bountyId)) === value;
      } catch {
        // shortcut: storage can disappear after broadcast; keep recovery in this tab, require available storage before funding.
        return false;
      }
    },
    clear: (bountyId) => {
      submitted.delete(bountyId);
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
