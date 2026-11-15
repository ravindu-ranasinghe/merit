"use client";

import Link from "next/link";
import { useState } from "react";
import { IconArrowRight, IconCheck, IconComment, IconCommit, IconGithub, IconLock, IconPullRequest } from "./icons";
import styles from "@/app/home.module.css";

const STEPS = [
  { title: "Fund the review", body: "Pick a pull request. Lock $5–$10 of testnet USDC in escrow before the review starts." },
  { title: "Leave a good catch", body: "Review on GitHub, just as you do today. No wallet is needed to leave feedback." },
  { title: "Make the code better", body: "The author pushes a fix. GitHub signals flag a review candidate for the maintainer to verify." },
  { title: "Approve. Claim. Credit.", body: "The maintainer checks the evidence and signs approval. The linked reviewer claims once." },
] as const;

export function HowItWorks() {
  const [active, setActive] = useState(0);
  return (
    <div className={styles.walkthrough}>
      <ol className={styles.steps}>
        {STEPS.map(({ title, body }, i) => (
          <li key={title}>
            <button type="button" onClick={() => setActive(i)} aria-pressed={active === i} aria-controls="workflow-example" className={styles.step}>
              <span className={styles.stepNumber}>0{i + 1}</span>
              <span><strong>{title}</strong><span>{body}</span></span>
              <IconArrowRight size={16} />
            </button>
          </li>
        ))}
      </ol>
      <div className={styles.productWindow} id="workflow-example" role="region" aria-label={`${STEPS[active].title}: illustrated example`}>
        <div className={styles.windowBar}><span className={styles.windowDots} aria-hidden><i /><i /><i /></span><span>merit / review reward</span><span className={styles.sampleLabel}>Sample data</span></div>
        <div className={styles.productBody}>
          <div className={styles.prMeta}><span><IconGithub size={16} /> acme / editor</span><span>#482</span></div>
          <h3>Fix autosave writing after close</h3>
          <div className={styles.rewardRow}><div><span>Review reward</span><p>10.00 <span>testnet USDC</span></p></div><span className={styles.rewardStatus}><IconCheck size={13} />{active === 3 ? "Claimed" : "Funded in escrow"}</span></div>
          <div className={styles.exampleContent} aria-live="polite" aria-atomic="true">
            {active === 0 ? <><div className={styles.exampleLabel}><IconLock size={15} /> Reward secured before the review</div><dl className={styles.exampleDetails}><div><dt>Pull request</dt><dd><IconPullRequest size={14} /> acme/editor #482</dd></div><div><dt>Amount</dt><dd>10.00 testnet USDC</dd></div><div><dt>Recipient</dt><dd>One approved reviewer</dd></div><div><dt>Network</dt><dd>Arc testnet</dd></div></dl><p className={styles.exampleNote}>If the bounty expires without an approval, the original funder can submit a refund transaction.</p></> : active === 1 ? <><div className={styles.exampleLabel}><IconComment size={15} /> jun-park left a review</div><p className={styles.filePath}>src/editor/autosave.ts</p><blockquote>The debounce timer is never cleared, so a late tick writes to a closed file handle. Could we clear it on dispose?</blockquote><p className={styles.exampleNote}>A specific catch, in the context of the code.</p></> : active === 2 ? <><div className={styles.exampleLabel}><IconCommit size={15} /> Feedback becomes a fix</div><p className={styles.filePath}>src/editor/autosave.ts</p><pre className={styles.codeDiff}><code>{"   dispose() {\n     this.disposed = true;\n"}<span>{"+    clearTimeout(this.timer);\n"}</span>{"   }"}</code></pre><p className={styles.exampleNote}>Commit a41c9e7 · Thread resolved<br />These signals are heuristics. A maintainer still verifies the improvement.</p></> : <><div className={styles.exampleLabel}><IconCheck size={15} /> Verified by the maintainer</div><div className={styles.payoutReceipt}><span>Reward claimed by jun-park</span><p>+10.00 <span>testnet USDC</span></p><span>One reviewer. One payout.</span></div><p className={styles.exampleNote}>The reviewer links a wallet and claims the approved reward. The indexed contract event confirms the paid state.</p></>}
          </div>
        </div>
        <div className={styles.productBottom}><span><span className={styles.statusDot} /> Illustrated workflow · Arc testnet</span><Link href={active === 3 ? "/reviewer" : "/maintainer"}>Try the app <IconArrowRight size={13} /></Link></div>
      </div>
    </div>
  );
}
