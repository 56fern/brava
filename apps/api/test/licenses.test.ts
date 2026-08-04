import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { LicenseRepository } from "../src/repository.js";

describe("license lifecycle", () => {
  it("creates and activates a device-bound license", async () => {
    const directory = await mkdtemp(join(tmpdir(), "brava-api-"));
    const app = createApp(new LicenseRepository(join(directory, "licenses.json")));
    const created = await request(app).post("/v1/admin/licenses")
      .set("authorization", `Bearer ${config.adminToken}`)
      .send({ label: "Test", maxDevices: 1, expiresAt: null }).expect(201);
    const activated = await request(app).post("/v1/licenses/activate")
      .send({ key: created.body.key, deviceId: "device-12345678", deviceName: "Test PC" }).expect(200);
    expect(activated.body.token).toContain(".");
    await request(app).post("/v1/licenses/activate")
      .send({ key: created.body.key, deviceId: "device-87654321", deviceName: "Other PC" }).expect(403);
    const reset = await request(app).delete(`/v1/admin/licenses/${created.body.license.id}/devices`)
      .set("authorization", `Bearer ${config.adminToken}`).expect(200);
    expect(reset.body.removed).toBe(1);
    await request(app).post("/v1/licenses/activate")
      .send({ key: created.body.key, deviceId: "device-87654321", deviceName: "Other PC" }).expect(200);
    const current = await request(app).post("/v1/licenses/activate")
      .send({ key: created.body.key, deviceId: "device-87654321", deviceName: "Other PC" }).expect(200);
    await request(app).delete("/v1/licenses/device")
      .set("authorization", `Bearer ${current.body.token}`).expect(200);
    await request(app).post("/v1/licenses/activate")
      .send({ key: created.body.key, deviceId: "device-third-123", deviceName: "Third PC" }).expect(200);
  });

  it("creates an owner license without device or expiration limits", async () => {
    const directory = await mkdtemp(join(tmpdir(), "brava-owner-api-"));
    const app = createApp(new LicenseRepository(join(directory, "licenses.json")));
    const created = await request(app).post("/v1/admin/licenses")
      .set("authorization", `Bearer ${config.adminToken}`)
      .send({ label: "Owner development", role: "owner", maxDevices: null, expiresAt: "2026-08-01T00:00:00.000Z" })
      .expect(201);
    expect(created.body.key).toMatch(/^BRVA(?:-[A-Z0-9]{5}){4}$/);
    expect(created.body.license).toMatchObject({ role: "owner", maxDevices: null, expiresAt: null });

    for (let index = 0; index < 25; index += 1) {
      await request(app).post("/v1/licenses/activate")
        .send({ key: created.body.key, deviceId: `owner-device-${index}`, deviceName: `Owner PC ${index}` })
        .expect(200);
    }
  });
});
