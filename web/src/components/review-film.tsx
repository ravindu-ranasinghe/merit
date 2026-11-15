"use client";

import { Player, type PlayerRef } from "@remotion/player";
import { useEffect, useMemo, useRef, useState } from "react";
import { HowItWorksVideo } from "./how-it-works-video";
import { CHAPTERS, DURATION, FPS, chapterAt } from "./walkthrough-timing";
import styles from "@/app/home.module.css";

export default function ReviewFilm({ compact, visible, reduced, request, onChapterChange }: { compact: boolean; visible: boolean; reduced: boolean; request: { index: number; revision: number }; onChapterChange: (index: number) => void }) {
  const player = useRef<PlayerRef>(null);
  const slider = useRef<HTMLInputElement>(null);
  const timestamp = useRef<HTMLSpanElement>(null);
  const chapter = useRef(0);
  const lastReported = useRef(-1);
  const manuallyPaused = useRef(false);
  const [playing, setPlaying] = useState(false);
  const inputProps = useMemo(() => ({ compact }), [compact]);
  const initialFrame = reduced ? CHAPTERS[0].still : 0;

  useEffect(() => {
    const p = player.current;
    if (!p) return;
    const update = ({ detail: { frame } }: { detail: { frame: number } }) => {
      if (slider.current) {
        slider.current.value = String(frame);
        slider.current.setAttribute("aria-valuetext", `${Math.floor(frame / FPS)} of 26 seconds`);
      }
      if (timestamp.current) timestamp.current.textContent = `0:${String(Math.floor(frame / FPS)).padStart(2, "0")} / 0:26`;
      const next = chapterAt(frame);
      chapter.current = next;
      if (next !== lastReported.current) { lastReported.current = next; onChapterChange(next); }
    };
    const play = () => setPlaying(true);
    const pause = () => setPlaying(false);
    p.addEventListener("frameupdate", update); p.addEventListener("play", play); p.addEventListener("pause", pause);
    return () => { p.removeEventListener("frameupdate", update); p.removeEventListener("play", play); p.removeEventListener("pause", pause); };
  }, [onChapterChange]);

  useEffect(() => {
    const sync = () => {
      if (!visible || reduced || document.hidden || manuallyPaused.current) player.current?.pause();
      else player.current?.play();
    };
    if (reduced) player.current?.seekTo(CHAPTERS[chapter.current].still);
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [visible, reduced]);

  useEffect(() => {
    if (!request.revision) return;
    player.current?.seekTo(reduced ? CHAPTERS[request.index].still : CHAPTERS[request.index].start + 24);
  }, [request, reduced]);

  return <div className={styles.film}>
    <div className={styles.filmViewport} data-walkthrough-player="" data-fps={FPS}>
      <Player ref={player} component={HowItWorksVideo} inputProps={inputProps} durationInFrames={DURATION} compositionWidth={compact ? 720 : 1120} compositionHeight={compact ? 900 : 800} fps={FPS} loop acknowledgeRemotionLicense initialFrame={initialFrame} style={{ width: "100%", display: "block" }} />
    </div>
    <div className={styles.filmControls}>
      <button type="button" aria-label={playing ? "Pause walkthrough" : "Play walkthrough"} disabled={reduced} onClick={() => { manuallyPaused.current = playing; if (playing) player.current?.pause(); else player.current?.play(); }}>{playing ? "Ⅱ" : "▷"}</button>
      <input ref={slider} type="range" aria-label="Scrub walkthrough" aria-valuetext={`${Math.floor(initialFrame / FPS)} of 26 seconds`} min={0} max={DURATION - 1} defaultValue={initialFrame} onChange={event => player.current?.seekTo(Number(event.target.value))} />
      <span ref={timestamp} className={styles.filmTime}>0:{String(Math.floor(initialFrame / FPS)).padStart(2, "0")} / 0:26</span>
      <button type="button" aria-label="Replay walkthrough" onClick={() => { player.current?.seekTo(reduced ? CHAPTERS[0].still : 0); if (!reduced) { manuallyPaused.current = false; player.current?.play(); } }}>↺</button>
    </div>
  </div>;
}
