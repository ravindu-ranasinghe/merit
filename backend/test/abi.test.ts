import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, keccak256, toFunctionSelector } from "viem";
import { claimId, escrowAbi, prHash } from "../src/chain/escrow.js";

// Values copied from docs/escrow-interface.md (Engineer A). If A's contract changes, this fails first.
describe("escrow ABI matches docs/escrow-interface.md", () => {
  it("event topic0s", () => {
    const t0 = (eventName: string) => encodeEventTopics({ abi: escrowAbi, eventName } as never)[0];
    expect(t0("BountyFunded")).toBe("0x4703133ed190b619ce4034b52cca1182f1f02f8e9de0d24309e35b1b296fe172");
    expect(t0("RewardApproved")).toBe("0x3830da5ae1d552f7899720c184c3f4576b9f26de96692c90938efbd55467294f");
    expect(t0("RewardPaid")).toBe("0x9f5b59d2a8ccf2f24c6428440048dc2ab3521768467f1a5030098b8e50c8ae6f");
    expect(t0("BountyRefunded")).toBe("0xf1ed347f033f54c0d6f1589c933d81b4256cf2f72a785106e3653a565f7433a2");
  });
  it("AlreadyClaimed selector (the demo's duplicate-claim revert)", () => {
    expect(toFunctionSelector("AlreadyClaimed(uint256)")).toBe("0xb3167bfa");
  });
  it("prHash and claimId use A's documented encodings", () => {
    const u = { type: "uint256" } as const;
    expect(prHash(900001, 1)).toBe(keccak256(encodeAbiParameters([u, u], [900001n, 1n])));
    expect(claimId(5550001)).toBe(keccak256(encodeAbiParameters([u], [5550001n])));
  });
});
