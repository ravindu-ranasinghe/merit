"use client";

import { BountyRow } from "@/components/bounty-row";
import { IconExternal, IconGithub, IconPlus } from "@/components/icons";
import { RequireSignIn } from "@/components/sign-in";
import { Empty, LinkButton, Money, Notice, PageHeader, Roll, Skeleton, Tray } from "@/components/ui";
import { useBounties, useRepositories } from "@/lib/api/queries";
import type { Bounty, BountyStatus } from "@/lib/api/types";
import { GITHUB_APP_SLUG, MOCK } from "@/lib/env";

/** Statuses where the contract still holds this bounty's money. */
const HOLDING: BountyStatus[] = ["funded", "review_candidate", "approved", "claimable", "expired", "rejected"];

const sum = (list: Bounty[]) => list.reduce((t, b) => t + BigInt(b.amountUnits), BigInt(0)).toString();

const ORDER: BountyStatus[] = ["review_candidate", "draft", "expired", "funding_pending", "approved", "claimable", "funded", "rejected", "paid", "refunded"];

const HINT: Partial<Record<BountyStatus, string>> = {
  review_candidate: "A review is waiting for your decision",
  draft: "Not funded yet",
  expired: "Refund available",
};

function Dashboard() {
  const bounties = useBounties("funded-by-me");
  const repos = useRepositories();
  const list = bounties.data ?? [];
  const sorted = [...list].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
  const deciding = list.filter((b) => b.status === "review_candidate").length;
  const installUrl = GITHUB_APP_SLUG ? `https://github.com/apps/${GITHUB_APP_SLUG}/installations/new` : null;

  return (
    <div>
      <PageHeader
        title="Maintainer dashboard"
        lead="Fund a review reward on a pull request, then decide which review earned it."
        action={
          <LinkButton href="/maintainer/new" variant="accent">
            <IconPlus size={15} />
            New bounty
          </LinkButton>
        }
      />

      <div className="stagger grid grid-cols-1 gap-3 md:grid-cols-12">
        {/* Stat tiles: one headline number each */}
        <Tray tone="white" className="md:col-span-4" style={{ "--i": 0 } as React.CSSProperties}>
          <p className="text-[12.5px] font-medium text-mut">Held in escrow</p>
          <Money units={sum(list.filter((b) => HOLDING.includes(b.status)))} className="mt-1 text-[30px]" />
          <p className="mt-1 text-[12.5px] text-mut">Locked for reviews, confirmed onchain</p>
        </Tray>
        <Tray tone="white" className="md:col-span-4" style={{ "--i": 1 } as React.CSSProperties}>
          <p className="text-[12.5px] font-medium text-mut">Paid to reviewers</p>
          <Money units={sum(list.filter((b) => b.status === "paid"))} className="mt-1 text-[30px]" />
          <p className="mt-1 text-[12.5px] text-mut">Across {list.filter((b) => b.status === "paid").length} paid bounties</p>
        </Tray>
        <Tray tone={deciding > 0 ? "dark" : "white"} className="md:col-span-4" style={{ "--i": 2 } as React.CSSProperties}>
          <p className={deciding > 0 ? "text-[12.5px] font-medium text-[#b9b9c0]" : "text-[12.5px] font-medium text-mut"}>Waiting for your decision</p>
          <p className="mt-1 text-[30px] font-semibold tracking-tight"><Roll text={String(deciding)} /></p>
          <p className={deciding > 0 ? "mt-1 text-[12.5px] text-[#b9b9c0]" : "mt-1 text-[12.5px] text-mut"}>
            {deciding === 1 ? "bounty has a review to decide on" : "bounties have a review to decide on"}
          </p>
        </Tray>

        <Tray className="md:col-span-8" style={{ "--i": 3 } as React.CSSProperties}>
          <h2 className="mb-3 text-[15px] font-semibold">Your bounties</h2>
          {bounties.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          ) : bounties.error ? (
            <Notice tone="critical" title="Your bounties could not be loaded">{bounties.error.message}</Notice>
          ) : sorted.length === 0 ? (
            <Empty
              title="No bounties yet"
              action={<LinkButton href="/maintainer/new" variant="accent">Create your first bounty</LinkButton>}
            >
              Pick a pull request and lock a small reward for whoever gives the review that leads to a fix.
            </Empty>
          ) : (
            <div className="space-y-2">
              {sorted.map((b) => (
                <BountyRow key={b.id} bounty={b} hint={HINT[b.status]} />
              ))}
            </div>
          )}
        </Tray>

        <Tray className="md:col-span-4 md:self-start" style={{ "--i": 4 } as React.CSSProperties}>
          <h2 className="text-[15px] font-semibold">Connected repositories</h2>
          <p className="mt-1 text-[13px] text-mut">Merit reads reviews through a GitHub App installed on each repository.</p>
          <div className="mt-3 space-y-2">
            {repos.isLoading && <Skeleton className="h-12" />}
            {repos.data?.map((r) => (
              <a
                key={r.id}
                href={`https://github.com/${r.fullName}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2.5 rounded-card bg-card px-3.5 py-2.5 text-[13.5px] font-medium shadow-inner-card hover:shadow-card"
              >
                <IconGithub size={16} />
                <span className="min-w-0 flex-1 truncate">{r.fullName}</span>
                <IconExternal size={13} className="text-mut-2" />
              </a>
            ))}
            {repos.data?.length === 0 && (
              <p className="rounded-card border border-dashed border-[#cfcfc8] px-3.5 py-4 text-center text-[13px] text-mut">
                No repositories connected. You need to maintain a repository to fund bounties on it.
              </p>
            )}
          </div>
          <div className="mt-3">
            {installUrl ? (
              <LinkButton href={installUrl} external variant="secondary" className="w-full">
                <IconPlus size={15} />
                Connect a repository
              </LinkButton>
            ) : (
              <p className="text-[12.5px] text-mut">
                {MOCK
                  ? "In mock mode the repositories are sample data. Live, this button installs the Merit GitHub App."
                  : "The GitHub App is not configured yet (NEXT_PUBLIC_GITHUB_APP_SLUG)."}
              </p>
            )}
          </div>
        </Tray>
      </div>
    </div>
  );
}

export default function MaintainerPage() {
  return (
    <RequireSignIn why="Merit uses your GitHub account to find the repositories you maintain.">
      <Dashboard />
    </RequireSignIn>
  );
}
