import type { ReviewCandidate } from "@/lib/api/types";
import Link from "next/link";
import { relativeTime } from "@/lib/format";
import { IconCheck, IconCommit, IconExternal, IconX } from "./icons";
import { cx, Pill, UserChip } from "./ui";

/** A unified diff hunk with added and removed lines tinted, like GitHub renders it. */
export function DiffHunk({ hunk }: { hunk: string }) {
  return (
    <pre className="overflow-x-auto rounded-card bg-diff-bg py-2 font-mono text-[12px] leading-[1.65] shadow-inner-card">
      {hunk.split("\n").map((line, i) => (
        <span
          key={i}
          className={cx(
            "block min-w-max px-3",
            line.startsWith("@@") && "text-mut-2",
            line.startsWith("+") && "bg-diff-add-bg text-diff-add-ink",
            line.startsWith("-") && "bg-diff-remove-bg text-diff-remove-ink",
          )}
        >
          {line || " "}
        </span>
      ))}
    </pre>
  );
}

function Signal({ ok, children }: { ok: boolean | null; children: string }) {
  return (
    <li className="flex items-start gap-2 text-[13px]">
      <span
        className={cx(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full",
          ok ? "bg-good-bg text-good" : "bg-tray-2 text-mut",
        )}
      >
        {ok ? <IconCheck size={10} /> : ok === null ? <span aria-hidden>?</span> : <IconX size={10} />}
      </span>
      <span className={ok ? "text-ink" : "text-mut"}>
        {children}
        <span className="sr-only">{ok ? " (yes)" : ok === null ? " (not verified)" : " (not yet)"}</span>
      </span>
    </li>
  );
}

/**
 * The evidence behind a review candidate: the comment, the code it was about, the later
 * commit, and the three heuristic signals. The signals are labelled as heuristics because
 * they are: the maintainer decides whether the review earned the reward.
 */
export function EvidenceCard({ candidate, footer }: { candidate: ReviewCandidate; footer?: React.ReactNode }) {
  const e = candidate.evidence;
  return (
    <article className="rounded-card bg-card p-4 shadow-inner-card">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link href={`/reviewers/${candidate.reviewer.id}`} className="hover:underline"><UserChip user={candidate.reviewer} size={22} className="text-[14px]" /></Link>
        <span className="text-[13px] text-mut">commented {relativeTime(candidate.commentedAt)}</span>
        <span className="ml-auto flex items-center gap-2">
          {candidate.status === "approved" && <Pill tone="good"><IconCheck size={12} />Approved</Pill>}
          {candidate.status === "rejected" && <Pill tone="critical"><IconX size={12} />Rejected</Pill>}
          {candidate.status === "ineligible" && <Pill tone="warning">Pending checks</Pill>}
          <a
            href={candidate.commentUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[13px] font-medium text-accent-ink hover:underline"
          >
            View on GitHub <IconExternal size={12} />
          </a>
        </span>
      </header>

      <blockquote className="mt-3 whitespace-pre-wrap break-words border-l-2 border-accent pl-3 text-[14px] leading-relaxed text-ink">
        {candidate.commentBody}
      </blockquote>

      <p className="mt-3 font-mono text-[12px] text-mut">{candidate.filePath}{e.line ? `:${e.line}` : ""}</p>
      <div className="mt-2">
        <DiffHunk hunk={candidate.diffHunk} />
      </div>

      {candidate.commitSha && (
        <p className="mt-3 flex items-center gap-2 text-[13px] text-ink-2">
          <IconCommit size={14} className="text-mut" />
          Later revision <span className="break-all font-mono text-[12px]">{candidate.commitSha.slice(0, 12)}</span>
          {candidate.commitMessage && <span className="truncate text-mut">{candidate.commitMessage}</span>}
        </p>
      )}

      <div className="mt-4 rounded-card bg-diff-bg p-3">
        <p className="text-[12px] font-medium text-ink-2">
          Signals from GitHub <span className="font-normal text-mut">· heuristics, not proof</span>
        </p>
        <ul className="mt-2 space-y-2">
          <Signal ok={e.commentExists}>A review comment exists on this pull request</Signal>
          <Signal ok={e.laterCommitTouchedContext}>A later revision changed code near the commented line</Signal>
          <Signal ok={e.threadResolved}>The comment thread was resolved</Signal>
        </ul>
        {e.note && <p className="mt-2 text-[12px] text-warn">{e.note}</p>}
        {e.checkedAt && <p className="mt-2 text-[12px] text-mut">GitHub checked {relativeTime(e.checkedAt)}</p>}
      </div>

      {candidate.status === "ineligible" && candidate.ineligibleReason && (
        <p className="mt-3 text-[13px] text-mut">{candidate.ineligibleReason}</p>
      )}
      {footer && <div className="mt-4">{footer}</div>}
    </article>
  );
}
