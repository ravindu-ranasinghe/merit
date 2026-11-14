"use client";

import { Player, type PlayerRef } from "@remotion/player";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { FPS, HEIGHT, HowItWorksVideo, SCENE, SCENES, WIDTH } from "./how-it-works-video";
import { cx } from "./ui";

const STEPS = [
  ["A maintainer locks a reward", "They pick a pull request and put $5 to $10 of testnet USDC into escrow. It is locked before anyone reviews."],
  ["A reviewer leaves feedback", "On GitHub, as usual. No wallet is needed to review."],
  ["The author fixes it", "Merit notices a later commit touching the commented code and a resolved thread, and flags the review as a candidate."],
  ["The maintainer verifies and approves", "They read the evidence and sign the approval themselves. The reviewer claims the reward, once."],
] as const;

const REDUCED = "(prefers-reduced-motion: reduce)";
const subscribe = (cb: () => void) => {
  const mq = window.matchMedia(REDUCED);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

/**
 * The four steps as a looping, simulated screen recording, with the step text below lit
 * in time with it: the player's frame is the only clock. Clicking a step jumps to it.
 * With reduced motion nothing plays; the last frame and every step are shown instead.
 */
export function HowItWorks() {
  const player = useRef<PlayerRef>(null);
  const reduced = useSyncExternalStore(subscribe, () => window.matchMedia(REDUCED).matches, () => false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const p = player.current;
    if (!p) return;
    const onFrame = (e: { detail: { frame: number } }) => setActive(Math.min(SCENES - 1, Math.floor(e.detail.frame / SCENE)));
    p.addEventListener("frameupdate", onFrame);
    return () => p.removeEventListener("frameupdate", onFrame);
  }, []);

  return (
    <div className="mt-5">
      <div
        role="img"
        aria-label="Illustration of the four steps: a maintainer funds a bounty in Merit, a reviewer comments on GitHub, the author pushes a fix, and the maintainer approves the payout in Merit"
        className="overflow-hidden rounded-card shadow-card"
      >
        <Player
          ref={player}
          component={HowItWorksVideo}
          durationInFrames={SCENE * SCENES}
          compositionWidth={WIDTH}
          compositionHeight={HEIGHT}
          fps={FPS}
          // Remounted when the motion preference changes, so autoplay and the start frame follow it.
          key={String(reduced)}
          autoPlay={!reduced}
          initialFrame={reduced ? SCENE * SCENES - 1 : 0}
          loop
          acknowledgeRemotionLicense
          style={{ width: "100%" }}
        />
      </div>

      <ol className="mt-6 grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map(([title, body], i) => {
          const reached = reduced || i <= active;
          return (
            <li key={title} aria-current={!reduced && i === active ? "step" : undefined}>
              <button
                type="button"
                onClick={() => player.current?.seekTo(i * SCENE)}
                className="block w-full cursor-pointer rounded-md text-left"
              >
                <span aria-hidden className="block h-px bg-ink/15">
                  <span
                    // Remounted when it becomes current, so the fill restarts from empty.
                    key={i === active ? `on-${active}` : "off"}
                    className={cx("block h-px origin-left bg-ink", reduced || i < active ? "scale-x-100" : i > active && "scale-x-0")}
                    style={!reduced && i === active ? { animation: `step-fill ${(SCENE / FPS) * 1000}ms linear both` } : undefined}
                  />
                </span>
                <span className={cx("block pt-3 transition-opacity duration-300 ease-soft", reached ? "opacity-100" : "opacity-45")}>
                  <span className="block font-mono text-[12px] text-mut">0{i + 1}</span>
                  <span className="mt-2 block text-[14px] font-medium">{title}</span>
                  <span className="mt-1 block text-[13px] text-mut">{body}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
