export const FPS = 60;
export const DURATION = 26 * FPS;
export const CHAPTERS = [
  { start: 0, still: 320, title: "Fund the review", body: "Pick a pull request. Lock $5–$10 of testnet USDC in escrow before the review starts." },
  { start: 360, still: 690, title: "Leave a good catch", body: "Review on GitHub, just as you do today. No wallet is needed to leave feedback." },
  { start: 720, still: 1050, title: "Make the code better", body: "The author pushes a fix. GitHub signals flag a review candidate for the maintainer to verify." },
  { start: 1080, still: 1520, title: "Approve. Claim. Credit.", body: "The maintainer verifies the improvement and signs approval. The linked reviewer claims once." },
] as const;

export function chapterAt(frame: number) {
  if (frame >= DURATION - 24) return 0;
  return frame >= 1080 ? 3 : frame >= 720 ? 2 : frame >= 360 ? 1 : 0;
}
