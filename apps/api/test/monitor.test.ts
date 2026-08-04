import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { ProductMonitorHub } from "../src/monitor.js";
import { parseProductSignals } from "../src/monitor-worker.js";
import { LicenseRepository } from "../src/repository.js";

describe("central product monitor", () => {
  it("extracts normalized product signals from JSON-LD", () => {
    const body = JSON.stringify({ "@context": "https://schema.org", "@type": "Product", name: "Celebration Box", sku: "10-12345-100", url: "/product/10-12345-100/celebration-box", purchaseLimit: 4, offers: { price: "49.99", availability: "https://schema.org/InStock" } });
    expect(parseProductSignals(body, "application/ld+json", "https://www.pokemoncenter.com/search/new")).toEqual([expect.objectContaining({ sku: "10-12345-100", name: "Celebration Box", price: 49.99, maxCartQuantity: 4, available: true, productUrl: "https://www.pokemoncenter.com/product/10-12345-100/celebration-box" })]);
  });

  it("baselines products and only announces new or changed observations", () => {
    const hub = new ProductMonitorHub();
    const product = { site: "pokemon_center_us" as const, sku: "10-12345-100", name: "Celebration Box", productUrl: "https://www.pokemoncenter.com/product/10-12345-100/celebration-box", available: true, source: "test" };
    expect(hub.observe(product, false)).toBeNull();
    expect(hub.observe(product)).toBeNull();
    expect(hub.observe({ ...product, available: false })).toMatchObject({ sequence: 1, available: false });
  });

  it("publishes deduplicated monitor signals to licensed clients", async () => {
    const directory = await mkdtemp(join(tmpdir(), "brava-monitor-"));
    const repository = new LicenseRepository(join(directory, "licenses.json"));
    const hub = new ProductMonitorHub();
    const app = createApp(repository, hub);
    const created = await request(app).post("/v1/admin/licenses").set("authorization", `Bearer ${config.adminToken}`).send({ label: "Monitor test", maxDevices: 1, expiresAt: null }).expect(201);
    const activated = await request(app).post("/v1/licenses/activate").send({ key: created.body.key, deviceId: "monitor-device-123", deviceName: "Monitor PC" }).expect(200);
    const product = { site: "pokemon_center_us", sku: "10-12345-100", name: "Celebration Box", productUrl: "https://www.pokemoncenter.com/product/10-12345-100/celebration-box", available: true, source: "manual-test" };
    await request(app).post("/v1/admin/monitor/signals").set("authorization", `Bearer ${config.adminToken}`).send(product).expect(201);
    await request(app).post("/v1/admin/monitor/signals").set("authorization", `Bearer ${config.adminToken}`).send(product).expect(200);
    const signals = await request(app).get("/v1/monitor/signals?after=0").set("authorization", `Bearer ${activated.body.token}`).expect(200);
    expect(signals.body.signals).toHaveLength(1);
    expect(signals.body.signals[0]).toMatchObject({ sku: "10-12345-100", sequence: 1 });
  });
});
