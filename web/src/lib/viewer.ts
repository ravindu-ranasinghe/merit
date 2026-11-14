"use client";

import { signIn, signOut, useSession } from "next-auth/react";
import { useSyncExternalStore } from "react";
import { PERSONAS, type PersonaKey } from "@/fixtures/seed";
import type { GithubUser } from "@/lib/api/types";
import { MOCK } from "@/lib/env";
import { getPersonaKey, subscribePersona } from "@/mock/store";

export interface Viewer {
  user: GithubUser | null;
  loading: boolean;
  signIn: () => void;
  signOut: () => void;
  /** Mock mode only: which sample persona is active. */
  persona?: PersonaKey;
}

const noop = () => {};

function useMockViewer(): Viewer {
  const persona = useSyncExternalStore(subscribePersona, getPersonaKey, () => "maintainer" as const);
  return { user: PERSONAS[persona].user, loading: false, signIn: noop, signOut: noop, persona };
}

function useSessionViewer(): Viewer {
  const { data, status } = useSession();
  const u = data?.user;
  return {
    user: u?.id ? { id: u.id, login: u.login, name: u.name ?? undefined, avatarUrl: u.image ?? undefined } : null,
    loading: status === "loading",
    signIn: () => void signIn("github"),
    signOut: () => void signOut({ callbackUrl: "/" }),
  };
}

/** Who is signed in. Identity is the immutable GitHub user ID from the session. */
export const useViewer: () => Viewer = MOCK ? useMockViewer : useSessionViewer;
