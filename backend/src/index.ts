import { buildApp } from "./app.js";
import { createDb, runMigrations } from "./db/index.js";
import { loadEnv } from "./env.js";
import { createOctokitClient, MockGitHubClient } from "./github/client.js";

const env = loadEnv();
const { db } = createDb(env.databaseUrl);
await runMigrations(db);
const gh = env.github.mock ? new MockGitHubClient() : createOctokitClient(env);
const app = await buildApp({ db, env, gh }, { logger: true });
for (const w of env.warnings) app.log.warn(`!!! ${w}`);
await app.listen({ port: env.port, host: "0.0.0.0" });
