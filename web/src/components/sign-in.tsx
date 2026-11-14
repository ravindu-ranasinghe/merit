"use client";

import type { ReactNode } from "react";
import { useViewer } from "@/lib/viewer";
import { IconGithub } from "./icons";
import { Button, Skeleton, Tray } from "./ui";

/** Renders children once someone is signed in with GitHub; otherwise a sign-in prompt. */
export function RequireSignIn({ why, children }: { why: string; children: ReactNode }) {
  const viewer = useViewer();
  if (viewer.loading) return <Skeleton className="h-60 !rounded-tray" />;
  if (!viewer.user) {
    return (
      <Tray tone="white" className="mx-auto max-w-md animate-rise text-center">
        <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-ink text-white">
          <IconGithub size={22} />
        </span>
        <h1 className="mt-4 text-[20px] font-semibold tracking-tight">Sign in with GitHub</h1>
        <p className="mx-auto mt-1.5 max-w-[40ch] text-[13.5px] text-mut">{why}</p>
        <div className="mt-5 flex justify-center">
          <Button onClick={viewer.signIn}>
            <IconGithub size={15} />
            Continue with GitHub
          </Button>
        </div>
      </Tray>
    );
  }
  return <>{children}</>;
}
