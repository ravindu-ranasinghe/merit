import { DiffHunk } from "./evidence";
import { IconCheck, IconCommit, IconLock } from "./icons";
import { Money, Pill } from "./ui";

const HUNK = `   dispose() {
     this.disposed = true;
+    clearTimeout(this.timer);
   }`;

/** The three ledger entries of one bounty, as the event feed stores them. Sample data. */
const LEDGER = [
  ["BountyFunded", "72,270,571", "0x59fa…f9b6", "+10.00"],
  ["RewardApproved", "72,270,574", "0xadab…d099", "10.00"],
  ["RewardPaid", "72,270,577", "0xe819…264c", "−10.00"],
] as const;

/**
 * One finished bounty, as the app shows it: the review, the fix it led to, and the ledger
 * of what the escrow contract did. An illustration with sample data, not a live view.
 */
export function HeroPreview() {
  return (
    <div
      role="img"
      aria-label="Illustration: a review comment, the fix that followed, and the escrow ledger showing the reviewer was paid"
      className="animate-rise overflow-hidden rounded-tray bg-card shadow-card"
    >
      <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <p className="truncate font-mono text-[12px] text-mut">acme/editor #482</p>
          <p className="mt-1 truncate text-[14px] font-medium">Fix autosave writing after close</p>
        </div>
        <div className="shrink-0 text-right">
          <Money units="10000000" className="text-[20px]" />
          <div className="mt-1 flex justify-end">
            <Pill tone="good">
              <IconCheck size={12} />
              Paid
            </Pill>
          </div>
        </div>
      </div>

      <div className="px-5 py-4">
        <p className="text-[13px]">
          <span className="font-medium">jun-park</span> <span className="text-mut">reviewed src/editor/autosave.ts</span>
        </p>
        <p className="mt-2 border-l-2 border-accent pl-3 text-[14px] text-ink">
          The debounce timer is never cleared, so a late tick writes to a closed file handle.
        </p>
        <div className="mt-3">
          <DiffHunk hunk={HUNK} />
        </div>
        <p className="mt-2 flex items-center gap-2 text-[12px] text-ink-2">
          <IconCommit size={13} className="text-mut" /> Fix commit <span className="font-mono">a41c9e7</span> · thread resolved
        </p>
      </div>

      <table className="w-full border-t border-line font-mono text-[12px]">
        <tbody>
          {LEDGER.map(([event, block, tx, amount]) => (
            <tr key={event} className="border-b border-line last:border-0">
              <td className="py-2 pl-5 text-ink">{event}</td>
              <td className="hidden px-3 py-2 text-right text-mut sm:table-cell">{block}</td>
              <td className="px-3 py-2 text-mut">{tx}</td>
              <td className="py-2 pr-5 text-right text-ink">{amount}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="flex items-center gap-2 border-t border-line bg-tray px-5 py-2 text-[12px] text-mut">
        <IconLock size={12} /> Locked before the review, paid once · illustration, sample data
      </p>
    </div>
  );
}
