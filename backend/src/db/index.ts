import { type NodePgDatabase, drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { join } from "node:path";
import * as schema from "./schema.js";

export type Db = NodePgDatabase<typeof schema>;

export function createDb(url: string) {
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  return { db: drizzle(pool, { schema }), pool };
}

// Vercel bundles src/index.ts into a function, changing import.meta.url.
// The project root remains the working directory in local, Docker, and Vercel runs.
export const migrationsFolder = join(process.cwd(), "drizzle");

export const runMigrations = (db: Db) => migrate(db, { migrationsFolder });

// Drizzle wraps driver errors; the pg code is on .cause.
export const isUniqueViolation = (e: unknown) =>
  ((e as { cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code) === "23505";
