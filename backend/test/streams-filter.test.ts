import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";

it("the dashboard filter preserves signed reorg metadata even when the corrected block has no escrow logs", () => {
  const source = readFileSync(new URL("../scripts/streams-filter.js", import.meta.url), "utf8");
  const main = runInNewContext(`${source}; main`) as (s: unknown) => unknown;
  const own = { address: "0x924525bF3f3A39f9c7f298E71aFf43F4c27a4727", topics: ["synthetic"] };
  const foreign = { address: "0x0000000000000000000000000000000000000001", topics: ["synthetic"] };
  const metadata = { blocks_reorged: [123], reorgs: [{ block_number: 123, block_hash: "synthetic-orphan" }] };
  expect(main({ data: [[own, foreign]], metadata })).toEqual({ data: [own], metadata });
  expect(main({ data: [[foreign]], metadata })).toEqual({ data: [], metadata });
  expect(main({ data: [], metadata: { reorgs: null, blocks_reorged: null } })).toBeNull();
});
