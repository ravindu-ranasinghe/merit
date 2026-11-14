"use client";

import { BountyRow } from "@/components/bounty-row";
import { RequireSignIn } from "@/components/sign-in";
import { Empty, Money, Notice, PageHeader, Roll, Skeleton, Tray } from "@/components/ui";
import { WalletLinkCard } from "@/components/wallet";
import { useBounties, useWalletLink } from "@/lib/api/queries";
import type { Bounty } from "@/lib/api/types";
import { useViewer } from "@/lib/viewer";

function Group({ title, note, bounties, hint }: { title: string; note: string; bounties: Bounty[]; hint?: string }) {
  if (bounties.length === 0) return null;
  return (
    <section>
      <h2 className="text-[15px] font-semibold">
        {title} <span className="ml-1 font-normal text-mut">{bounties.length}</span>
      </h2>
      <p className="mb-2.5 mt-0.5 text-[13px] text-mut">{note}</p>
      <div className="space-y-2">
        {bounties.map((b) => (
          <BountyRow key={b.id} bounty={b} hint={hint} />
        ))}
      </div>
    </section>
  );
}

function Dashboard() {
  const { user } = useViewer();
  const bounties = useBounties("reviewed-by-me");
  const link = useWalletLink();
  const list = bounties.data ?? [];

  const mine = (b: Bounty) => b.approval?.reviewer.id === user?.id;
  const claimable = list.filter((b) => b.status === "claimable" && mine(b));
  const paid = list.filter((b) => b.status === "paid" && mine(b));
  const pending = list.filter((b) => ["review_candidate", "approved"].includes(b.status));
  const closed = list.filter((b) => !claimable.includes(b) && !paid.includes(b) && !pending.includes(b));
  const total = (xs: Bounty[]) => xs.reduce((t, b) => t + BigInt(b.approval?.amountUnits ?? "0"), BigInt(0)).toString();

  return (
    <div>
      <PageHeader
        title="Reviewer dashboard"
        lead="Bounties on pull requests you reviewed. A maintainer decides whether a review earned the reward; you claim it once they approve."
      />

      <div className="stagger grid grid-cols-1 gap-3 md:grid-cols-12">
        <Tray tone={link.data ? "tray" : "white"} className="md:col-span-6" style={{ "--i": 0 } as React.CSSProperties}>
          {link.isLoading ? <Skeleton className="h-28" /> : <WalletLinkCard />}
        </Tray>
        <Tray tone={claimable.length > 0 ? "dark" : "white"} className="md:col-span-3" style={{ "--i": 1 } as React.CSSProperties}>
          <p className={claimable.length > 0 ? "text-[12.5px] font-medium text-[#b9b9c0]" : "text-[12.5px] font-medium text-mut"}>Ready to claim</p>
          <Money units={total(claimable)} className="mt-1 text-[30px]" unitClassName={claimable.length > 0 ? "!text-[#b9b9c0]" : undefined} />
          <p className={claimable.length > 0 ? "mt-1 text-[12.5px] text-[#b9b9c0]" : "mt-1 text-[12.5px] text-mut"}>
            <Roll text={String(claimable.length)} /> approved, not yet claimed
          </p>
        </Tray>
        <Tray tone="white" className="md:col-span-3" style={{ "--i": 2 } as React.CSSProperties}>
          <p className="text-[12.5px] font-medium text-mut">Claimed so far</p>
          <Money units={total(paid)} className="mt-1 text-[30px]" />
          <p className="mt-1 text-[12.5px] text-mut">Testnet USDC, {paid.length} paid</p>
        </Tray>

        <Tray className="md:col-span-12" style={{ "--i": 3 } as React.CSSProperties}>
          {bounties.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          ) : bounties.error ? (
            <Notice tone="critical" title="Your bounties could not be loaded">{bounties.error.message}</Notice>
          ) : list.length === 0 ? (
            <Empty title="No bounties on pull requests you reviewed">
              When you review a pull request that has a funded bounty, and your comment is followed by a fix, it shows up
              here.
            </Empty>
          ) : (
            <div className="space-y-6">
              <Group title="Ready to claim" note="The maintainer approved your review and the contract confirmed it." bounties={claimable} hint="Claim your reward" />
              <Group title="In review" note="Your review is a candidate, or an approval is being confirmed." bounties={pending} hint={link.data ? undefined : "Link a payout wallet so this can be approved"} />
              <Group title="Paid" note="Rewards you claimed, with their transactions." bounties={paid} />
              <Group title="Closed" note="Bounties that ended without a payout to you." bounties={closed} />
            </div>
          )}
        </Tray>
      </div>
    </div>
  );
}

export default function ReviewerPage() {
  return (
    <RequireSignIn why="Merit matches bounties to the reviews you left, using your GitHub account.">
      <Dashboard />
    </RequireSignIn>
  );
}
