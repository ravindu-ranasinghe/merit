"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { CopyButton } from "@/components/copy-button";
import { useSiteOrigin } from "@/components/bounty-share";
import { PaymentRecord } from "@/components/payment-record";
import { ReviewTimeline } from "@/components/review-timeline";
import { AddressLink, LinkButton, Money, Notice, PageHeader, Pill, Row, Skeleton, Tray, TxLink, UserChip } from "@/components/ui";
import { escrowAmounts } from "@/lib/accounting";
import type { Bounty } from "@/lib/api/types";
import { useBounty } from "@/lib/api/queries";
import { escrowContractAddress } from "@/lib/chain/hooks";
import { formatDate, formatUsdc } from "@/lib/format";
import { useNow } from "@/lib/now";

/**
 * One page, two kinds of receipt. A payout receipt needs an indexed RewardPaid matched to a confirmed approval.
 * A refund receipt needs an indexed BountyRefunded. A partial refund (the funder got back what was never approved)
 * appears alongside the payout, or on its own while the approved reward is still waiting to be claimed.
 */
export default function ReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const { data: b, isLoading, error } = useBounty(id);
  const origin = useSiteOrigin();
  if (isLoading) return <Skeleton className="mx-auto h-96 max-w-3xl" />;
  if (error || !b) return <Notice tone="critical" title="Receipt could not be loaded">{error?.message}</Notice>;

  const share = (
    <div className="flex flex-wrap gap-3">
      <CopyButton value={`${origin}/bounties/${id}/receipt`} label="Copy receipt link" />
      <LinkButton href={`/bounties/${id}`} variant="secondary">View bounty</LinkButton>
    </div>
  );

  if (b.chain.paid && b.approval) return <PayoutReceipt b={b} share={share} />;
  if (b.chain.refunded) return <RefundReceipt b={b} share={share} />;
  return (
    <Tray tone="white" className="mx-auto max-w-xl">
      <h1 className="text-[24px] font-medium">{b.chain.paid ? "Payout details are still being matched" : "No payout or refund yet"}</h1>
      <p className="my-4 text-mut">{b.chain.paid
        ? "A payout was indexed. Its recipient and claim must match a confirmed review approval before Merit can issue a receipt."
        : "A receipt becomes available once the indexed contract event confirms a payout to the reviewer or a refund to the funder."}</p>
      <LinkButton href={`/bounties/${id}`}>View bounty</LinkButton>
    </Tray>
  );
}

function PrHeading({ b }: { b: Bounty }) {
  return (
    <>
      <a href={b.pr.url} target="_blank" rel="noreferrer" className="mt-5 block text-[20px] font-medium hover:underline">{b.pr.title}</a>
      <p className="mt-1 text-[13px] text-mut">{b.repo.fullName} #{b.pr.number}</p>
    </>
  );
}

function NetworkRows() {
  return (
    <>
      <Row label="Network">Arc testnet · Chain 5042002</Row>
      {escrowContractAddress && <Row label="Escrow"><AddressLink address={escrowContractAddress} /></Row>}
    </>
  );
}

function PayoutReceipt({ b, share }: { b: Bounty; share: React.ReactNode }) {
  const approval = b.approval!, paid = b.chain.paid!, refunded = b.chain.refunded;
  const review = b.candidates.find((c) => c.id === approval.candidateId);
  const a = escrowAmounts(b, useNow());
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="A good catch, rewarded." lead="A shareable record of a code review and its confirmed payout." />
      <Tray tone="white">
        <div className="flex flex-wrap items-center justify-between gap-3"><Pill tone="good">Payout confirmed on Arc</Pill><span className="font-mono text-[12px] text-mut">Bounty #{b.onchainBountyId}</span></div>
        <Money units={approval.amountUnits} className="mt-5 text-[48px]" />
        <p className="mt-3 flex flex-wrap items-center gap-2 text-[14px]">Paid to <Link href={`/reviewers/${approval.reviewer.id}`} className="hover:underline"><UserChip user={approval.reviewer} size={25} /></Link></p>
        <PrHeading b={b} />
        {review && <blockquote className="mt-4 whitespace-pre-wrap break-words border-l-2 border-accent pl-4 text-[14px]">{review.commentBody}<a href={review.commentUrl} target="_blank" rel="noreferrer" className="mt-2 block text-[12px] text-accent-ink hover:underline">Read the review on GitHub</a></blockquote>}
        <dl className="mt-5 divide-y divide-line border-y border-line py-2">
          <Row label="Recipient"><AddressLink address={approval.approvedRecipient} /></Row>
          <Row label="Payout transaction"><TxLink hash={paid.txHash} /></Row>
          <Row label="Indexed on">{formatDate(paid.at)}</Row>
          {refunded && <Row label="Returned to funder">{formatUsdc(a.refunded)} · <TxLink hash={refunded.txHash} /></Row>}
          <NetworkRows />
        </dl>
        {refunded && <p className="mt-4 text-[13px] text-ink-2">The funder escrowed {formatUsdc(a.funded)}. After the deadline, the {formatUsdc(a.refunded)} that was never approved went back to the funding wallet.</p>}
        <p className="my-4 text-[12px] text-mut">Testnet USDC has no monetary value. This receipt records a testnet payout; review usefulness was assessed by the maintainer.</p>
        {share}
      </Tray>
      <Tray><PaymentRecord bounty={b} /></Tray>
      <Tray><ReviewTimeline bounty={b} /></Tray>
    </div>
  );
}

function RefundReceipt({ b, share }: { b: Bounty; share: React.ReactNode }) {
  const refunded = b.chain.refunded!;
  const a = escrowAmounts(b, useNow());
  // An approval confirmed onchain (RewardApproved) is committed to the reviewer: the refund can never touch it.
  const reserved = a.approved > BigInt(0) ? { amount: a.approved, reviewer: b.approval?.reviewer ?? null } : null;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        title={reserved ? "Unapproved funds, returned." : "An unused reward, returned."}
        lead="A shareable record of an expired bounty and its confirmed refund to the funder."
      />
      <Tray tone="white">
        <div className="flex flex-wrap items-center justify-between gap-3"><Pill tone="neutral">Refund confirmed on Arc</Pill><span className="font-mono text-[12px] text-mut">Bounty #{b.onchainBountyId}</span></div>
        <Money units={a.refunded} className="mt-5 text-[48px]" />
        <p className="mt-3 flex flex-wrap items-center gap-2 text-[14px]">
          Returned to <UserChip user={b.funder} size={25} />
          {b.funderWallet && <span className="text-mut">at <AddressLink address={b.funderWallet} /></span>}
        </p>
        <PrHeading b={b} />
        <p className="mt-4 text-[14px] text-ink-2">
          {reserved
            ? <>The deadline passed on {formatDate(b.deadline)}. The maintainer had already approved part of the reward, so only the unapproved remainder came back.</>
            : <>The deadline passed on {formatDate(b.deadline)} without an approved payout, so the full reward came back.</>}
          {" "}The contract cannot act on a clock: someone sent the refund transaction, and the escrow only ever returns these funds to the wallet that deposited them.
        </p>
        {reserved && (
          <div className="mt-4 rounded-card bg-card px-4 py-3 shadow-inner-card">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="flex flex-wrap items-center gap-2 text-[14px]">
                {formatUsdc(reserved.amount)} stays reserved for {reserved.reviewer ? <UserChip user={reserved.reviewer} size={20} /> : "the approved reviewer"}
              </span>
              <Pill tone={b.chain.paid ? "good" : "neutral"}>{b.chain.paid ? "Claimed" : "Waiting to be claimed"}</Pill>
            </div>
            <p className="mt-1 text-[12px] text-mut">An approved reward is committed onchain. It cannot be refunded, and the reviewer can claim it even after the deadline.</p>
          </div>
        )}
        <dl className="mt-5 divide-y divide-line border-y border-line py-2">
          <Row label="Funded">{formatUsdc(a.funded)}{b.chain.funded && <> · <TxLink hash={b.chain.funded.txHash} /></>}</Row>
          {reserved && <Row label="Approved for the reviewer">{formatUsdc(reserved.amount)}</Row>}
          <Row label="Refunded">{formatUsdc(a.refunded)}</Row>
          <Row label="Deadline">{formatDate(b.deadline)}</Row>
          <Row label="Refund transaction"><TxLink hash={refunded.txHash} /></Row>
          <Row label="Indexed on">{formatDate(refunded.at)}</Row>
          <NetworkRows />
        </dl>
        <p className="my-4 text-[12px] text-mut">Testnet USDC has no monetary value. This receipt records a testnet refund confirmed by the indexed contract event.</p>
        {share}
      </Tray>
      <Tray><PaymentRecord bounty={b} /></Tray>
      <Tray><ReviewTimeline bounty={b} /></Tray>
    </div>
  );
}
