import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Easing, interpolate, Series, useCurrentFrame } from "remotion";
import { IconCheck, IconCommit, IconGithub, IconLock } from "./icons";

/**
 * "How it works" as four short simulated screen recordings: Merit, GitHub, GitHub, Merit.
 * Drawn in code with sample data (the same bounty as the hero); nothing here is a real
 * capture of either site. Remotion rule: every motion is driven by the frame, never by a
 * CSS transition, so the player can seek and loop it exactly.
 */
export const FPS = 30;
export const SCENE = 4 * FPS;
export const SCENES = 4;
export const WIDTH = 1280;
export const HEIGHT = 580;

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const soft = { ...clamp, easing: Easing.bezier(0.22, 1, 0.36, 1) };

/** Fades and rises in at frame `at`. */
function Appear({ at, children, className, style }: { at: number; children: ReactNode; className?: string; style?: CSSProperties }) {
  const frame = useCurrentFrame();
  return (
    <div
      className={className}
      style={{
        ...style,
        opacity: interpolate(frame, [at, at + 10], [0, 1], clamp),
        translate: `0px ${interpolate(frame, [at, at + 14], [14, 0], soft)}px`,
      }}
    >
      {children}
    </div>
  );
}

/** Shown from frame `from` until `until`, with no motion: one state replacing another. */
function Between({ from = 0, until = Infinity, children }: { from?: number; until?: number; children: ReactNode }) {
  const frame = useCurrentFrame();
  return frame >= from && frame < until ? <>{children}</> : null;
}

function Typed({ text, from, to }: { text: string; from: number; to: number }) {
  const frame = useCurrentFrame();
  return <>{text.slice(0, Math.floor(interpolate(frame, [from, to], [0, text.length], clamp)))}</>;
}

/** A pointer that glides from one spot to another and clicks when it arrives. */
function Cursor({ from, to, start, click }: { from: [number, number]; to: [number, number]; start: number; click: number }) {
  const frame = useCurrentFrame();
  return (
    <div
      className="absolute left-0 top-0"
      style={{
        translate: `${interpolate(frame, [start, click - 4], [from[0], to[0]], soft)}px ${interpolate(frame, [start, click - 4], [from[1], to[1]], soft)}px`,
        opacity: interpolate(frame, [start - 6, start], [0, 1], clamp),
      }}
    >
      <span
        className="absolute -left-7 -top-7 size-14 rounded-full border-2 border-ink"
        style={{
          opacity: interpolate(frame, [click, click + 14], [0.5, 0], clamp),
          scale: interpolate(frame, [click, click + 14], [0.3, 1.2], soft),
        }}
      />
      <svg width="34" height="34" viewBox="0 0 24 24" style={{ scale: interpolate(frame, [click - 3, click, click + 5], [1, 0.82, 1], clamp) }}>
        <path d="M5 3l14 8-6 2-2 6z" fill="#171717" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

/** A browser window: which site this is, and which step of the four. */
function Screen({ site, url, step, children }: { site: "merit" | "github"; url: string; step: string; children: ReactNode }) {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill className="bg-card font-sans text-ink" style={{ opacity: interpolate(frame, [0, 8], [0, 1], clamp) }}>
      <div className="flex h-[72px] items-center gap-5 border-b border-line bg-tray px-7">
        <span className="flex gap-2">
          {[0, 1, 2].map((d) => (
            <span key={d} className="size-3.5 rounded-full bg-ink/15" />
          ))}
        </span>
        <span className="flex h-11 flex-1 items-center gap-3 rounded-lg bg-card px-4 font-mono text-[20px] text-ink-2 shadow-inner-card">
          {site === "github" ? (
            <IconGithub size={22} />
          ) : (
            <span className="flex size-6 items-center justify-center rounded bg-ink text-[13px] font-medium text-white">M</span>
          )}
          {url}
        </span>
        <span className="font-mono text-[20px] text-mut">{step}</span>
      </div>
      <div className="relative flex-1 px-14 py-10">{children}</div>
    </AbsoluteFill>
  );
}

const CODE = "whitespace-pre font-mono text-[26px] leading-[48px]";

function Lock() {
  return (
    <Screen site="merit" url="merit / new bounty" step="01">
      <p className="font-mono text-[22px] text-mut">acme/editor #482</p>
      <p className="mt-2 text-[44px] font-medium tracking-[-0.02em]">Fix autosave writing after close</p>
      <p className="mt-12 text-[24px] text-mut">Reward for the review that leads to a fix</p>
      <p className="mt-1 font-mono text-[84px] font-medium leading-none">
        $10.00 <span className="font-sans text-[32px] font-normal text-mut">USDC</span>
      </p>
      <div className="mt-10 h-[76px]">
        <Between until={62}>
          <span className="inline-flex h-[76px] items-center gap-4 rounded-xl bg-accent px-9 text-[30px] font-medium text-white">
            <IconLock size={28} /> Fund $10.00
          </span>
        </Between>
        <Between from={62}>
          <Appear at={62} className="inline-flex h-[76px] items-center gap-4 rounded-xl bg-tint px-9 text-[30px] font-medium text-accent-ink">
            <IconCheck size={28} /> Locked in escrow, before any review
          </Appear>
        </Between>
      </div>
      <Cursor from={[980, 180]} to={[190, 400]} start={18} click={56} />
    </Screen>
  );
}

function Review() {
  return (
    <Screen site="github" url="github.com/acme/editor/pull/482" step="02">
      <p className="font-mono text-[22px] text-mut">src/editor/autosave.ts</p>
      <div className={`mt-4 overflow-hidden rounded-xl bg-[#f6f8fa] py-3 shadow-inner-card ${CODE}`}>
        <p className="px-7">dispose() {"{"}</p>
        <p className="bg-warn-bg px-7">{"  "}this.disposed = true;</p>
        <p className="px-7">{"}"}</p>
      </div>
      <Appear at={34} className="mt-6 rounded-xl bg-card p-6 shadow-card">
        <p className="flex items-center gap-3 text-[24px]">
          <span className="flex size-9 items-center justify-center rounded-full bg-ink text-[18px] font-medium text-white">J</span>
          <span className="font-medium">jun-park</span>
          <span className="text-mut">reviewing</span>
        </p>
        <p className="mt-3 min-h-[84px] border-l-4 border-accent pl-5 text-[30px] leading-[42px]">
          <Typed text="The timer is never cleared, so a late tick writes to a closed file." from={42} to={100} />
        </p>
      </Appear>
      <Cursor from={[1040, 60]} to={[420, 130]} start={8} click={30} />
    </Screen>
  );
}

function Fix() {
  const frame = useCurrentFrame();
  return (
    <Screen site="github" url="github.com/acme/editor/pull/482" step="03">
      <p className="font-mono text-[22px] text-mut">src/editor/autosave.ts</p>
      <div className={`mt-4 overflow-hidden rounded-xl bg-[#f6f8fa] py-3 shadow-inner-card ${CODE}`}>
        <p className="px-7">dispose() {"{"}</p>
        <p className="px-7">{"  "}this.disposed = true;</p>
        <p
          className="overflow-hidden bg-[#e3f3e1] px-7 text-[#12501a]"
          style={{ height: interpolate(frame, [22, 36], [0, 48], soft), opacity: interpolate(frame, [26, 38], [0, 1], clamp) }}
        >
          +{" "}clearTimeout(this.timer);
        </p>
        <p className="px-7">{"}"}</p>
      </div>
      <Appear at={48} className="mt-6 flex items-center gap-3 text-[26px] text-ink-2">
        <IconCommit size={28} className="text-mut" />
        The author pushes a fix <span className="font-mono text-ink">a41c9e7</span>
      </Appear>
      <Appear at={74} className="mt-5 flex items-center justify-between rounded-xl bg-card px-6 py-5 text-[26px] shadow-card">
        <span>
          <span className="font-medium">jun-park</span> <span className="text-mut">The timer is never cleared…</span>
        </span>
        <span className="inline-flex h-12 items-center gap-2 rounded-lg bg-tint px-4 font-medium text-accent-ink">
          <IconCheck size={24} /> Resolved
        </span>
      </Appear>
    </Screen>
  );
}

function Approve() {
  return (
    <Screen site="merit" url="merit / bounty #482" step="04">
      <p className="text-[24px] text-mut">Review evidence</p>
      <p className="mt-2 text-[36px] font-medium tracking-[-0.02em]">jun-park&apos;s comment led to fix a41c9e7</p>
      <div className="mt-8 h-[76px]">
        <Between until={52}>
          <span className="inline-flex h-[76px] items-center rounded-xl bg-accent px-9 text-[30px] font-medium text-white">
            Approve $10.00 for jun-park
          </span>
        </Between>
        <Between from={52}>
          <Appear at={52} className="inline-flex h-[76px] items-center gap-4 rounded-xl bg-tint px-9 text-[30px] font-medium text-accent-ink">
            <IconCheck size={28} /> Approved by the maintainer
          </Appear>
        </Between>
      </div>
      <div className="mt-9 font-mono text-[26px]">
        <p className="flex justify-between border-t border-line py-3">
          <span>BountyFunded</span>
          <span>+10.00</span>
        </p>
        <Appear at={64} className="flex justify-between border-t border-line py-3">
          <span>RewardApproved</span>
          <span>10.00</span>
        </Appear>
        <Appear at={88} className="flex justify-between border-t border-line py-3 text-accent-ink">
          <span>RewardPaid → jun-park</span>
          <span>−10.00</span>
        </Appear>
      </div>
      <Cursor from={[1000, 420]} to={[250, 210]} start={14} click={48} />
    </Screen>
  );
}

export function HowItWorksVideo() {
  return (
    <Series>
      <Series.Sequence durationInFrames={SCENE}><Lock /></Series.Sequence>
      <Series.Sequence durationInFrames={SCENE}><Review /></Series.Sequence>
      <Series.Sequence durationInFrames={SCENE}><Fix /></Series.Sequence>
      <Series.Sequence durationInFrames={SCENE}><Approve /></Series.Sequence>
    </Series>
  );
}
