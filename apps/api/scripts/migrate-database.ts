import { config } from "../src/config.js";
import { authEnabled, runBetterAuthMigrations } from "../src/auth.js";
import { closeDatabasePool, getDatabasePool, pingDatabase } from "../src/database.js";
import { runBravaMigrations } from "../src/migrations.js";

if (!config.databaseUrl) throw new Error("DATABASE_URL is required before running database migrations.");

const pool = getDatabasePool();
try {
  await pingDatabase(pool);
  if (authEnabled) await runBetterAuthMigrations();
  await runBravaMigrations(pool);
  console.log("Better Auth and Brava PostgreSQL migrations are up to date.");
} finally {
  await closeDatabasePool();
}
