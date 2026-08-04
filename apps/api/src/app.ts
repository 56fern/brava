import crypto from "node:crypto";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { z } from "zod";
import { config } from "./config.js";
import { generateLicenseKey, hashLicenseKey, signToken, verifyToken } from "./crypto.js";
import { LicenseRepository } from "./repository.js";
import { ProductMonitorHub } from "./monitor.js";
import { DiscordPublicCheckoutPublisher, publicCheckoutSchema, type PublicCheckoutPublisher } from "./public-checkout.js";

const activationSchema = z.object({
  key: z.string().min(12).max(128),
  deviceId: z.string().min(8).max(128),
  deviceName: z.string().min(1).max(80),
});

const createSchema = z.object({
  label: z.string().min(1).max(100),
  role: z.enum(["user", "owner"]).default("user"),
  maxDevices: z.number().int().min(1).max(10).nullable().default(1),
  expiresAt: z.iso.datetime().nullable().default(null),
});

const productSignalSchema = z.object({
  site: z.literal("pokemon_center_us").default("pokemon_center_us"),
  sku: z.string().trim().min(3).max(96),
  name: z.string().trim().min(1).max(240),
  productUrl: z.url().refine((value) => {
    try { return new URL(value).hostname.toLowerCase().endsWith("pokemoncenter.com"); } catch { return false; }
  }, "productUrl must be a Pokémon Center URL"),
  available: z.boolean().default(true),
  price: z.number().nonnegative().optional(),
  maxCartQuantity: z.number().int().min(1).max(999).optional(),
  source: z.string().trim().min(1).max(240).default("admin"),
});

const bearer = (request: Request) => request.headers.authorization?.match(/^Bearer (.+)$/)?.[1];

export function createApp(
  repository = new LicenseRepository(config.dataFile),
  monitor = new ProductMonitorHub(),
  publicCheckouts: PublicCheckoutPublisher = new DiscordPublicCheckoutPublisher(config.publicCheckoutWebhookUrl, config.publicCheckoutAvatarPath),
) {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors({ origin: true, methods: ["GET", "POST", "DELETE"] }));
  app.use(express.json({ limit: "32kb" }));
  app.use("/updates", express.static(config.updateDir, {
    index: false,
    fallthrough: true,
    immutable: false,
    etag: false,
    lastModified: true,
    maxAge: 0,
    setHeaders: (response) => response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate"),
  }));

  app.get("/health", (_request, response) => response.json({ ok: true, service: "brava-license-api" }));
  app.get("/v1/monitor/health", (_request, response) => response.json(monitor.health()));

  app.get("/v1/monitor/signals", async (request, response) => {
    const token = bearer(request);
    const payload = token ? verifyToken(token) : null;
    if (!payload) return response.status(401).json({ error: "invalid_session" });
    const database = await repository.read();
    const license = database.licenses.find((item) => item.id === payload.licenseId && item.status === "active");
    if (!license?.devices.some((device) => device.deviceId === payload.deviceId)) return response.status(403).json({ error: "license_unavailable" });
    const after = Math.max(0, Number(request.query.after ?? 0) || 0);
    return response.json({ signals: monitor.list(after), latestSequence: monitor.health().latestSequence });
  });

  app.post("/v1/admin/monitor/signals", (request, response) => {
    if (bearer(request) !== config.adminToken) return response.status(401).json({ error: "unauthorized" });
    const parsed = productSignalSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "invalid_request", details: parsed.error.flatten() });
    const signal = monitor.observe(parsed.data);
    return response.status(signal ? 201 : 200).json({ accepted: Boolean(signal), signal });
  });

  app.post("/v1/admin/licenses", async (request, response) => {
    if (bearer(request) !== config.adminToken) return response.status(401).json({ error: "unauthorized" });
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "invalid_request", details: parsed.error.flatten() });
    const key = generateLicenseKey();
    const owner = parsed.data.role === "owner";
    const license = {
      id: crypto.randomUUID(), keyHash: hashLicenseKey(key), label: parsed.data.label,
      role: parsed.data.role, status: "active" as const,
      maxDevices: owner ? null : (parsed.data.maxDevices ?? 1),
      expiresAt: owner ? null : parsed.data.expiresAt,
      createdAt: new Date().toISOString(), devices: [],
    };
    await repository.mutate((database) => database.licenses.push(license));
    return response.status(201).json({ key, license: { ...license, keyHash: undefined } });
  });

  app.delete("/v1/admin/licenses/:licenseId/devices", async (request, response) => {
    if (bearer(request) !== config.adminToken) return response.status(401).json({ error: "unauthorized" });
    const result = await repository.mutate((database) => {
      const license = database.licenses.find((item) => item.id === request.params.licenseId);
      if (!license) return null;
      const removed = license.devices.length;
      license.devices = [];
      return { removed, licenseId: license.id, label: license.label };
    });
    if (!result) return response.status(404).json({ error: "license_not_found" });
    return response.json({ ok: true, ...result });
  });

  app.post("/v1/licenses/activate", async (request, response) => {
    const parsed = activationSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "invalid_request" });
    const keyHash = hashLicenseKey(parsed.data.key);
    const result = await repository.mutate((database) => {
      const license = database.licenses.find((item) => item.keyHash === keyHash);
      if (!license || license.status !== "active") return { error: "invalid_license" } as const;
      if (license.expiresAt && new Date(license.expiresAt).getTime() <= Date.now()) return { error: "expired_license" } as const;
      let device = license.devices.find((item) => item.deviceId === parsed.data.deviceId);
      if (!device && license.maxDevices !== null && license.devices.length >= license.maxDevices) return { error: "device_limit" } as const;
      const now = new Date().toISOString();
      if (device) device.lastSeenAt = now;
      else {
        device = { deviceId: parsed.data.deviceId, deviceName: parsed.data.deviceName, activatedAt: now, lastSeenAt: now };
        license.devices.push(device);
      }
      return { licenseId: license.id, label: license.label, expiresAt: license.expiresAt } as const;
    });
    if ("error" in result) return response.status(403).json(result);
    const token = signToken({ licenseId: result.licenseId, deviceId: parsed.data.deviceId, exp: Date.now() + 15 * 60_000 });
    return response.json({ token, license: result });
  });

  app.post("/v1/licenses/heartbeat", async (request, response) => {
    const token = bearer(request);
    const payload = token ? verifyToken(token) : null;
    if (!payload) return response.status(401).json({ error: "invalid_session" });
    const result = await repository.mutate((database) => {
      const license = database.licenses.find((item) => item.id === payload.licenseId);
      const device = license?.devices.find((item) => item.deviceId === payload.deviceId);
      if (!license || !device || license.status !== "active") return null;
      device.lastSeenAt = new Date().toISOString();
      return { licenseId: license.id, deviceId: device.deviceId };
    });
    if (!result) return response.status(403).json({ error: "license_unavailable" });
    return response.json({ ok: true, token: signToken({ ...result, exp: Date.now() + 15 * 60_000 }) });
  });

  app.post("/v1/checkouts/public", async (request, response) => {
    const token = bearer(request);
    const payload = token ? verifyToken(token) : null;
    if (!payload) return response.status(401).json({ error: "invalid_session" });
    const parsed = publicCheckoutSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "invalid_request", details: parsed.error.flatten() });
    const database = await repository.read();
    const license = database.licenses.find((item) => item.id === payload.licenseId && item.status === "active");
    if (!license?.devices.some((device) => device.deviceId === payload.deviceId)) return response.status(403).json({ error: "license_unavailable" });
    const result = await publicCheckouts.publish(parsed.data);
    if (result === "disabled") return response.status(503).json({ error: "public_checkout_feed_unavailable" });
    return response.status(result === "sent" ? 201 : 200).json({ accepted: result === "sent", duplicate: result === "duplicate" });
  });

  app.delete("/v1/licenses/device", async (request, response) => {
    const token = bearer(request);
    const payload = token ? verifyToken(token) : null;
    if (!payload) return response.status(401).json({ error: "invalid_session" });
    const removed = await repository.mutate((database) => {
      const license = database.licenses.find((item) => item.id === payload.licenseId);
      if (!license || license.status !== "active") return false;
      const before = license.devices.length;
      license.devices = license.devices.filter((item) => item.deviceId !== payload.deviceId);
      return license.devices.length < before;
    });
    if (!removed) return response.status(404).json({ error: "device_not_found" });
    return response.json({ ok: true });
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    console.error(error);
    response.status(500).json({ error: "internal_error" });
  });
  return app;
}
