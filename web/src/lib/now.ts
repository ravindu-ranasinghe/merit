"use client";

import { useSyncExternalStore } from "react";

/** A shared clock that ticks every 20 seconds, so deadlines flip to "passed" on their own. */
let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  timer ??= setInterval(() => {
    now = Date.now();
    listeners.forEach((l) => l());
  }, 20_000);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const snapshot = () => now;

/** The current time in ms, safe to read during render. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
