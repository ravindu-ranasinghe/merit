import { HeroBento } from "@/components/hero-bento";
import { IconArrowRight, IconCheck, IconComment, IconGithub, IconLock, IconPullRequest, IconStream, IconX } from "@/components/icons";
import { LinkButton, Pill, Tray } from "@/components/ui";

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

const LIMITS = [
  "A maintainer can approve a low-quality review. Merit shows evidence; it does not score reviews.",
  "A maintainer, author and reviewer could collude. A blockchain does not fix that.",
  "The GitHub signals are heuristics. They can be wrong after a rebase or when lines move.",
  "This is a payment-coordination prototype on a test network, not a tax, identity or labor-compliance system.",
];

export default function LandingPage() {
  return (
    <div className="space-y-3">
      {/* Hero */}
      <section className="grid grid-cols-1 items-center gap-8 px-1 pb-6 pt-4 lg:grid-cols-12 lg:gap-10 lg:pt-10">
        <div className="animate-rise lg:col-span-6">
          <Pill tone="neutral">Testnet prototype · UBC Hackathon 2026</Pill>
          <h1 className="mt-4 text-[38px] font-semibold leading-[1.05] tracking-[-0.035em] sm:text-[52px]">
            Reward the review that led to the fix.
          </h1>
          <p className="mt-4 max-w-[52ch] text-[16.5px] leading-relaxed text-ink-2">
            Typical bounties pay for <em>writing code</em>. Merit pays for{" "}
            <strong className="font-semibold text-ink">review feedback a maintainer verified led to an improvement</strong>,
            with the reward locked in escrow before the reviewer starts.
          </p>
          <div className="mt-6 flex flex-wrap gap-2.5">
            <LinkButton href="/maintainer" variant="primary" className="h-11 px-5">
              I maintain a repository
              <IconArrowRight size={15} />
            </LinkButton>
            <LinkButton href="/reviewer" variant="secondary" className="h-11 px-5">
              I review code
            </LinkButton>
          </div>
          <p className="mt-4 text-[12.5px] text-mut">Rewards are testnet USDC on Arc. They have no monetary value.</p>
        </div>
        <div className="lg:col-span-6">
          <HeroBento />
        </div>
      </section>

      {/* The distinction */}
      <section aria-labelledby="difference" className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <h2 id="difference" className="sr-only">How Merit differs from a typical bounty</h2>
        <Tray>
          <p className="text-[12.5px] font-medium text-mut">A typical bounty</p>
          <p className="mt-1.5 text-[22px] font-semibold tracking-[-0.02em]">Pays for writing code</p>
          <ul className="mt-4 space-y-2 text-[13.5px] text-ink-2">
            <li className="flex gap-2.5"><IconPullRequest size={16} className="mt-0.5 shrink-0 text-mut" />Someone opens a pull request that closes an issue.</li>
            <li className="flex gap-2.5"><IconX size={16} className="mt-0.5 shrink-0 text-mut" />The person who caught the bug in review gets nothing.</li>
            <li className="flex gap-2.5"><IconX size={16} className="mt-0.5 shrink-0 text-mut" />Payment is often promised, not locked up front.</li>
          </ul>
        </Tray>
        <Tray tone="dark">
          <p className="text-[12.5px] font-medium text-[#b9b9c0]">Merit</p>
          <p className="mt-1.5 text-[22px] font-semibold tracking-[-0.02em]">Pays for the review that led to a fix</p>
          <ul className="mt-4 space-y-2 text-[13.5px] text-[#dedee3]">
            <li className="flex gap-2.5"><IconComment size={16} className="mt-0.5 shrink-0 text-[#9fb4ff]" />A reviewer&apos;s comment is followed by a fix from the author.</li>
            <li className="flex gap-2.5"><IconCheck size={16} className="mt-0.5 shrink-0 text-[#9fb4ff]" />The maintainer verifies it and approves the payout themselves.</li>
            <li className="flex gap-2.5"><IconLock size={16} className="mt-0.5 shrink-0 text-[#9fb4ff]" />The reward was in escrow before the review began.</li>
          </ul>
        </Tray>
      </section>

      {/* How it works */}
      <Tray as="section">
        <h2 className="text-[20px] font-semibold tracking-tight">How it works</h2>
        <ol className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(([title, body], i) => (
            <li key={title} className="rounded-card bg-card p-4 shadow-inner-card">
              <span className="flex size-6 items-center justify-center rounded-full bg-ink text-[12px] font-semibold text-white">{i + 1}</span>
              <p className="mt-3 text-[14.5px] font-semibold">{title}</p>
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
          <h2 id="trust-title" className="text-[20px] font-semibold tracking-tight">How trust works</h2>
          <p className="mt-1.5 max-w-[60ch] text-[13.5px] text-mut">
            Three systems each own one thing. The Merit server joins them. It holds no key that can move money, and it does
            not decide whether a review was useful. A maintainer does, and signs for it.
          </p>
          <ul className="mt-4 space-y-2.5">
            {SOURCES.map(({ icon: Icon, name, role, body }) => (
              <li key={name} className="flex gap-3.5 rounded-card bg-card p-4 shadow-inner-card">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-[11px] bg-tint text-accent-ink">
                  <Icon size={18} />
                </span>
                <div>
                  <p className="text-[14px]">
                    <strong className="font-semibold">{name}</strong> <span className="text-ink-2">{role}.</span>
                  </p>
                  <p className="mt-0.5 text-[13px] text-mut">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </Tray>
        <Tray tone="white" className="lg:col-span-5">
          <h2 className="text-[20px] font-semibold tracking-tight">What this does not solve</h2>
          <p className="mt-1.5 text-[13.5px] text-mut">Stated plainly, because it matters.</p>
          <ul className="mt-4 space-y-3">
            {LIMITS.map((l) => (
              <li key={l} className="flex gap-2.5 text-[13.5px] text-ink-2">
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
