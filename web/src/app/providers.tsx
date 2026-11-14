"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/chain/wagmi";
import { MOCK } from "@/lib/env";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 1000, retry: 1, refetchOnWindowFocus: false } } }),
  );
  return (
    <WagmiProvider config={wagmiConfig} reconnectOnMount={!MOCK}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
