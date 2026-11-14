"use client";

import { useEffect, useState } from "react";
import { DiffHunk } from "./evidence";
import { IconCheck, IconCheckDraw, IconCommit, IconLock } from "./icons";
import { cx, Money, Pill } from "./ui";

const STAGES = [
  { pill: "Funded", note: "Locked before the review starts" },
  { pill: "Review candidate", note: "A comment was followed by a fix" },
  { pill: "Approved", note: "The maintainer signed off" },
  { pill: "Paid", note: "The reviewer claimed it" },
] as const;

const HUNK = `   dispose() {
     this.disposed = true;
+    clearTimeout(this.timer);
   }`;

/** An illustration of one bounty's life, cycling through its four key moments. Sample data. */
export function HeroBento() {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setStage((s) => (s + 1) % STAGES.length), 2600);
    return () => clearInterval(id);
  }, []);

  const s = STAGES[stage];

  return (
    <div aria-label="Illustration: a review bounty moving from funded to paid" role="img" className="stagger grid grid-cols-6 gap-2.5">
      <div className="col-span-6 rounded-tray bg-card p-4 shadow-card sm:col-span-3" style={{ "--i": 1 } as React.CSSProperties}>
        <p className="flex items-center gap-1.5 text-[12px] font-medium text-mut">
          <IconLock size={13} /> Reward in escrow
        </p>
        <Money units={stage === 3 ? "0" : "10000000"} className="mt-1.5 text-[34px] leading-none" />
        <div className="mt-3 flex items-center gap-2">
          <Pill tone={stage === 3 ? "good" : "progress"}>
            {stage === 3 && <IconCheck size={12} />}
            {s.pill}
          </Pill>
        </div>
        <p className="mt-2 text-[12px] text-mut">{s.note}</p>
      </div>

      <div className="col-span-6 rounded-tray bg-dark p-4 text-white sm:col-span-3" style={{ "--i": 2 } as React.CSSProperties}>
        <p className="text-[12px] font-medium text-[#b9b9c0]">Maintainer decision</p>
        <p className="mt-1.5 text-[15px] font-semibold">Pay this review?</p>
        <div className="mt-3 flex items-center gap-3">
          <span className={cx("relative h-7 w-12 rounded-full transition-colors duration-500", stage >= 2 ? "bg-accent" : "bg-white/20")}>
            <span
              className="absolute left-1 top-1 size-5 rounded-full bg-white transition-transform duration-700 ease-spring"
              style={{ transform: `translateX(${stage >= 2 ? 20 : 0}px)` }}
            />
          </span>
          <span className="text-[12.5px] text-[#c9c9cf]">{stage >= 2 ? "Approved from their own wallet" : "Waiting for the maintainer"}</span>
        </div>
      </div>

      <div className="col-span-6 rounded-tray bg-tray p-3" style={{ "--i": 3 } as React.CSSProperties}>
        <div className="rounded-card bg-card p-3.5 shadow-inner-card">
          <p className="flex items-center gap-2 text-[12.5px]">
            <span className="flex size-5 items-center justify-center rounded-full bg-[#16a37f] text-[10px] font-semibold text-white">J</span>
            <span className="font-semibold">jun-park</span>
            <span className="text-mut">reviewed src/editor/autosave.ts</span>
          </p>
          <p className="mt-2 border-l-2 border-accent pl-2.5 text-[13px] text-ink">
            The debounce timer is never cleared, so a late tick writes to a closed file handle.
          </p>
          <div className={cx("grid transition-[grid-template-rows,opacity] duration-700 ease-soft", stage >= 1 ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
            <div className="overflow-hidden">
              <div className="mt-2.5">
                <DiffHunk hunk={HUNK} />
              </div>
              <p className="mt-2 flex items-center gap-1.5 text-[12px] text-ink-2">
                <IconCommit size={13} className="text-mut" /> Fix commit <span className="font-mono">a41c9e7</span> · thread resolved
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="col-span-6 flex items-center gap-3 rounded-tray bg-card p-4 shadow-card" style={{ "--i": 4 } as React.CSSProperties}>
        <span
          className={cx(
            "flex size-9 shrink-0 items-center justify-center rounded-full transition-colors duration-500",
            stage === 3 ? "bg-good text-white" : "bg-tray-2 text-mut-2",
          )}
        >
          {stage === 3 ? <IconCheckDraw key="on" size={18} /> : <IconCheck size={16} />}
        </span>
        <div className="min-w-0">
          <p className="text-[14px] font-semibold">{stage === 3 ? "jun-park was paid $10.00 USDC" : "Payout to the reviewer"}</p>
          <p className="text-[12px] text-mut">{stage === 3 ? "Once. A second claim is refused by the contract." : "Happens only after the maintainer approves"}</p>
        </div>
        <span className="ml-auto hidden text-[11px] text-mut-2 sm:block">Illustration, sample data</span>
      </div>
    </div>
  );
}
