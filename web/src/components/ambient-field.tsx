"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { GlyphField } from "asciify-engine/field";
import { usePathname } from "next/navigation";

const MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const subscribe = (notify: () => void) => {
  const media = window.matchMedia(MOTION_QUERY);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
};
const getReducedMotion = () => window.matchMedia(MOTION_QUERY).matches;
const getServerMotion = () => false;
const FLUID = { resolution: 96, force: .5, curl: 8, refraction: .025, glow: .3 };

function setPlayback(field: GlyphField, stopped: boolean) {
  if (stopped) {
    field.pointer(null);
    field.update({ hover: "none", fluid: false });
    field.pause();
  } else {
    field.update({ hover: "fluid", fluid: FLUID });
    field.play();
  }
}

// Three branching streams become one: review, improvement, reward.
// The GPU evaluates the entire scene; there is no pixel readback or React frame loop.
const CURRENTS = `
  vec2 p = uv * vec2(aspect, 1.);
  float t = time * .22;
  float x = p.x - t * .11;
  float bend = .52 + .14 * sin(x * 2.8 - t) + .06 * cos(x * 5.2 + t * .7);
  float split = .24 * (.5 + .5 * sin(x * 1.5 + t * .3));
  float a = exp(-pow((uv.y - bend - split) * 15., 2.));
  float b = exp(-pow((uv.y - bend) * 13., 2.));
  float c = exp(-pow((uv.y - bend + split) * 15., 2.));
  float ribbon = max(max(a, b * .85), c);
  float ribs = .45 + .55 * pow(.5 + .5 * sin(p.x * 38. + uv.y * 24. - t * 4.), 3.);
  float threads = pow(.5 + .5 * cos(uv.y * 180. + sin(x * 3. - t) * 10.), 16.);
  float current = ribbon * (.22 + ribs * .56 + threads * .18);
  float distanceToPointer = distance(p, pointer * vec2(aspect, 1.));
  float wake = exp(-distanceToPointer * 7.) * pointerOn;
  tone = clamp(current + wake * .18, 0., 1.);
  glyph += floor(t * 2. + p.x * 3.);
`;

export function AmbientField() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const field = useRef<GlyphField | null>(null);
  const desiredPause = useRef(false);
  const clearRects = useRef<{ left: number; top: number; width: number; height: number }[]>([]);
  const pathname = usePathname();
  const [paused, setPaused] = useState(false);
  const [available, setAvailable] = useState(false);
  const reduced = useSyncExternalStore(subscribe, getReducedMotion, getServerMotion);
  const stopped = paused || reduced;

  useEffect(() => {
    let disposed = false;
    let failed = false;
    let instance: GlyphField | null = null;
    const element = canvas.current;
    if (!element) return;
    void import("asciify-engine/field").then(async ({ mountGlyphField, defineFieldEffect, isGlyphFieldSupported }) => {
      if (disposed || !isGlyphFieldSupported()) return;
      const ink = getComputedStyle(element).getPropertyValue("--field-ink").trim();
      instance = mountGlyphField(element, {
        scene: "none", context: "own", charset: " .,:;-=+*/<>[]{}01", glyphOrder: "tone",
        cellSize: 12, cellAspect: .62, glyphScale: .85, maxPixelRatio: 1,
        ink, color: "ink", shade: .3, background: "transparent", levels: "none",
        hover: "fluid", fluid: FLUID,
        clear: { rects: () => clearRects.current, padding: 16, softness: 72, strength: .96, bend: .05 },
        effects: [defineFieldEffect({ name: "merit-currents", animate: true, shade: CURRENTS })],
        respectReducedMotion: true,
        onError: () => { failed = true; element.dataset.ready = "false"; setAvailable(false); },
      });
      field.current = instance;
      await instance.ready;
      if (disposed || failed) { instance.destroy(); return; }
      element.dataset.ready = "true";
      setAvailable(true);
      setPlayback(instance, desiredPause.current);
    }).catch(() => { element.dataset.ready = "false"; });
    return () => { disposed = true; instance?.destroy(); field.current = null; };
  }, []);

  useEffect(() => {
    desiredPause.current = stopped;
    if (field.current) setPlayback(field.current, stopped);
  }, [stopped]);

  useEffect(() => {
    // Cache layout only when it changes; the GPU loop never measures DOM elements.
    const measure = () => {
      clearRects.current = [...document.querySelectorAll("[data-field-clear]")].map(element => {
        const { left, top, width, height } = element.getBoundingClientRect();
        return { left, top, width, height };
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    const frame = requestAnimationFrame(measure);
    return () => { observer.disconnect(); window.removeEventListener("scroll", measure); window.removeEventListener("resize", measure); cancelAnimationFrame(frame); };
  }, [pathname]);

  return (
    <>
      <div className="ambient-background" aria-hidden="true">
        <div className="ambient-poster" />
        <canvas ref={canvas} data-merit-field="" data-motion={stopped ? "paused" : "running"} className="ambient-canvas" />
      </div>
      {available && <button type="button" className="motion-toggle" aria-label={stopped ? "Resume background animation" : "Pause background animation"} aria-pressed={stopped} disabled={reduced} title={reduced ? "Following your reduced-motion preference" : undefined} onClick={() => setPaused(!paused)}>
        <span aria-hidden="true">{stopped ? "[ ▷ ]" : "[ Ⅱ ]"}</span> Motion {stopped ? "off" : "on"}
      </button>}
    </>
  );
}
