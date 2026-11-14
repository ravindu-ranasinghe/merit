import type { BountyStatus } from "@/lib/api/types";

export type Tone = "neutral" | "progress" | "good" | "warning" | "critical";

export interface StatusMeta {
  label: string;
  /** One line a maintainer or reviewer can act on. No blockchain vocabulary required. */
  description: string;
  tone: Tone;
  /** True for the money states the chain is the source of truth for. */
  onchain: boolean;
}

export const STATUS_META: Record<BountyStatus, StatusMeta> = {
  draft: {
    label: "Draft",
    description: "Bounty created. No money has moved yet.",
    tone: "neutral",
    onchain: false,
  },
  funding_pending: {
    label: "Awaiting funding",
    description: "Deposit sent. Waiting for the escrow contract to confirm it.",
    tone: "progress",
    onchain: false,
  },
  funded: {
    label: "Funded",
    description: "The reward is locked in escrow. Reviews can start.",
    tone: "progress",
    onchain: true,
  },
  review_candidate: {
    label: "Review candidate",
    description: "A review looks like it led to a fix. The maintainer decides.",
    tone: "progress",
    onchain: false,
  },
  approved: {
    label: "Approved",
    description: "The maintainer approved a payout. Waiting for the contract to confirm it.",
    tone: "progress",
    onchain: false,
  },
  claimable: {
    label: "Claimable",
    description: "The approval is confirmed. The reviewer can claim the reward.",
    tone: "progress",
    onchain: false,
  },
  paid: {
    label: "Paid",
    description: "The reviewer claimed the reward. This bounty is complete.",
    tone: "good",
    onchain: true,
  },
  expired: {
    label: "Expired",
    description: "The deadline passed. Unapproved funds can be refunded to the funder.",
    tone: "warning",
    onchain: false,
  },
  refunded: {
    label: "Refunded",
    description: "Unapproved funds went back to the funder.",
    tone: "neutral",
    onchain: true,
  },
  rejected: {
    label: "Rejected",
    description: "The maintainer decided this review does not qualify.",
    tone: "critical",
    onchain: false,
  },
};

export const MAIN_PATH: BountyStatus[] = [
  "draft",
  "funding_pending",
  "funded",
  "review_candidate",
  "approved",
  "claimable",
  "paid",
];

export type StepState = "done" | "current" | "upcoming";

export interface RailStep {
  status: BountyStatus;
  state: StepState;
  /** True for steps off the main path: Expired, Refunded, Rejected. */
  branch: boolean;
}

/**
 * The steps to draw for a status. The main path runs Draft to Paid. Expired and Refunded
 * branch off Funded; Rejected branches off Review candidate. A branch replaces the rest
 * of the main path, so the current stage is always the one highlighted step.
 */
export function railFor(status: BountyStatus): RailStep[] {
  const main = (upTo: BountyStatus, allDone: boolean): RailStep[] => {
    const end = MAIN_PATH.indexOf(upTo);
    return MAIN_PATH.slice(0, end + 1).map((s, i) => ({
      status: s,
      state: allDone || i < end ? "done" : "current",
      branch: false,
    }));
  };

  if (status === "expired") {
    return [
      ...main("funded", true),
      { status: "expired", state: "current", branch: true },
      { status: "refunded", state: "upcoming", branch: true },
    ];
  }
  if (status === "refunded") {
    return [
      ...main("funded", true),
      { status: "expired", state: "done", branch: true },
      { status: "refunded", state: "current", branch: true },
    ];
  }
  if (status === "rejected") {
    return [...main("review_candidate", true), { status: "rejected", state: "current", branch: true }];
  }

  const idx = MAIN_PATH.indexOf(status);
  return MAIN_PATH.map((s, i) => ({
    status: s,
    state: i < idx ? "done" : i === idx ? "current" : "upcoming",
    branch: false,
  }));
}

export const ALL_STATUSES: BountyStatus[] = [...MAIN_PATH, "expired", "refunded", "rejected"];
