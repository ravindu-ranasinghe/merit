import type { Metadata } from "next";
import { EventFeed } from "@/components/event-feed";
import { PageHeader, Tray } from "@/components/ui";

export const metadata: Metadata = { title: "Event feed" };

const STEPS = [
  ["Escrow contract", "Emits an event for every funding, approval, payout and refund on Arc testnet."],
  ["QuickNode Streams", "Filters for those four events and delivers each one to the Merit server."],
  ["Merit server", "Stores each event once, then updates the bounty it belongs to."],
  ["This page", "Reads the stored events. Nothing here asks the chain directly."],
];

export default function EventsPage() {
  return (
    <div>
      <PageHeader
        title="Event feed"
        lead="Every money movement in Merit is a contract event. This is the indexed record of them, newest first, with the block and transaction each one came from."
      />
      <div className="stagger grid grid-cols-1 gap-3">
        <Tray style={{ "--i": 0 } as React.CSSProperties}>
          <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(([title, body], i) => (
              <li key={title} className="rounded-card bg-card p-4 shadow-inner-card">
                <p className="flex items-center gap-2 text-[14px] font-medium">
                  <span className="flex size-5 items-center justify-center rounded-ctl bg-accent text-[12px] text-bg">{i + 1}</span>
                  {title}
                </p>
                <p className="mt-2 text-[13px] text-mut">{body}</p>
              </li>
            ))}
          </ol>
        </Tray>
        <Tray style={{ "--i": 1 } as React.CSSProperties}>
          <EventFeed />
        </Tray>
      </div>
    </div>
  );
}
