import { createPublicClient, http, TransactionReceiptNotFoundError, type Hex } from "viem";
import type { Env } from "../env.js";
import type { RawLog } from "../streams/webhook.js";

export interface CanonicalReceipt { blockHash: string; blockNumber: bigint; logs: RawLog[] }
export interface CanonicalChain {
  getChainId(): Promise<number>;
  getBlockHash(height: number): Promise<string>;
  getReceipt(hash: string): Promise<CanonicalReceipt | null>;
}

/** Validation only: RPC never inserts a log or advances a payment without a signed Streams delivery. */
export function createCanonicalChain(env: Env): CanonicalChain {
  const client = createPublicClient({ transport: http(env.canonicalRpcUrl, { timeout: 4000, retryCount: 1 }) });
  return {
    getChainId: () => client.getChainId(),
    getBlockHash: async (height) => (await client.getBlock({ blockNumber: BigInt(height) })).hash,
    getReceipt: async (hash) => {
      try {
        const r = await client.getTransactionReceipt({ hash: hash as Hex });
        return { blockHash: r.blockHash, blockNumber: r.blockNumber, logs: r.logs.map((l) => ({
          address: l.address, topics: l.topics, data: l.data, blockNumber: Number(l.blockNumber),
          transactionHash: l.transactionHash, logIndex: l.logIndex,
        })) };
      } catch (err) {
        if (err instanceof TransactionReceiptNotFoundError) return null;
        throw err;
      }
    },
  };
}
