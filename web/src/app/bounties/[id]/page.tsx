"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { BountyActions } from "@/components/bounty-actions";
import { EventFeed } from "@/components/event-feed";
import { EvidenceCard } from "@/components/evidence";
import { checksFor, GuardrailPanel } from "@/components/guardrails";
import { IconExternal, IconGithub } from "@/components/icons";
import { StatusRail } from "@/components/status";
import { AddressLink, BlockLink, Button, LinkButton, Money, Row, Skeleton, Tray, TxLink, UserChip } from "@/components/ui";
import { useBounty, useRejectCandidate } from "@/lib/api/queries";
import type { Bounty, ReviewCandidate } from "@/lib/api/types";
import { escrowContractAddress } from "@/lib/chain/hooks";
import { formatDate, formatUsdc, relativeTime } from "@/lib/format";
import { useNow } from "@/lib/now";
import { useViewer } from "@/lib/viewer";

function CandidateActions({ bounty, candidate }: { bounty: Bounty; candidate: ReviewCandidate }) {
  const reject = useRejectCandidate();
  if (candidate.status !== "candidate") return null;
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
      {candidate.reviewerWallet ? (
        <LinkButton href={`/bounties/${bounty.id}/approve/${candidate.id}`} variant="accent">
          Review and approve payout
        </LinkButton>
      ) : (
        <p className="text-[13px] text-mut">
          {candidate.reviewer.login} has not linked a payout wallet yet, so this review cannot be approved for payment.
        </p>
      )}
      <Button
        variant="ghost"
        loading={reject.isPending}
        onClick={() => reject.mutate({ bountyId: bounty.id, candidateId: candidate.id })}
      >
        Does not qualify
      </Button>
      {reject.error && <p className="w-full text-[13px] text-crit">{reject.error.message}</p>}
    </div>
  );
}

export default function BountyPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useViewer();
  // After the user sends a transaction, poll quickly until the indexed event lands.
  const [watching, setWatching] = useState(false);
  const now = useNow();
  const { data: bounty, isLoading, error } = useBounty(id, watching);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-48 !rounded-tray" />
        <Skeleton className="h-64 !rounded-tray" />
      </div>
    );
  }
  if (error || !bounty) {
    return (
      <Tray tone="white" className="mx-auto max-w-xl text-center">
        <h1 className="text-[20px] font-medium">This bounty could not be loaded</h1>
        <p className="mt-2 text-mut">{error?.message ?? "It may not exist."}</p>
        <div className="mt-4 flex justify-center">
          <LinkButton href="/maintainer" variant="secondary">Back to dashboard</LinkButton>
        </div>
      </Tray>
    );
  }

  const isFunder = !!user && user.id === bounty.funder.id;
  const expiredAt = new Date(bounty.deadline).getTime() < now;
  const c = bounty.chain;

  return (
    <div className="stagger grid grid-cols-1 gap-3 lg:grid-cols-12">
      {/* Header: what, how much, and where it is in the flow */}
      <Tray tone="white" className="lg:col-span-12" style={{ "--i": 0 } as React.CSSProperties}>
        <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
          <div className="min-w-0 flex-1 basis-80">
            <a
              href={bounty.pr.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-[13px] font-medium text-mut hover:text-ink"
            >
              <IconGithub size={14} />
              {bounty.repo.fullName} #{bounty.pr.number}
              <IconExternal size={12} />
            </a>
            <h1 className="mt-2 text-[24px] font-medium leading-tight tracking-[-0.025em] sm:text-[28px]">{bounty.pr.title}</h1>
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-mut">
              Review bounty funded by <UserChip user={bounty.funder} className="text-ink" />
              <span aria-hidden>·</span>
              PR by <UserChip user={bounty.pr.author} className="text-ink" />
            </p>
          </div>
          <div className="text-left sm:text-right">
            <Money units={bounty.amountUnits} className="text-[40px] leading-none" />
            <p className="mt-2 text-[13px] text-mut">
              {expiredAt ? `Deadline passed ${relativeTime(bounty.deadline)}` : `Open until ${formatDate(bounty.deadline)}`}
            </p>
          </div>
        </div>
        <StatusRail status={bounty.status} className="mt-7" />
      </Tray>

      <div className="space-y-3 lg:col-span-7" style={{ "--i": 1 } as React.CSSProperties}>
        {/* What happens next */}
        <Tray>
          <BountyActions bounty={bounty} onSent={() => setWatching(true)} />
        </Tray>

        {/* Evidence */}
        {bounty.candidates.length > 0 && (
          <Tray>
            <h2 className="text-[16px] font-medium">Review evidence</h2>
            <p className="mt-1 text-[13px] text-mut">
              What GitHub shows about each review. The maintainer reads it and decides; Merit does not score reviews.
            </p>
            <div className="mt-3 space-y-3">
              {bounty.candidates.map((cand) => (
                <EvidenceCard
                  key={cand.id}
                  candidate={cand}
                  footer={isFunder && bounty.status === "review_candidate" ? <CandidateActions bounty={bounty} candidate={cand} /> : undefined}
                />
              ))}
            </div>
          </Tray>
        )}
      </div>

      <div className="space-y-3 lg:col-span-5" style={{ "--i": 2 } as React.CSSProperties}>
        {/* The money, in plain words; chain detail on demand */}
        <Tray>
          <h2 className="text-[16px] font-medium">The reward</h2>
          <dl className="mt-2 divide-y divide-line/70">
            <Row label="Amount">{formatUsdc(bounty.amountUnits)}</Row>
            <Row label="Held in escrow since">{c.funded ? formatDate(c.funded.at) : "Not funded yet"}</Row>
            <Row label="Deadline">{formatDate(bounty.deadline)}</Row>
            <Row label="Approved for">
              {bounty.approval ? <UserChip user={bounty.approval.reviewer} size={18} /> : <span className="text-mut">No one yet</span>}
            </Row>
            <Row label="Pays">One reviewer, once</Row>
          </dl>
          <details className="group mt-3 rounded-card bg-card px-4 py-3 shadow-inner-card">
            <summary className="cursor-pointer list-none text-[13px] font-medium text-ink-2 marker:hidden">
              <span className="mr-2 inline-block transition-transform duration-300 ease-soft group-open:rotate-90">›</span>
              Onchain details
            </summary>
            <dl className="mt-2 divide-y divide-line/70">
              <Row label="Network">Arc testnet</Row>
              <Row label="Escrow contract">
                {escrowContractAddress ? <AddressLink address={escrowContractAddress} /> : <span className="text-mut">Not deployed yet</span>}
              </Row>
              <Row label="Onchain bounty">{bounty.onchainBountyId ? `#${bounty.onchainBountyId}` : <span className="text-mut">None yet</span>}</Row>
              {bounty.funderWallet && <Row label="Funder wallet"><AddressLink address={bounty.funderWallet} /></Row>}
              {bounty.approval && <Row label="Approved recipient"><AddressLink address={bounty.approval.approvedRecipient} /></Row>}
              {c.funded && <Row label="Funding"><TxRefView tx={c.funded} /></Row>}
              {c.approved && <Row label="Approval"><TxRefView tx={c.approved} /></Row>}
              {c.paid && <Row label="Payout"><TxRefView tx={c.paid} /></Row>}
              {c.refunded && <Row label="Refund"><TxRefView tx={c.refunded} /></Row>}
            </dl>
          </details>
        </Tray>

        {bounty.onchainBountyId && (
          <Tray>
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-[16px] font-medium">Indexed events</h2>
              <Link href="/events" className="text-[13px] font-medium text-accent-ink hover:underline">Full feed</Link>
            </div>
            <p className="mb-3 mt-1 text-[13px] text-mut">Contract events for this bounty, as the indexer delivered them.</p>
            <EventFeed bountyId={bounty.id} compact />
          </Tray>
        )}
        {checksFor(bounty).length > 0 && (
          <Tray>
            <GuardrailPanel bounty={bounty} />
          </Tray>
        )}
      </div>
    </div>
  );
}

function TxRefView({ tx }: { tx: { txHash: string; blockNumber: number | null } }) {
  return (
    <span className="inline-flex items-center gap-2">
      <TxLink hash={tx.txHash} />
      {tx.blockNumber !== null && (
        <span className="text-[12px] text-mut">
          block <BlockLink block={tx.blockNumber} />
        </span>
      )}
    </span>
  );
}
