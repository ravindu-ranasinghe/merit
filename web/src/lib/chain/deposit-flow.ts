/**
 * Funding a bounty without ever funding it twice.
 *
 * The deposit (createBounty) can be broadcast and then the receipt lookup can fail: an RPC timeout, a
 * closed tab, a refresh. An error at that point says nothing about whether the deposit landed. So the
 * deposit is recorded the moment the wallet returns its hash, and while that record is unresolved a
 * retry only checks it again. A new deposit is allowed only once the chain shows the old one did not
 * fund the bounty: it reverted, or its nonce was used by a transaction that did not fund it.
 *
 * Pure orchestration with no runtime imports, so scripts/deposit-recovery.test.mjs can run it under
 * Node with fake chain and storage. hooks.ts wires it to the real driver and browser storage.
 */
import type { Address, Hex } from "@/lib/api/types";

/** A broadcast deposit, bound to the bounty, the wallet that sent it, and the chain and escrow it went to. */
export interface DepositRecord {
  bountyId: string;
  hash: Hex;
  wallet: Address;
  chainId: number;
  escrow: Address;
  /** What a successful deposit emits, to recognise a replacement transaction that funded it. */
  expect: { prHash: Hex; amount: string; expiry: string };
  /** Block number before broadcast: where to look for a replacement's BountyFunded. Decimal string. */
  fromBlock: string;
  /** The deposit transaction's nonce once known. Needed before a replaced deposit can be declared unfunded. */
  nonce: number | null;
  submittedAt: number;
}

/**
 * What the chain says about a recorded deposit.
 * - confirmed: it (or a replacement from the same wallet) emitted the matching BountyFunded. Never fund again.
 * - reverted: its receipt failed. Nothing was deposited.
 * - replaced: its nonce was used by a different transaction, and no matching BountyFunded exists.
 * - pending: not mined and not replaced yet, or unknown. Keep waiting; do not fund again.
 */
export type DepositOutcome = "confirmed" | "reverted" | "replaced" | "pending";

export interface DepositCheck {
  outcome: DepositOutcome;
  /** The transaction that funded the bounty, when it was a replacement of the recorded one. */
  fundedBy?: Hex;
  /** The deposit's nonce, when the check learned it. */
  nonce?: number;
}

/** A successful receipt can belong to a cancellation; only the intended escrow event proves funding. */
export function matchesDeposit(record: Pick<DepositRecord, "wallet" | "escrow" | "expect">, event: {
  address: string; args: { funder: string; prHash: string; amount: bigint; expiry: bigint };
}): boolean {
  return event.address.toLowerCase() === record.escrow.toLowerCase()
    && event.args.funder.toLowerCase() === record.wallet.toLowerCase()
    && event.args.prHash.toLowerCase() === record.expect.prHash.toLowerCase()
    && event.args.amount === BigInt(record.expect.amount) && event.args.expiry === BigInt(record.expect.expiry);
}

export interface DepositStore {
  assertWritable(): void;
  get(bountyId: string): DepositRecord | null;
  /** False when only this page could remember it; keep the tab open until indexing. */
  set(record: DepositRecord): boolean;
  clear(bountyId: string): void;
}

export interface FundingChain {
  assertWallet(owner: Address): void;
  allowance(owner: Address): Promise<bigint>;
  approveUsdc(amount: bigint, onSubmitted: (hash: Hex) => void): Promise<{ hash: Hex }>;
  blockNumber(): Promise<bigint>;
  /** Broadcasts createBounty. Calls onSubmitted with the hash as soon as the wallet returns it. */
  createBounty(args: readonly [Hex, bigint, bigint], onSubmitted: (hash: Hex) => void): Promise<{ hash: Hex }>;
  checkDeposit(record: DepositRecord): Promise<DepositCheck>;
}

export interface FundRequest {
  bountyId: string;
  owner: Address;
  chainId: number;
  escrow: Address;
  prHash: Hex;
  amount: bigint;
  expiry: bigint;
}

export type FundEvent =
  | { type: "approve_wallet" }
  | { type: "approve_submitted"; hash: Hex }
  | { type: "deposit_wallet" }
  | { type: "deposit_submitted"; hash: Hex }
  | { type: "storage_failed" }
  | { type: "checking"; hash: Hex };

export type FundResult =
  /** The deposit is confirmed onchain (by its own receipt or a funding replacement). Wait for indexing. */
  | { kind: "confirmed"; hash: Hex }
  /** A deposit is out there and unresolved. Nothing new was broadcast. */
  | { kind: "pending"; hash: Hex }
  /** The recorded deposit did not fund the bounty. The record is cleared, so funding may start again. */
  | { kind: "not_funded"; hash: Hex; reason: "reverted" | "replaced" }
  /** A deposit from a different wallet is recorded for this bounty. Connect that wallet to resolve it. */
  | { kind: "other_wallet"; hash: Hex; wallet: Address }
  /** Another fund() for this bounty is already running in this page. */
  | { kind: "busy" };

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Bounties with a fund() in flight in this page, so a double click cannot broadcast twice. */
const inFlight = new Set<string>();

/** Resolve a recorded deposit against the chain. Clears the record only when it provably did not fund. */
export async function resolveDeposit(chain: FundingChain, store: DepositStore, record: DepositRecord, owner: Address | null): Promise<FundResult> {
  // Records from older builds carry only a hash (chainId 0): check them by receipt, whatever the wallet.
  const legacy = record.chainId === 0;
  if (!legacy && owner && !sameAddress(record.wallet, owner)) return { kind: "other_wallet", hash: record.hash, wallet: record.wallet };
  let check: DepositCheck;
  try {
    check = await chain.checkDeposit(record);
  } catch {
    return { kind: "pending", hash: record.hash }; // could not reach the chain: assume nothing
  }
  if (check.nonce !== undefined && record.nonce === null) store.set({ ...record, nonce: check.nonce });
  switch (check.outcome) {
    case "confirmed":
      return { kind: "confirmed", hash: check.fundedBy ?? record.hash };
    case "reverted":
    case "replaced":
      store.clear(record.bountyId);
      return { kind: "not_funded", hash: record.hash, reason: check.outcome };
    default:
      return { kind: "pending", hash: record.hash };
  }
}

/**
 * Fund a bounty: USDC allowance if needed, then createBounty. If a deposit is already recorded for this
 * bounty, no transaction is sent: the recorded deposit is checked instead.
 */
export async function fund(chain: FundingChain, store: DepositStore, req: FundRequest, on: (e: FundEvent) => void = () => {}): Promise<FundResult> {
  if (inFlight.has(req.bountyId)) return { kind: "busy" };
  inFlight.add(req.bountyId);
  try {
    const existing = store.get(req.bountyId);
    if (existing) {
      on({ type: "checking", hash: existing.hash });
      return await resolveDeposit(chain, store, existing, req.owner);
    }

    store.assertWritable(); // no wallet signature until recovery storage is available
    chain.assertWallet(req.owner);

    if ((await chain.allowance(req.owner)) < req.amount) {
      chain.assertWallet(req.owner);
      on({ type: "approve_wallet" });
      // The allowance hash is never recorded as a deposit. If its receipt fails, the next attempt
      // re-reads the allowance and skips this step when the approval did land.
      await chain.approveUsdc(req.amount, (hash) => on({ type: "approve_submitted", hash }));
    }

    const fromBlock = await chain.blockNumber();
    store.assertWritable(); // allowance confirmation may have taken long enough for storage to change
    chain.assertWallet(req.owner); // the wallet or network can change while allowance confirms
    on({ type: "deposit_wallet" });
    // Set inside onSubmitted: present if and only if the wallet broadcast the deposit.
    const sent: { record: DepositRecord | null } = { record: null };
    try {
      const { hash } = await chain.createBounty([req.prHash, req.amount, req.expiry], (hash) => {
        const record: DepositRecord = {
          bountyId: req.bountyId, hash, wallet: req.owner, chainId: req.chainId, escrow: req.escrow,
          expect: { prHash: req.prHash, amount: req.amount.toString(), expiry: req.expiry.toString() },
          fromBlock: fromBlock.toString(), nonce: null, submittedAt: Date.now(),
        };
        sent.record = record;
        const saved = store.set(record); // before anything else can fail
        on({ type: "deposit_submitted", hash });
        if (!saved) on({ type: "storage_failed" });
      });
      return { kind: "confirmed", hash };
    } catch (err) {
      // Nothing was broadcast (wallet rejection, simulation revert): a real error, and no record exists.
      if (!sent.record) throw err;
      // Broadcast happened, then something failed. The error is not evidence; ask the chain.
      on({ type: "checking", hash: sent.record.hash });
      return await resolveDeposit(chain, store, sent.record, req.owner);
    }
  } finally {
    inFlight.delete(req.bountyId);
  }
}
