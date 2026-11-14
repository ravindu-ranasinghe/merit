import { createDb } from "./index.js";
import { pull_requests, repositories } from "./schema.js";
import { prHash } from "../chain/escrow.js";

// Demo identities. Reviewer and PR author are distinct numeric GitHub ids on purpose.
export const DEMO = { repoId: 900001, installationId: 1, maintainerId: 1001, authorId: 2002, reviewerId: 3003, prNumber: 1, name: "merit-demo/demo-repo" };

export async function seed(db: ReturnType<typeof createDb>["db"]) {
  const [repo] = await db.insert(repositories)
    .values({ github_repo_id: DEMO.repoId, installation_id: DEMO.installationId, name: DEMO.name, maintainer_github_id: DEMO.maintainerId })
    .onConflictDoUpdate({ target: repositories.github_repo_id, set: { name: DEMO.name } })
    .returning();
  await db.insert(pull_requests)
    .values({ repo_id: repo!.id, github_pr_number: DEMO.prNumber, head_sha: "demo-head-sha", status: "open", author_github_id: DEMO.authorId, pr_hash: prHash(DEMO.repoId, DEMO.prNumber) })
    .onConflictDoNothing();
}

if (process.argv[1]?.endsWith("seed.ts")) {
  const { db, pool } = createDb(process.env.DATABASE_URL ?? "");
  await seed(db);
  console.log(`seeded ${DEMO.name} PR #${DEMO.prNumber}: maintainer=${DEMO.maintainerId} author=${DEMO.authorId} reviewer=${DEMO.reviewerId}`);
  await pool.end();
}
