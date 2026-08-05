import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type pg from "pg";
import type { Database } from "./types.js";

const legacyImportName = "legacy-json-licenses-v1";

export type JsonLicenseImportResult = {
  licenses: number;
  devices: number;
  skipped: boolean;
  sourceSha256: string;
};

function parseLicenseDatabase(source: string): Database {
  const parsed: unknown = JSON.parse(source);
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as Partial<Database>).licenses)) {
    throw new Error("The legacy license file is not a valid Brava license database.");
  }
  const database = parsed as Database;
  if (database.licenses.some((license) => !Array.isArray(license.devices))) {
    throw new Error("The legacy license file contains a license without a devices array.");
  }
  return database;
}

export async function importJsonLicenses(pool: pg.Pool, filePath: string): Promise<JsonLicenseImportResult> {
  const sourcePath = resolve(filePath);
  const client = await pool.connect();
  let deviceCount = 0;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [legacyImportName]);
    const completed = await client.query<{
      source_sha256: string;
      licenses_imported: number;
      devices_imported: number;
    }>(
      `SELECT source_sha256, licenses_imported, devices_imported
       FROM brava_data_imports WHERE import_name = $1`,
      [legacyImportName],
    );
    const previous = completed.rows[0];
    if (previous) {
      await client.query("COMMIT");
      return {
        licenses: previous.licenses_imported,
        devices: previous.devices_imported,
        skipped: true,
        sourceSha256: previous.source_sha256,
      };
    }

    const source = await readFile(sourcePath, "utf8");
    const sourceSha256 = createHash("sha256").update(source).digest("hex");
    const database = parseLicenseDatabase(source);
    for (const license of database.licenses) {
      const role = license.role ?? (license.maxDevices === null ? "owner" : "user");
      await client.query(
        `INSERT INTO brava_licenses
          (id, key_hash, label, role, status, max_devices, expires_at, source, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'admin', $8)
         ON CONFLICT (id) DO UPDATE SET
           key_hash = EXCLUDED.key_hash,
           label = EXCLUDED.label,
           role = EXCLUDED.role,
           status = EXCLUDED.status,
           max_devices = EXCLUDED.max_devices,
           expires_at = EXCLUDED.expires_at,
           updated_at = now()`,
        [license.id, license.keyHash, license.label, role, license.status, license.maxDevices, license.expiresAt, license.createdAt],
      );
      for (const device of license.devices) {
        await client.query(
          `INSERT INTO brava_license_devices (license_id, device_id, device_name, activated_at, last_seen_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (license_id, device_id) DO UPDATE SET
             device_name = EXCLUDED.device_name,
             activated_at = EXCLUDED.activated_at,
             last_seen_at = EXCLUDED.last_seen_at`,
          [license.id, device.deviceId, device.deviceName, device.activatedAt, device.lastSeenAt],
        );
        deviceCount += 1;
      }
    }
    await client.query(
      `INSERT INTO brava_data_imports
        (import_name, source_path, source_sha256, licenses_imported, devices_imported)
       VALUES ($1, $2, $3, $4, $5)`,
      [legacyImportName, sourcePath, sourceSha256, database.licenses.length, deviceCount],
    );
    await client.query("COMMIT");
    return { licenses: database.licenses.length, devices: deviceCount, skipped: false, sourceSha256 };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
