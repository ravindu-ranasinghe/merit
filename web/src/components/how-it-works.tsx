"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { IconArrowRight } from "./icons";
import { CHAPTERS } from "./walkthrough-timing";
import styles from "@/app/home.module.css";

const Film = dynamic(() => import("./review-film"), { ssr: false, loading: () => <div className={styles.filmPlaceholder}>Merit → GitHub → Merit</div> });
const subscribe = (callback: () => void) => {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const mobile = matchMedia("(max-width: 760px)");
  reduced.addEventListener("change", callback); mobile.addEventListener("change", callback);
  return () => { reduced.removeEventListener("change", callback); mobile.removeEventListener("change", callback); };
};
const getReduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const getCompact = () => matchMedia("(max-width: 760px)").matches;

export function HowItWorks() {
  const host = useRef<HTMLDivElement>(null);
  const [enabled, setEnabled] = useState(false);
  const [visible, setVisible] = useState(false);
  const [active, setActive] = useState(0);
  const [request, setRequest] = useState({ index: 0, revision: 0 });
  const reduced = useSyncExternalStore(subscribe, getReduced, () => true);
  const compact = useSyncExternalStore(subscribe, getCompact, () => false);
  const onChapterChange = useCallback((index: number) => setActive(index), []);

  useEffect(() => {
    if (!host.current) return;
    const near = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setEnabled(true); near.disconnect(); } }, { rootMargin: "300px" });
    const shown = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: .15 });
    near.observe(host.current); shown.observe(host.current);
    return () => { near.disconnect(); shown.disconnect(); };
  }, []);

  return <div className={styles.walkthrough}>
    <ol className={styles.steps}>
      {CHAPTERS.map(({ title, body }, index) => <li key={title}><button type="button" className={styles.step} aria-pressed={active === index} aria-controls="workflow-example" onClick={() => { setActive(index); setRequest(previous => ({ index, revision: previous.revision + 1 })); }}><span className={styles.stepNumber}>0{index + 1}</span><span><strong>{title}</strong><span>{body}</span></span><IconArrowRight size={16} /></button></li>)}
    </ol>
    <div ref={host} id="workflow-example" className={styles.filmExample} role="region" aria-label="Animated walkthrough of Merit and GitHub">
      {enabled ? <Film key={String(compact)} compact={compact} visible={visible} reduced={reduced} request={request} onChapterChange={onChapterChange} /> : <div className={styles.filmPlaceholder}>Merit → GitHub → Merit</div>}
      <div className={styles.filmFooter}><span>Illustrated workflow · sample data · testnet USDC</span><Link href={active === 3 ? "/reviewer" : "/maintainer"}>Try the app <IconArrowRight size={13} /></Link></div>
    </div>
  </div>;
}
