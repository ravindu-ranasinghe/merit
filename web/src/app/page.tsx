import { HeroPreview } from "@/components/hero-preview";
import { IconArrowRight, IconGithub, IconLock, IconStream } from "@/components/icons";
import { LinkButton, Tray } from "@/components/ui";

const STEPS = [
  ["A maintainer locks a reward", "They pick a pull request and put $5 to $10 of testnet USDC into escrow. It is locked before anyone reviews."],
  ["A reviewer leaves feedback", "On GitHub, as usual. No wallet is needed to review."],
  ["The author fixes it", "Merit notices a later commit touching the commented code and a resolved thread, and flags the review as a candidate."],
  ["The maintainer verifies and approves", "They read the evidence and sign the approval themselves. The reviewer claims the reward, once."],
];

const SOURCES = [
  { icon: IconGithub, name: "GitHub", role: "is the source of truth for reviews", body: "Comments, commits, resolved threads and who has maintainer permission all come from GitHub." },
  { icon: IconLock, name: "The escrow contract on Arc", role: "is the source of truth for money", body: "It holds the reward and enforces the rules: one payout, never more than was locked, refund only to the funder." },
  { icon: IconStream, name: "QuickNode Streams", role: "is how money events reach the app", body: "Contract events are indexed into the feed this app reads, so what you see is what the contract did." },
];

const REMOVED = [
  "Someone opens a pull request that closes an issue.",
  "The person who caught the bug in review gets nothing.",
  "Payment is often promised, not locked up front.",
];

const ADDED = [
  "A reviewer's comment is followed by a fix from the author.",
  "The maintainer verifies it and approves the payout themselves.",
  "The reward was in escrow before the review began.",
];

const LIMITS = [
  "A maintainer can approve a low-quality review. Merit shows evidence; it does not score reviews.",
  "A maintainer, author and reviewer could collude. A blockchain does not fix that.",
  "The GitHub signals are heuristics. They can be wrong after a rebase or when lines move.",
  "This is a payment-coordination prototype on a test network, not a tax, identity or labor-compliance system.",
];

export default function LandingPage() {
  return (
    <div className="space-y-4">
      {/* Hero */}
      <section className="grid grid-cols-1 items-center gap-10 pb-12 pt-8 lg:grid-cols-12 lg:pb-16 lg:pt-16">
        <div className="animate-rise lg:col-span-6">
          <p className="font-mono text-[12px] text-mut">Testnet prototype · UBC Hackathon 2026</p>
          <h1 className="mt-4 text-[40px] font-medium leading-[1.05] tracking-[-0.03em] sm:text-[56px]">
            Reward the review that led to the fix
          </h1>
          <p className="mt-5 max-w-[36rem] text-[18px] leading-[28px] text-ink-2">
            Typical bounties pay for writing code. Merit pays for{" "}
            <span className="text-ink">review feedback a maintainer verified led to an improvement</span>, with the reward
            locked in escrow before the reviewer starts.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <LinkButton href="/maintainer" variant="primary" className="h-11 px-5">
              I maintain a repository
              <IconArrowRight size={16} />
            </LinkButton>
            <LinkButton href="/reviewer" variant="secondary" className="h-11 px-5">
              I review code
            </LinkButton>
          </div>
          <p className="mt-4 text-[13px] text-mut">Rewards are testnet USDC on Arc. They have no monetary value.</p>
        </div>
        <div className="lg:col-span-6">
          <HeroPreview />
        </div>
      </section>

      {/* The distinction, drawn as a diff: the typical bounty removed, Merit added. */}
      <section aria-labelledby="difference" className="overflow-hidden rounded-tray bg-card shadow-card">
        <h2 id="difference" className="sr-only">How Merit differs from a typical bounty</h2>
        <p className="border-b border-line px-5 py-3 font-mono text-[12px] text-mut">@@ what a bounty pays for @@</p>
        <div className="grid grid-cols-1 md:grid-cols-2">
          <div className="bg-[#fbe6e3]/50 px-5 py-5">
            <p className="text-[13px] text-mut">A typical bounty</p>
            <p className="mt-1 text-[20px] font-medium tracking-[-0.02em]">Pays for writing code</p>
            <ul className="mt-4 space-y-2 text-[14px] text-ink-2">
              {REMOVED.map((line) => (
                <li key={line} className="flex gap-3"><span aria-hidden className="w-3 shrink-0 font-mono text-crit">−</span>{line}</li>
              ))}
            </ul>
          </div>
          <div className="border-t border-line bg-tint/60 px-5 py-5 md:border-l md:border-t-0">
            <p className="text-[13px] text-mut">Merit</p>
            <p className="mt-1 text-[20px] font-medium tracking-[-0.02em]">Pays for the review that led to a fix</p>
            <ul className="mt-4 space-y-2 text-[14px] text-ink">
              {ADDED.map((line) => (
                <li key={line} className="flex gap-3"><span aria-hidden className="w-3 shrink-0 font-mono text-accent-ink">+</span>{line}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* How it works */}
      <Tray as="section">
        <h2 className="text-[20px] font-medium tracking-[-0.02em]">How it works</h2>
        <ol className="mt-5 grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(([title, body], i) => (
            <li key={title} className="border-t border-ink/25 pt-3">
              <span className="font-mono text-[12px] text-mut">0{i + 1}</span>
              <p className="mt-2 text-[14px] font-medium">{title}</p>
              <p className="mt-1 text-[13px] text-mut">{body}</p>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-[13px] text-mut">
          You do not need to read blockchain documentation to use Merit. Transaction links are there when you want proof.
        </p>
      </Tray>

      {/* Trust model */}
      <section id="trust" aria-labelledby="trust-title" className="grid scroll-mt-28 grid-cols-1 gap-3 lg:grid-cols-12">
        <Tray className="lg:col-span-7">
          <h2 id="trust-title" className="text-[20px] font-medium tracking-[-0.02em]">How trust works</h2>
          <p className="mt-2 max-w-[60ch] text-[14px] text-mut">
            Three systems each own one thing. The Merit server joins them. It holds no key that can move money, and it does
            not decide whether a review was useful. A maintainer does, and signs for it.
          </p>
          <ul className="mt-4 space-y-3">
            {SOURCES.map(({ icon: Icon, name, role, body }) => (
              <li key={name} className="flex gap-4 rounded-card bg-card p-4 shadow-inner-card">
                <Icon size={18} className="mt-0.5 shrink-0 text-mut" />
                <div>
                  <p className="text-[14px]">
                    <strong className="font-medium">{name}</strong> <span className="text-ink-2">{role}.</span>
                  </p>
                  <p className="mt-0.5 text-[13px] text-mut">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </Tray>
        <Tray tone="white" className="lg:col-span-5">
          <h2 className="text-[20px] font-medium tracking-[-0.02em]">What this does not solve</h2>
          <p className="mt-2 text-[14px] text-mut">Stated plainly, because it matters.</p>
          <ul className="mt-4 space-y-3">
            {LIMITS.map((l) => (
              <li key={l} className="flex gap-3 text-[14px] text-ink-2">
                <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-mut-2" />
                {l}
              </li>
            ))}
          </ul>
          <div className="mt-5 flex flex-wrap gap-2">
            <LinkButton href="/states" variant="secondary">See every state and refusal</LinkButton>
            <LinkButton href="/events" variant="ghost">Event feed</LinkButton>
          </div>
        </Tray>
      </section>
    </div>
  );
}
