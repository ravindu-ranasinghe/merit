import type { Metadata } from "next";
import Link from "next/link";
import { StatusPill, StatusRail } from "@/components/status";
import { GuardrailCard, Notice, PageHeader, Tray } from "@/components/ui";
import { ChainError, describeChainError } from "@/lib/chain/errors";
import { MOCK } from "@/lib/env";
import { ALL_STATUSES, STATUS_META } from "@/lib/status";

export const metadata: Metadata = { title: "All states" };

/** In mock mode each state links to the sample bounty that is in it. */
const SAMPLE: Record<string, string> = {
  paid: "b-101", refunded: "b-102", rejected: "b-103", expired: "b-104", claimable: "b-105",
  approved: "b-106", review_candidate: "b-107", funded: "b-108", funding_pending: "b-109", draft: "b-110",
};

const TEN = BigInt(10_000_000);

const REFUSALS: { when: string; error: ChainError }[] = [
  { when: "A reviewer claims a reward that was already paid", error: new ChainError("revert", "", "AlreadyClaimed", [BigInt(1)]) },
  { when: "A wallet that did not fund the bounty tries to approve a payout", error: new ChainError("revert", "", "NotFunder", [BigInt(7), "0x5a5a…5a5a"]) },
  { when: "An approval asks for more than the bounty holds", error: new ChainError("revert", "", "AmountExceedsBalance", [BigInt(7), TEN + BigInt(1), TEN]) },
  { when: "An approval arrives after the deadline", error: new ChainError("revert", "", "BountyExpired", [BigInt(4)]) },
];

export default function StatesPage() {
  return (
    <div>
      <PageHeader
        title="Every state, and every refusal"
        lead="A reference for the bounty status machine and the ways the system says no. Funded, Paid and Refunded are only ever shown after the escrow contract has confirmed them."
      />

      <div className="stagger grid grid-cols-1 gap-3 lg:grid-cols-2">
        {ALL_STATUSES.map((s, i) => (
          <Tray key={s} tone="white" style={{ "--i": i } as React.CSSProperties}>
            <div className="mb-5 flex items-center justify-between gap-3">
              <StatusPill status={s} />
              <span className="text-[12px] text-mut">
                {STATUS_META[s].onchain ? "Source of truth: escrow contract" : "Source of truth: GitHub and the Merit server"}
              </span>
            </div>
            <StatusRail status={s} />
            {MOCK && (
              <p className="mt-4 text-center text-[13px]">
                <Link href={`/bounties/${SAMPLE[s]}`} className="font-medium text-accent-ink hover:underline">
                  Open the sample bounty in this state
                </Link>
              </p>
            )}
          </Tray>
        ))}
      </div>

      <h2 className="mb-1 mt-10 px-1 text-[20px] font-medium">Refusals</h2>
      <p className="mb-4 max-w-[62ch] px-1 text-[14px] text-mut">
        These are rules of the escrow contract. When one is broken the contract refuses the transaction and no money
        moves. The app shows the refusal as what it is: a guardrail working.
      </p>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {REFUSALS.map(({ when, error }) => {
          const copy = describeChainError(error);
          return (
            <Tray key={error.errorName}>
              <p className="mb-3 text-[13px] font-medium text-ink-2">{when}</p>
              <GuardrailCard title={copy.title} body={copy.body} code={copy.code} />
            </Tray>
          );
        })}
        <Tray className="lg:col-span-2">
          <p className="mb-3 text-[13px] font-medium text-ink-2">
            Someone who is not a maintainer of the repository tries to approve, before any wallet is involved
          </p>
          <Notice tone="critical" title="You are not a maintainer of this repository, so you cannot approve this payout">
            The Merit server re-checks GitHub permission at approval time, by GitHub user ID. It never trusts a role sent by
            the browser.
          </Notice>
        </Tray>
      </div>
    </div>
  );
}
