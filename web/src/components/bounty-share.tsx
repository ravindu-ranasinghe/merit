"use client";

import { useSyncExternalStore } from "react";
import type { Bounty } from "@/lib/api/types";
import { BACKEND_URL } from "@/lib/env";
import { formatUsdc } from "@/lib/format";
import { CopyButton } from "./copy-button";
import { LinkButton, Pill } from "./ui";

const subscribe = () => () => {};
export function useSiteOrigin() {
  return useSyncExternalStore(subscribe, () => window.location.origin, () => "");
}

export function BountyShare({ bounty }: { bounty: Bounty }) {
  const origin = useSiteOrigin();
  const url = `${origin}/bounties/${bounty.id}`;
  const apiOrigin = BACKEND_URL.startsWith("/") ? `${origin}${BACKEND_URL}` : BACKEND_URL;
  const markdown = `[![Merit review bounty](${apiOrigin}/bounties/${bounty.id}/badge.svg)](${url})`;
  return (
    <section>
      <h2 className="text-[16px] font-medium">Bring reviewers to this PR</h2>
      <p className="mt-1 text-[13px] text-mut">Add a live reward badge to the pull request description. Its status updates as the bounty progresses.</p>
      <div className="my-3 flex flex-wrap items-center gap-0 overflow-hidden rounded-ctl text-[12px]">
        {/* The real badge is an SVG served by the backend in fixed colors (routes/public.ts); preview it as GitHub will show it. */}
        <span className="bg-[#3f3b33] px-3 py-1.5 text-[#f4eddd]">Merit review</span>
        <span className="bg-[#4e5843] px-3 py-1.5 text-[#f4eddd]">{formatUsdc(bounty.amountUnits)} · {bounty.status.replaceAll("_", " ")}</span>
      </div>
      <textarea aria-label="GitHub badge Markdown" readOnly value={markdown} rows={3} className="mb-3 w-full resize-none rounded-ctl border border-line bg-card p-3 font-mono text-[11px] text-ink-2" onFocus={(e) => e.currentTarget.select()} />
      <div className="flex flex-wrap gap-2"><CopyButton value={markdown} label="Copy PR badge" /><CopyButton value={url} /></div>
      <p className="mt-3 text-[12px] text-mut">Badges are available for public repositories.</p>
      {bounty.chain.paid ? <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <Pill tone="good">Payout confirmed</Pill><LinkButton href={`/bounties/${bounty.id}/receipt`} variant="secondary">View payout receipt</LinkButton>
      </div> : bounty.chain.refunded && <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <Pill>Refund confirmed</Pill><LinkButton href={`/bounties/${bounty.id}/receipt`} variant="secondary">View refund receipt</LinkButton>
      </div>}
    </section>
  );
}
