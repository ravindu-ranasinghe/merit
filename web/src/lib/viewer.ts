"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { PERSONAS, type PersonaKey } from "@/fixtures/seed";
import { fetchViewer, loginUrl, logout } from "@/lib/api/http";
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

/** Live mode: the backend's httpOnly session cookie decides who this is (GET /me). */
function useSessionViewer(): Viewer {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: fetchViewer, retry: false });
  return {
    user: me.data ?? null,
    loading: me.isLoading,
    signIn: () => window.location.assign(loginUrl),
    signOut: () => void logout().finally(() => qc.invalidateQueries()),
  };
}

/** Who is signed in. Identity is the immutable GitHub user ID from the session. */
export const useViewer: () => Viewer = MOCK ? useMockViewer : useSessionViewer;
