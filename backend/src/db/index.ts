import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import * as schema from "./schema.js";

export type Db = ReturnType<typeof createDb>["db"];

export function createDb(url: string) {
  const pool = new pg.Pool({ connectionString: url });
  return { db: drizzle(pool, { schema }), pool };
}

export const migrationsFolder = new URL("../../drizzle", import.meta.url).pathname;

export const runMigrations = (db: Db) => migrate(db, { migrationsFolder });

// Drizzle wraps driver errors; the pg code is on .cause.
export const isUniqueViolation = (e: unknown) =>
  ((e as { cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code) === "23505";
