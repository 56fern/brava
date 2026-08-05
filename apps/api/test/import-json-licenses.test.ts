import { mkdtemp, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type pg from "pg";
import { describe, expect, it } from "vitest";
import { importJsonLicenses } from "../src/import-json-licenses.js";

type ImportLedgerRow = {
  source_sha256: string;
  licenses_imported: number;
  devices_imported: number;
};

class ImportClient {
  ledger: ImportLedgerRow | null = null;
  licenseWrites = 0;
  deviceWrites = 0;

  async query<T = Record<string, unknown>>(sql: string, values: unknown[] = []): Promise<{ rows: T[]; rowCount: number }> {
    if (sql.includes("FROM brava_data_imports")) {
      return { rows: (this.ledger ? [this.ledger] : []) as T[], rowCount: this.ledger ? 1 : 0 };
    }
    if (sql.includes("INSERT INTO brava_licenses")) this.licenseWrites += 1;
    if (sql.includes("INSERT INTO brava_license_devices")) this.deviceWrites += 1;
    if (sql.includes("INSERT INTO brava_data_imports")) {
      this.ledger = {
        source_sha256: String(values[2]),
        licenses_imported: Number(values[3]),
        devices_imported: Number(values[4]),
      };
    }
    return { rows: [], rowCount: 0 };
  }

  release(): void {}
}

describe("legacy JSON license import", () => {
  it("records a completed import and never restores stale device bindings on later runs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "brava-import-"));
    const filePath = join(directory, "licenses.json");
    const database = {
      licenses: [{
        id: "10000000-0000-4000-8000-000000000001",
        keyHash: "a".repeat(64),
        label: "Legacy",
        role: "user",
        status: "active",
        maxDevices: 1,
        expiresAt: null,
        createdAt: "2026-08-01T00:00:00.000Z",
        devices: [{
          deviceId: "old-device",
          deviceName: "Old PC",
          activatedAt: "2026-08-01T00:00:00.000Z",
          lastSeenAt: "2026-08-01T00:00:00.000Z",
        }],
      }],
    };
    await writeFile(filePath, JSON.stringify(database), "utf8");

    const client = new ImportClient();
    const pool = { connect: async () => client } as unknown as pg.Pool;
    const first = await importJsonLicenses(pool, filePath);
    expect(first).toMatchObject({ licenses: 1, devices: 1, skipped: false });
    expect(client.licenseWrites).toBe(1);
    expect(client.deviceWrites).toBe(1);

    // Simulate a stale legacy file remaining on disk after the PostgreSQL device was deactivated.
    const second = await importJsonLicenses(pool, filePath);
    expect(second).toMatchObject({ licenses: 1, devices: 1, skipped: true });
    expect(client.licenseWrites).toBe(1);
    expect(client.deviceWrites).toBe(1);

    // A completed import also remains safe if the ephemeral legacy file is gone on restart.
    await unlink(filePath);
    const third = await importJsonLicenses(pool, filePath);
    expect(third.skipped).toBe(true);
    expect(client.licenseWrites).toBe(1);
    expect(client.deviceWrites).toBe(1);
  });
});
