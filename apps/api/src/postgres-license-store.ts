import type pg from "pg";
import type { LicenseStore } from "./repository.js";
import type {
  DeviceResetResult,
  License,
  LicenseActivationInput,
  LicenseActivationResult,
} from "./types.js";

type LicenseRow = {
  id: string;
  label: string;
  status: "active" | "revoked";
  max_devices: number | null;
  expires_at: Date | null;
};

export class PostgresLicenseStore implements LicenseStore {
  constructor(readonly pool: pg.Pool) {}

  async ping(): Promise<void> { await this.pool.query("SELECT 1"); }

  async createLicense(license: License): Promise<void> {
    await this.pool.query(
      `INSERT INTO brava_licenses
        (id, key_hash, label, role, status, max_devices, expires_at, source, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'admin', $8)`,
      [license.id, license.keyHash, license.label, license.role ?? (license.maxDevices === null ? "owner" : "user"), license.status, license.maxDevices, license.expiresAt, license.createdAt],
    );
  }

  async activateDevice(input: LicenseActivationInput): Promise<LicenseActivationResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<LicenseRow>(
        `SELECT id, label, status, max_devices, expires_at
         FROM brava_licenses WHERE key_hash = $1 FOR UPDATE`,
        [input.keyHash],
      );
      const license = result.rows[0];
      if (!license || license.status !== "active") {
        await client.query("ROLLBACK");
        return { ok: false, error: "invalid_license" };
      }
      if (license.expires_at && license.expires_at.getTime() <= input.now.getTime()) {
        await client.query("ROLLBACK");
        return { ok: false, error: "expired_license" };
      }
      const existing = await client.query(
        "SELECT 1 FROM brava_license_devices WHERE license_id = $1 AND device_id = $2",
        [license.id, input.deviceId],
      );
      if (!existing.rowCount && license.max_devices !== null) {
        const count = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM brava_license_devices WHERE license_id = $1", [license.id]);
        if (Number(count.rows[0]?.count ?? 0) >= license.max_devices) {
          await client.query("ROLLBACK");
          return { ok: false, error: "device_limit" };
        }
      }
      await client.query(
        `INSERT INTO brava_license_devices (license_id, device_id, device_name, activated_at, last_seen_at)
         VALUES ($1, $2, $3, $4, $4)
         ON CONFLICT (license_id, device_id)
         DO UPDATE SET device_name = EXCLUDED.device_name, last_seen_at = EXCLUDED.last_seen_at`,
        [license.id, input.deviceId, input.deviceName, input.now],
      );
      await client.query("COMMIT");
      return { ok: true, licenseId: license.id, label: license.label, expiresAt: license.expires_at?.toISOString() ?? null };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async isActiveDevice(licenseId: string, deviceId: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1 FROM brava_licenses l
       JOIN brava_license_devices d ON d.license_id = l.id
       WHERE l.id = $1 AND d.device_id = $2 AND l.status = 'active'
         AND (l.expires_at IS NULL OR l.expires_at > now())`,
      [licenseId, deviceId],
    );
    return Boolean(result.rowCount);
  }

  async heartbeatDevice(licenseId: string, deviceId: string, now: Date): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE brava_license_devices d SET last_seen_at = $3
       FROM brava_licenses l
       WHERE d.license_id = l.id AND l.id = $1 AND d.device_id = $2
         AND l.status = 'active' AND (l.expires_at IS NULL OR l.expires_at > $3)`,
      [licenseId, deviceId, now],
    );
    return Boolean(result.rowCount);
  }

  async deactivateDevice(licenseId: string, deviceId: string): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM brava_license_devices WHERE license_id = $1 AND device_id = $2", [licenseId, deviceId]);
    return Boolean(result.rowCount);
  }

  async resetLicenseDevices(licenseId: string): Promise<DeviceResetResult | null> {
    return this.reset("l.id = $1", licenseId);
  }

  async resetDevicesBySelector(selector: string): Promise<DeviceResetResult | null> {
    return this.reset("(l.id::text = $1 OR lower(l.label) = lower($1))", selector);
  }

  private async reset(predicate: string, selector: string): Promise<DeviceResetResult | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query<{ id: string; label: string }>(`SELECT l.id, l.label FROM brava_licenses l WHERE ${predicate} FOR UPDATE`, [selector]);
      const license = found.rows[0];
      if (!license) {
        await client.query("ROLLBACK");
        return null;
      }
      const removed = await client.query("DELETE FROM brava_license_devices WHERE license_id = $1", [license.id]);
      await client.query("COMMIT");
      return { removed: removed.rowCount ?? 0, licenseId: license.id, label: license.label };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {}
}
