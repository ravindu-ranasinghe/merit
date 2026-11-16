"use client";

/** React Query hooks over the typed API client. Query keys include the viewer's ID. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import type { Address, Bounty, CreateBountyInput, Hex } from "@/lib/api/types";
import { useViewer } from "@/lib/viewer";

/** Statuses that are waiting on the indexer, so the screen should keep checking. */
const WAITING: Bounty["status"][] = ["funding_pending", "approved"];

export function useRepositories() {
  const { user } = useViewer();
  return useQuery({ queryKey: ["repositories", user?.id], queryFn: api.listRepositories, enabled: !!user });
}

export function usePullRequests(repoId: string | null) {
  return useQuery({
    queryKey: ["pulls", repoId],
    queryFn: () => api.listPullRequests(repoId as string),
    enabled: !!repoId,
  });
}

export function useBounties(scope: "funded-by-me" | "reviewed-by-me") {
  const { user } = useViewer();
  return useQuery({
    queryKey: ["bounties", scope, user?.id],
    queryFn: () => api.listBounties(scope),
    enabled: !!user,
    refetchInterval: 5000,
  });
}

/**
 * One bounty. `watching` is set after the user sends a transaction: the screen then polls
 * the API until the indexed event changes the status. The UI never flips a money state itself.
 */
export function useBounty(id: string, watching = false) {
  return useQuery({
    queryKey: ["bounty", id],
    queryFn: () => api.getBounty(id),
    refetchInterval: (q) => (watching || (q.state.data && WAITING.includes(q.state.data.status)) ? 1200 : 8000),
  });
}

export function useOpenSource() {
  return useQuery({ queryKey: ["open-source"], queryFn: api.listOpenSource, refetchInterval: 30_000 });
}

export function useReviewerProfile(id: string) {
  return useQuery({ queryKey: ["reviewer-profile", id], queryFn: () => api.getReviewerProfile(id) });
}

export function useRefreshBounty() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (id: string) => api.refreshBounty(id), onSuccess: invalidate });
}

export function useEvents(bountyId?: string) {
  return useQuery({
    queryKey: ["events", bountyId ?? "all"],
    queryFn: () => api.listEvents(bountyId ? { bountyId } : undefined),
    refetchInterval: 2500,
  });
}

export function useWalletLink() {
  const { user } = useViewer();
  return useQuery({ queryKey: ["wallet-link", user?.id], queryFn: api.getWalletLink, enabled: !!user });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => Promise.all([
    qc.invalidateQueries({ queryKey: ["bounty"] }),
    qc.invalidateQueries({ queryKey: ["bounties"] }),
    qc.invalidateQueries({ queryKey: ["pulls"] }),
    qc.invalidateQueries({ queryKey: ["open-source"] }),
    qc.invalidateQueries({ queryKey: ["reviewer-profile"] }),
  ]);
}

export function useCreateBounty() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (input: CreateBountyInput) => api.createBounty(input), onSuccess: invalidate });
}

export function useReportFundingTx() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (v: { bountyId: string; txHash: Hex }) => api.reportFundingTx(v.bountyId, v.txHash),
    onSuccess: invalidate,
  });
}

export function useRejectCandidate() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (v: { bountyId: string; candidateId: string }) => api.rejectCandidate(v.bountyId, v.candidateId),
    onSuccess: invalidate,
  });
}

export function usePrepareApproval() {
  return useMutation({
    mutationFn: (v: { bountyId: string; candidateId: string; amountUnits: string }) =>
      api.prepareApproval(v.bountyId, v.candidateId, v.amountUnits),
  });
}

export function useReportApprovalTx() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (v: { bountyId: string; txHash: Hex }) => api.reportApprovalTx(v.bountyId, v.txHash),
    onSuccess: invalidate,
  });
}

export function useLinkWallet() {
  const qc = useQueryClient();
  return {
    challenge: useMutation({ mutationFn: (address: Address) => api.createWalletChallenge(address) }),
    verify: useMutation({
      mutationFn: (v: { address: Address; nonce: string; signature: Hex }) => api.verifyWalletLink(v),
      onSuccess: () => qc.invalidateQueries(),
    }),
  };
}
