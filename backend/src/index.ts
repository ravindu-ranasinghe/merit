import { buildApp } from "./app.js";
import { createDb, runMigrations } from "./db/index.js";
import { loadEnv } from "./env.js";
import { createOctokitClient, MockGitHubClient } from "./github/client.js";
import { DEMO } from "./db/seed.js";

const env = loadEnv();
const { db } = createDb(env.databaseUrl);
await runMigrations(db);
const gh = env.github.mock ? new MockGitHubClient() : createOctokitClient(env);
// Mock mode only: the seeded maintainer is admin of the seeded repo so the demo flow can run offline.
if (gh instanceof MockGitHubClient) gh.permissions.set(`${DEMO.name}:${DEMO.maintainerId}`, "admin");
const app = await buildApp({ db, env, gh }, { logger: true });
for (const w of env.warnings) app.log.warn(`!!! ${w}`);
await app.listen({ port: env.port, host: "0.0.0.0" });
