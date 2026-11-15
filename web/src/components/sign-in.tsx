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
        <span className="mx-auto flex size-11 items-center justify-center rounded-ctl bg-accent text-bg">
          <IconGithub size={22} />
        </span>
        <h1 className="mt-4 text-[20px] font-medium">Sign in with GitHub</h1>
        <p className="mx-auto mt-2 max-w-[40ch] text-[14px] text-mut">{why}</p>
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
