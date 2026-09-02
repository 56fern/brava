import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { LicenseRepository } from "../src/repository.js";

describe("production update feed", () => {
  it("serves the announced manifest and matching installer", async () => {
    const directory = await mkdtemp(join(tmpdir(), "brava-update-feed-"));
    const app = createApp(new LicenseRepository(join(directory, "licenses.json")));

    const manifest = await request(app).get("/updates/latest.yml").expect(200);
    expect(manifest.text).toContain("version: 0.52.0");
    expect(manifest.text).toContain("path: Brava-Setup-0.52.0.exe");
    expect(manifest.headers["cache-control"]).toBe("no-store, no-cache, must-revalidate");

    const installer = await request(app).head("/updates/Brava-Setup-0.52.0.exe").expect(200);
    expect(Number(installer.headers["content-length"])).toBeGreaterThan(90_000_000);
  });
});
