import type { CanonicalChain, CanonicalReceipt } from "../src/chain/canonical.js";
import type { RawLog } from "../src/streams/webhook.js";

/** Synthetic chain separate from the signed delivery; reorg tests explicitly change these canonical facts. */
export class MockCanonicalChain implements CanonicalChain {
  blocks = new Map<number, string>();
  receipts = new Map<string, CanonicalReceipt | null>();
  fail = false;
  constructor(private chainId: () => number) {}
  async getChainId() { if (this.fail) throw new Error("synthetic RPC unavailable"); return this.chainId(); }
  async getBlockHash(n: number) { const h = this.blocks.get(n); if (!h) throw new Error(`missing synthetic block ${n}`); return h; }
  async getReceipt(tx: string) { return this.receipts.get(tx) ?? null; }
  observe(logs: RawLog[]) {
    for (const l of logs) {
      const n = Number(BigInt(l.blockNumber));
      const hash = l.blockHash ?? `0x${n.toString(16).padStart(64, "0")}`;
      if (!this.blocks.has(n)) this.blocks.set(n, hash.toLowerCase());
      const tx = l.transactionHash.toLowerCase();
      if (!this.receipts.has(tx)) this.receipts.set(tx, { blockNumber: BigInt(n), blockHash: hash.toLowerCase(), logs: [] });
      const r = this.receipts.get(tx);
      if (r && !r.logs.some((x) => x.logIndex === l.logIndex)) r.logs.push(l);
    }
  }
}
