"use client";

import { useParams } from "next/navigation";
import { BountyRow } from "@/components/bounty-row";
import { Avatar, Empty, LinkButton, Money, Notice, PageHeader, Skeleton, Tray } from "@/components/ui";
import { useReviewerProfile } from "@/lib/api/queries";

export default function ReviewerProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, error } = useReviewerProfile(id);
  if (isLoading) return <Skeleton className="h-64" />;
  if (error || !data) return <Notice tone="critical" title="This reviewer could not be loaded">{error?.message}</Notice>;
  const accepted = data.bounties.filter((b) => b.approval?.reviewer.id === id && !!b.chain.approved);
  const paid = accepted.filter((b) => !!b.chain.paid);
  const earned = paid.reduce((sum, b) => sum + BigInt(b.approval!.amountUnits), BigInt(0));
  const repositories = new Set(data.bounties.map((b) => b.repo.fullName)).size;
  return (
    <div className="space-y-4">
      <PageHeader title="Reviewer profile" lead="A public record of reviews and rewards on Merit." action={<LinkButton href="/open-source" variant="secondary">Find a bounty</LinkButton>} />
      <Tray tone="white">
        <div className="flex flex-wrap items-center gap-4"><Avatar user={data.user} size={64} /><div><h2 className="text-[26px] font-medium tracking-tight">{data.user.login}</h2>
          <a href={`https://github.com/${encodeURIComponent(data.user.login)}`} target="_blank" rel="noreferrer" className="text-[13px] text-accent-ink hover:underline">View GitHub profile</a></div></div>
        <dl className="mt-6 grid grid-cols-1 gap-5 border-t border-line pt-5 sm:grid-cols-3">
          <div><dt className="text-[13px] text-mut">Rewards received</dt><dd><Money units={earned} className="mt-1 text-[30px]" /></dd></div>
          <div><dt className="text-[13px] text-mut">Accepted reviews</dt><dd className="mt-1 font-mono text-[30px]">{accepted.length}</dd></div>
          <div><dt className="text-[13px] text-mut">Repositories reviewed</dt><dd className="mt-1 font-mono text-[30px]">{repositories}</dd></div>
        </dl>
        <p className="mt-4 text-[12px] text-mut">Earnings count indexed payouts only. Acceptance counts confirmed payout approvals. Testnet USDC has no monetary value.</p>
      </Tray>
      <Tray><h2 className="mb-3 text-[16px] font-medium">Public contributions</h2>
        {data.bounties.length ? <div className="space-y-2">{data.bounties.map((b) => <BountyRow key={b.id} bounty={b} hint={b.chain.paid && b.approval?.reviewer.id === id ? "Reward received · View payout receipt inside" : undefined} />)}</div>
          : <Empty title="No public reviews yet">Reviews on public repositories will appear here. Private repository activity is excluded.</Empty>}
      </Tray>
    </div>
  );
}
