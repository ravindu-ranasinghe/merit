import Image from "next/image";
import Link from "next/link";
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import type { GithubUser } from "@/lib/api/types";
import { explorer, formatUsd, shortHash } from "@/lib/format";
import type { Tone } from "@/lib/status";
import { IconAlert, IconCheck, IconExternal, IconInfo, IconShield } from "./icons";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

/* ---------- surfaces ---------- */

/** A bento tray: the grey (or white, or dark) rounded container cards sit in. */
export function Tray({
  tone = "tray",
  className,
  children,
  style,
  as: As = "section",
}: {
  tone?: "tray" | "white" | "dark";
  className?: string;
  children: ReactNode;
  style?: CSSProperties;
  as?: "section" | "div" | "article" | "aside";
}) {
  return (
    <As
      style={style}
      className={cx(
        "rounded-tray p-4 sm:p-5",
        tone === "tray" && "bg-tray",
        tone === "white" && "bg-card shadow-card",
        tone === "dark" && "bg-dark text-white",
        className,
      )}
    >
      {children}
    </As>
  );
}

/** A white inner card that sits on a tray. */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("rounded-card bg-card p-4 shadow-inner-card", className)}>{children}</div>;
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx("text-[12px] font-medium text-mut", className)}>{children}</p>;
}

/* ---------- buttons ---------- */

type ButtonVariant = "primary" | "accent" | "secondary" | "ghost";

const BTN: Record<ButtonVariant, string> = {
  primary: "bg-ink text-white hover:bg-black shadow-[0_6px_16px_rgb(15_15_18/0.18)]",
  accent: "bg-accent text-white hover:bg-accent-ink shadow-[0_6px_16px_rgb(47_91_255/0.28)]",
  secondary: "bg-card text-ink shadow-knob hover:bg-[#fafaf8]",
  ghost: "text-ink-2 hover:bg-tray-2",
};

const btnBase =
  "inline-flex items-center justify-center gap-2 rounded-ctl px-4 h-10 text-[13.5px] font-semibold transition-[transform,background-color,box-shadow,opacity] duration-300 ease-spring active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45 whitespace-nowrap";

export function Button({
  variant = "primary",
  loading,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; loading?: boolean }) {
  return (
    <button {...rest} disabled={rest.disabled || loading} className={cx(btnBase, BTN[variant], className)}>
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  variant = "primary",
  className,
  children,
  external,
}: {
  href: string;
  variant?: ButtonVariant;
  className?: string;
  children: ReactNode;
  external?: boolean;
}) {
  const cls = cx(btnBase, BTN[variant], className);
  return external ? (
    <a href={href} target="_blank" rel="noreferrer" className={cls}>
      {children}
    </a>
  ) : (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Working"
      className={cx("inline-block size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent", className)}
    />
  );
}

/* ---------- status + notices ---------- */

const TONE_PILL: Record<Tone, string> = {
  neutral: "bg-tray-2 text-ink-2",
  progress: "bg-tint text-accent-ink",
  good: "bg-good-bg text-good",
  warning: "bg-warn-bg text-warn",
  critical: "bg-crit-bg text-crit",
};

export function Pill({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-semibold", TONE_PILL[tone], className)}>
      {children}
    </span>
  );
}

const NOTICE: Record<Tone, string> = {
  neutral: "bg-tray-2 text-ink-2",
  progress: "bg-tint text-accent-ink",
  good: "bg-good-bg text-good",
  warning: "bg-warn-bg text-warn",
  critical: "bg-crit-bg text-crit",
};

export function Notice({
  tone = "neutral",
  title,
  children,
  className,
}: {
  tone?: Tone;
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  const Icon = tone === "good" ? IconCheck : tone === "warning" || tone === "critical" ? IconAlert : IconInfo;
  return (
    <div role={tone === "critical" ? "alert" : "status"} className={cx("flex gap-2.5 rounded-card px-3.5 py-3 text-[13px]", NOTICE[tone], className)}>
      <Icon size={16} className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cx("text-ink-2", title && "mt-0.5")}>{children}</div>}
      </div>
    </div>
  );
}

/**
 * A refusal by the escrow contract, rendered as a guardrail doing its job. This is what
 * the duplicate-claim beat of the demo shows.
 */
export function GuardrailCard({
  title,
  body,
  code,
  footnote,
}: {
  title: string;
  body: string;
  code?: string;
  footnote?: string;
}) {
  return (
    <div role="status" className="animate-rise rounded-card bg-dark p-4 text-white">
      <div className="flex items-center gap-2 text-[12px] font-semibold text-[#9fb4ff]">
        <IconShield size={15} />
        Rejected by the escrow contract
      </div>
      <p className="mt-2 text-[16px] font-semibold tracking-tight">{title}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-[#c9c9cf]">{body}</p>
      {code && (
        <p className="mt-3 overflow-x-auto rounded-lg bg-white/[0.07] px-2.5 py-1.5 font-mono text-[11.5px] text-[#d9d9de]">
          {code}
        </p>
      )}
      {footnote && <p className="mt-2.5 text-[12px] text-[#9a9aa2]">{footnote}</p>}
    </div>
  );
}

/* ---------- money ---------- */

/**
 * A USDC amount for people: "$10.00 USDC". Digits roll like an odometer when the value
 * changes. Takes integer 6-decimal units; never a float.
 */
export function Money({ units, className, unitClassName }: { units: string | bigint; className?: string; unitClassName?: string }) {
  const text = formatUsd(units);
  return (
    <span className={cx("inline-flex items-baseline gap-[0.3em] whitespace-nowrap font-semibold tracking-tight", className)}>
      <Roll text={text} />
      <span className={cx("text-[0.5em] font-medium tracking-normal text-mut", unitClassName)}>USDC</span>
    </span>
  );
}

/** Per-character odometer. Digits slide on a spring; other characters render as-is. */
export function Roll({ text }: { text: string }) {
  return (
    <span aria-label={text} className="inline-flex overflow-hidden leading-[1.2]">
      {[...text].map((ch, i) =>
        /\d/.test(ch) ? (
          <span key={`${text.length - i}`} aria-hidden className="inline-block h-[1.2em] overflow-hidden">
            <span
              className="block transition-transform duration-700 ease-spring"
              style={{ transform: `translateY(${-Number(ch) * 1.2}em)` }}
            >
              {"0123456789".split("").map((d) => (
                <span key={d} className="block h-[1.2em]">
                  {d}
                </span>
              ))}
            </span>
          </span>
        ) : (
          <span key={`${text.length - i}`} aria-hidden className="inline-block h-[1.2em]">
            {ch}
          </span>
        ),
      )}
    </span>
  );
}

/* ---------- people ---------- */

const AVATAR_COLORS = ["#2f5bff", "#141416", "#ff7a59", "#16a37f", "#9b6bff", "#e84d8a", "#b7791f"];

export function Avatar({ user, size = 24 }: { user: GithubUser; size?: number }) {
  if (user.avatarUrl) {
    return (
      <Image
        src={user.avatarUrl}
        alt=""
        width={size}
        height={size}
        unoptimized
        className="shrink-0 rounded-full"
        style={{ width: size, height: size }}
      />
    );
  }
  const color = AVATAR_COLORS[Number(user.id.slice(-3)) % AVATAR_COLORS.length];
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold uppercase text-white"
      style={{ width: size, height: size, fontSize: size * 0.42, background: color }}
    >
      {user.login[0]}
    </span>
  );
}

export function UserChip({ user, size = 20, className }: { user: GithubUser; size?: number; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 align-middle font-medium", className)}>
      <Avatar user={user} size={size} />
      <span>{user.login}</span>
    </span>
  );
}

/* ---------- onchain references (detail on demand) ---------- */

export function TxLink({ hash, className, label }: { hash: string; className?: string; label?: string }) {
  return (
    <a
      href={explorer.tx(hash)}
      target="_blank"
      rel="noreferrer"
      title={`View transaction ${hash} on the Arc explorer`}
      className={cx("inline-flex items-center gap-1 font-mono text-[12px] text-accent-ink underline-offset-2 hover:underline", className)}
    >
      {label ?? shortHash(hash)}
      <IconExternal size={12} />
    </a>
  );
}

export function AddressLink({ address, full, className }: { address: string; full?: boolean; className?: string }) {
  return (
    <a
      href={explorer.address(address)}
      target="_blank"
      rel="noreferrer"
      title={`View ${address} on the Arc explorer`}
      className={cx("inline-flex items-center gap-1 break-all font-mono text-[12px] text-accent-ink underline-offset-2 hover:underline", className)}
    >
      {full ? address : shortHash(address)}
      <IconExternal size={12} className="shrink-0" />
    </a>
  );
}

export function BlockLink({ block, className }: { block: number; className?: string }) {
  return (
    <a
      href={explorer.block(block)}
      target="_blank"
      rel="noreferrer"
      className={cx("font-mono text-[12px] text-ink-2 underline-offset-2 hover:underline", className)}
    >
      {block.toLocaleString("en-US")}
    </a>
  );
}

/* ---------- small layout helpers ---------- */

export function PageHeader({ title, lead, action, eyebrow }: { title: string; lead?: ReactNode; action?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-4 px-1">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5 text-[12.5px] text-mut">{eyebrow}</div>}
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.025em] sm:text-[30px]">{title}</h1>
        {lead && <p className="mt-1.5 max-w-[62ch] text-[14.5px] text-mut">{lead}</p>}
      </div>
      {action}
    </header>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-card border border-dashed border-[#cfcfc8] px-5 py-8 text-center">
      <p className="font-semibold">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-[46ch] text-[13px] text-mut">{children}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-card bg-tray-2", className)} />;
}

/** A label/value row for detail lists. */
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-[13px]">
      <dt className="shrink-0 text-mut">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}
