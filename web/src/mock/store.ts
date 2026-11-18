/**
 * In-memory state for mock mode. It stands in for Engineer B's backend and the Arc
 * contract at once, and resets on a full page reload.
 */
import { buildSeed, fakeHash, PERSONAS, type PersonaKey, type Seed, type SeedOnchain } from "@/fixtures/seed";
import type { Address, Bounty, ChainEvent, Hex } from "@/lib/api/types";
import { computePrHash } from "@/lib/chain/driver";
import type { DepositRecord, DepositStore } from "@/lib/chain/deposit-flow";
import { ARC, MOCK_ESCROW_ADDRESS } from "@/lib/env";

interface Db extends Seed {
  allowances: Map<Address, bigint>;
  usedClaimIds: Set<string>;
  nextOnchainId: number;
  nextBountyNumber: number;
  challenges: Map<string, { address: Address; userId: string }>;
  txCount: number;
}

let db: Db | null = null;

export function getDb(): Db {
  if (!db) {
    const seed = buildSeed();
    db = {
      ...seed,
      allowances: new Map(),
      usedClaimIds: new Set([...seed.onchain.values()].flatMap((o) => (o.claimId ? [o.claimId] : []))),
      // Highest seeded onchain id + 1, not the count: seeded ids have gaps (drafts are never onchain), and a reused
      // id would route a new bounty's events to a fixture.
      nextOnchainId: Math.max(0, ...[...seed.onchain.keys()].map(Number)) + 1,
      // After the highest seeded id (b-101 … b-112 today), so a new bounty never reuses a fixture's id.
      nextBountyNumber: Math.max(100, ...seed.bounties.map((b) => Number(b.id.replace(/\D/g, "")) || 0)) + 1,
      challenges: new Map(),
      txCount: 0,
    };
  }
  return db;
}

export function resetDb() {
  db = null;
  mockDeposits.clear();
  mockTxOutcomes.clear();
}

/* ---------- recorded deposits and their outcomes (reset with the sample data) ---------- */

const mockDeposits = new Map<string, DepositRecord>();

/** In mock mode a recorded deposit lives in memory, like the rest of the sample chain. */
export const mockDepositStore: DepositStore = {
  get: (bountyId) => mockDeposits.get(bountyId) ?? null,
  set: (record) => { mockDeposits.set(record.bountyId, record); },
  clear: (bountyId) => { mockDeposits.delete(bountyId); },
};

/** Broadcast mock transactions that are not mined yet ("pending") or that reverted after broadcast. */
export const mockTxOutcomes = new Map<Hex, "pending" | "reverted">();

/**
 * Mock-only fault injection for the deposit recovery path. Set in the browser console, for example
 *   sessionStorage.setItem("merit.mock.fault", "receipt-timeout")
 * The next deposit consumes it. "receipt-timeout": the deposit is mined and indexed, but the receipt
 * lookup throws. "revert-after-broadcast": the deposit is broadcast, then reverts.
 */
export type MockFault = "receipt-timeout" | "revert-after-broadcast";
export function takeMockFault(): MockFault | null {
  try {
    const v = window.sessionStorage.getItem("merit.mock.fault");
    if (v !== "receipt-timeout" && v !== "revert-after-broadcast") return null;
    window.sessionStorage.removeItem("merit.mock.fault");
    return v;
  } catch {
    return null;
  }
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function newTxHash(): Hex {
  const d = getDb();
  d.txCount += 1;
  return fakeHash(`tx:${d.txCount}:${Date.now()}`);
}

/* ---------- persona (who the mock session is signed in as) ---------- */

const PERSONA_KEY = "merit.mock.persona";
const listeners = new Set<() => void>();

export function getPersonaKey(): PersonaKey {
  if (typeof window === "undefined") return "maintainer";
  const v = window.sessionStorage.getItem(PERSONA_KEY) as PersonaKey | null;
  return v && v in PERSONAS ? v : "maintainer";
}

export function setPersonaKey(key: PersonaKey) {
  window.sessionStorage.setItem(PERSONA_KEY, key);
  listeners.forEach((l) => l());
}

export function subscribePersona(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const currentPersona = () => PERSONAS[getPersonaKey()];

/* ---------- the mock indexer: what Streams + the backend do with a confirmed event ---------- */

const INDEX_DELAY_MS = 1600;

function findByOnchainId(id: string): Bounty | undefined {
  return getDb().bounties.find((b) => b.onchainBountyId === id);
}

/**
 * Records a confirmed mock transaction's event, then (after a short delay, like a real
 * pipeline) applies it to the bounty. Money states change only here, never in the UI.
 */
export function indexEvent(
  eventType: ChainEvent["eventType"],
  txHash: Hex,
  payload: Record<string, string>,
) {
  const d = getDb();
  d.headBlock += 3;
  const blockNumber = d.headBlock;

  setTimeout(() => {
    const at = new Date().toISOString();
    const onchainId = payload.bountyId;
    let bounty = findByOnchainId(onchainId);

    if (eventType === "BountyFunded") {
      bounty = d.bounties.find(
        (b) => !b.onchainBountyId && computePrHash(b.repo.githubRepoId, b.pr.number) === payload.prHash,
      );
      if (bounty) {
        bounty.onchainBountyId = onchainId;
        bounty.funderWallet = payload.funder as Address;
        bounty.status = "funded";
        bounty.chain.funded = { txHash, blockNumber, logIndex: 1, at, amountUnits: payload.amount };
        bounty.pendingTxHash = null;
      }
    } else if (bounty && eventType === "RewardApproved") {
      bounty.status = "claimable";
      bounty.chain.approved = { txHash, blockNumber, logIndex: 0, at, amountUnits: payload.amount };
      if (bounty.approval) bounty.approval.chainTxHash = txHash;
      bounty.pendingTxHash = null;
    } else if (bounty && eventType === "RewardPaid") {
      bounty.status = "paid";
      bounty.chain.paid = { txHash, blockNumber, logIndex: 0, at, amountUnits: payload.amount };
      bounty.pendingTxHash = null;
    } else if (bounty && eventType === "BountyRefunded") {
      // Same precedence as the backend (streams/project.ts): paid > claimable > refunded. Refunding the
      // unapproved remainder leaves an approved, unclaimed reward claimable.
      if (bounty.status !== "paid") bounty.status = bounty.chain.approved ? "claimable" : "refunded";
      bounty.chain.refunded = { txHash, blockNumber, logIndex: 0, at, amountUnits: payload.amount };
      bounty.pendingTxHash = null;
    }

    d.events.unshift({
      chainId: ARC.chainId,
      contract: MOCK_ESCROW_ADDRESS,
      txHash,
      logIndex: eventType === "BountyFunded" ? 1 : 0,
      blockNumber,
      eventType,
      payload,
      ingestionTimestamp: at,
      bountyId: bounty?.id,
    });
  }, INDEX_DELAY_MS);
}

export type { SeedOnchain };
