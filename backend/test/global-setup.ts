import pg from "pg";
import { createDb, runMigrations } from "../src/db/index.js";
import { TEST_DB_URL } from "./helpers.js";

// Tests run against the real Postgres from docker-compose (`docker compose up -d db`) in a separate database.
export default async function setup() {
  const admin = new pg.Client({ connectionString: TEST_DB_URL.replace(/\/merit_test$/, "/postgres") });
  await admin.connect();
  const { rowCount } = await admin.query("select 1 from pg_database where datname = 'merit_test'");
  if (!rowCount) await admin.query("create database merit_test");
  await admin.end();
  const { db, pool } = createDb(TEST_DB_URL);
  await runMigrations(db);
  await pool.end();
}
