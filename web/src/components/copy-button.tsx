"use client";

import { useState } from "react";
import { Button } from "./ui";

export function CopyButton({ value, label = "Copy link" }: { value: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button variant="secondary" onClick={async () => {
        try { await navigator.clipboard.writeText(value); setState("copied"); }
        catch { setState("failed"); }
      }}>{label}</Button>
      <span role="status" className="text-[12px] text-mut">
        {state === "copied" ? "Copied" : state === "failed" ? "Clipboard unavailable. Select and copy the link below." : ""}
      </span>
      {state === "failed" && <input aria-label="Text to copy" className="w-full rounded-ctl border border-line bg-card p-2 text-[12px]" readOnly value={value} onFocus={(e) => e.currentTarget.select()} />}
    </span>
  );
}
