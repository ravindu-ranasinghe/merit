"use client";

import { useEffect, useRef, useState } from "react";
import type { MorphFieldHandle } from "asciify-engine/kit";
import { IconArrowRight, IconCheck, IconComment, IconCommit, IconLock } from "./icons";
import styles from "@/app/home.module.css";

const NAMES = ["review", "improve", "reward"];
const FRAMES = NAMES.map((name) => `/art/${name}.svg`);
const STEPS = [
  { label: "Review", note: "One thoughtful comment", title: "The timer outlives the editor.", detail: "Could we clear it on dispose?", icon: IconComment },
  { label: "Improve", note: "One accepted improvement", title: "+ clearTimeout(this.timer)", detail: "Fix committed · thread resolved", icon: IconCommit },
  { label: "Reward", note: "Credit where it’s earned", title: "+ 10.00 testnet USDC", detail: "Maintainer approved · reviewer claimed", icon: IconCheck },
] as const;

export function AsciiReview() {
  const host = useRef<HTMLDivElement>(null);
  const art = useRef<MorphFieldHandle | null>(null);
  const selected = useRef(0);
  const [step, setStep] = useState(0);
  const [enhanced, setEnhanced] = useState(false);

  useEffect(() => {
    let disposed = false;
    let handle: MorphFieldHandle | null = null;
    // Defer the renderer and keep the static artwork if it cannot initialize.
    void import("asciify-engine/kit").then(({ morphField }) => {
      if (disposed || !host.current) return;
      handle = morphField(host.current, {
        sources: FRAMES, autoplay: false, transition: 520, fit: "contain",
        ink: "--ascii-ink-strong", charset: " .,:;+*#%@",
        poster: `/art/${NAMES[selected.current]}-ascii.svg`, lazy: false,
        look: { cellSize: 7, hover: "none" },
      });
      art.current = handle;
      setEnhanced(handle.supported);
      handle.go(selected.current);
    }).catch(() => { /* The CSS poster and HTML controls remain available. */ });
    return () => { disposed = true; handle?.destroy(); art.current = null; };
  }, []);

  const pick = (index: number) => {
    selected.current = index;
    setStep(index);
    art.current?.update({ poster: `/art/${NAMES[index]}-ascii.svg` });
    art.current?.go(index);
  };
  const current = STEPS[step];
  const Icon = current.icon;

  return (
    <div className={styles.asciiStory}>
      <div className={styles.artMeta}><span>Every good catch has a story</span><span>0{step + 1} / 03</span></div>
      <div className={styles.artwork}>
        <div ref={host} className={styles.asciiCanvas} aria-hidden="true" style={{ backgroundImage: enhanced ? undefined : `url(/art/${NAMES[step]}-ascii.svg)` }} />
        <span className={styles.artAnnotation}><span /> {current.note}</span>
        <div className={styles.escrowNote}><IconLock size={13} /><span>Reward funded<br /><strong>before the first comment</strong></span></div>
      </div>
      <div className={styles.storyReceipt} aria-live="polite" aria-atomic="true">
        <span className={styles.receiptIcon}><Icon size={18} /></span>
        <div><p>{current.title}</p><span>{current.detail}</span></div>
        <span className={styles.receiptCorner} aria-hidden>↗</span>
      </div>
      <div className={styles.storyControls} aria-label="Illustrated review stages">
        {STEPS.map(({ label }, index) => (
          <button key={label} type="button" aria-pressed={index === step} onClick={() => pick(index)}><span>0{index + 1}</span>{label}{index < 2 && <IconArrowRight size={13} />}</button>
        ))}
      </div>
      <p className={styles.artCaption}>An illustrated example. Click through the story.</p>
    </div>
  );
}
