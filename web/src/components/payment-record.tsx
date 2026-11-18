"use client";

import type { Bounty, ChainEventType, TxRef } from "@/lib/api/types";
import { useTxMeasurement, type ReceiptCheck, type TxMeasurement } from "@/lib/chain/hooks";
import { formatDateTime, formatDelay, formatNetworkFee } from "@/lib/format";
import { MOCK } from "@/lib/env";
import { IconAlert, IconCheck } from "./icons";
import { BlockLink, cx, Spinner, TxLink } from "./ui";

/** Past this, the event did not arrive by live delivery; it was backfilled or delayed. */
const LIVE_DELIVERY_MS = 5 * 60_000;

const STEPS: { key: keyof Bounty["chain"]; event: ChainEventType; label: string; sender: string }[] = [
  { key: "funded", event: "BountyFunded", label: "Reward funded", sender: "maintainer" },
  { key: "approved", event: "RewardApproved", label: "Payout approved", sender: "maintainer" },
  { key: "paid", event: "RewardPaid", label: "Reward claimed", sender: "reviewer" },
  { key: "refunded", event: "BountyRefunded", label: "Remainder refunded", sender: "sender" },
];

const CHECK_COPY: Record<ReceiptCheck, string> = {
  matched: "Matches Arc",
  mismatch: "Does not match",
  reverted: "Reverted on Arc",
  not_found: "Not found on Arc",
};

function CheckCell({ check }: { check: ReceiptCheck }) {
  const ok = check === "matched";
  return (
    <span className={cx("inline-flex items-center gap-1.5 whitespace-nowrap font-medium", ok ? "text-good" : "text-crit")}>
      {ok ? <IconCheck size={13} /> : <IconAlert size={13} />}
      {CHECK_COPY[check]}
    </span>
  );
}

type Step = (typeof STEPS)[number];

function useMeasured(step: Step, tx: TxRef, onchainBountyId: string | null) {
  const q = useTxMeasurement(tx, step.event, onchainBountyId);
  const m = q.data && "feeWei" in q.data ? (q.data as TxMeasurement) : null;
  const check: ReceiptCheck | null = m ? m.check : q.data?.check ?? null;
  const message = q.isLoading ? null
    : q.error ? "Arc RPC could not be reached. Try again later."
    : !m ? "Arc RPC does not know this transaction."
    : null;
  return { loading: q.isLoading, m, check, message, late: m ? m.indexedAfterMs > LIVE_DELIVERY_MS : false };
}

const Reading = () => <span className="inline-flex items-center gap-2 text-mut"><Spinner /> Reading Arc</span>;

function MeasuredRow({ step, tx, onchainBountyId }: { step: Step; tx: TxRef; onchainBountyId: string | null }) {
  const { loading, m, check, message, late } = useMeasured(step, tx, onchainBountyId);
  return (
    <tr className="border-t border-line align-top">
      <th scope="row" className="px-4 py-3 text-left font-medium">
        {step.label}
        <div className="mt-0.5"><TxLink hash={tx.txHash} /></div>
      </th>
      {loading || !m ? (
        <td colSpan={check ? 3 : 4} className="px-3 py-3 text-mut">{loading ? <Reading /> : message}</td>
      ) : (
        <>
          <td className="px-3 py-3 text-right">
            {tx.blockNumber !== null && <BlockLink block={tx.blockNumber} />}
            <div className="text-[12px] text-mut">{formatDateTime(new Date(m.blockTimeMs).toISOString())}</div>
          </td>
          <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-[12.5px]">
            {formatNetworkFee(m.feeWei)}
            <div className="font-sans text-[12px] text-mut">paid by the {step.sender}</div>
          </td>
          <td className="whitespace-nowrap px-3 py-3 text-right">
            {formatDelay(Math.max(0, m.indexedAfterMs))}
            {late && <div className="text-[12px] text-mut">backfilled or delayed</div>}
          </td>
        </>
      )}
      {check && <td className="px-4 py-3 text-right"><CheckCell check={check} /></td>}
    </tr>
  );
}

/** The same measurements as a stacked card, for narrow screens where five columns do not fit. */
function MeasuredCard({ step, tx, onchainBountyId }: { step: Step; tx: TxRef; onchainBountyId: string | null }) {
  const { loading, m, check, message, late } = useMeasured(step, tx, onchainBountyId);
  const line = "flex items-baseline justify-between gap-4 py-1.5";
  return (
    <li className="border-t border-line px-4 py-3 first:border-t-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{step.label}</span>
        {check && <CheckCell check={check} />}
      </div>
      <div className="mt-0.5"><TxLink hash={tx.txHash} /></div>
      {loading ? <div className="mt-2"><Reading /></div> : !m ? <p className="mt-2 text-mut">{message}</p> : (
        <dl className="mt-2 text-[13px]">
          <div className={line}>
            <dt className="text-mut">Arc block</dt>
            <dd className="text-right">{tx.blockNumber !== null && <BlockLink block={tx.blockNumber} />}<div className="text-[12px] text-mut">{formatDateTime(new Date(m.blockTimeMs).toISOString())}</div></dd>
          </div>
          <div className={line}>
            <dt className="text-mut">Network fee</dt>
            <dd className="text-right"><span className="font-mono text-[12.5px]">{formatNetworkFee(m.feeWei)}</span><div className="text-[12px] text-mut">paid by the {step.sender}</div></dd>
          </div>
          <div className={line}>
            <dt className="text-mut">Indexed after</dt>
            <dd className="text-right">{formatDelay(Math.max(0, m.indexedAfterMs))}{late && <div className="text-[12px] text-mut">backfilled or delayed</div>}</dd>
          </div>
        </dl>
      )}
    </li>
  );
}

/**
 * The payment, measured against Arc itself rather than taken from Merit's database: for each
 * indexed escrow event, the network fee its transaction paid, when its block was produced, how
 * long the event pipeline took to deliver it, and whether Arc's receipt contains that event.
 * Confirmation on Arc and indexing by the pipeline are reported separately on purpose.
 */
export function PaymentRecord({ bounty }: { bounty: Bounty }) {
  const rows = STEPS.flatMap((s) => {
    const tx = bounty.chain[s.key];
    return tx ? [{ step: s, tx }] : [];
  });
  if (rows.length === 0) return null;

  return (
    <section aria-labelledby="payment-record-title">
      <h2 id="payment-record-title" className="text-[16px] font-medium">Payment record</h2>
      <p className="mt-1 text-[13px] text-mut">
        Each step below is read directly from Arc, not from Merit&apos;s database, and checked against the event the indexer stored.
      </p>
      <div className="mt-4 hidden overflow-x-auto border border-line bg-card sm:block">
        <table className="w-full border-collapse text-left text-[13px]">
          <thead>
            <tr className="text-[12px] text-mut">
              <th className="px-4 py-3 font-medium">Step</th>
              <th className="px-3 py-3 text-right font-medium">Arc block</th>
              <th className="px-3 py-3 text-right font-medium">Network fee</th>
              <th className="px-3 py-3 text-right font-medium">Indexed after</th>
              <th className="px-4 py-3 text-right font-medium">Receipt check</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ step, tx }) => (
              <MeasuredRow key={step.key} step={step} tx={tx} onchainBountyId={bounty.onchainBountyId} />
            ))}
          </tbody>
        </table>
      </div>
      <ul className="mt-4 border border-line bg-card text-[13px] sm:hidden">
        {rows.map(({ step, tx }) => (
          <MeasuredCard key={step.key} step={step} tx={tx} onchainBountyId={bounty.onchainBountyId} />
        ))}
      </ul>
      <dl className="mt-3 space-y-1.5 text-[12px] text-mut">
        <div><dt className="inline font-medium text-ink-2">Network fee</dt> <dd className="inline">is the gas the sending wallet paid, in USDC, since Arc charges gas in USDC. It is separate from the reward.</dd></div>
        <div><dt className="inline font-medium text-ink-2">Indexed after</dt> <dd className="inline">is the time from the block being produced to the event pipeline delivering the event to Merit. Block times have one-second precision.</dd></div>
        <div><dt className="inline font-medium text-ink-2">Receipt check</dt> <dd className="inline">confirms that Arc&apos;s receipt for the transaction succeeded and contains this event, from the escrow contract, for this bounty.</dd></div>
        {MOCK && <div className="text-warn">Mock mode: these measurements are sample values, not real Arc data.</div>}
      </dl>
    </section>
  );
}
