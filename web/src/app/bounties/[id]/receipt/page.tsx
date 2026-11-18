"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { CopyButton } from "@/components/copy-button";
import { useSiteOrigin } from "@/components/bounty-share";
import { PaymentRecord } from "@/components/payment-record";
import { ReviewTimeline } from "@/components/review-timeline";
import { AddressLink, LinkButton, Money, Notice, PageHeader, Pill, Row, Skeleton, Tray, TxLink, UserChip } from "@/components/ui";
import { useBounty } from "@/lib/api/queries";
import { escrowContractAddress } from "@/lib/chain/hooks";
import { formatDate } from "@/lib/format";

export default function ReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const { data: b, isLoading, error } = useBounty(id);
  const origin = useSiteOrigin();
  if (isLoading) return <Skeleton className="mx-auto h-96 max-w-3xl" />;
  if (error || !b) return <Notice tone="critical" title="Receipt could not be loaded">{error?.message}</Notice>;
  if (!b.chain.paid || !b.approval) return (
    <Tray tone="white" className="mx-auto max-w-xl">
      <h1 className="text-[24px] font-medium">{b.chain.paid ? "Payout details are still being matched" : "This reward has not been paid yet"}</h1>
      <p className="my-4 text-mut">{b.chain.paid
        ? "A payout was indexed. Its recipient and claim must match a confirmed review approval before Merit can issue a receipt."
        : "A receipt becomes available after the payout is confirmed by the indexed contract event."}</p>
      <LinkButton href={`/bounties/${id}`}>View bounty</LinkButton>
    </Tray>
  );
  const review = b.candidates.find((c) => c.id === b.approval!.candidateId);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="A good catch, rewarded." lead="A shareable record of a code review and its confirmed payout." />
      <Tray tone="white">
        <div className="flex flex-wrap items-center justify-between gap-3"><Pill tone="good">Payout confirmed on Arc</Pill><span className="font-mono text-[12px] text-mut">Bounty #{b.onchainBountyId}</span></div>
        <Money units={b.approval.amountUnits} className="mt-5 text-[48px]" />
        <p className="mt-3 flex flex-wrap items-center gap-2 text-[14px]">Paid to <Link href={`/reviewers/${b.approval.reviewer.id}`} className="hover:underline"><UserChip user={b.approval.reviewer} size={25} /></Link></p>
        <a href={b.pr.url} target="_blank" rel="noreferrer" className="mt-5 block text-[20px] font-medium hover:underline">{b.pr.title}</a>
        <p className="mt-1 text-[13px] text-mut">{b.repo.fullName} #{b.pr.number}</p>
        {review && <blockquote className="mt-4 whitespace-pre-wrap break-words border-l-2 border-accent pl-4 text-[14px]">{review.commentBody}<a href={review.commentUrl} target="_blank" rel="noreferrer" className="mt-2 block text-[12px] text-accent-ink hover:underline">Read the review on GitHub</a></blockquote>}
        <dl className="mt-5 divide-y divide-line border-y border-line py-2">
          <Row label="Recipient"><AddressLink address={b.approval.approvedRecipient} /></Row>
          <Row label="Payout transaction"><TxLink hash={b.chain.paid.txHash} /></Row>
          <Row label="Indexed on">{formatDate(b.chain.paid.at)}</Row>
          <Row label="Network">Arc testnet · Chain 5042002</Row>
          {escrowContractAddress && <Row label="Escrow"><AddressLink address={escrowContractAddress} /></Row>}
        </dl>
        <p className="my-4 text-[12px] text-mut">Testnet USDC has no monetary value. This receipt records a testnet payout; review usefulness was assessed by the maintainer.</p>
        <div className="flex flex-wrap gap-3"><CopyButton value={`${origin}/bounties/${id}/receipt`} label="Copy receipt link" /><LinkButton href={`/bounties/${id}`} variant="secondary">View bounty</LinkButton></div>
      </Tray>
      <Tray><PaymentRecord bounty={b} /></Tray>
      <Tray><ReviewTimeline bounty={b} /></Tray>
    </div>
  );
}
