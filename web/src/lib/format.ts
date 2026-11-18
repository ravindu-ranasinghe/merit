import { ARC } from "@/lib/env";

/**
 * The only place integer USDC units become text for people.
 * "10000000" -> "$10.00". Uses BigInt, never floats.
 */
export function formatUsd(units: string | bigint): string {
  const v = BigInt(units);
  const neg = v < BigInt(0);
  const abs = neg ? -v : v;
  const whole = abs / BigInt(1_000_000);
  const frac = abs % BigInt(1_000_000);
  // Show cents; keep extra precision only when the amount has sub-cent units.
  let fracStr = frac.toString().padStart(6, "0");
  fracStr = /^\d{2}0{4}$/.test(fracStr) ? fracStr.slice(0, 2) : fracStr.replace(/0+$/, "");
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}$${wholeStr}.${fracStr}`;
}

/** "$10.00 USDC" */
export function formatUsdc(units: string | bigint): string {
  return `${formatUsd(units)} USDC`;
}

/** Dollars typed by a person ("7.5") to integer units ("7500000"). Null when not a valid amount. */
export function parseUsdToUnits(input: string): string | null {
  const m = /^\s*\$?\s*(\d{1,9})(?:\.(\d{0,6}))?\s*$/.exec(input);
  if (!m) return null;
  const units = BigInt(m[1]) * BigInt(1_000_000) + BigInt((m[2] ?? "").padEnd(6, "0") || "0");
  return units.toString();
}

export function shortHash(hash: string, lead = 6, tail = 4): string {
  return hash.length <= lead + tail + 2 ? hash : `${hash.slice(0, lead)}…${hash.slice(-tail)}`;
}

export const explorer = {
  tx: (hash: string) => `${ARC.explorerUrl}/tx/${hash}`,
  address: (address: string) => `${ARC.explorerUrl}/address/${address}`,
  block: (n: number) => `${ARC.explorerUrl}/block/${n}`,
};

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "3 minutes ago", "in 5 days". */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const diff = (new Date(iso).getTime() - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return diff < 0 ? "just now" : "in a moment";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  return rtf.format(Math.round(diff / 86400), "day");
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatBlock(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * A network fee in wei of Arc's native USDC (18 decimals), for people: "$0.00164 USDC".
 * Rounded up to the 6-decimal unit so a fee never reads as smaller than it was.
 */
export function formatNetworkFee(wei: bigint): string {
  if (wei <= BigInt(0)) return "$0.00 USDC";
  const step = BigInt(1_000_000_000_000); // 1e18 / 1e6
  const units = (wei + step - BigInt(1)) / step;
  return `${formatUsd(units)} USDC`;
}

/**
 * A delay between two clocks, for people. Block timestamps have one-second precision, so
 * anything under 1.5 s reads as "under 2 s" rather than a false decimal.
 */
export function formatDelay(ms: number): string {
  if (ms < 1500) return "under 2 s";
  const s = Math.round(ms / 1000);
  if (s < 90) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h`;
  return `${Math.round(h / 24)} days`;
}

/** A measured confirmation time: "0.8 s". */
export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}
