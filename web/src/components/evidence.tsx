import type { ReviewCandidate } from "@/lib/api/types";
import { relativeTime } from "@/lib/format";
import { IconCheck, IconCommit, IconExternal, IconX } from "./icons";
import { cx, Pill, UserChip } from "./ui";

/** A unified diff hunk with added and removed lines tinted, like GitHub renders it. */
export function DiffHunk({ hunk }: { hunk: string }) {
  return (
    <pre className="overflow-x-auto rounded-[10px] bg-[#f6f8fa] py-2 font-mono text-[12px] leading-[1.65] shadow-[inset_0_0_0_1px_#e5e5e5]">
      {hunk.split("\n").map((line, i) => (
        <span
          key={i}
          className={cx(
            "block min-w-max px-3",
            line.startsWith("@@") && "text-mut-2",
            line.startsWith("+") && "bg-[#e3f3e1] text-[#12501a]",
            line.startsWith("-") && "bg-[#fbe6e3] text-[#8a1f1f]",
          )}
        >
          {line || " "}
        </span>
      ))}
    </pre>
  );
}

function Signal({ ok, children }: { ok: boolean; children: string }) {
  return (
    <li className="flex items-start gap-2 text-[13px]">
      <span
        className={cx(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full",
          ok ? "bg-good-bg text-good" : "bg-tray-2 text-mut",
        )}
      >
        {ok ? <IconCheck size={10} /> : <IconX size={10} />}
      </span>
      <span className={ok ? "text-ink" : "text-mut"}>
        {children}
        <span className="sr-only">{ok ? " (yes)" : " (no)"}</span>
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
        <UserChip user={candidate.reviewer} size={22} className="text-[14px]" />
        <span className="text-[13px] text-mut">commented {relativeTime(candidate.commentedAt)}</span>
        <span className="ml-auto flex items-center gap-2">
          {candidate.status === "approved" && <Pill tone="good"><IconCheck size={12} />Approved</Pill>}
          {candidate.status === "rejected" && <Pill tone="critical"><IconX size={12} />Rejected</Pill>}
          {candidate.status === "ineligible" && <Pill tone="neutral">Not eligible</Pill>}
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

      <blockquote className="mt-3 border-l-2 border-accent pl-3 text-[14px] leading-relaxed text-ink">
        {candidate.commentBody}
      </blockquote>

      <p className="mt-3 font-mono text-[12px] text-mut">{candidate.filePath}</p>
      <div className="mt-2">
        <DiffHunk hunk={candidate.diffHunk} />
      </div>

      {candidate.commitSha && (
        <p className="mt-3 flex items-center gap-2 text-[13px] text-ink-2">
          <IconCommit size={14} className="text-mut" />
          Later commit <span className="font-mono text-[12px]">{candidate.commitSha}</span>
          {candidate.commitMessage && <span className="truncate text-mut">{candidate.commitMessage}</span>}
        </p>
      )}

      <div className="mt-4 rounded-[10px] bg-[#f6f8fa] p-3">
        <p className="text-[12px] font-medium text-ink-2">
          Signals from GitHub <span className="font-normal text-mut">· heuristics, not proof</span>
        </p>
        <ul className="mt-2 space-y-2">
          <Signal ok={e.commentExists}>A review comment exists on this pull request</Signal>
          <Signal ok={e.laterCommitTouchedContext}>A later commit changed the code the comment is about</Signal>
          <Signal ok={e.threadResolved}>The comment thread was resolved</Signal>
        </ul>
        {e.note && <p className="mt-2 text-[12px] text-warn">{e.note}</p>}
        <p className="mt-2 text-[12px] text-mut">
          These can be wrong after a rebase or when lines move. They help you decide; they do not show the review was useful.
        </p>
      </div>

      {candidate.status === "ineligible" && candidate.ineligibleReason && (
        <p className="mt-3 text-[13px] text-mut">{candidate.ineligibleReason}</p>
      )}
      {footer && <div className="mt-4">{footer}</div>}
    </article>
  );
}
