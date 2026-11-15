"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { EvidenceCard } from "@/components/evidence";
import { IconLock, IconShield } from "@/components/icons";
import { ChainErrorView, TxProgress } from "@/components/tx";
import { AddressLink, Button, LinkButton, Money, Notice, PageHeader, Skeleton, Tray, UserChip } from "@/components/ui";
import { WalletGate } from "@/components/wallet";
import { ApiError } from "@/lib/api/client";
import { useBounty, usePrepareApproval, useReportApprovalTx } from "@/lib/api/queries";
import { ChainError } from "@/lib/chain/errors";
import { useApproveReward, useWallet } from "@/lib/chain/hooks";
import { formatDate, formatUsd, formatUsdc, parseUsdToUnits } from "@/lib/format";
import { useNow } from "@/lib/now";
import { useViewer } from "@/lib/viewer";

/** Shown to anyone who is not the maintainer who funded this bounty. */
function NotAllowed({ bountyId, serverMessage }: { bountyId: string; serverMessage?: string }) {
  return (
    <Tray tone="dark" className="mx-auto max-w-2xl animate-rise">
      <p className="flex items-center gap-2 text-[13px] font-medium text-[#4cc38a]">
        <IconShield size={15} />
        Approval blocked
      </p>
      <h1 className="mt-2 text-[24px] font-medium tracking-[-0.02em]">You can&apos;t approve this payout</h1>
      <p className="mt-2 text-[14px] leading-relaxed text-[#a1a1a6]">
        {serverMessage ?? "Only the maintainer who funded this bounty can approve a payout from it."} This is checked in
        two places, and neither one trusts this page:
      </p>
      <ul className="mt-4 space-y-3 text-[14px] text-[#ededed]">
        <li className="rounded-card bg-white/[0.07] px-4 py-3">
          <strong className="font-medium text-white">The Merit server</strong> re-checks your GitHub permission on the
          repository at the moment of approval, using your GitHub user ID.
        </li>
        <li className="rounded-card bg-white/[0.07] px-4 py-3">
          <strong className="font-medium text-white">The escrow contract</strong> accepts an approval only from the wallet
          that funded the bounty. Any other wallet is refused with <span className="font-mono text-[12px]">NotFunder</span>.
        </li>
      </ul>
      <div className="mt-5">
        <LinkButton href={`/bounties/${bountyId}`} variant="secondary">Back to the bounty</LinkButton>
      </div>
    </Tray>
  );
}

export default function ApprovePage() {
  const { id, candidateId } = useParams<{ id: string; candidateId: string }>();
  const router = useRouter();
  const { user, loading: viewerLoading } = useViewer();
  const wallet = useWallet();
  const [watching, setWatching] = useState(false);
  const now = useNow();
  const { data: bounty, isLoading } = useBounty(id, watching);

  const prepare = usePrepareApproval();
  const tx = useApproveReward();
  const report = useReportApprovalTx();

  const [dollars, setDollars] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  if (isLoading || viewerLoading) return <Skeleton className="h-96 !rounded-tray" />;
  if (!bounty) {
    return <Notice tone="critical" title="This bounty could not be loaded" />;
  }

  const candidate = bounty.candidates.find((c) => c.id === candidateId);
  const isFunder = !!user && user.id === bounty.funder.id;
  const forbidden = prepare.error instanceof ApiError && prepare.error.code === "forbidden";

  if (!isFunder || forbidden) {
    return <NotAllowed bountyId={bounty.id} serverMessage={forbidden ? prepare.error?.message : undefined} />;
  }
  if (!candidate) {
    return <Notice tone="critical" title="That review is not part of this bounty" />;
  }

  const sent = tx.phase === "done";
  const expired = new Date(bounty.deadline).getTime() < now;
  const decidable = bounty.status === "review_candidate" && candidate.status === "candidate";

  const input = dollars ?? formatUsd(bounty.amountUnits).slice(1);
  const units = parseUsdToUnits(input);
  const overBudget = units !== null && BigInt(units) > BigInt(bounty.amountUnits);
  const invalid = units === null || BigInt(units) === BigInt(0);
  const remainder = units && !overBudget ? (BigInt(bounty.amountUnits) - BigInt(units)).toString() : "0";
  const wrongWallet =
    !!wallet.address && !!bounty.funderWallet && wallet.address.toLowerCase() !== bounty.funderWallet.toLowerCase();

  const approve = async () => {
    if (!units) return;
    const prepared = await prepare.mutateAsync({ bountyId: bounty.id, candidateId: candidate.id, amountUnits: units }).catch(() => null);
    if (!prepared) return;
    const result = await tx.run(prepared);
    if (!result) return;
    setWatching(true);
    await report.mutateAsync({ bountyId: bounty.id, txHash: result.hash }).catch(() => null);
    router.push(`/bounties/${bounty.id}`);
  };

  return (
    <div>
      <PageHeader
        eyebrow={
          <Link href={`/bounties/${bounty.id}`} className="hover:text-ink">
            ← {bounty.repo.fullName} #{bounty.pr.number}
          </Link>
        }
        title="Approve a payout"
        lead="This is the decision the whole system rests on. Read what you are authorizing; it cannot be changed afterwards."
      />

      {!decidable && !sent && (
        <Notice tone="warning" className="mb-3" title="This review can no longer be approved">
          {bounty.approval
            ? "A payout was already approved for this bounty. One bounty pays one reviewer, once."
            : "This review is no longer waiting for a decision."}
        </Notice>
      )}
      {expired && decidable && (
        <Notice tone="warning" className="mb-3" title="This bounty has expired">
          The deadline passed on {formatDate(bounty.deadline)}. The contract refuses approvals after the deadline; the funds
          can be refunded to you instead.
        </Notice>
      )}

      <div className="stagger grid grid-cols-1 gap-3 lg:grid-cols-12">
        <Tray tone="white" className="lg:col-span-7" style={{ "--i": 0 } as React.CSSProperties}>
          <p className="text-[13px] font-medium text-mut">You are authorizing</p>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-card bg-bg px-4 py-4">
              <p className="text-[12px] text-mut">Pay</p>
              <Money units={units && !overBudget ? units : bounty.amountUnits} className="mt-0.5 text-[32px] leading-tight" />
              <label className="mt-2 block text-[12px] text-mut" htmlFor="amount">
                Amount in dollars (this bounty holds {formatUsd(bounty.amountUnits)})
              </label>
              <div className="mt-1 flex h-10 items-center rounded-ctl bg-card px-3 shadow-knob focus-within:shadow-[inset_0_0_0_2px_var(--color-accent)]">
                <span className="text-mut">$</span>
                <input
                  id="amount"
                  inputMode="decimal"
                  value={input}
                  disabled={!decidable || tx.busy || sent}
                  onChange={(e) => setDollars(e.target.value)}
                  aria-invalid={overBudget || invalid}
                  aria-describedby="amount-help"
                  className="w-full bg-transparent px-2 text-[16px] font-medium outline-none"
                />
                <span className="text-[12px] text-mut">USDC</span>
              </div>
            </div>

            <div className="rounded-card bg-bg px-4 py-4">
              <p className="text-[12px] text-mut">To</p>
              <UserChip user={candidate.reviewer} size={28} className="mt-1 text-[18px] font-medium" />
              <p className="mt-2 text-[12px] text-mut">Their linked payout wallet</p>
              {candidate.reviewerWallet ? (
                <AddressLink address={candidate.reviewerWallet} full className="mt-0.5" />
              ) : (
                <p className="mt-0.5 text-[13px] text-crit">No wallet linked</p>
              )}
            </div>
          </div>

          <div id="amount-help" className="mt-3">
            {overBudget && units && (
              <Notice tone="critical" title="Over budget">
                {formatUsdc(units)} is more than the {formatUsdc(bounty.amountUnits)} this bounty holds. The escrow contract
                rejects any payout larger than what was escrowed.
              </Notice>
            )}
            {invalid && <Notice tone="critical" title="Enter an amount greater than zero, in dollars and cents" />}
            {!overBudget && !invalid && remainder !== "0" && (
              <Notice tone="neutral">
                The remaining {formatUsdc(remainder)} stays in escrow and can be refunded to you after the deadline.
              </Notice>
            )}
          </div>

          <p className="mb-2 mt-5 text-[13px] font-medium text-mut">For this review</p>
          <EvidenceCard candidate={candidate} />
        </Tray>

        <div className="space-y-3 lg:col-span-5" style={{ "--i": 1 } as React.CSSProperties}>
          <Tray>
            <h2 className="text-[16px] font-medium">What happens when you sign</h2>
            <ol className="mt-3 space-y-3 text-[14px] text-ink-2">
              {[
                "Your wallet signs one approval on the escrow contract.",
                `${units && !overBudget && !invalid ? formatUsdc(units) : "The amount"} is committed to ${candidate.reviewer.login}. No money moves until they claim it.`,
                "The approval is final. It cannot be changed, withdrawn or refunded, and this bounty cannot pay anyone else.",
              ].map((t, i) => (
                <li key={i} className="flex gap-3">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-card text-[12px] font-medium shadow-knob">{i + 1}</span>
                  {t}
                </li>
              ))}
            </ol>
          </Tray>

          <Tray tone="dark">
            <p className="flex items-center gap-2 text-[14px] font-medium">
              <IconLock size={15} />
              You are the one authorizing this
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-[#a1a1a6]">
              Merit&apos;s server prepared this request from GitHub data, but it holds no key that can move money and it has
              not judged the review. The escrow contract acts only on a signature from the wallet that funded this bounty.
            </p>
            {bounty.funderWallet && (
              <p className="mt-3 text-[12px] text-[#a1a1a6]">
                Funding wallet <span className="font-mono text-[#ededed]">{bounty.funderWallet}</span>
              </p>
            )}
          </Tray>

          <Tray tone="white">
            <label className="flex cursor-pointer items-start gap-3 text-[14px]">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={!decidable || tx.busy || sent}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-0.5 size-4.5 accent-(--color-accent)"
              />
              <span>
                I read this review and the change it led to, and I want to pay{" "}
                <strong className="font-medium">{candidate.reviewer.login}</strong> for it.
              </span>
            </label>

            {wrongWallet && (
              <Notice tone="warning" className="mt-3" title="This is not the wallet that funded the bounty">
                The contract will refuse an approval from this wallet. Switch to the funding wallet.
              </Notice>
            )}

            <div className="mt-4 space-y-3">
              {!sent && (
                <WalletGate reason="Connect the wallet that funded this bounty.">
                  <Button
                    variant="accent"
                    className="w-full"
                    disabled={!decidable || expired || !confirmed || overBudget || invalid || !candidate.reviewerWallet}
                    loading={prepare.isPending || tx.busy}
                    onClick={approve}
                  >
                    {units && !overBudget && !invalid
                      ? `Approve ${formatUsdc(units)} for ${candidate.reviewer.login}`
                      : "Approve payout"}
                  </Button>
                </WalletGate>
              )}
              <TxProgress phase={tx.phase} hash={tx.hash} error={tx.error} indexedLabel="Taking you back to the bounty." />
              {prepare.error && !forbidden && (
                prepare.error instanceof ChainError ? (
                  <ChainErrorView error={prepare.error} />
                ) : (
                  <Notice tone="critical" title="The approval could not be prepared">{prepare.error.message}</Notice>
                )
              )}
            </div>
          </Tray>
        </div>
      </div>
    </div>
  );
}
