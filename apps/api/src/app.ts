import crypto from "node:crypto";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { z } from "zod";
import {
  authEnabled,
  authTrustedOrigins,
  createAuthNodeHandler,
  getAuthenticatedUser,
  polarEnabled,
} from "./auth.js";
import { config } from "./config.js";
import { generateLicenseKey, hashLicenseKey, signToken, verifyToken } from "./crypto.js";
import { pingDatabase } from "./database.js";
import type { LicenseStore } from "./repository.js";
import { createLicenseStore } from "./repository-factory.js";
import { ProductMonitorHub } from "./monitor.js";
import {
  getPolarEntitlement,
  provisionPolarLicense,
  rotatePolarLicense,
  type PolarLicenseResult,
} from "./polar-entitlements.js";
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

function accountLicenseStatus(result: PolarLicenseResult): number {
  if (result.ok) return 200;
  if (result.error === "entitlement_required") return 403;
  if (result.error === "already_provisioned") return 409;
  return 404;
}

export function createApp(
  repository: LicenseStore = createLicenseStore(),
  monitor = new ProductMonitorHub(),
  publicCheckouts: PublicCheckoutPublisher = new DiscordPublicCheckoutPublisher(config.publicCheckoutWebhookUrl, config.publicCheckoutAvatarPath),
) {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  const accountOrigins = new Set(authTrustedOrigins);
  app.use(cors({
    origin: (origin, callback) => callback(null, !origin || accountOrigins.has(origin)),
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  }));

  // Better Auth and the signed Polar webhook must receive the untouched request
  // body. Express's JSON parser is intentionally mounted after these handlers.
  const authHandler = createAuthNodeHandler();
  app.all("/api/auth", authHandler);
  app.all("/api/auth/*splat", authHandler);

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

  app.get("/health", async (_request, response) => {
    try {
      if (config.databaseUrl) await pingDatabase();
      await repository.ping();
      return response.json({
        ok: true,
        service: "brava-license-api",
        storage: config.licenseStorage,
        database: config.databaseUrl ? "connected" : "not_configured",
        auth: authEnabled ? "ready" : "not_configured",
        billing: polarEnabled ? "ready" : "not_configured",
      });
    } catch {
      return response.status(503).json({ ok: false, service: "brava-license-api", storage: config.licenseStorage, database: "unavailable" });
    }
  });
  app.get("/v1/monitor/health", (_request, response) => response.json(monitor.health()));

  app.get("/v1/account/entitlement", async (request, response) => {
    if (!authEnabled || !polarEnabled) return response.status(503).json({ error: "account_billing_unavailable" });
    const user = await getAuthenticatedUser(request.headers);
    if (!user) return response.status(401).json({ error: "authentication_required" });
    return response.json({ user: { email: user.email, name: user.name }, entitlement: await getPolarEntitlement(user.id) });
  });

  app.post("/v1/account/license/provision", async (request, response) => {
    if (!authEnabled || !polarEnabled) return response.status(503).json({ error: "account_billing_unavailable" });
    const user = await getAuthenticatedUser(request.headers);
    if (!user) return response.status(401).json({ error: "authentication_required" });
    const result = await provisionPolarLicense(user.id);
    return response.status(accountLicenseStatus(result)).json(result);
  });

  app.post("/v1/account/license/rotate", async (request, response) => {
    if (!authEnabled || !polarEnabled) return response.status(503).json({ error: "account_billing_unavailable" });
    const user = await getAuthenticatedUser(request.headers);
    if (!user) return response.status(401).json({ error: "authentication_required" });
    const result = await rotatePolarLicense(user.id);
    return response.status(accountLicenseStatus(result)).json(result);
  });

  app.get("/v1/monitor/signals", async (request, response) => {
    const token = bearer(request);
    const payload = token ? verifyToken(token) : null;
    if (!payload) return response.status(401).json({ error: "invalid_session" });
    if (!await repository.isActiveDevice(payload.licenseId, payload.deviceId)) return response.status(403).json({ error: "license_unavailable" });
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
    await repository.createLicense(license);
    return response.status(201).json({ key, license: { ...license, keyHash: undefined } });
  });

  app.delete("/v1/admin/licenses/:licenseId/devices", async (request, response) => {
    if (bearer(request) !== config.adminToken) return response.status(401).json({ error: "unauthorized" });
    const result = await repository.resetLicenseDevices(request.params.licenseId);
    if (!result) return response.status(404).json({ error: "license_not_found" });
    return response.json({ ok: true, ...result });
  });

  app.post("/v1/licenses/activate", async (request, response) => {
    const parsed = activationSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "invalid_request" });
    const keyHash = hashLicenseKey(parsed.data.key);
    const result = await repository.activateDevice({ keyHash, deviceId: parsed.data.deviceId, deviceName: parsed.data.deviceName, now: new Date() });
    if (!result.ok) return response.status(403).json({ error: result.error });
    const token = signToken({ licenseId: result.licenseId, deviceId: parsed.data.deviceId, exp: Date.now() + 15 * 60_000 });
    return response.json({ token, license: result });
  });

  app.post("/v1/licenses/heartbeat", async (request, response) => {
    const token = bearer(request);
    const payload = token ? verifyToken(token) : null;
    if (!payload) return response.status(401).json({ error: "invalid_session" });
    if (!await repository.heartbeatDevice(payload.licenseId, payload.deviceId, new Date())) return response.status(403).json({ error: "license_unavailable" });
    return response.json({ ok: true, token: signToken({ licenseId: payload.licenseId, deviceId: payload.deviceId, exp: Date.now() + 15 * 60_000 }) });
  });

  app.post("/v1/checkouts/public", async (request, response) => {
    const token = bearer(request);
    const payload = token ? verifyToken(token) : null;
    if (!payload) return response.status(401).json({ error: "invalid_session" });
    const parsed = publicCheckoutSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "invalid_request", details: parsed.error.flatten() });
    if (!await repository.isActiveDevice(payload.licenseId, payload.deviceId)) return response.status(403).json({ error: "license_unavailable" });
    const result = await publicCheckouts.publish(parsed.data);
    if (result === "disabled") return response.status(503).json({ error: "public_checkout_feed_unavailable" });
    return response.status(result === "sent" ? 201 : 200).json({ accepted: result === "sent", duplicate: result === "duplicate" });
  });

  app.delete("/v1/licenses/device", async (request, response) => {
    const token = bearer(request);
    const payload = token ? verifyToken(token) : null;
    if (!payload) return response.status(401).json({ error: "invalid_session" });
    const removed = await repository.deactivateDevice(payload.licenseId, payload.deviceId);
    if (!removed) return response.status(404).json({ error: "device_not_found" });
    return response.json({ ok: true });
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    console.error(error);
    response.status(500).json({ error: "internal_error" });
  });
  return app;
}
