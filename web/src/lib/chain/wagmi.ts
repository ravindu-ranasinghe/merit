import { defineChain } from "viem";
import { createConfig, http, injected } from "wagmi";
import { ARC } from "@/lib/env";

/** Arc testnet. Values are frozen in SPEC.md. USDC is the native gas token on Arc. */
export const arcTestnet = defineChain({
  id: ARC.chainId,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [ARC.rpcUrl] } },
  blockExplorers: { default: { name: "Arc Explorer", url: ARC.explorerUrl } },
  testnet: true,
});

export const wagmiConfig = createConfig({
  chains: [arcTestnet],
  connectors: [injected()],
  transports: { [arcTestnet.id]: http(ARC.rpcUrl) },
  ssr: true,
});
