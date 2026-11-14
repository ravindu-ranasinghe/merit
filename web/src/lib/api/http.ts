/**
 * Real backend implementation of the Api interface.
 *
 * ASSUMED ROUTES. Engineer B publishes docs/api.md on Nov 15. Until then these paths and
 * shapes are this file's best reading of SPEC.md. When api.md lands, adapt this file only:
 * nothing else in web/ knows a route or a wire shape.
 *
 * Requests go to this app's own /api/backend proxy, which attaches the signed-in user's
 * GitHub token server-side. The browser never sees a secret or asserts a role.
 */
import { ApiError, type Api, type ApiErrorCode } from "@/lib/api/types";

const CODE_BY_STATUS: Record<number, ApiErrorCode> = {
  400: "validation",
  401: "unauthenticated",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  422: "validation",
};

async function request<T>(path: string, init?: { method?: "GET" | "POST"; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/backend${path}`, {
      method: init?.method ?? "GET",
      headers: init?.body ? { "content-type": "application/json" } : undefined,
      body: init?.body ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new ApiError("network", "Couldn't reach the Merit API. Check your connection and try again.");
  }
  if (!res.ok) {
    let message = `The Merit API returned ${res.status}.`;
    try {
      const data = (await res.json()) as { error?: string; message?: string };
      message = data.message ?? data.error ?? message;
    } catch {
      /* non-JSON error body: keep the default message */
    }
    throw new ApiError(CODE_BY_STATUS[res.status] ?? "network", message);
  }
  return (res.status === 204 ? null : await res.json()) as T;
}

const q = (params: Record<string, string | undefined>) => {
  const s = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1])).toString();
  return s ? `?${s}` : "";
};

export const httpApi: Api = {
  listRepositories: () => request("/repositories"),
  listPullRequests: (repoId) => request(`/repositories/${repoId}/pulls`),
  listBounties: (scope) => request(`/bounties${q({ scope })}`),
  getBounty: (id) => request(`/bounties/${id}`),
  createBounty: (input) => request("/bounties", { method: "POST", body: input }),
  reportFundingTx: (id, txHash) => request(`/bounties/${id}/funding-tx`, { method: "POST", body: { txHash } }),
  rejectCandidate: (id, candidateId) =>
    request(`/bounties/${id}/candidates/${candidateId}/reject`, { method: "POST", body: {} }),
  prepareApproval: (id, candidateId, amountUnits) =>
    request(`/bounties/${id}/approvals`, { method: "POST", body: { candidateId, amountUnits } }),
  reportApprovalTx: (id, txHash) => request(`/bounties/${id}/approval-tx`, { method: "POST", body: { txHash } }),
  getWalletLink: () => request("/wallet-link"),
  createWalletChallenge: (address) => request("/wallet-link/challenge", { method: "POST", body: { address } }),
  verifyWalletLink: (input) => request("/wallet-link/verify", { method: "POST", body: input }),
  listEvents: (filter) => request(`/events${q({ bountyId: filter?.bountyId })}`),
};
