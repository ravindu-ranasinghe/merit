"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import homeStyles from "@/app/home.module.css";
import { PERSONAS, type PersonaKey } from "@/fixtures/seed";
import { useWallet } from "@/lib/chain/hooks";
import { MOCK } from "@/lib/env";
import { shortHash } from "@/lib/format";
import { useViewer } from "@/lib/viewer";
import { resetDb, setPersonaKey } from "@/mock/store";
import { IconArrowRight, IconGithub, IconRefresh, IconWallet } from "./icons";
import { Avatar, Button, cx } from "./ui";

const NAV = [
  { href: "/open-source", label: "Open source" },
  { href: "/maintainer", label: "Maintainer" },
  { href: "/reviewer", label: "Reviewer" },
  { href: "/events", label: "Event feed" },
];

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 text-[16px] font-medium">
      <span className="flex size-7 items-center justify-center rounded-ctl bg-accent text-bg">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M4 18V7l8 7 8-7v11" />
        </svg>
      </span>
      Merit
    </Link>
  );
}

export function AppHeader() {
  const pathname = usePathname();
  return pathname === "/" ? <LandingHeader /> : <DashboardHeader />;
}

function LandingHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const links = [
    { href: "/open-source", label: "Open rewards" },
    { href: "/#how-it-works", label: "How it works" },
    { href: "/#trust", label: "Trust model" },
    { href: "/events", label: "Event feed" },
  ];
  return (
    <header className={homeStyles.landingHeader}>
      <div className={homeStyles.headerInner}>
        <Logo />
        <nav className={homeStyles.desktopNav} aria-label="Main">{links.map(({ href, label }) => <Link key={href} href={href}>{label}</Link>)}</nav>
        <Link className={homeStyles.headerCta} href="/maintainer">Open app <IconArrowRight size={14} /></Link>
        <button type="button" className={homeStyles.menuButton} aria-label={menuOpen ? "Close navigation" : "Open navigation"} aria-expanded={menuOpen} aria-controls="home-mobile-nav" onClick={() => setMenuOpen(!menuOpen)}><span /><span /></button>
      </div>
      {menuOpen && <nav id="home-mobile-nav" className={homeStyles.mobileNav} aria-label="Mobile">{links.map(({ href, label }) => <Link key={href} href={href} onClick={() => setMenuOpen(false)}>{label}</Link>)}</nav>}
    </header>
  );
}

export function AppMain({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return <main id="main-content" className={pathname === "/" ? "w-full flex-1" : "app-main mx-auto w-full max-w-[1280px] flex-1 px-4 pb-24 sm:px-6"}>{children}</main>;
}

function DashboardHeader() {
  const pathname = usePathname();
  const viewer = useViewer();
  const wallet = useWallet();

  return (
    <div className="sticky top-0 z-30">
      {MOCK && <MockBar />}
      <header className="app-header border-b border-line">
        <div className="mx-auto flex min-h-14 w-full max-w-[1280px] flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 sm:h-14 sm:flex-nowrap sm:gap-6 sm:px-6 sm:py-0">
          <Logo />
          <nav aria-label="Main" className="order-last flex w-full min-w-0 items-center gap-0.5 overflow-x-auto sm:order-none sm:w-auto sm:flex-1">
            {NAV.map((n) => {
              const active = pathname === n.href || pathname.startsWith(`${n.href}/`);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "whitespace-nowrap rounded-[9px] px-2 py-2 text-[12px] font-medium transition-colors sm:px-3 sm:text-[14px]",
                    active ? "bg-tray text-ink" : "text-mut hover:text-ink",
                  )}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-2 sm:ml-0">
            {/* The wallet is a detail, not the front door: a quiet chip, only once connected. */}
            {wallet.connected && wallet.address && (
              <span
                title={`Connected wallet ${wallet.address}`}
                className="hidden items-center gap-2 rounded-md bg-tray px-2 py-1 font-mono text-[12px] text-ink-2 md:inline-flex"
              >
                <IconWallet size={13} />
                {shortHash(wallet.address, 6, 4)}
              </span>
            )}
            {viewer.user ? (
              <span className="flex items-center gap-2 text-[13px] font-medium">
                <Avatar user={viewer.user} size={26} />
                <span className="hidden sm:inline">{viewer.user.login}</span>
                {!MOCK && (
                  <button onClick={viewer.signOut} className="rounded-md px-2 py-1 text-[13px] text-mut hover:text-ink">
                    Sign out
                  </button>
                )}
              </span>
            ) : (
              <Button variant="primary" className="h-9 px-3" onClick={viewer.signIn} loading={viewer.loading}>
                <IconGithub size={15} />
                Sign in
              </Button>
            )}
          </div>
        </div>
      </header>
    </div>
  );
}

/** Mock mode only: says plainly that this is sample data, and switches the signed-in persona. */
function MockBar() {
  const { persona } = useViewer();
  const qc = useQueryClient();
  const keys = Object.keys(PERSONAS) as PersonaKey[];
  const index = Math.max(0, keys.indexOf(persona ?? "maintainer"));

  const pick = (key: PersonaKey) => {
    setPersonaKey(key);
    void qc.invalidateQueries();
  };

  return (
    <div className="bg-dark text-white">
      <div className="mx-auto flex w-full max-w-[1280px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 sm:px-6">
        <p className="text-[12px] text-[#a1a1a6]">
          <span className="mr-2 rounded bg-white/15 px-2 py-0.5 font-medium text-white">Mock mode</span>
          Sample data. No real GitHub, backend or transactions.
        </p>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-[12px] text-[#a1a1a6] sm:inline">Viewing as</span>
          <div role="radiogroup" aria-label="Sample persona" className="relative grid h-7 grid-cols-4 rounded-[9px] bg-white/10 p-0.5">
            <span
              aria-hidden
              className="absolute bottom-0.5 left-0.5 top-0.5 w-[calc((100%-4px)/4)] rounded-ctl bg-accent transition-transform duration-500 ease-soft"
              style={{ transform: `translateX(${index * 100}%)` }}
            />
            {keys.map((k) => (
              <button
                key={k}
                role="radio"
                aria-checked={k === persona}
                title={`${PERSONAS[k].user.login}: ${PERSONAS[k].blurb}`}
                onClick={() => pick(k)}
                className={cx(
                  "relative z-10 whitespace-nowrap px-2 text-[12px] font-medium transition-colors duration-300 sm:px-3",
                  k === persona ? "text-bg" : "text-[#a1a1a6] hover:text-white",
                )}
              >
                {PERSONAS[k].label}
              </button>
            ))}
          </div>
          <button
            title="Reset sample data"
            aria-label="Reset sample data"
            onClick={() => {
              resetDb();
              void qc.invalidateQueries();
            }}
            className="rounded-md p-1 text-[#a1a1a6] hover:bg-white/10 hover:text-white"
          >
            <IconRefresh size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function AppFooter() {
  const pathname = usePathname();
  if (pathname === "/") return (
    <footer className={homeStyles.landingFooter}>
      <div className={homeStyles.footerTop}><Logo /><p>A little credit for a good catch.</p><nav aria-label="Footer"><Link href="/#trust">Trust model</Link><Link href="/states">All states</Link><Link href="/events">Event feed</Link></nav></div>
      <div className={homeStyles.footerBottom}><p>Testnet prototype · Test USDC on Arc has no monetary value</p><p>Made for UBC Hackathon 2026</p></div>
    </footer>
  );
  return (
    <footer className="app-footer border-t border-line">
      <div className="mx-auto flex w-full max-w-[1280px] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-5 text-[13px] text-mut sm:px-6">
        <p>
          Testnet prototype. Rewards are testnet USDC on Arc and have no monetary value.
        </p>
        <nav aria-label="Footer" className="flex gap-4">
          <Link href="/#trust" className="hover:text-ink">How trust works</Link>
          <Link href="/states" className="hover:text-ink">All states</Link>
          <Link href="/events" className="hover:text-ink">Event feed</Link>
        </nav>
      </div>
    </footer>
  );
}
