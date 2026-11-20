"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useReportFundingTx } from "@/lib/api/queries";
import type { Bounty } from "@/lib/api/types";
import { useClaim, useFundBounty, useNeedsGas, useRefundExpired, useWallet, type FundPhase } from "@/lib/chain/hooks";
import { escrowAmounts } from "@/lib/accounting";
import { formatDeadline, formatUsdc, relativeTime } from "@/lib/format";
import { useNow } from "@/lib/now";
import { useViewer } from "@/lib/viewer";
import { IconCheck, IconCheckDraw, IconExternal, IconGithub, IconLock } from "./icons";
import { ChainErrorView, TxProgress } from "./tx";
import { AddressLink, BlockLink, Button, cx, LinkButton, Money, Notice, Spinner, TxLink, UserChip } from "./ui";
import { GasStep, WalletGate } from "./wallet";

function Heading({ children }: { children: ReactNode }) {
  return <h2 className="text-[16px] font-medium">{children}</h2>;
}

function Lead({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-[14px] text-ink-2">{children}</p>;
}

/* ---------- funding ---------- */

type FundStep = { title: string; body: string; active: (p: FundPhase, sent: boolean) => boolean; done: (p: FundPhase, sent: boolean) => boolean };

const FUND_STEPS: FundStep[] = [
  {
    title: "Allow the escrow contract to take this amount",
    body: "A one-time permission for exactly this bounty's amount of your testnet USDC.",
    active: (p, sent) => p === "approve_wallet" || p === "approve_confirming" || (p === "checking" && !sent),
    done: (p, sent) => sent && p !== "not_funded",
  },
  {
    title: "Deposit into escrow",
    body: "The contract pulls the USDC and locks it for this pull request.",
    active: (p, sent) => p === "deposit_wallet" || p === "deposit_confirming" || p === "pending" || (p === "checking" && sent),
    done: (p) => p === "done",
  },
  {
    title: "Confirmed by the contract",
    body: "The bounty shows as Funded once the contract's funding event has been indexed.",
    active: (p) => p === "done",
    done: () => false,
  },
];

const sameWallet = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

function FundPanel({ bounty, onSent }: { bounty: Bounty; onSent: () => void }) {
  const wallet = useWallet();
  const report = useReportFundingTx();
  // Called the moment the wallet broadcasts the deposit, before any receipt: the deposit is recorded by then.
  const fund = useFundBounty(bounty.id, wallet.address, (txHash) => {
    onSent();
    report.mutate({ bountyId: bounty.id, txHash });
  });
  const sent = !!fund.depositHash && fund.phase !== "not_funded";
  // Prompt 1: a bounty only binds funding from the wallet recorded when it was created.
  const wrongWallet = !!bounty.funderWallet && !!wallet.address && !sameWallet(bounty.funderWallet, wallet.address);

  const start = () =>
    fund.run({ githubRepoId: bounty.repo.githubRepoId, prNumber: bounty.pr.number, amountUnits: bounty.amountUnits, deadline: bounty.deadline });

  return (
    <div>
      <Heading>Fund this bounty</Heading>
      <Lead>
        Nothing is locked yet. Funding takes two confirmations in your wallet, then {formatUsdc(bounty.amountUnits)} sits in
        escrow until you approve a review or the deadline passes on {formatDeadline(bounty.deadline)}.
      </Lead>

      <ol className="mt-4 space-y-2">
        {FUND_STEPS.map((s, i) => {
          const active = s.active(fund.phase, sent);
          const done = s.done(fund.phase, sent);
          return (
            <li key={s.title} className={cx("flex gap-3 rounded-card px-4 py-3 transition-colors duration-500", active ? "bg-tint" : "bg-card shadow-inner-card")}>
              <span
                className={cx(
                  "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] font-medium",
                  done ? "bg-ink text-bg" : active ? "bg-accent text-bg" : "bg-tray-2 text-mut",
                )}
              >
                {done ? <IconCheck size={12} /> : active && fund.phase !== "done" ? <Spinner className="size-3" /> : i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-medium">{s.title}</span>
                <span className="block text-[13px] text-mut">
                  {active && fund.phase.endsWith("_wallet") ? "Confirm in your wallet." : s.body}
                </span>
              </span>
              {i === 0 && fund.approveHash && <TxLink hash={fund.approveHash} />}
              {i === 1 && fund.depositHash && <TxLink hash={fund.depositHash} />}
            </li>
          );
        })}
      </ol>

      <div className="mt-3 space-y-3">
        {fund.phase === "pending" && (
          <Notice tone="progress" title="Deposit sent. Arc has not confirmed it yet">
            Your wallet broadcast the deposit, but its result is not known yet. Checking again looks at that same
            deposit; it never sends another one.
          </Notice>
        )}
        {fund.phase === "done" && (
          <Notice tone="good" title="Deposit confirmed on Arc">
            Waiting for the funding event to be indexed. The bounty shows as Funded then. There is nothing more to sign.
          </Notice>
        )}
        {fund.phase === "not_funded" && (
          <Notice tone="warning" title={fund.notFundedReason === "reverted" ? "That deposit reverted" : "That deposit was replaced"}>
            {fund.notFundedReason === "reverted"
              ? "Arc reverted the deposit, so no USDC moved. You can fund the bounty again."
              : "Your wallet used that transaction's slot for a different transaction, and nothing funded this bounty. You can fund it again."}
          </Notice>
        )}
        {fund.phase === "other_wallet" && fund.otherWallet && (
          <Notice tone="warning" title="A deposit from another wallet is recorded">
            A deposit from <AddressLink address={fund.otherWallet} /> is waiting for this bounty. Connect that wallet to check it.
          </Notice>
        )}
        {fund.canFund && wrongWallet && bounty.funderWallet && (
          <Notice tone="warning" title="Switch to your linked wallet">
            This bounty only accepts funding from <AddressLink address={bounty.funderWallet} />, the wallet linked to your
            GitHub account. A deposit from this wallet would not count toward it.
          </Notice>
        )}
        {fund.error && <ChainErrorView error={fund.error} />}
      </div>

      <div className="mt-4">
        <WalletGate reason="Connect the wallet that holds your testnet USDC.">
          {fund.canFund ? (
            <Button variant="accent" onClick={() => void start()} loading={fund.busy} disabled={wrongWallet}>
              <IconLock size={15} />
              {fund.phase === "error" ? "Try again" : fund.phase === "not_funded" ? "Fund again" : `Fund ${formatUsdc(bounty.amountUnits)}`}
            </Button>
          ) : fund.phase === "pending" || fund.phase === "checking" ? (
            <Button variant="secondary" onClick={() => void fund.recheck()} loading={fund.busy}>
              Check the deposit again
            </Button>
          ) : null}
        </WalletGate>
      </div>
    </div>
  );
}

/* ---------- claim ---------- */

function ClaimPanel({ bounty, onSent }: { bounty: Bounty; onSent: () => void }) {
  const wallet = useWallet();
  const claim = useClaim();
  const approval = bounty.approval;
  const needsGas = useNeedsGas(approval?.approvedRecipient);
  if (!approval || !bounty.onchainBountyId) return null;
  const onchainId = bounty.onchainBountyId;
  const mismatch = wallet.address && wallet.address.toLowerCase() !== approval.approvedRecipient.toLowerCase();

  return (
    <div>
      <Heading>Your reward is ready to claim</Heading>
      <Lead>
        <UserChip user={bounty.funder} /> approved your review. Claiming sends{" "}
        <strong className="font-medium text-ink">{formatUsdc(approval.amountUnits)}</strong> from escrow to your linked wallet.
      </Lead>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-card bg-card px-4 py-3 shadow-inner-card">
        <Money units={approval.amountUnits} className="text-[28px]" />
        <span className="text-[13px] text-mut">
          to <AddressLink address={approval.approvedRecipient} />
        </span>
      </div>
      {mismatch && (
        <Notice tone="warning" className="mt-3" title="This is not the wallet the reward was approved for">
          Switch your wallet to the linked address. The contract only pays the approved recipient.
        </Notice>
      )}
      <GasStep address={approval.approvedRecipient} className="mt-3" />
      <div className="mt-4 space-y-3">
        {claim.phase !== "done" && (
          <WalletGate reason="Connect your linked payout wallet to claim.">
            <Button
              variant="accent"
              loading={claim.busy}
              disabled={needsGas}
              onClick={async () => {
                if (await claim.run(onchainId)) onSent();
              }}
            >
              {claim.phase === "error" ? "Try again" : `Claim ${formatUsdc(approval.amountUnits)}`}
            </Button>
          </WalletGate>
        )}
        <TxProgress phase={claim.phase} hash={claim.hash} error={claim.error} confirmedInMs={claim.confirmedInMs} indexedLabel="Waiting for the payout event to be indexed." />
      </div>
    </div>
  );
}

/* ---------- refund ---------- */

function RefundPanel({ bounty, onSent }: { bounty: Bounty; onSent: () => void }) {
  const refund = useRefundExpired();
  const now = useNow();
  if (!bounty.onchainBountyId) return null;
  const onchainId = bounty.onchainBountyId;
  const a = escrowAmounts(bounty, now);
  const refundable = a.refundable.toString();
  const partial = a.approved > BigInt(0);

  return (
    <div>
      <Heading>{partial ? "Refund the unapproved remainder" : "This bounty expired without a payout"}</Heading>
      <Lead>
        The deadline passed {relativeTime(bounty.deadline)}.{" "}
        {partial && (
          <>
            {formatUsdc(a.approved)} of the {formatUsdc(a.funded)} was approved for the reviewer
            {a.paid > BigInt(0) ? " and has been paid" : " and stays reserved for them to claim"}; the rest can go back.{" "}
          </>
        )}
        The contract cannot act on a clock, so the refund needs one transaction. Anyone may send it, and the money can
        only go back to the wallet that funded the bounty.
      </Lead>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-card bg-card px-4 py-3 shadow-inner-card">
        <Money units={refundable} className="text-[28px]" />
        <span className="text-[13px] text-mut">
          back to {bounty.funderWallet ? <AddressLink address={bounty.funderWallet} /> : "the funder"}
        </span>
      </div>
      <div className="mt-4 space-y-3">
        {refund.phase !== "done" && (
          <WalletGate reason="Any wallet can send the refund transaction.">
            <Button
              variant="primary"
              loading={refund.busy}
              onClick={async () => {
                if (await refund.run(onchainId)) onSent();
              }}
            >
              {refund.phase === "error" ? "Try again" : `Refund ${formatUsdc(refundable)} to the funder`}
            </Button>
          </WalletGate>
        )}
        <TxProgress phase={refund.phase} hash={refund.hash} error={refund.error} confirmedInMs={refund.confirmedInMs} indexedLabel="Waiting for the refund event to be indexed." />
      </div>
    </div>
  );
}

/* ---------- receipts and waiting states ---------- */

function Waiting({ title, children, hash }: { title: string; children: ReactNode; hash?: string | null }) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <Spinner className="text-accent" />
        <Heading>{title}</Heading>
      </div>
      <Lead>{children}</Lead>
      {hash && (
        <p className="mt-3 text-[13px] text-mut">
          Transaction <TxLink hash={hash} />
        </p>
      )}
    </div>
  );
}

function Receipt({ title, units, line, tx }: { title: string; units: string; line: ReactNode; tx?: { txHash: string; blockNumber: number | null; at: string } }) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-full bg-good text-bg">
          <IconCheckDraw size={18} />
        </span>
        <div>
          <Heading>{title}</Heading>
          <p className="text-[13px] text-mut">{line}</p>
        </div>
      </div>
      <div className="mt-4 rounded-card bg-card px-4 py-4 shadow-inner-card">
        <Money units={units} className="text-[28px]" />
        {tx && (
          <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 border-t border-line pt-3 text-[13px] sm:grid-cols-3">
            <div>
              <dt className="text-mut">Transaction</dt>
              <dd><TxLink hash={tx.txHash} /></dd>
            </div>
            <div>
              <dt className="text-mut">Block</dt>
              <dd>{tx.blockNumber !== null ? <BlockLink block={tx.blockNumber} /> : "pending"}</dd>
            </div>
            <div>
              <dt className="text-mut">Confirmed</dt>
              <dd className="text-ink-2">{relativeTime(tx.at)}</dd>
            </div>
          </dl>
        )}
      </div>
    </div>
  );
}

/* ---------- the panel ---------- */

/**
 * "What happens next" for a bounty, for whoever is looking at it. Roles come from
 * comparing immutable GitHub user IDs; the backend and the contract enforce them for real.
 */
export function BountyActions({ bounty, onSent }: { bounty: Bounty; onSent: () => void }) {
  const { user } = useViewer();
  const isFunder = !!user && user.id === bounty.funder.id;
  const myCandidate = user ? bounty.candidates.find((c) => c.reviewer.id === user.id) : undefined;
  const isRecipient = !!user && bounty.approval?.reviewer.id === user.id;
  const openCandidates = bounty.candidates.filter((c) => c.status === "candidate");
  const now = useNow();
  const amounts = escrowAmounts(bounty, now);

  const primary = primaryPanel();
  // A partial payout leaves an unapproved remainder. Once the deadline passes it is refundable whether or not
  // the reviewer has claimed yet, so offer it beside the claim or receipt instead of hiding it.
  const remainder = amounts.refundOpen && (bounty.status === "claimable" || bounty.status === "paid");
  if (!remainder) return primary;
  return (
    <div className="space-y-6">
      {primary}
      <div className="border-t border-line pt-6">
        <RefundPanel bounty={bounty} onSent={onSent} />
      </div>
    </div>
  );

  function primaryPanel() {
  switch (bounty.status) {
    case "draft":
      return isFunder ? (
        <FundPanel bounty={bounty} onSent={onSent} />
      ) : (
        <div>
          <Heading>Not funded yet</Heading>
          <Lead>The maintainer has created this bounty but has not locked the reward. Reviews count once it shows as Funded.</Lead>
        </div>
      );

    case "funding_pending":
      // The funder's own browser resumes the recorded deposit here instead of offering a second one.
      if (isFunder) return <FundPanel bounty={bounty} onSent={onSent} />;
      return (
        <Waiting title="Waiting for the deposit to be confirmed" hash={bounty.pendingTxHash}>
          The deposit was sent. This bounty shows as Funded once the escrow contract&apos;s funding event has been indexed.
          Until then, no money state is shown.
        </Waiting>
      );

    case "funded":
      return (
        <div>
          <Heading>{isFunder ? "The reward is locked. Waiting for reviews" : "This reward is locked and waiting for a review"}</Heading>
          <Lead>
            {isFunder
              ? "An inline comment under Files changed can qualify after a later commit changes code near it and the thread is resolved. You decide whether the review earned the reward."
              : "Leave an inline comment under Files changed on GitHub. After a later commit addresses it and the thread is resolved, the maintainer can review it for payment. A PR approval alone does not qualify."}
          </Lead>
          <div className="mt-4">
            <LinkButton href={bounty.pr.url} external variant="secondary">
              <IconGithub size={15} />
              Open pull request #{bounty.pr.number}
              <IconExternal size={13} />
            </LinkButton>
          </div>
        </div>
      );

    case "review_candidate":
      if (isFunder) {
        return (
          <div>
            <Heading>
              {openCandidates.length === 1 ? "One review is waiting for your decision" : `${openCandidates.length} reviews are waiting for your decision`}
            </Heading>
            <Lead>
              Read the evidence below. You can approve one review for payment. Nothing is paid unless you approve it from
              your own wallet.
            </Lead>
          </div>
        );
      }
      if (myCandidate) {
        return (
          <div>
            <Heading>Your review is a candidate for this reward</Heading>
            <Lead>
              The maintainer decides whether it earned the reward. There is nothing you need to do
              {myCandidate.reviewerWallet ? "." : " except link a payout wallet, so an approval has somewhere to go."}
            </Lead>
            {!myCandidate.reviewerWallet && (
              <div className="mt-4">
                <LinkButton href="/reviewer" variant="accent">Link a payout wallet</LinkButton>
              </div>
            )}
          </div>
        );
      }
      return (
        <div>
          <Heading>A review is being considered</Heading>
          <Lead>The maintainer is deciding whether a review on this pull request earned the reward.</Lead>
        </div>
      );

    case "approved":
      return (
        <Waiting title="Approval sent. Waiting for the contract to confirm it" hash={bounty.pendingTxHash}>
          The maintainer signed the approval. The reward becomes claimable once the contract&apos;s approval event has been indexed.
        </Waiting>
      );

    case "claimable":
      if (isRecipient) return <ClaimPanel bounty={bounty} onSent={onSent} />;
      return (
        <div>
          <Heading>Approved. Waiting for the reviewer to claim</Heading>
          <Lead>
            {bounty.approval && (
              <>
                {formatUsdc(amounts.reserved > BigInt(0) ? amounts.reserved : BigInt(bounty.approval.amountUnits))} is reserved for{" "}
                <UserChip user={bounty.approval.reviewer} />. Only their linked wallet can claim it, and it can no longer be
                refunded.{amounts.funded > amounts.approved && " Anything unapproved can be refunded to the funder after the deadline."}
              </>
            )}
          </Lead>
        </div>
      );

    case "paid":
      return (
        <Receipt
          title={isRecipient ? "You were paid" : "Paid"}
          units={amounts.paid > BigInt(0) ? amounts.paid.toString() : (bounty.approval?.amountUnits ?? bounty.amountUnits)}
          line={isRecipient ? "for your review, to your linked wallet" : bounty.approval ? <>to <UserChip user={bounty.approval.reviewer} size={16} /> for their review</> : "to the approved reviewer"}
          tx={bounty.chain.paid}
        />
      );

    case "expired":
      return <RefundPanel bounty={bounty} onSent={onSent} />;

    case "refunded":
      return (
        <Receipt
          title="Refunded to the funder"
          units={bounty.chain.refunded?.amountUnits ?? bounty.amountUnits}
          line="The deadline passed without a payout for these funds."
          tx={bounty.chain.refunded}
        />
      );

    case "rejected":
      return (
        <div>
          <Heading>The maintainer decided this review does not qualify</Heading>
          <Lead>
            No payout was approved. The reward stays in escrow until the deadline on {formatDeadline(bounty.deadline)}; after
            that it can be refunded to the funder.
          </Lead>
          <p className="mt-3 text-[13px] text-mut">
            A rejection is the maintainer&apos;s judgement call. See <Link href="/#trust" className="text-accent-ink hover:underline">how trust works</Link>.
          </p>
        </div>
      );
  }
  }
}
