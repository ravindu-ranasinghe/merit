import type { Hex } from "@/lib/api/types";
import { describeChainError, type ChainError } from "@/lib/chain/errors";
import type { TxPhase } from "@/lib/chain/hooks";
import { IconCheck } from "./icons";
import { GuardrailCard, Notice, Spinner, TxLink } from "./ui";

/** A wallet or contract failure. Contract refusals render as guardrails, not crashes. */
export function ChainErrorView({ error }: { error: ChainError }) {
  const copy = describeChainError(error);
  if (copy.guardrail) {
    return <GuardrailCard title={copy.title} body={copy.body} code={copy.code} footnote="Nothing was sent and no money moved." />;
  }
  return <Notice tone="warning" title={copy.title}>{copy.body}</Notice>;
}

/** Where a transaction is: in the wallet, on the network, or waiting for the indexer. */
export function TxProgress({
  phase,
  hash,
  error,
  indexedLabel,
}: {
  phase: TxPhase;
  hash: Hex | null;
  error: ChainError | null;
  /** What we are waiting for once the transaction is confirmed. */
  indexedLabel: string;
}) {
  if (phase === "idle") return null;
  if (phase === "error" && error) return <ChainErrorView error={error} />;
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-card bg-tint px-3.5 py-3 text-[13px] text-accent-ink">
      {phase === "done" ? <IconCheck size={15} /> : <Spinner />}
      <span className="font-semibold">
        {phase === "wallet" && "Confirm in your wallet"}
        {phase === "confirming" && "Sent. Waiting for the network"}
        {phase === "done" && "Transaction confirmed"}
      </span>
      {phase === "done" && <span className="text-ink-2">{indexedLabel}</span>}
      {hash && <TxLink hash={hash} className="ml-auto" />}
    </div>
  );
}
