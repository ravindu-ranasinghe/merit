/**
 * The one module the UI uses to talk to the backend. Components import `api` (usually via
 * the hooks in queries.ts) and never call fetch themselves.
 */
import { httpApi } from "@/lib/api/http";
import type { Api } from "@/lib/api/types";
import { MOCK } from "@/lib/env";
import { mockApi } from "@/mock/api";

export const api: Api = MOCK ? mockApi : httpApi;

export { ApiError } from "@/lib/api/types";
export type * from "@/lib/api/types";
