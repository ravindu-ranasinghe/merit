"use client";

import { useState } from "react";
import type { Bounty } from "@/lib/api/types";
import { formatDate } from "@/lib/format";
import { IconCheck, IconExternal } from "./icons";
import { TxLink } from "./ui";

export function ReviewTimeline({ bounty }: { bounty: Bounty }) {
  const [selected, setSelected] = useState("");
  const c = bounty.candidates.find((c) => c.id === selected)
    ?? bounty.candidates.find((c) => c.id === bounty.approval?.candidateId) ?? bounty.candidates[0];
  const approvalForReview = bounty.approval?.candidateId === c?.id;
  const steps = [
    { label: "Reward funded", done: !!bounty.chain.funded, date: bounty.chain.funded?.at, tx: bounty.chain.funded?.txHash, detail: "The reward is held in escrow on Arc." },
    { label: "Review posted", done: !!c, date: c?.commentedAt, href: c?.commentUrl, detail: c ? `${c.reviewer.login} reviewed ${c.filePath}${c.evidence.line ? `:${c.evidence.line}` : ""}.` : "Leave an inline review on the pull request." },
    { label: "Fix detected", done: c?.evidence.laterCommitTouchedContext === true, href: c?.commitSha ? `https://github.com/${bounty.repo.fullName}/commit/${c.commitSha}` : undefined, detail: c?.commitSha ? `Later revision ${c.commitSha.slice(0, 12)} touched the commented context.` : "Waiting for a later change near the review comment." },
    { label: "Thread resolved", done: c?.evidence.threadResolved === true, detail: c?.evidence.threadResolved ? "GitHub marks the review thread as resolved." : "Resolve the thread on GitHub after addressing the feedback." },
    { label: "Payout approved", done: approvalForReview && !!bounty.chain.approved, date: approvalForReview ? bounty.chain.approved?.at : undefined, tx: approvalForReview ? bounty.chain.approved?.txHash : undefined, detail: "The maintainer signs the payout approval." },
    { label: "Reward claimed", done: approvalForReview && !!bounty.chain.paid, date: approvalForReview ? bounty.chain.paid?.at : undefined, tx: approvalForReview ? bounty.chain.paid?.txHash : undefined, detail: "The reviewer claims their approved reward." },
  ];
  return (
    <section aria-labelledby="timeline-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="timeline-title" className="text-[16px] font-medium">From review to reward</h2>
        {bounty.candidates.length > 1 && <label className="text-[12px] text-mut">Review <select className="ml-2 max-w-48 rounded-ctl border border-line bg-card p-1 text-ink" value={c?.id} onChange={(e) => setSelected(e.target.value)}>
          {bounty.candidates.map((c) => <option key={c.id} value={c.id}>{c.reviewer.login} · {c.filePath}</option>)}
        </select></label>}
      </div>
      <ol className="mt-4">
        {steps.map((s, i) => <li key={s.label} className="relative flex gap-3 pb-5 last:pb-0">
          {i < steps.length - 1 && <span aria-hidden className="absolute bottom-0 left-[10px] top-6 border-l border-line" />}
          <span aria-hidden className={`relative flex size-[22px] shrink-0 items-center justify-center rounded-full ${s.done ? "bg-good text-card" : "border border-line bg-card text-mut"}`}>
            {s.done ? <IconCheck size={12} /> : <span className="size-1 rounded-full bg-current" />}
          </span>
          <div className="min-w-0 flex-1 text-[13px]">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><span className="font-medium">{s.label}</span><span className="text-[12px] text-mut">{s.date ? formatDate(s.date) : s.done ? "Confirmed" : "Pending"}</span>
              {s.tx && <TxLink hash={s.tx} label="Transaction" />}
              {s.href && <a href={s.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent-ink underline-offset-2 hover:underline">View on GitHub <IconExternal size={11} /></a>}
            </div>
            <p className="mt-0.5 text-mut">{s.detail}</p>
          </div>
        </li>)}
      </ol>
      <p className="mt-4 border-t border-line pt-3 text-[12px] text-mut">GitHub signals help a maintainer assess the review. Money steps are confirmed by indexed contract events.</p>
    </section>
  );
}
