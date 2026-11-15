"use client";

import Link from "next/link";
import type { Bounty } from "@/lib/api/types";
import { relativeTime } from "@/lib/format";
import { useNow } from "@/lib/now";
import { IconArrowRight, IconPullRequest } from "./icons";
import { StatusPill } from "./status";
import { Money } from "./ui";

/** One bounty in a list: the PR, the reward, the status and, when there is one, the next step. */
export function BountyRow({ bounty, hint }: { bounty: Bounty; hint?: string }) {
  const now = useNow();
  const past = new Date(bounty.deadline).getTime() < now;
  return (
    <Link
      href={`/bounties/${bounty.id}`}
      className="group flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card bg-card px-4 py-3 shadow-inner-card transition-colors duration-150 ease-soft hover:bg-tray"
    >
      <span className="flex min-w-0 flex-1 basis-64 items-start gap-3">
        <IconPullRequest size={16} className="mt-0.5 shrink-0 text-mut" />
        <span className="min-w-0">
          <span className="block truncate text-[14px] font-medium">{bounty.pr.title}</span>
          <span className="block truncate text-[13px] text-mut">
            {bounty.repo.fullName} #{bounty.pr.number}
            {" · "}
            {past ? "deadline passed" : `deadline ${relativeTime(bounty.deadline)}`}
          </span>
          {hint && <span className="mt-1 block text-[13px] font-medium text-ink">{hint}</span>}
        </span>
      </span>
      <Money units={bounty.amountUnits} className="text-[16px]" unitClassName="!text-[12px]" />
      <span className="flex w-[150px] justify-start sm:justify-end">
        <StatusPill status={bounty.status} />
      </span>
      <IconArrowRight size={16} className="hidden text-mut-2 transition-transform duration-150 ease-soft group-hover:translate-x-0.5 sm:block" />
    </Link>
  );
}
