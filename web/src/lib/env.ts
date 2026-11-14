import type { Address } from "viem";

/** Mock mode: every screen renders from fixtures. No backend, no Arc RPC, no GitHub. */
export const MOCK = process.env.NEXT_PUBLIC_MOCK === "1";

/** Arc testnet config, frozen in SPEC.md. Only public values live here. */
export const ARC = {
  chainId: 5042002,
  rpcUrl: process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.io",
  explorerUrl: process.env.NEXT_PUBLIC_ARC_EXPLORER_URL ?? "https://explorer.testnet.arc.io",
  usdc: "0x3600000000000000000000000000000000000000" as Address,
  usdcDecimals: 6,
} as const;

/** Deployed BountyEscrow address. Published by Engineer A in docs/escrow-interface.md. */
export const ESCROW_ADDRESS = (process.env.NEXT_PUBLIC_ESCROW_ADDRESS ?? undefined) as
  | Address
  | undefined;

/** Placeholder escrow address used only by mock fixtures. */
export const MOCK_ESCROW_ADDRESS = "0xe5c70000000000000000000000000000000b0a17" as Address;

/** GitHub App slug, used to build the "connect a repository" install link. */
export const GITHUB_APP_SLUG = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG ?? "";
