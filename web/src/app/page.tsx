import Link from "next/link";
import { HowItWorks } from "@/components/how-it-works";
import { IconArrowRight, IconGithub, IconLock, IconStream } from "@/components/icons";
import styles from "./home.module.css";

const SOURCES = [
  { icon: IconGithub, name: "GitHub", body: "The comments, commits, resolved threads and maintainer permissions. Your review stays where the code lives." },
  { icon: IconLock, name: "Arc escrow", body: "Funds locked before the work starts. The contract enforces one payout and returns expired, unapproved funds to the funder." },
  { icon: IconStream, name: "QuickNode Streams", body: "The event pipeline indexes contract activity so funding and payout states reflect what happened onchain." },
];

export default function LandingPage() {
  return (
    <div className={`landing-page ${styles.home}`}>
      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.heroCopy} data-field-clear="">
          <h1 id="hero-title">Good reviews.<br />Better code.<br /><span>Real credit.</span></h1>
          <p className={styles.lede}>Fund a code-review reward before the first comment. When feedback leads to a fix, the maintainer approves it. The reviewer claims the reward.</p>
          <div className={styles.actions}>
            <Link href="/maintainer" className={styles.primary}>Fund a review <IconArrowRight size={16} /></Link>
            <Link href="/reviewer" className={styles.secondary}>I review code <IconArrowRight size={16} /></Link>
          </div>
          <p className={styles.testnet}><span /> Arc testnet · Test USDC, no monetary value</p>
        </div>
      </section>

      <section id="difference" className={styles.difference} aria-labelledby="difference-title">
        <div className={styles.sectionIntro}>
          <h2 id="difference-title">The fix matters.<br /><span>So does who spotted it.</span></h2>
          <p>Writing code gets the credit. The careful review that catches a bug deserves some, too. Merit puts a funded reward behind that work.</p>
        </div>
        <div className={styles.diff}>
          <div className={styles.diffHeader}><span>contribution.md</span><span>− 3&nbsp;&nbsp; <span className={styles.addedCount}>+ 3</span></span></div>
          <div className={styles.diffGroup}>
            <p><span>−</span> Bounties reward the person writing the code</p>
            <p><span>−</span> The reviewer catches the bug, then moves on</p>
            <p><span>−</span> Payment is a promise for later</p>
          </div>
          <div className={`${styles.diffGroup} ${styles.diffAdded}`}>
            <p><span>+</span> Feedback leads to an accepted improvement</p>
            <p><span>+</span> A maintainer verifies and rewards that review</p>
            <p><span>+</span> The reward is already locked in escrow</p>
          </div>
        </div>
      </section>

      <section id="how-it-works" className={styles.workflow} aria-labelledby="workflow-title">
        <div className={styles.sectionHeading}>
          <div><h2 id="workflow-title">One review.<br /><span>A visible trail.</span></h2></div>
          <p>Review on GitHub. Verify the improvement.<br />Let the escrow handle the reward.</p>
        </div>
        <HowItWorks />
      </section>

      <section id="trust" className={styles.trust} aria-labelledby="trust-title">
        <div className={styles.sectionHeading}>
          <div><h2 id="trust-title">Three systems.<br /><span>Clear responsibilities.</span></h2></div>
          <p>Merit joins three systems. The server holds no key that can move money. The maintainer decides what deserves a reward and signs the approval.</p>
        </div>
        <div className={styles.sources}>
          {SOURCES.map(({ icon: Icon, name, body }) => (
            <article key={name} className={styles.source}>
              <div className={styles.sourceTop}><Icon size={20} /></div>
              <h3>{name}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
        <div className={styles.limits}>
          <div><h3>Human judgment stays human.</h3></div>
          <p>A maintainer can approve a weak review, and collusion remains possible. GitHub signals are heuristics that can break when lines move or commits are rebased. Merit coordinates payments; it does not score review quality or replace tax, identity or labor-compliance systems.</p>
        </div>
      </section>

      <section className={styles.closing} aria-labelledby="closing-title">
        <div className={styles.closingMark} aria-hidden>+</div>
        <div><h2 id="closing-title">Give a good review<br />the credit it deserves.</h2><p>Start with a pull request and a $5–$10 testnet reward.</p></div>
        <Link href="/maintainer" className={styles.primary}>Fund your first review <IconArrowRight size={16} /></Link>
      </section>
    </div>
  );
}
