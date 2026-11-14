import type { BountyStatus } from "@/lib/api/types";
import { railFor, STATUS_META, type RailStep, type Tone } from "@/lib/status";
import { IconAlert, IconCheck, IconClock, IconLock, IconX } from "./icons";
import { cx, Pill } from "./ui";

function StatusGlyph({ status, size = 12 }: { status: BountyStatus; size?: number }) {
  if (status === "paid" || status === "refunded") return <IconCheck size={size} />;
  if (status === "rejected") return <IconX size={size} />;
  if (status === "expired") return <IconClock size={size} />;
  return null;
}

/** Compact status for lists. Always a label plus, for end states, an icon; never color alone. */
export function StatusPill({ status }: { status: BountyStatus }) {
  const meta = STATUS_META[status];
  return (
    <Pill tone={meta.tone}>
      <StatusGlyph status={status} />
      {meta.label}
    </Pill>
  );
}

const CURRENT: Record<Tone, string> = {
  neutral: "bg-ink text-white",
  progress: "bg-ink text-white",
  good: "bg-good text-white",
  warning: "bg-[#b7791f] text-white",
  critical: "bg-crit text-white",
};

const CURRENT_TEXT: Record<Tone, string> = {
  neutral: "text-ink",
  progress: "text-ink",
  good: "text-good",
  warning: "text-warn",
  critical: "text-crit",
};

function Node({ step, index }: { step: RailStep; index: number }) {
  const meta = STATUS_META[step.status];
  const base = "relative z-10 flex size-7 items-center justify-center rounded-full text-[12px] font-medium transition-colors duration-150 ease-soft";
  if (step.state === "done") {
    return (
      <span className={cx(base, "bg-ink text-white")}>
        <IconCheck size={13} />
      </span>
    );
  }
  if (step.state === "current") {
    return (
      <span className={cx(base, "ring-4 ring-ink/10", CURRENT[meta.tone])}>
        {step.status === "expired" ? <IconClock size={14} /> : step.status === "rejected" ? <IconX size={14} /> : meta.tone === "good" || step.status === "refunded" ? <IconCheck size={14} /> : index + 1}
      </span>
    );
  }
  return <span className={cx(base, "bg-card text-mut-2 shadow-[inset_0_0_0_1.5px_#d4d4d4]")}>{index + 1}</span>;
}

/**
 * The bounty status machine from SPEC.md, drawn as one rail. The current stage is the one
 * large, colored node; finished stages are checked; later stages are hollow. Expired,
 * Refunded and Rejected appear as a dashed branch off the main path.
 *
 * Funded, Paid and Refunded carry a lock: the escrow contract is the source of truth for
 * them, and this component is only ever given a status the indexer has confirmed.
 */
export function StatusRail({ status, className }: { status: BountyStatus; className?: string }) {
  const steps = railFor(status);
  const currentIndex = steps.findIndex((s) => s.state === "current");
  const current = steps[currentIndex];
  const meta = STATUS_META[status];

  return (
    <div className={className}>
      {/* Wide screens: the full rail. */}
      <ol aria-label={`Bounty status: ${meta.label}`} className="hidden sm:flex">
        {steps.map((step, i) => {
          const m = STATUS_META[step.status];
          const isCurrent = step.state === "current";
          return (
            <li key={step.status} aria-current={isCurrent ? "step" : undefined} className="relative flex min-w-0 flex-1 flex-col items-center px-0.5 text-center">
              {i > 0 && (
                <span
                  aria-hidden
                  className={cx(
                    "absolute right-1/2 top-[13px] h-[2px] w-full",
                    step.branch
                      ? "bg-[repeating-linear-gradient(90deg,#a3a3a3_0_5px,transparent_5px_9px)]"
                      : step.state === "upcoming"
                        ? "bg-[#d4d4d4]"
                        : "bg-ink",
                  )}
                />
              )}
              <Node step={step} index={i} />
              <span
                className={cx(
                  "mt-2 flex items-center gap-1 text-[12px] leading-tight",
                  isCurrent ? cx("font-medium", CURRENT_TEXT[m.tone]) : step.state === "done" ? "font-medium text-ink-2" : "text-mut-2",
                )}
              >
                {m.label}
                {m.onchain && (
                  <span title="Confirmed by the escrow contract" className="inline-flex">
                    <IconLock size={10} />
                    <span className="sr-only"> (confirmed onchain)</span>
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>

      {/* Narrow screens: a segmented bar plus the current stage in words. */}
      <div className="sm:hidden">
        <div aria-hidden className="flex gap-1">
          {steps.map((step) => (
            <span
              key={step.status}
              className={cx(
                "h-1.5 flex-1 rounded-full",
                step.state === "upcoming" ? "bg-[#d4d4d4]" : step.state === "current" ? CURRENT[STATUS_META[step.status].tone] : "bg-ink",
              )}
            />
          ))}
        </div>
        <p className="mt-2 text-[13px] text-mut">
          Step {currentIndex + 1} of {steps.length}:{" "}
          <span className={cx("font-medium", CURRENT_TEXT[meta.tone])}>{meta.label}</span>
        </p>
      </div>

      <p className="mt-3 flex items-start gap-2 text-[13px] text-ink-2 sm:justify-center sm:text-center">
        {current && STATUS_META[current.status].tone === "warning" && <IconAlert size={15} className="mt-0.5 shrink-0 text-warn" />}
        {meta.description}
      </p>
    </div>
  );
}
