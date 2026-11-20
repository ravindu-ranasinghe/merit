"use client";

/**
 * The one module that touches the wallet and the BountyEscrow contract. Components use
 * these hooks and never import wagmi, viem actions or the ABI directly.
 *
 * Adopting a new ABI is `npm run sync-abi`; a changed call shape is an edit to this file.
 */
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { erc20Abi, numberToHex, parseEventLogs, TransactionReceiptNotFoundError } from "viem";
import { injected, useConnect, useConnection, useDisconnect, useSwitchChain } from "wagmi";
import {
  getBlock,
  getBlockNumber,
  getConnection,
  getPublicClient,
  getTransactionReceipt,
  readContract,
  signMessage,
  simulateContract,
  waitForTransactionReceipt,
  writeContract,
} from "wagmi/actions";
import type { Address, ChainEventType, Hex, PreparedApproval, TxRef } from "@/lib/api/types";
import { computePrHash, eventTopic, type ChainDriver, type EscrowCall, type TxDetails, type TxResult } from "@/lib/chain/driver";
import { fund, matchesDeposit, resolveDeposit, type DepositCheck, type DepositOutcome, type DepositRecord, type DepositStore, type FundEvent, type FundingChain, type FundResult } from "@/lib/chain/deposit-flow";
import { browserDepositStore } from "@/lib/chain/deposit-store";
import { ChainError, toChainError } from "@/lib/chain/errors";
import { escrowAbi } from "@/lib/chain/escrow-abi";
import { wagmiConfig } from "@/lib/chain/wagmi";
import { ARC, ESCROW_ADDRESS, MOCK, MOCK_ESCROW_ADDRESS } from "@/lib/env";
import { mockDriver } from "@/mock/chain";
import { PERSONAS } from "@/fixtures/seed";
import { getPersonaKey, mockDepositStore, subscribePersona } from "@/mock/store";

/* ------------------------------------------------------------------ real driver */

/**
 * Arc produces blocks in well under a second, so poll for receipts often. The confirmation
 * time shown after a transaction is measured from this wait, so it is accurate to about this.
 */
const RECEIPT_POLL_MS = 250;

function escrowAddress(): Address {
  if (!ESCROW_ADDRESS) {
    throw new ChainError("wallet", "The escrow contract address is not configured yet (NEXT_PUBLIC_ESCROW_ADDRESS).");
  }
  return ESCROW_ADDRESS;
}

function connectedAccount(): Address {
  const address = getConnection(wagmiConfig).address;
  if (!address) throw new ChainError("wallet", "Connect a wallet first.");
  return address;
}

/**
 * viem types each contract call by its literal function name. The four escrow calls share
 * one code path here, so the already-checked EscrowCall union is narrowed to one member
 * for the type system only.
 */
type TypedCall = { address: Address; abi: typeof escrowAbi; functionName: "claim"; args: readonly [bigint]; chainId: typeof ARC.chainId };
const typed = (call: EscrowCall): TypedCall =>
  ({ address: escrowAddress(), abi: escrowAbi, functionName: call.fn, args: call.args, chainId: ARC.chainId }) as unknown as TypedCall;

const realDriver: ChainDriver = {
  allowance: (owner) =>
    readContract(wagmiConfig, {
      address: ARC.usdc,
      abi: erc20Abi,
      functionName: "allowance",
      args: [owner, escrowAddress()],
      chainId: ARC.chainId,
    }),

  usdcBalance: (owner) =>
    readContract(wagmiConfig, { address: ARC.usdc, abi: erc20Abi, functionName: "balanceOf", args: [owner], chainId: ARC.chainId }),

  async approveUsdc(amount, onSubmitted) {
    const account = connectedAccount();
    const hash = await writeContract(wagmiConfig, {
      account,
      address: ARC.usdc,
      abi: erc20Abi,
      functionName: "approve",
      args: [escrowAddress(), amount],
      chainId: ARC.chainId,
    });
    onSubmitted?.(hash);
    const receipt = await waitForTransactionReceipt(wagmiConfig, {
      hash, chainId: ARC.chainId, pollingInterval: RECEIPT_POLL_MS,
      onReplaced: ({ transaction }) => onSubmitted?.(transaction.hash),
    });
    if (receipt.status !== "success") throw new ChainError("revert", "The USDC approval reverted.");
    return { hash: receipt.transactionHash };
  },

  async send(call, onSubmitted) {
    const account = connectedAccount();
    // Dry-run first, so a refusal arrives as a decoded contract error before the wallet opens.
    await simulateContract(wagmiConfig, { ...typed(call), account });
    const hash = await writeContract(wagmiConfig, { ...typed(call), account });
    onSubmitted?.(hash);
    const receipt = await waitForTransactionReceipt(wagmiConfig, {
      hash, chainId: ARC.chainId, pollingInterval: RECEIPT_POLL_MS,
      onReplaced: ({ transaction }) => onSubmitted?.(transaction.hash),
    });
    if (receipt.status !== "success") throw new ChainError("revert", "The transaction reverted onchain.");
    const result: TxResult = { hash: receipt.transactionHash };
    if (call.fn === "createBounty") {
      const expected = { wallet: account, escrow: escrowAddress(), expect: { prHash: call.args[0], amount: call.args[1].toString(), expiry: call.args[2].toString() } };
      const funded = parseEventLogs({ abi: escrowAbi, eventName: "BountyFunded", logs: receipt.logs }).find((e) => matchesDeposit(expected, e));
      if (!funded) throw new ChainError("wallet", "The confirmed replacement did not fund this bounty. Check the recorded deposit before trying again.");
      result.bountyId = funded.args.bountyId;
    }
    return result;
  },

  async simulate(call, from) {
    await simulateContract(wagmiConfig, { ...typed(call), account: from });
  },

  signMessage: (message) => signMessage(wagmiConfig, { message }),

  blockNumber: () => getBlockNumber(wagmiConfig, { chainId: ARC.chainId }),

  checkDeposit: checkDepositOnArc,

  async txDetails(hash) {
    let receipt;
    try {
      receipt = await getTransactionReceipt(wagmiConfig, { hash, chainId: ARC.chainId });
    } catch (err) {
      if (err instanceof TransactionReceiptNotFoundError) return null;
      throw err;
    }
    const block = await getBlock(wagmiConfig, { blockNumber: receipt.blockNumber, chainId: ARC.chainId });
    return {
      success: receipt.status === "success",
      blockNumber: receipt.blockNumber,
      blockTimestamp: Number(block.timestamp),
      gasUsed: receipt.gasUsed,
      effectiveGasPrice: receipt.effectiveGasPrice,
      logs: receipt.logs.map((l) => ({ address: l.address, logIndex: l.logIndex, topics: l.topics })),
    };
  },
};

/** Arc RPC refuses eth_getLogs over more blocks than this. */
const LOG_RANGE = BigInt(10_000);

/** A BountyFunded from the deposit's wallet, for its PR hash, amount and expiry, since it was sent. */
async function findFunding(record: DepositRecord): Promise<Hex | null> {
  const client = getPublicClient(wagmiConfig, { chainId: ARC.chainId });
  if (!client) return null;
  const head = await client.getBlockNumber();
  const event = escrowAbi.find((x) => x.type === "event" && x.name === "BountyFunded")!;
  for (let from = BigInt(record.fromBlock); from <= head; from += LOG_RANGE) {
    const to = from + LOG_RANGE - BigInt(1) < head ? from + LOG_RANGE - BigInt(1) : head;
    const logs = await client.getLogs({
      address: record.escrow, event, fromBlock: from, toBlock: to,
      args: { funder: record.wallet, prHash: record.expect.prHash },
    } as Parameters<typeof client.getLogs>[0]);
    for (const l of logs as unknown as { address: string; transactionHash: Hex; args: { funder: string; prHash: string; amount: bigint; expiry: bigint } }[]) {
      if (matchesDeposit(record, l)) return l.transactionHash;
    }
  }
  return null;
}

/** The deposit's own receipt: confirmed or reverted, or null while it is not mined. */
async function ownReceipt(record: DepositRecord): Promise<DepositOutcome | null> {
  try {
    const r = await getTransactionReceipt(wagmiConfig, { hash: record.hash, chainId: ARC.chainId });
    if (r.status !== "success") return "reverted";
    const events = parseEventLogs({ abi: escrowAbi, eventName: "BountyFunded", logs: r.logs });
    const funded = record.chainId === 0
      ? events.some((e) => e.address.toLowerCase() === escrowAddress().toLowerCase())
      : events.some((e) => matchesDeposit(record, e));
    return funded ? "confirmed" : "replaced";
  } catch (err) {
    if (err instanceof TransactionReceiptNotFoundError) return null;
    throw err;
  }
}

async function checkDepositOnArc(record: DepositRecord): Promise<DepositCheck> {
  const own = await ownReceipt(record);
  if (own) return { outcome: own };
  if (record.chainId === 0) return { outcome: "pending" }; // an older hash-only record: receipt is all we can check
  const fundedBy = await findFunding(record);
  if (fundedBy) return { outcome: "confirmed", fundedBy };

  // Not mined and nothing funded: was its nonce used by another transaction? Learn the nonce while a
  // node still knows the transaction; without it, keep waiting rather than guess.
  const client = getPublicClient(wagmiConfig, { chainId: ARC.chainId });
  let nonce = record.nonce;
  if (nonce === null && client) {
    try { nonce = (await client.getTransaction({ hash: record.hash })).nonce; } catch { /* not known to this node */ }
  }
  if (nonce === null || !client) return { outcome: "pending" };
  const used = await client.getTransactionCount({ address: record.wallet, blockTag: "latest" });
  if (used <= nonce) return { outcome: "pending", nonce };
  // The nonce is used. Check once more, in case this very deposit was mined between the reads above.
  const again = await ownReceipt(record);
  if (again) return { outcome: again, nonce };
  const late = await findFunding(record);
  if (late) return { outcome: "confirmed", fundedBy: late, nonce };
  return { outcome: "replaced", nonce };
}

const driver: ChainDriver = MOCK ? mockDriver : realDriver;

/** The escrow contract address to display. Null until Engineer A's deployment is configured. */
export const escrowContractAddress: Address | null = MOCK ? MOCK_ESCROW_ADDRESS : (ESCROW_ADDRESS ?? null);

/* ------------------------------------------------------------------ wallet */

export interface WalletState {
  address: Address | null;
  connected: boolean;
  /** Connected, but to a network other than Arc testnet. */
  wrongNetwork: boolean;
  busy: boolean;
  connect: () => void;
  disconnect: () => void;
  switchNetwork: () => void;
}

function useRealWallet(): WalletState {
  const connection = useConnection();
  const connect = useConnect();
  const disconnect = useDisconnect();
  const switchChain = useSwitchChain();
  return {
    address: connection.address ?? null,
    connected: connection.isConnected,
    wrongNetwork: connection.isConnected && connection.chainId !== ARC.chainId,
    busy: connect.isPending || switchChain.isPending || connection.isReconnecting,
    connect: () => connect.mutate({ connector: injected(), chainId: ARC.chainId }),
    disconnect: () => disconnect.mutate(),
    switchNetwork: () => switchChain.mutate({ chainId: ARC.chainId }),
  };
}

const noop = () => {};

function useMockWallet(): WalletState {
  // Re-render when the mock persona changes; each persona has its own sample wallet.
  const persona = useSyncExternalStore(subscribePersona, getPersonaKey, () => "maintainer" as const);
  return {
    address: PERSONAS[persona].wallet,
    connected: true,
    wrongNetwork: false,
    busy: false,
    connect: noop,
    disconnect: noop,
    switchNetwork: noop,
  };
}

/** The connected wallet. MOCK is fixed at build time, so the same hook runs on every render. */
export const useWallet: () => WalletState = MOCK ? useMockWallet : useRealWallet;

/**
 * True only when the wallet is known to hold no USDC, which on Arc also means no gas.
 * Unknown (loading, RPC down) is false, so a failed read never blocks anyone. While it is
 * zero the balance is re-read, so the faucet step clears itself once the USDC arrives.
 */
export function useNeedsGas(address: Address | null | undefined): boolean {
  const { data } = useQuery({
    queryKey: ["usdc-balance", address],
    queryFn: () => driver.usdcBalance(address as Address),
    enabled: !!address,
    refetchInterval: (q) => (q.state.data === BigInt(0) ? 4000 : false),
  });
  return data === BigInt(0);
}

/* ------------------------------------------------------------------ transactions */

export type TxPhase = "idle" | "wallet" | "confirming" | "done" | "error";

export interface TxState {
  phase: TxPhase;
  hash: Hex | null;
  error: ChainError | null;
  /**
   * Milliseconds from the wallet handing back the transaction hash to this browser seeing
   * the receipt. Measured here, so it includes RPC round trips; accurate to about RECEIPT_POLL_MS.
   */
  confirmedInMs: number | null;
}

const IDLE: TxState = { phase: "idle", hash: null, error: null, confirmedInMs: null };

function useTx<A>(fn: (args: A, onSubmitted: (hash: Hex) => void) => Promise<TxResult>) {
  const [state, setState] = useState<TxState>(IDLE);
  const run = useCallback(
    async (args: A): Promise<TxResult | null> => {
      setState({ ...IDLE, phase: "wallet" });
      let submittedAt: number | null = null;
      try {
        const result = await fn(args, (hash) => {
          submittedAt = performance.now();
          setState({ ...IDLE, phase: "confirming", hash });
        });
        const confirmedInMs = submittedAt === null ? null : Math.round(performance.now() - submittedAt);
        setState({ phase: "done", hash: result.hash, error: null, confirmedInMs });
        return result;
      } catch (err) {
        setState((s) => ({ ...s, phase: "error", error: toChainError(err) }));
        return null;
      }
    },
    [fn],
  );
  const reset = useCallback(() => setState(IDLE), []);
  return { ...state, busy: state.phase === "wallet" || state.phase === "confirming", run, reset };
}

const sendClaim = (bountyId: string, cb: (h: Hex) => void) =>
  driver.send({ fn: "claim", args: [BigInt(bountyId)] }, cb);

const sendRefund = (bountyId: string, cb: (h: Hex) => void) =>
  driver.send({ fn: "refundExpired", args: [BigInt(bountyId)] }, cb);

const sendApproval = (a: PreparedApproval, cb: (h: Hex) => void) =>
  driver.send(
    { fn: "approveReward", args: [BigInt(a.onchainBountyId), a.recipient, BigInt(a.amountUnits), a.claimId] },
    cb,
  );

/** claim(bountyId): the approved reviewer collects the reward. */
export const useClaim = () => useTx(sendClaim);

/** refundExpired(bountyId): anyone may send it; the USDC only ever goes to the funder. */
export const useRefundExpired = () => useTx(sendRefund);

/** approveReward(...): the maintainer signs the four arguments the backend prepared. */
export const useApproveReward = () => useTx(sendApproval);

/* ------------------------------------------------------------------ funding (two steps) */

export type FundPhase =
  | "idle"
  /** Checking a recorded deposit against the chain. */
  | "checking"
  | "approve_wallet"
  | "approve_confirming"
  | "deposit_wallet"
  | "deposit_confirming"
  /** The deposit is confirmed onchain. Waiting for the indexer; never offer Fund again. */
  | "done"
  /** A deposit was broadcast and is not resolved yet. Retry checks it; it never sends another. */
  | "pending"
  /** The recorded deposit did not fund the bounty (reverted or replaced). Funding may start again. */
  | "not_funded"
  /** A deposit from another wallet is recorded for this bounty. */
  | "other_wallet"
  | "error";

export interface FundInput {
  githubRepoId: string;
  prNumber: number;
  amountUnits: string;
  /** ISO deadline; becomes the contract's unix-seconds expiry. */
  deadline: string;
}

export interface FundState {
  phase: FundPhase;
  approveHash: Hex | null;
  depositHash: Hex | null;
  error: ChainError | null;
  notFundedReason: "reverted" | "replaced" | null;
  otherWallet: Address | null;
}

const FUND_IDLE: FundState = { phase: "idle", approveHash: null, depositHash: null, error: null, notFundedReason: null, otherWallet: null };

const fundingChain: FundingChain = {
  assertWallet: (owner) => {
    const current = MOCK ? { address: PERSONAS[getPersonaKey()].wallet, chainId: ARC.chainId } : getConnection(wagmiConfig);
    if (current.address?.toLowerCase() !== owner.toLowerCase()) throw new ChainError("wallet", "The funding wallet changed. Reconnect the wallet linked to this bounty before funding.");
    if (current.chainId !== ARC.chainId) throw new ChainError("wallet", "Switch back to Arc testnet before funding.");
  },
  allowance: (owner) => driver.allowance(owner),
  approveUsdc: (amount, onSubmitted) => driver.approveUsdc(amount, onSubmitted),
  blockNumber: () => driver.blockNumber(),
  createBounty: (args, onSubmitted) => driver.send({ fn: "createBounty", args }, onSubmitted),
  checkDeposit: (record) => driver.checkDeposit(record),
};

const depositStore = (): DepositStore =>
  MOCK ? mockDepositStore : browserDepositStore({ chainId: ARC.chainId, escrow: escrowContractAddress });

function applyResult(r: FundResult, prev: FundState): FundState {
  switch (r.kind) {
    case "confirmed": return { ...prev, phase: "done", depositHash: r.hash };
    case "pending": return { ...prev, phase: "pending", depositHash: r.hash };
    case "not_funded": return { ...prev, phase: "not_funded", depositHash: r.hash, notFundedReason: r.reason, error: null };
    case "other_wallet": return { ...prev, phase: "other_wallet", depositHash: r.hash, otherWallet: r.wallet };
    case "busy": return prev;
  }
}

/**
 * Funding a bounty: allow the escrow contract to take exactly this amount of USDC, then createBounty.
 * The deposit is recorded the moment the wallet broadcasts it. While that record is unresolved, run()
 * and recheck() only check it against the chain; another deposit is possible only once the chain shows
 * the recorded one did not fund the bounty. A refresh resumes from the record. See deposit-flow.ts.
 */
export function useFundBounty(bountyId: string, owner: Address | null, onDepositSubmitted?: (hash: Hex) => void) {
  const recorded = depositStore().get(bountyId);
  const [state, setState] = useState<FundState>(() =>
    recorded ? { ...FUND_IDLE, phase: "checking", depositHash: recorded.hash } : FUND_IDLE);
  const submitted = useRef(onDepositSubmitted);
  useEffect(() => { submitted.current = onDepositSubmitted; }, [onDepositSubmitted]);

  // Resume a deposit recorded before this page loaded (a refresh, or an earlier failure).
  const recordedHash = recorded?.hash ?? null;
  useEffect(() => {
    if (!recordedHash) return;
    let live = true;
    const record = depositStore().get(bountyId);
    if (!record) return;
    void resolveDeposit(fundingChain, depositStore(), record, owner).then((r) => { if (live) setState((s) => applyResult(r, s)); });
    return () => { live = false; };
  }, [bountyId, owner, recordedHash]);

  const onEvent = useCallback((e: FundEvent) => {
    setState((s) => {
      switch (e.type) {
        case "approve_wallet": return { ...s, phase: "approve_wallet" };
        case "approve_submitted": return { ...s, phase: "approve_confirming", approveHash: e.hash };
        case "deposit_wallet": return { ...s, phase: "deposit_wallet" };
        case "deposit_submitted": return { ...s, phase: "deposit_confirming", depositHash: e.hash };
        case "storage_failed": return { ...s, error: new ChainError("storage", "Your deposit was sent, but browser storage stopped working. Keep this tab open until the funding event is indexed; refreshing could lose its recovery record.") };
        case "checking": return { ...s, phase: "checking", depositHash: e.hash };
      }
    });
    if (e.type === "deposit_submitted") submitted.current?.(e.hash);
  }, []);

  const run = useCallback(async (input: FundInput): Promise<FundResult | null> => {
    if (!owner) return null;
    setState((s) => ({ ...s, phase: "checking", error: null, notFundedReason: null }));
    try {
      const result = await fund(fundingChain, depositStore(), {
        bountyId, owner, chainId: ARC.chainId, escrow: escrowContractAddress as Address,
        prHash: computePrHash(input.githubRepoId, input.prNumber), amount: BigInt(input.amountUnits),
        expiry: BigInt(Math.floor(new Date(input.deadline).getTime() / 1000)),
      }, onEvent);
      setState((s) => applyResult(result, s));
      return result;
    } catch (err) {
      // Only reachable before a deposit was broadcast (wallet rejection, allowance failure, simulation revert).
      setState((s) => ({ ...s, phase: "error", error: toChainError(err) }));
      return null;
    }
  }, [bountyId, owner, onEvent]);

  const recheck = useCallback(async () => {
    const record = depositStore().get(bountyId);
    if (!record) return;
    setState((s) => ({ ...s, phase: "checking" }));
    const r = await resolveDeposit(fundingChain, depositStore(), record, owner);
    setState((s) => applyResult(r, s));
  }, [bountyId, owner]);

  const busy = ["checking", "approve_wallet", "approve_confirming", "deposit_wallet", "deposit_confirming"].includes(state.phase);
  /** True when the next action must be a fresh deposit (nothing recorded, or the recorded one did not fund). */
  const canFund = ["idle", "error", "not_funded"].includes(state.phase);
  return { ...state, busy, canFund, run, recheck };
}

/* ------------------------------------------------------------------ signing */

/** Signs a plain message (the wallet-link challenge). Free; moves no money. */
export function useSignMessage() {
  const [state, setState] = useState<{ busy: boolean; error: ChainError | null }>({ busy: false, error: null });
  const sign = useCallback(async (message: string): Promise<Hex | null> => {
    setState({ busy: true, error: null });
    try {
      const signature = await driver.signMessage(message);
      setState({ busy: false, error: null });
      return signature;
    } catch (err) {
      setState({ busy: false, error: toChainError(err) });
      return null;
    }
  }, []);
  return { ...state, sign };
}

/* ------------------------------------------------------------------ guardrail checks */

export type GuardrailResult =
  | { outcome: "rejected"; error: ChainError }
  | { outcome: "would_succeed" }
  | { outcome: "unavailable"; error: ChainError };

/**
 * Dry-runs a call against the contract as a given wallet, sending nothing. Used to show
 * that the contract itself refuses a duplicate claim, a stranger's approval, or an
 * over-budget payout.
 */
export function useGuardrailCheck() {
  const [state, setState] = useState<{ busy: boolean; result: GuardrailResult | null }>({ busy: false, result: null });
  const run = useCallback(async (call: EscrowCall, from: Address) => {
    setState({ busy: true, result: null });
    try {
      await driver.simulate(call, from);
      setState({ busy: false, result: { outcome: "would_succeed" } });
    } catch (err) {
      const error = toChainError(err);
      setState({ busy: false, result: { outcome: error.kind === "revert" ? "rejected" : "unavailable", error } });
    }
  }, []);
  const reset = useCallback(() => setState({ busy: false, result: null }), []);
  return { ...state, run, reset };
}

export type { EscrowCall } from "@/lib/chain/driver";

/* ------------------------------------------------------------------ payment measurements */

export type ReceiptCheck =
  /** Arc's receipt has this event at this log index, from the escrow contract, for this bounty. */
  | "matched"
  /** Arc knows the transaction, but its logs do not match what the indexer stored. */
  | "mismatch"
  /** Arc reports the transaction as reverted. */
  | "reverted"
  /** Arc RPC does not know this hash. */
  | "not_found";

export interface TxMeasurement {
  /** Gas paid by the sender, in wei of native USDC (18 decimals). */
  feeWei: bigint;
  /** Block timestamp in ms. One-second precision. */
  blockTimeMs: number;
  /** Indexer delivery time minus block time, in ms. Can read slightly negative from clock skew. */
  indexedAfterMs: number;
  check: ReceiptCheck;
}

/**
 * Measures one indexed escrow event against Arc itself: the fee its transaction paid, when its
 * block was produced, how long the event pipeline took to deliver it, and whether the receipt
 * really contains the event the indexer stored. Transactions are immutable, so this never refetches.
 */
export function useTxMeasurement(ref: TxRef | undefined, eventType: ChainEventType, onchainBountyId: string | null) {
  return useQuery({
    queryKey: ["tx-measurement", ref?.txHash, ref?.logIndex, eventType, onchainBountyId],
    enabled: !!ref && !!onchainBountyId,
    staleTime: Infinity,
    retry: 1,
    queryFn: async (): Promise<TxMeasurement | { check: "not_found" }> => {
      const details = await driver.txDetails(ref!.txHash);
      if (!details) return { check: "not_found" };
      const blockTimeMs = details.blockTimestamp * 1000;
      return {
        feeWei: details.gasUsed * details.effectiveGasPrice,
        blockTimeMs,
        indexedAfterMs: new Date(ref!.at).getTime() - blockTimeMs,
        check: checkReceipt(details, ref!, eventType, onchainBountyId!),
      };
    },
  });
}

function checkReceipt(d: TxDetails, ref: TxRef, eventType: ChainEventType, onchainBountyId: string): ReceiptCheck {
  if (!d.success) return "reverted";
  const escrow = escrowContractAddress?.toLowerCase();
  const topic0 = eventTopic(eventType);
  const topic1 = numberToHex(BigInt(onchainBountyId), { size: 32 });
  const found = d.logs.some((l) =>
    l.address.toLowerCase() === escrow
    && (ref.logIndex === undefined || l.logIndex === ref.logIndex)
    && l.topics[0]?.toLowerCase() === topic0.toLowerCase()
    && l.topics[1]?.toLowerCase() === topic1.toLowerCase());
  return found ? "matched" : "mismatch";
}
