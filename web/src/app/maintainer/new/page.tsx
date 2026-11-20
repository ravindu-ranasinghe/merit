"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconCheck, IconGithub, IconPullRequest } from "@/components/icons";
import { RequireSignIn } from "@/components/sign-in";
import { Button, cx, Empty, Money, Notice, PageHeader, Skeleton, Tray, UserChip } from "@/components/ui";
import { useCreateBounty, usePullRequests, useRepositories } from "@/lib/api/queries";
import { DEMO_DEADLINES } from "@/lib/env";
import { formatDeadline, formatUsd } from "@/lib/format";

const AMOUNTS = ["5000000", "7500000", "10000000"];
const DAY = 86_400_000;
/** Deadline windows. The 5-minute one exists only to demo expiry and refund on testnet (see DEMO_DEADLINES). */
const DEMO_WINDOW = "5m";
const WINDOWS: { key: string; ms: number; label: string }[] = [
  ...(DEMO_DEADLINES ? [{ key: DEMO_WINDOW, ms: 5 * 60_000, label: "5 min" }] : []),
  { key: "3d", ms: 3 * DAY, label: "3 days" },
  { key: "7d", ms: 7 * DAY, label: "7 days" },
  { key: "14d", ms: 14 * DAY, label: "14 days" },
];
/** Read the clock when the bounty is created (module scope keeps render pure). */
const deadlineAfterNow = (ms: number) => new Date(Date.now() + ms).toISOString();

const RULES = [
  ["The money is locked first.", "Your testnet USDC moves into an escrow contract before any review counts. You cannot take it back before the deadline."],
  ["Only you can approve a payout.", "Merit shows you evidence from GitHub. You decide, and you sign the approval from your own wallet."],
  ["One reviewer, once.", "A bounty pays at most one reviewer, at most one time, and never more than you locked."],
  ["Not the author, not you.", "The pull request's author and the approving maintainer cannot be paid for it."],
  ["Unapproved money comes back.", "After the deadline, anything you did not approve can be refunded to your wallet with one transaction."],
];

/** A segmented control with a knob that glides between options. */
function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
  render,
}: {
  label: string;
  options: T[];
  value: T;
  onChange: (v: T) => void;
  render: (v: T) => string;
}) {
  const index = options.indexOf(value);
  return (
    <div role="radiogroup" aria-label={label} className="relative grid h-11 rounded-[13px] bg-tray-2 p-1" style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
      <span
        aria-hidden
        className="absolute bottom-1 left-1 top-1 rounded-[10px] bg-card shadow-knob transition-transform duration-500 ease-soft"
        style={{ width: `calc((100% - 8px) / ${options.length})`, transform: `translateX(${index * 100}%)` }}
      />
      {options.map((o) => (
        <button
          key={String(o)}
          type="button"
          role="radio"
          aria-checked={o === value}
          onClick={() => onChange(o)}
          className={cx("relative z-10 text-[14px] transition-colors duration-300", o === value ? "font-medium text-ink" : "font-medium text-mut hover:text-ink")}
        >
          {render(o)}
        </button>
      ))}
    </div>
  );
}

function NewBounty() {
  const router = useRouter();
  const repos = useRepositories();
  const [repoId, setRepoId] = useState<string | null>(null);
  const activeRepoId = repoId ?? repos.data?.[0]?.id ?? null;
  const pulls = usePullRequests(activeRepoId);
  const [prNumber, setPrNumber] = useState<number | null>(null);
  const [amount, setAmount] = useState(AMOUNTS[2]);
  const [windowKey, setWindowKey] = useState("7d");
  // Fixed when the page opens, so the deadline shown is the deadline created.
  const [openedAt] = useState(() => Date.now());
  const create = useCreateBounty();

  const win = WINDOWS.find((w) => w.key === windowKey)!;
  const isDemo = win.key === DEMO_WINDOW;
  const deadline = new Date(openedAt + win.ms).toISOString();
  const pr = pulls.data?.find((p) => p.number === prNumber && !p.bountyId);

  const submit = async () => {
    if (!activeRepoId || !pr) return;
    // The demo window starts when the bounty is created, not when the page opened, or a slow form would eat it.
    const bountyDeadline = isDemo ? deadlineAfterNow(win.ms) : deadline;
    const bounty = await create.mutateAsync({ repoId: activeRepoId, prNumber: pr.number, amountUnits: amount, deadline: bountyDeadline }).catch(() => null);
    if (bounty) router.push(`/bounties/${bounty.id}`);
  };

  return (
    <div>
      <PageHeader
        eyebrow={<Link href="/maintainer" className="hover:text-ink">← Maintainer dashboard</Link>}
        title="New review bounty"
        lead="Choose a pull request and a reward. You will see exactly what you are agreeing to before any money moves."
      />

      <div className="stagger grid grid-cols-1 gap-3 lg:grid-cols-12">
        <div className="space-y-3 lg:col-span-7" style={{ "--i": 0 } as React.CSSProperties}>
          <Tray>
            <h2 className="text-[16px] font-medium">1. Repository</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {repos.isLoading && <Skeleton className="h-10 w-48" />}
              {repos.data?.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  aria-pressed={r.id === activeRepoId}
                  onClick={() => {
                    setRepoId(r.id);
                    setPrNumber(null);
                  }}
                  className={cx(
                    "flex h-10 items-center gap-2 rounded-ctl px-4 text-[14px] font-medium transition-[background-color,box-shadow,transform] duration-300 ease-soft active:scale-[0.97]",
                    r.id === activeRepoId ? "bg-ink text-bg" : "bg-card shadow-knob hover:bg-tray",
                  )}
                >
                  <IconGithub size={15} />
                  {r.fullName}
                </button>
              ))}
              {repos.data?.length === 0 && (
                <Notice tone="warning" title="You have no connected repositories">
                  Only a repository&apos;s maintainer can fund a bounty on it. Connect one from the dashboard.
                </Notice>
              )}
            </div>
          </Tray>

          <Tray>
            <h2 className="text-[16px] font-medium">2. Pull request</h2>
            <div className="mt-3 space-y-2">
              {pulls.isLoading && <Skeleton className="h-14" />}
              {pulls.data?.length === 0 && <Empty title="No open pull requests">Open a pull request in this repository first.</Empty>}
              {pulls.data?.map((p) => {
                const taken = !!p.bountyId;
                const selected = p.number === prNumber && !taken;
                return (
                  <button
                    key={p.number}
                    type="button"
                    disabled={taken}
                    aria-pressed={selected}
                    onClick={() => setPrNumber(p.number)}
                    className={cx(
                      "flex w-full items-center gap-3 rounded-card px-4 py-3 text-left transition-[box-shadow,background-color] duration-300",
                      selected ? "bg-card shadow-[0_0_0_2px_var(--color-accent),0_0_0_6px_rgb(47_91_255/0.14)]" : "bg-card shadow-inner-card",
                      taken && "opacity-55",
                    )}
                  >
                    <IconPullRequest size={16} className="shrink-0 text-mut" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium">{p.title}</span>
                      <span className="flex items-center gap-2 text-[13px] text-mut">
                        #{p.number} by <UserChip user={p.author} size={15} />
                      </span>
                    </span>
                    {taken ? (
                      <span className="text-[12px] text-mut">Has a bounty</span>
                    ) : (
                      <span className={cx("flex size-5 items-center justify-center rounded-full", selected ? "bg-accent text-bg" : "shadow-knob")}>
                        {selected && <IconCheck size={11} />}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </Tray>

          <Tray>
            <h2 className="text-[16px] font-medium">3. Reward and deadline</h2>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-2 text-[13px] text-mut">Reward, in testnet USDC</p>
                <Segmented label="Reward" options={AMOUNTS} value={amount} onChange={setAmount} render={(u) => formatUsd(u)} />
              </div>
              <div>
                <p className="mb-2 text-[13px] text-mut">Open for</p>
                <Segmented label="Deadline" options={WINDOWS.map((w) => w.key)} value={windowKey} onChange={setWindowKey} render={(k) => WINDOWS.find((w) => w.key === k)!.label} />
              </div>
            </div>
            {isDemo && (
              <Notice tone="warning" className="mt-4" title="Testnet demo window">
                The bounty expires 5 minutes after you create it, so you can show what happens when no review is approved:
                the deadline passes and the reward is refunded to your wallet. Fund it straight away; the contract refuses a
                deadline that has already passed. Use a day-long window for real reviews.
              </Notice>
            )}
          </Tray>
        </div>

        <div className="space-y-3 lg:sticky lg:top-24 lg:col-span-5 lg:self-start" style={{ "--i": 1 } as React.CSSProperties}>
          <Tray tone="white">
            <p className="text-[13px] font-medium text-mut">You are about to lock</p>
            <Money units={amount} className="mt-1 text-[40px] leading-tight" />
            <p className="mt-1 text-[13px] text-mut">
              {pr ? (
                <>for a review of <span className="font-medium text-ink">#{pr.number} {pr.title}</span>, </>
              ) : (
                "for a review of the pull request you choose, "
              )}
              {isDemo ? "open for 5 minutes after you create it (testnet demo)." : <>open until {formatDeadline(deadline)}.</>}
            </p>

            <h2 className="mt-5 text-[14px] font-medium">What you are agreeing to</h2>
            <ul className="mt-3 space-y-3">
              {RULES.map(([title, body]) => (
                <li key={title} className="flex gap-3 text-[13px]">
                  <span className="mt-0.5 flex size-4.5 shrink-0 items-center justify-center rounded-full bg-tint text-accent-ink">
                    <IconCheck size={10} />
                  </span>
                  <span>
                    <strong className="font-medium">{title}</strong> <span className="text-ink-2">{body}</span>
                  </span>
                </li>
              ))}
            </ul>

            {create.error && (
              <Notice tone="critical" className="mt-4" title="The bounty could not be created">{create.error.message}</Notice>
            )}
            <Button variant="accent" className="mt-5 w-full" disabled={!pr} loading={create.isPending} onClick={submit}>
              {pr ? "Create bounty and continue to funding" : "Choose a pull request to continue"}
            </Button>
            <p className="mt-3 text-center text-[12px] text-mut">No money moves on this step. Testnet USDC only.</p>
          </Tray>
        </div>
      </div>
    </div>
  );
}

export default function NewBountyPage() {
  return (
    <RequireSignIn why="Merit uses your GitHub account to find the repositories you maintain.">
      <NewBounty />
    </RequireSignIn>
  );
}
