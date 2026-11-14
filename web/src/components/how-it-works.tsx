"use client";

import { useEffect, useState } from "react";
import { cx } from "./ui";

/** Each step, and the ledger-style line it leaves behind. The entries are sample data, matching the hero. */
const STEPS = [
  ["A maintainer locks a reward", "They pick a pull request and put $5 to $10 of testnet USDC into escrow. It is locked before anyone reviews.", "escrow  +10.00 USDC"],
  ["A reviewer leaves feedback", "On GitHub, as usual. No wallet is needed to review.", "review  1 comment · autosave.ts"],
  ["The author fixes it", "Merit notices a later commit touching the commented code and a resolved thread, and flags the review as a candidate.", "commit  a41c9e7 · thread resolved"],
  ["The maintainer verifies and approves", "They read the evidence and sign the approval themselves. The reviewer claims the reward, once.", "paid    10.00 USDC → jun-park"],
] as const;

const STEP_MS = 3200;

/**
 * The four steps, played in order: the rule above the current step fills while it is
 * current, earlier steps stay filled, later ones wait dimmed. Then it starts over.
 * With reduced motion it does not play and every step is shown at full strength.
 */
export function HowItWorks() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setTimeout(() => setActive((a) => (a + 1) % STEPS.length), STEP_MS);
    return () => clearTimeout(id);
  }, [active]);

  return (
    <ol className="mt-5 grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
      {STEPS.map(([title, body, entry], i) => {
        const reached = i <= active;
        return (
          <li key={title} aria-current={i === active ? "step" : undefined} className="flex flex-col">
            <span aria-hidden className="block h-px bg-ink/15">
              <span
                // Remounted when it becomes current, so the fill restarts from empty.
                key={i === active ? `on-${active}` : "off"}
                className={cx("block h-px origin-left bg-ink motion-reduce:scale-x-100", i < active ? "scale-x-100" : i > active && "scale-x-0")}
                style={i === active ? { animation: `step-fill ${STEP_MS}ms linear both` } : undefined}
              />
            </span>
            <div className={cx("flex flex-1 flex-col pt-3 transition-opacity duration-500 ease-soft motion-reduce:opacity-100", reached ? "opacity-100" : "opacity-45")}>
              <span className="font-mono text-[12px] text-mut">0{i + 1}</span>
              <p className="mt-2 text-[14px] font-medium">{title}</p>
              <p className="mt-1 text-[13px] text-mut">{body}</p>
              <p
                className={cx(
                  "mt-auto whitespace-pre pt-3 font-mono text-[12px] transition-[opacity,transform] duration-500 ease-soft motion-reduce:translate-y-0 motion-reduce:opacity-100",
                  i === STEPS.length - 1 ? "text-accent-ink" : "text-ink-2",
                  reached ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
                )}
              >
                {entry}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
