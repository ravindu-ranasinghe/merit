"use client";

/**
 * The one module that touches the wallet and the BountyEscrow contract. Components use
 * these hooks and never import wagmi, viem actions or the ABI directly.
 *
 * Adopting a new ABI is `npm run sync-abi`; a changed call shape is an edit to this file.
 */
import { useCallback, useState, useSyncExternalStore } from "react";
import { erc20Abi, parseEventLogs } from "viem";
import { injected, useConnect, useConnection, useDisconnect, useSwitchChain } from "wagmi";
import {
  getConnection,
  readContract,
  signMessage,
  simulateContract,
  waitForTransactionReceipt,
  writeContract,
} from "wagmi/actions";
import type { Address, Hex, PreparedApproval } from "@/lib/api/types";
import { computePrHash, type ChainDriver, type EscrowCall, type TxResult } from "@/lib/chain/driver";
import { ChainError, toChainError } from "@/lib/chain/errors";
import { escrowAbi } from "@/lib/chain/escrow-abi";
import { wagmiConfig } from "@/lib/chain/wagmi";
import { ARC, ESCROW_ADDRESS, MOCK, MOCK_ESCROW_ADDRESS } from "@/lib/env";
import { mockDriver } from "@/mock/chain";
import { PERSONAS } from "@/fixtures/seed";
import { getPersonaKey, subscribePersona } from "@/mock/store";

/* ------------------------------------------------------------------ real driver */

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

  async approveUsdc(amount, onSubmitted) {
    const hash = await writeContract(wagmiConfig, {
      address: ARC.usdc,
      abi: erc20Abi,
      functionName: "approve",
      args: [escrowAddress(), amount],
      chainId: ARC.chainId,
    });
    onSubmitted?.(hash);
    const receipt = await waitForTransactionReceipt(wagmiConfig, { hash, chainId: ARC.chainId });
    if (receipt.status !== "success") throw new ChainError("revert", "The USDC approval reverted.");
    return { hash };
  },

  async send(call, onSubmitted) {
    // Dry-run first, so a refusal arrives as a decoded contract error before the wallet opens.
    await simulateContract(wagmiConfig, { ...typed(call), account: connectedAccount() });
    const hash = await writeContract(wagmiConfig, typed(call));
    onSubmitted?.(hash);
    const receipt = await waitForTransactionReceipt(wagmiConfig, { hash, chainId: ARC.chainId });
    if (receipt.status !== "success") throw new ChainError("revert", "The transaction reverted onchain.");
    const result: TxResult = { hash };
    if (call.fn === "createBounty") {
      const [funded] = parseEventLogs({ abi: escrowAbi, eventName: "BountyFunded", logs: receipt.logs });
      result.bountyId = funded?.args.bountyId;
    }
    return result;
  },

  async simulate(call, from) {
    await simulateContract(wagmiConfig, { ...typed(call), account: from });
  },

  signMessage: (message) => signMessage(wagmiConfig, { message }),
};

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

/* ------------------------------------------------------------------ transactions */

export type TxPhase = "idle" | "wallet" | "confirming" | "done" | "error";

export interface TxState {
  phase: TxPhase;
  hash: Hex | null;
  error: ChainError | null;
}

const IDLE: TxState = { phase: "idle", hash: null, error: null };

function useTx<A>(fn: (args: A, onSubmitted: (hash: Hex) => void) => Promise<TxResult>) {
  const [state, setState] = useState<TxState>(IDLE);
  const run = useCallback(
    async (args: A): Promise<TxResult | null> => {
      setState({ phase: "wallet", hash: null, error: null });
      try {
        const result = await fn(args, (hash) => setState({ phase: "confirming", hash, error: null }));
        setState({ phase: "done", hash: result.hash, error: null });
        return result;
      } catch (err) {
        setState((s) => ({ phase: "error", hash: s.hash, error: toChainError(err) }));
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
  | "checking"
  | "approve_wallet"
  | "approve_confirming"
  | "deposit_wallet"
  | "deposit_confirming"
  | "done"
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
}

const FUND_IDLE: FundState = { phase: "idle", approveHash: null, depositHash: null, error: null };

/**
 * Funding a bounty: allow the escrow contract to take exactly this amount of USDC, then
 * createBounty, which pulls it. The allowance step is skipped when it is already enough.
 */
export function useFundBounty() {
  const [state, setState] = useState<FundState>(FUND_IDLE);

  const run = useCallback(async (input: FundInput, owner: Address): Promise<TxResult | null> => {
    const amount = BigInt(input.amountUnits);
    setState({ ...FUND_IDLE, phase: "checking" });
    try {
      if ((await driver.allowance(owner)) < amount) {
        setState((s) => ({ ...s, phase: "approve_wallet" }));
        await driver.approveUsdc(amount, (approveHash) =>
          setState((s) => ({ ...s, phase: "approve_confirming", approveHash })),
        );
      }
      setState((s) => ({ ...s, phase: "deposit_wallet" }));
      const result = await driver.send(
        {
          fn: "createBounty",
          args: [
            computePrHash(input.githubRepoId, input.prNumber),
            amount,
            BigInt(Math.floor(new Date(input.deadline).getTime() / 1000)),
          ],
        },
        (depositHash) => setState((s) => ({ ...s, phase: "deposit_confirming", depositHash })),
      );
      setState((s) => ({ ...s, phase: "done", depositHash: result.hash }));
      return result;
    } catch (err) {
      setState((s) => ({ ...s, phase: "error", error: toChainError(err) }));
      return null;
    }
  }, []);

  const reset = useCallback(() => setState(FUND_IDLE), []);
  const busy = !["idle", "done", "error"].includes(state.phase);
  return { ...state, busy, run, reset };
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
