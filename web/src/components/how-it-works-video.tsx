import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Easing, Interactive, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { IconCheck, IconComment, IconCommit, IconGithub, IconLock, IconPullRequest } from "./icons";
import { DURATION, chapterAt } from "./walkthrough-timing";

const INK = "var(--color-ink, #3F3B33)";
const MUTED = "var(--color-mut, #6A6255)";
const PANEL = "var(--color-card, #F4EDDD)";
const SURFACE = "var(--color-tray, #DED6C1)";
const LINE = "var(--color-line, #B7B09E)";
const CLAMP = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const MOVE = { ...CLAMP, easing: Easing.bezier(.77, 0, .175, 1) };
const MONO = "var(--font-geist-mono, ui-monospace, monospace)";

function Reveal({ at = 0, children, style }: { at?: number; children: ReactNode; style?: CSSProperties }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = spring({ frame: frame - at, fps, config: { damping: 24, stiffness: 210, mass: .8 } });
  return <div style={{ ...style, opacity: interpolate(frame, [at, at + 14], [0, 1], CLAMP), translate: `0 ${(1 - progress) * 18}px` }}>{children}</div>;
}

function Scene({ children, duration, first = false }: { children: ReactNode; duration: number; first?: boolean }) {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  // Both sides share the same leftward travel and timing. The browser chrome stays put.
  const enter = first ? 0 : interpolate(frame, [0, 24], [width, 0], MOVE);
  const exit = interpolate(frame, [duration - 24, duration], [0, -width], MOVE);
  return <AbsoluteFill data-walkthrough-scene="" style={{ translate: `${enter + exit}px 0`, padding: 32, background: PANEL }}>{children}</AbsoluteFill>;
}

function Cursor({ start, click, from, to }: { start: number; click: number; from: [number, number]; to: [number, number] }) {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [start, click - 6], [0, 1], MOVE);
  return <div style={{ position: "absolute", left: 0, top: 0, zIndex: 5, pointerEvents: "none", translate: `${from[0] + (to[0] - from[0]) * progress}px ${from[1] + (to[1] - from[1]) * progress}px`, opacity: interpolate(frame, [start - 8, start, click + 36, click + 56], [0, 1, 1, 0], CLAMP) }}>
    <div style={{ position: "absolute", left: -18, top: -18, width: 42, height: 42, border: `2px solid ${INK}`, borderRadius: "50%", opacity: interpolate(frame, [click - 1, click, click + 22], [0, .45, 0], CLAMP), scale: interpolate(frame, [click, click + 22], [.65, 1.3], CLAMP) }} />
    <svg width="32" height="38" viewBox="0 0 26 32" style={{ scale: interpolate(frame, [click - 4, click, click + 6], [1, .88, 1], CLAMP), filter: "drop-shadow(0 2px 2px #0002)" }}><path d="M3 2v24l7-7 5 10 5-3-5-9h10z" fill={INK} stroke={PANEL} strokeWidth="2" strokeLinejoin="round" /></svg>
  </div>;
}

function Check({ at = 0, size = 24 }: { at?: number; size?: number }) {
  const frame = useCurrentFrame();
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="m5 12 4 4L19 6" pathLength={1} strokeDasharray="1" strokeDashoffset={interpolate(frame, [at, at + 24], [1, 0], CLAMP)} /></svg>;
}

function Badge({ children }: { children: ReactNode }) {
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 8, background: SURFACE, border: `1px solid ${LINE}`, padding: "8px 12px", borderRadius: 4, fontSize: 22, whiteSpace: "nowrap" }}>{children}</span>;
}

function Heading({ children, detail }: { children: ReactNode; detail: string }) {
  return <div style={{ marginBottom: 22 }}><div style={{ fontFamily: MONO, fontSize: 22, color: MUTED, display: "flex", alignItems: "center", gap: 10 }}><IconPullRequest size={22} /> acme / editor <span style={{ marginLeft: "auto" }}>#482</span></div><Interactive.Div name="Pull request title" style={{ marginTop: 16, fontSize: 34, fontWeight: 500, lineHeight: 1.2, letterSpacing: -.8 }}>{children}</Interactive.Div><p style={{ margin: "10px 0 0", color: MUTED, fontSize: 22 }}>{detail}</p></div>;
}

function Funding({ compact, first = true }: { compact: boolean; first?: boolean }) {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const funded = frame >= 180;
  return <Scene duration={384} first={first}>
    <Heading detail="Reward the feedback that leads to a fix">Fix autosave writing after close</Heading>
    <div style={{ border: `1px solid ${LINE}`, padding: 22, background: "var(--color-bg, #EBE2CC)", borderRadius: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}><span style={{ fontSize: 24, color: MUTED }}>Review reward</span><Badge>{funded ? <Check at={180} /> : <IconLock size={23} />}{funded ? "Funded" : "Ready to fund"}</Badge></div>
      <Interactive.Div name="Funded amount" style={{ fontFamily: MONO, fontSize: compact ? 68 : 76, lineHeight: 1.15, marginTop: 16, letterSpacing: -3 }}>10.00 <span style={{ fontSize: 24, color: MUTED, letterSpacing: 0 }}>testnet USDC</span></Interactive.Div>
      <div style={{ display: "flex", gap: 12, marginTop: 24 }}>{["$5.00", "$7.50", "$10.00"].map((amount, i) => <div key={amount} style={{ flex: 1, padding: "12px 16px", textAlign: "center", fontFamily: MONO, fontSize: 23, border: `1px solid ${i === 2 ? INK : LINE}`, background: i === 2 ? SURFACE : PANEL }}>{amount}</div>)}</div>
    </div>
    <div style={{ position: "relative", marginTop: 26, height: 68, overflow: "hidden", background: funded ? SURFACE : INK, color: funded ? INK : PANEL, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", gap: 12, fontSize: 26, fontWeight: 500, scale: interpolate(frame, [118, 126, 136], [1, .985, 1], CLAMP) }}>
      {funded ? <Check at={180} /> : <IconLock size={24} />}{funded ? "Locked before the first comment" : frame >= 126 ? "Confirming escrow…" : "Fund the review"}
      {!funded && <span style={{ position: "absolute", bottom: 0, left: 0, width: "100%", height: 3, background: SURFACE, scale: `${interpolate(frame, [126, 180], [0, 1], CLAMP)} 1`, transformOrigin: "left" }} />}
    </div>
    <Reveal at={190} style={{ marginTop: 20, fontSize: 23, color: MUTED, display: "flex", alignItems: "center", gap: 10 }}><IconLock size={23} /> Escrow confirmed on Arc testnet</Reveal>
    <Cursor start={60} click={126} from={[width - 90, 180]} to={[width * .48, compact ? 496 : 505]} />
  </Scene>;
}

function Code({ fix, compact }: { fix: boolean; compact: boolean }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const insertion = fix ? spring({ frame: frame - 54, fps, config: { damping: 26, stiffness: 190 } }) : 0;
  const row = compact ? 48 : 44;
  return <div style={{ border: `1px solid ${LINE}`, borderRadius: 5, overflow: "hidden", background: "var(--color-bg, #EBE2CC)" }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: `1px solid ${LINE}`, fontFamily: MONO, fontSize: compact ? 24 : 22 }}><span>src/editor/autosave.ts</span>{fix && <span style={{ opacity: insertion }}>+1 −0</span>}</div>
    <div style={{ position: "relative", padding: "18px 0", height: row * 4 + 36, fontFamily: MONO, fontSize: compact ? 26 : 25, lineHeight: `${row}px`, whiteSpace: "pre" }}>
      <div style={{ paddingLeft: 72 }}>dispose() {"{"}</div>
      <div style={{ paddingLeft: 72, background: fix ? "transparent" : "var(--color-warn-bg, #E6D9BA)" }}>{"  "}this.disposed = true;</div>
      {fix && <div style={{ position: "absolute", left: 0, right: 0, top: 18 + row * 2, paddingLeft: 58, background: "var(--color-diff-add-bg, #D7D7C1)", color: "var(--color-diff-add-ink, #434C36)", opacity: insertion, clipPath: `inset(0 ${(1 - insertion) * 100}% 0 0)` }}>+ clearTimeout(this.timer);</div>}
      <div style={{ paddingLeft: 72, translate: `0 ${insertion * row}px` }}>{"}"}</div>
      <div style={{ position: "absolute", left: 18, top: 18, color: MUTED, textAlign: "right", fontSize: 22 }}>106<br />107<br /><span style={{ opacity: fix ? insertion : 1 }}>108</span>{fix && <><br /><span style={{ opacity: insertion }}>109</span></>}</div>
    </div>
  </div>;
}

function Review({ compact }: { compact: boolean }) {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const comment = "The timer is never cleared, so a late tick writes to a closed file. Could we clear it on dispose?";
  return <Scene duration={384}>
    <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24, fontSize: 26, fontWeight: 500 }}><IconGithub size={28} /> Files changed <span style={{ marginLeft: "auto", fontSize: 23, color: MUTED }}>1 file</span></div>
    <Code fix={false} compact={compact} />
    <Reveal at={62} style={{ marginTop: 22, border: `1px solid ${LINE}`, borderLeft: `3px solid ${INK}`, borderRadius: 4, padding: 22, background: PANEL }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 25 }}><span style={{ display: "grid", placeItems: "center", width: 34, height: 34, borderRadius: "50%", background: SURFACE }}>J</span><strong style={{ fontWeight: 500 }}>jun-park</strong><span style={{ color: MUTED }}>reviewed</span></div>
      <Interactive.Div name="Review comment" style={{ marginTop: 14, minHeight: compact ? 116 : 72, fontSize: compact ? 27 : 26, lineHeight: 1.45 }}>{comment.slice(0, Math.floor(interpolate(frame, [90, 220], [0, comment.length], CLAMP)))}</Interactive.Div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}><span style={{ padding: "10px 16px", borderRadius: 3, background: frame >= 268 ? SURFACE : INK, color: frame >= 268 ? INK : PANEL, fontSize: 23, display: "flex", alignItems: "center", gap: 8 }}>{frame >= 268 && <Check at={268} size={22} />}{frame >= 268 ? "Comment added" : "Add review comment"}</span></div>
    </Reveal>
    <Cursor start={12} click={54} from={[width - 90, 130]} to={[66, compact ? 234 : 224]} />
    <Cursor start={228} click={260} from={[width * .55, 360]} to={[width - 150, compact ? 624 : 563]} />
  </Scene>;
}

function Improvement({ compact }: { compact: boolean }) {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  return <Scene duration={384}>
    <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24, fontSize: 26, fontWeight: 500 }}><IconGithub size={28} /> Feedback becomes a fix</div>
    <Code fix compact={compact} />
    <Reveal at={136} style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 28, fontSize: 25 }}><IconCommit size={26} /><span>Fix committed</span><span style={{ marginLeft: "auto", fontFamily: MONO, color: MUTED, fontSize: 23 }}>a41c9e7</span></Reveal>
    <Reveal at={190} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: 20, marginTop: 24, border: `1px solid ${LINE}`, borderRadius: 4 }}><span style={{ fontSize: 24 }}>jun-park’s review thread</span><Badge><Check at={190} /> Resolved</Badge></Reveal>
    <Reveal at={246} style={{ marginTop: 22, fontSize: 23, lineHeight: 1.4, color: MUTED }}>Review candidate found.<br />The maintainer still verifies the improvement.</Reveal>
    <div style={{ position: "absolute", top: compact ? 676 : 578, right: 32, opacity: interpolate(frame, [100, 120, 138, 152], [0, 1, 1, 0], CLAMP), background: INK, color: PANEL, padding: "12px 20px", borderRadius: 4, fontSize: 24 }}>Commit fix</div>
    <Cursor start={76} click={128} from={[width * .54, 290]} to={[width - 130, compact ? 692 : 596]} />
  </Scene>;
}

function Approval({ compact }: { compact: boolean }) {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const approved = frame >= 154;
  const paid = frame >= 330;
  return <Scene duration={480}>
    <Heading detail="Review evidence · maintainer decision">A good catch. An accepted fix.</Heading>
    <div style={{ padding: 22, border: `1px solid ${LINE}`, borderRadius: 4, fontSize: 25 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}><IconComment size={25} /> jun-park spotted the timer bug</div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 18, color: MUTED, fontSize: 24 }}><IconCommit size={25} /> Fix a41c9e7 · thread resolved</div>
    </div>
    <div style={{ position: "relative", marginTop: 22, height: 66, display: "flex", alignItems: "center", justifyContent: "center", gap: 12, borderRadius: 4, background: approved ? SURFACE : INK, color: approved ? INK : PANEL, fontSize: 25, fontWeight: 500, scale: interpolate(frame, [128, 136, 146], [1, .985, 1], CLAMP) }}>{approved ? <Check at={154} /> : <IconCheck size={25} />}{approved ? "Maintainer approval confirmed" : "Approve 10.00 for jun-park"}</div>
    <Reveal at={190} style={{ marginTop: 22, border: `1px solid ${LINE}`, background: "var(--color-bg, #EBE2CC)", borderRadius: 5, padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, fontSize: 24 }}><span>Reviewer · jun-park</span><span style={{ fontSize: 22, color: MUTED }}>{paid ? "Claimed" : "Ready to claim"}</span></div>
      <div style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 16, justifyContent: "space-between" }}><span style={{ fontSize: compact ? 56 : 64, fontFamily: MONO, letterSpacing: -2 }}>{paid ? "+10.00" : "10.00"}</span><span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "12px 18px", background: paid ? SURFACE : INK, color: paid ? INK : PANEL, borderRadius: 4, fontSize: 24 }}>{paid && <Check at={330} />}{paid ? "Reward claimed" : "Claim reward"}</span></div>
      <div style={{ color: MUTED, fontSize: 23, marginTop: 8 }}>testnet USDC · Arc</div>
    </Reveal>
    <Reveal at={372} style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 22, fontFamily: MONO, fontSize: 23, color: MUTED }}><Check at={372} /> RewardPaid · indexed and confirmed</Reveal>
    <Cursor start={70} click={136} from={[width - 70, 150]} to={[width * .49, 356]} />
    <Cursor start={230} click={298} from={[width * .45, 350]} to={[width - 150, compact ? 520 : 526]} />
  </Scene>;
}

/** A deterministic, seekable product demonstration, not a recording or live transaction. */
export function HowItWorksVideo({ compact = false }: { compact?: boolean }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const chapter = chapterAt(frame);
  const github = chapter === 1 || chapter === 2;
  return <AbsoluteFill style={{ background: PANEL, color: INK, fontFamily: "var(--font-geist, Arial, sans-serif)", lineHeight: 1.25, pointerEvents: "none" }}>
    <div style={{ height: 70, flexShrink: 0, display: "flex", alignItems: "center", gap: 16, padding: "0 24px", background: SURFACE, borderBottom: `1px solid ${LINE}` }}>
      <div style={{ display: "flex", gap: 5 }}>{[0, 1, 2].map(i => <span key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: MUTED, opacity: .5 }} />)}</div>
      {github ? <IconGithub size={26} /> : <span style={{ display: "grid", placeItems: "center", width: 29, height: 29, background: INK, color: PANEL, fontSize: 19, fontWeight: 500 }}>M</span>}
      <span style={{ fontFamily: MONO, fontSize: compact ? 23 : 21 }}>{github ? compact ? "GitHub / acme/editor #482" : "github.com/acme/editor/pull/482" : "merit / review reward"}</span>
      <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 21, color: MUTED }}>0{chapter + 1}/04</span>
    </div>
    <AbsoluteFill style={{ top: 70, height: "calc(100% - 70px)", overflow: "hidden" }}>
      <Sequence name="Fund the review in Merit" from={0} durationInFrames={6 * fps + 24}><Funding compact={compact} /></Sequence>
      <Sequence name="Leave feedback on GitHub" from={6 * fps} durationInFrames={6 * fps + 24}><Review compact={compact} /></Sequence>
      <Sequence name="Commit the fix and resolve the thread" from={12 * fps} durationInFrames={6 * fps + 24}><Improvement compact={compact} /></Sequence>
      <Sequence name="Approve and claim in Merit" from={18 * fps} durationInFrames={8 * fps}><Approval compact={compact} /></Sequence>
      <Sequence name="Return to the start" from={DURATION - 24} durationInFrames={24}><Funding compact={compact} first={false} /></Sequence>
    </AbsoluteFill>
  </AbsoluteFill>;
}
