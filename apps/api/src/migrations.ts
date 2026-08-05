import type pg from "pg";

type Migration = { version: number; name: string; sql: string };

const migrations: Migration[] = [{
  version: 1,
  name: "license_and_subscription_storage",
  sql: `
    CREATE TABLE IF NOT EXISTS brava_subscriptions (
      id uuid PRIMARY KEY,
      auth_user_id text,
      polar_subscription_id text UNIQUE NOT NULL,
      polar_customer_id text NOT NULL,
      polar_product_id text NOT NULL,
      status text NOT NULL,
      current_period_start timestamptz,
      current_period_end timestamptz,
      cancel_at_period_end boolean NOT NULL DEFAULT false,
      ended_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS brava_subscriptions_auth_user_idx ON brava_subscriptions(auth_user_id);
    CREATE INDEX IF NOT EXISTS brava_subscriptions_customer_idx ON brava_subscriptions(polar_customer_id);

    CREATE TABLE IF NOT EXISTS brava_licenses (
      id uuid PRIMARY KEY,
      key_hash varchar(64) UNIQUE NOT NULL CHECK (length(key_hash) = 64),
      label varchar(100) NOT NULL,
      role varchar(16) NOT NULL CHECK (role IN ('user', 'owner')),
      status varchar(16) NOT NULL CHECK (status IN ('active', 'revoked')),
      max_devices integer CHECK (max_devices IS NULL OR max_devices BETWEEN 1 AND 10),
      expires_at timestamptz,
      auth_user_id text,
      subscription_id uuid REFERENCES brava_subscriptions(id) ON DELETE SET NULL,
      source varchar(16) NOT NULL DEFAULT 'admin' CHECK (source IN ('admin', 'polar')),
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS brava_licenses_auth_user_idx ON brava_licenses(auth_user_id);
    CREATE INDEX IF NOT EXISTS brava_licenses_subscription_idx ON brava_licenses(subscription_id);

    CREATE TABLE IF NOT EXISTS brava_license_devices (
      license_id uuid NOT NULL REFERENCES brava_licenses(id) ON DELETE CASCADE,
      device_id varchar(128) NOT NULL,
      device_name varchar(80) NOT NULL,
      activated_at timestamptz NOT NULL,
      last_seen_at timestamptz NOT NULL,
      PRIMARY KEY (license_id, device_id)
    );
    CREATE INDEX IF NOT EXISTS brava_license_devices_last_seen_idx ON brava_license_devices(last_seen_at);

    CREATE TABLE IF NOT EXISTS brava_webhook_events (
      provider varchar(32) NOT NULL,
      provider_event_id text NOT NULL,
      event_type text NOT NULL,
      status varchar(16) NOT NULL,
      payload_sha256 varchar(64) NOT NULL,
      received_at timestamptz NOT NULL DEFAULT now(),
      processed_at timestamptz,
      last_error text,
      PRIMARY KEY (provider, provider_event_id)
    );
  `,
}, {
  version: 2,
  name: "one_polar_license_per_account",
  sql: `
    CREATE UNIQUE INDEX IF NOT EXISTS brava_licenses_one_polar_user_idx
      ON brava_licenses(auth_user_id)
      WHERE source = 'polar' AND auth_user_id IS NOT NULL;
  `,
}, {
  version: 3,
  name: "legacy_json_import_ledger",
  sql: `
    CREATE TABLE IF NOT EXISTS brava_data_imports (
      import_name text PRIMARY KEY,
      source_path text NOT NULL,
      source_sha256 varchar(64) NOT NULL CHECK (length(source_sha256) = 64),
      licenses_imported integer NOT NULL CHECK (licenses_imported >= 0),
      devices_imported integer NOT NULL CHECK (devices_imported >= 0),
      completed_at timestamptz NOT NULL DEFAULT now()
    );
  `,
}];

export async function runBravaMigrations(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('brava_schema_migrations'))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS brava_schema_migrations (
        version integer PRIMARY KEY,
        name text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const applied = new Set<number>((await client.query<{ version: number }>("SELECT version FROM brava_schema_migrations")).rows.map((row) => row.version));
    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;
      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query("INSERT INTO brava_schema_migrations(version, name) VALUES ($1, $2)", [migration.version, migration.name]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('brava_schema_migrations'))").catch(() => undefined);
    client.release();
  }
}
