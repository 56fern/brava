import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

let sharedPool: pg.Pool | null = null;

export function getDatabasePool(): pg.Pool {
  if (!config.databaseUrl) throw new Error("DATABASE_URL is not configured.");
  sharedPool ??= new Pool({
    connectionString: config.databaseUrl,
    max: config.databasePoolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  return sharedPool;
}

export async function closeDatabasePool(): Promise<void> {
  const pool = sharedPool;
  sharedPool = null;
  if (pool) await pool.end();
}

export async function pingDatabase(pool: pg.Pool = getDatabasePool()): Promise<void> {
  await pool.query("SELECT 1");
}
