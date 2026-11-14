"use client";

import { useState } from "react";
import type { Address, Bounty, Hex } from "@/lib/api/types";
import { describeChainError } from "@/lib/chain/errors";
import { useGuardrailCheck, type EscrowCall, type GuardrailResult } from "@/lib/chain/hooks";
import { IconShield } from "./icons";
import { Button, GuardrailCard, Notice } from "./ui";

// Throwaway values for dry runs only. Built at runtime; they are not keys or real ids.
const STRANGER = `0x${"5a".repeat(20)}` as Address;
const SAMPLE_CLAIM_ID = `0x${"c1".repeat(32)}` as Hex;

interface Check {
  key: string;
  title: string;
  what: string;
  action: string;
  call: EscrowCall;
  from: Address;
}

/** The dry runs that make sense for this bounty right now. */
export function checksFor(bounty: Bounty): Check[] {
  if (!bounty.onchainBountyId || !bounty.funderWallet) return [];
  const id = BigInt(bounty.onchainBountyId);
  const checks: Check[] = [];

  if (bounty.status === "paid" && bounty.approval) {
    checks.push({
      key: "duplicate-claim",
      title: "Claim the same reward twice",
      what: "Sends the reviewer's claim again for a bounty that was already paid.",
      action: "Try a second claim",
      call: { fn: "claim", args: [id] },
      from: bounty.approval.approvedRecipient,
    });
  }

  const open = bounty.status === "funded" || bounty.status === "review_candidate";
  const recipient = bounty.candidates.find((c) => c.reviewerWallet)?.reviewerWallet ?? STRANGER;

  if (open) {
    checks.push({
      key: "over-budget",
      title: "Approve more than the bounty holds",
      what: "Asks the contract to approve one unit more than was escrowed.",
      action: "Try an over-budget approval",
      call: { fn: "approveReward", args: [id, recipient, BigInt(bounty.amountUnits) + BigInt(1), SAMPLE_CLAIM_ID] },
      from: bounty.funderWallet,
    });
  }

  if (open || bounty.status === "claimable" || bounty.status === "paid") {
    checks.push({
      key: "unauthorized",
      title: "Approve from a wallet that is not the funder",
      what: "Asks the contract to approve a payout from a stranger's wallet.",
      action: "Try a stranger's approval",
      call: { fn: "approveReward", args: [id, recipient, BigInt(1), SAMPLE_CLAIM_ID] },
      from: STRANGER,
    });
  }

  return checks;
}

export function GuardrailResultView({ result }: { result: GuardrailResult }) {
  if (result.outcome === "rejected") {
    const copy = describeChainError(result.error);
    return (
      <GuardrailCard
        title={copy.title}
        body={copy.body}
        code={copy.code}
        footnote="This was a dry run against the contract. No transaction was sent and no money moved."
      />
    );
  }
  if (result.outcome === "would_succeed") {
    return (
      <Notice tone="warning" title="The contract would have accepted this">
        This guardrail did not hold in the dry run. Treat that as a bug and tell the team.
      </Notice>
    );
  }
  const copy = describeChainError(result.error);
  return <Notice tone="warning" title={copy.title}>{copy.body}</Notice>;
}

/**
 * "Try to break it": dry-runs calls the escrow contract must refuse, and shows its answer.
 * Each check runs the real contract logic without sending a transaction.
 */
export function GuardrailPanel({ bounty }: { bounty: Bounty }) {
  const checks = checksFor(bounty);
  const runner = useGuardrailCheck();
  const [active, setActive] = useState<string | null>(null);

  if (checks.length === 0) return null;

  return (
    <div>
      <h2 className="flex items-center gap-2 text-[15px] font-semibold">
        <IconShield size={17} />
        Guardrails
      </h2>
      <p className="mt-1 text-[13px] text-mut">
        The escrow contract enforces these rules, not this website. Try to break one: each button dry-runs the call
        against the contract and shows its answer.
      </p>
      <ul className="mt-3 space-y-2">
        {checks.map((c) => (
          <li key={c.key} className="rounded-card bg-card p-3.5 shadow-inner-card">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13.5px] font-semibold">{c.title}</p>
                <p className="text-[12.5px] text-mut">{c.what}</p>
              </div>
              <Button
                variant="secondary"
                className="h-9"
                loading={runner.busy && active === c.key}
                disabled={runner.busy}
                onClick={() => {
                  setActive(c.key);
                  void runner.run(c.call, c.from);
                }}
              >
                {c.action}
              </Button>
            </div>
            {active === c.key && runner.result && (
              <div className="mt-3">
                <GuardrailResultView result={runner.result} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
