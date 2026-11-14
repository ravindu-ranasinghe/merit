# How to use these briefs

Three parallel workstreams, one repo, one week. Each engineer pastes their brief into their
own Claude Code session as the first message, from inside a clone of this repo.

| Brief | Owns | Publishes for others | Blocked on |
|---|---|---|---|
| `BRIEF-A-contracts.md` | `contracts/` | `docs/escrow-abi.json`, `docs/escrow-interface.md` (Nov 14) | nothing — start immediately |
| `BRIEF-B-backend.md` | `backend/` | `docs/api.md` (Nov 15) | A's ABI, Nov 14 |
| `BRIEF-C-frontend.md` | `web/` | the demo | A's ABI + B's API; unblocked via mock mode |

## Setup, in order

1. **One person creates the public GitHub repo** — it must be created *during* the hackathon
   window to satisfy the originality rule.
2. Commit `SPEC.md`, `TEAM.md` and the three briefs to `main` first, so everyone clones the
   same source of truth.
3. Protect `main`: PRs only, no direct pushes. Branch naming `eng-a/`, `eng-b/`, `eng-c/`.
4. Each engineer clones, opens Claude Code in the repo root, and pastes their brief.

## Why it parallelizes

`SPEC.md` freezes the interfaces on day one — the contract signatures, the event shapes, the
table names, the unit convention (integer 6-decimal USDC), the status machine. B and C code
against that frozen surface before A's real ABI exists, keeping chain and API calls behind
single modules so swapping in the real thing is a one- or two-file change. C's mock mode
means the UI never waits on anyone.

## The three things that break a parallel build

1. **Someone edits another person's directory.** Don't. Open an issue or message them.
2. **An interface changes silently.** Changing `SPEC.md`, the ABI or `docs/api.md` means
   telling the other two in the team channel the same hour, in a PR.
3. **Someone builds a deferred feature.** The do-not-build list in `SPEC.md` exists because
   the original proposal was too large for a week. Finishing early means writing tests and
   rehearsing the demo, not adding scope.

## Integration points to schedule as actual meetings

- **Nov 14 EOD** — A's contract is deployed on Arc testnet and the ABI is published. B and C
  swap their stubs for the real thing.
- **Nov 16 EOD** — approval gate and wallet binding work; A, B and C walk one bounty from
  funding to approval together.
- **Nov 17 EOD** — first live end-to-end run: funded → reviewed → approved → claimed → paid,
  with explorer links. This is the real deadline; everything after is hardening.
- **Nov 18 EOD** — Streams verdict. Either events reach the DB and UI through Streams, or the
  QuickNode bounty is dropped honestly.
- **Nov 19** — **feature freeze.** Security regression pass, README, cold-start rehearsal
  twice, 2–3 min video.
- **Nov 20, before 12:00 PM CST** — smoke test and Devpost submission.

## Do not forget

Someone has to be **physically at UT Austin on Nov 21** for the closing ceremony. No prize —
including sponsor bounties — pays out without in-person presence. Sort out who, and their
travel, before the build week eats the calendar.
