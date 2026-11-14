"use client";

import Link from "next/link";
import { useEvents } from "@/lib/api/queries";
import type { ChainEvent, ChainEventType, EventFeed as Feed } from "@/lib/api/types";
import { formatDateTime, formatUsdc, relativeTime, shortHash } from "@/lib/format";
import type { Tone } from "@/lib/status";
import { IconStream } from "./icons";
import { BlockLink, cx, Empty, Notice, Pill, Roll, Skeleton, TxLink } from "./ui";

const EVENT_META: Record<ChainEventType, { label: string; tone: Tone; says: string }> = {
  BountyFunded: { label: "BountyFunded", tone: "progress", says: "Reward locked in escrow" },
  RewardApproved: { label: "RewardApproved", tone: "progress", says: "Maintainer approved a payout" },
  RewardPaid: { label: "RewardPaid", tone: "good", says: "Reviewer was paid" },
  BountyRefunded: { label: "BountyRefunded", tone: "neutral", says: "Unapproved funds returned" },
};

const eventKey = (e: ChainEvent) => `${e.chainId}:${e.contract}:${e.txHash}:${e.logIndex}`;

/** Where the rows come from. Mock mode says "fixtures"; it never claims to be Streams. */
export function PipelineHeader({ feed }: { feed: Feed }) {
  const live = feed.source === "quicknode-streams";
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      <span className="flex items-center gap-2 text-[13px] font-semibold">
        <span className="relative flex size-2.5">
          <span className={cx("absolute inset-0 rounded-full", live ? "animate-ping bg-good/50" : "bg-transparent")} />
          <span className={cx("relative size-2.5 rounded-full", live ? "bg-good" : "bg-mut-2")} />
        </span>
        {live ? "Indexed by QuickNode Streams" : "Sample events (mock mode)"}
      </span>
      <dl className="flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-mut">
        <div className="flex gap-1.5">
          <dt>Last indexed block</dt>
          <dd className="font-mono font-medium text-ink">
            {feed.lastIndexedBlock === null ? "none yet" : <Roll text={feed.lastIndexedBlock.toLocaleString("en-US")} />}
          </dd>
        </div>
        <div className="flex gap-1.5">
          <dt>Last delivery</dt>
          <dd className="font-medium text-ink">{feed.lastDeliveryAt ? relativeTime(feed.lastDeliveryAt) : "none yet"}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt>Events</dt>
          <dd className="font-medium text-ink">{feed.events.length}</dd>
        </div>
      </dl>
    </div>
  );
}

function amountOf(e: ChainEvent) {
  return e.payload.amount ? formatUsdc(e.payload.amount) : "";
}

/**
 * The indexed event feed: escrow events as the backend stored them, keyed by
 * (chain, contract, transaction, log index). It reads the backend's event table, which
 * QuickNode Streams fills. The browser does not poll the chain for these.
 */
export function EventFeed({ bountyId, compact, limit }: { bountyId?: string; compact?: boolean; limit?: number }) {
  const { data: feed, isLoading, error } = useEvents(bountyId);

  if (isLoading) return <Skeleton className="h-40" />;
  if (error || !feed) {
    return <Notice tone="critical" title="The event feed is unavailable">{error?.message ?? "Try again in a moment."}</Notice>;
  }

  const events = limit ? feed.events.slice(0, limit) : feed.events;

  return (
    <div>
      {!compact && <PipelineHeader feed={feed} />}
      {events.length === 0 ? (
        <div className={compact ? "" : "mt-4"}>
          <Empty title="No indexed events yet">
            Events appear here once the escrow contract emits them and the indexer delivers them.
          </Empty>
        </div>
      ) : (
        <div className={cx("overflow-x-auto rounded-card bg-card shadow-inner-card", !compact && "mt-4")}>
          <table className={cx("w-full border-collapse text-left text-[13px]", !compact && "min-w-[640px]")}>
            <thead>
              <tr className="text-[11.5px] text-mut">
                <th className={compact ? "py-2.5 pl-3 font-medium" : "px-4 py-2.5 font-medium"}>Event</th>
                {!bountyId && <th className="px-3 py-2.5 font-medium">Bounty</th>}
                <th className="px-3 py-2.5 text-right font-medium">Amount</th>
                <th className="px-3 py-2.5 text-right font-medium">Block</th>
                <th className="px-3 py-2.5 font-medium">Transaction</th>
                {!compact && <th className="px-3 py-2.5 text-right font-medium">Log</th>}
                {!compact && <th className="px-4 py-2.5 text-right font-medium">Indexed</th>}
              </tr>
            </thead>
            <tbody>
              {events.map((e) => {
                const meta = EVENT_META[e.eventType];
                return (
                  <tr key={eventKey(e)} className="animate-row-in border-t border-line/70">
                    <td className={compact ? "py-2.5 pl-3" : "px-4 py-2.5"}>
                      <Pill tone={meta.tone} className="font-mono !text-[11.5px]">{meta.label}</Pill>
                      {!compact && <span className="ml-2 hidden text-[12.5px] text-mut lg:inline">{meta.says}</span>}
                    </td>
                    {!bountyId && (
                      <td className="px-3 py-2.5">
                        {e.bountyId ? (
                          <Link href={`/bounties/${e.bountyId}`} className="font-medium text-accent-ink hover:underline">
                            #{e.payload.bountyId}
                          </Link>
                        ) : (
                          <span className="text-mut">#{e.payload.bountyId}</span>
                        )}
                      </td>
                    )}
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-medium">{compact ? amountOf(e).replace(" USDC", "") : amountOf(e)}</td>
                    <td className="px-3 py-2.5 text-right"><BlockLink block={e.blockNumber} /></td>
                    <td className="px-3 py-2.5"><TxLink hash={e.txHash} /></td>
                    {!compact && <td className="px-3 py-2.5 text-right font-mono text-[12px] text-mut">{e.logIndex}</td>}
                    {!compact && (
                      <td className="px-4 py-2.5 text-right text-[12.5px] text-mut" title={formatDateTime(e.ingestionTimestamp)}>
                        {relativeTime(e.ingestionTimestamp)}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!compact && (
        <p className="mt-3 flex items-start gap-2 text-[12.5px] text-mut">
          <IconStream size={15} className="mt-0.5 shrink-0" />
          <span>
            Each row is one contract event, stored once under the key (chain {events[0]?.chainId ?? ""}, contract{" "}
            {events[0] ? shortHash(events[0].contract) : ""}, transaction, log index). A replayed or duplicated
            delivery lands on the same key and changes nothing.
          </span>
        </p>
      )}
    </div>
  );
}
