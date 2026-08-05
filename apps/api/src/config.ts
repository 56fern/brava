import "dotenv/config";
import path from "node:path";

const developmentDefaults = {
  licensePepper: "development-only-license-pepper-change-me",
  tokenSecret: "development-only-token-secret-change-me",
  adminToken: "development-admin-token-change-me",
};

export const config = {
  port: Number(process.env.PORT ?? 4310),
  host: process.env.HOST ?? "127.0.0.1",
  licensePepper: process.env.LICENSE_PEPPER ?? developmentDefaults.licensePepper,
  tokenSecret: process.env.TOKEN_SECRET ?? developmentDefaults.tokenSecret,
  adminToken: process.env.ADMIN_TOKEN ?? developmentDefaults.adminToken,
  dataFile: process.env.DATA_FILE ?? new URL("../data/licenses.json", import.meta.url).pathname.replace(/^\/(.:\/)/, "$1"),
  databaseUrl: process.env.DATABASE_URL?.trim() ?? "",
  licenseStorage: process.env.LICENSE_STORAGE === "postgres" ? "postgres" as const : "json" as const,
  importJsonLicenses: process.env.IMPORT_JSON_LICENSES === "true",
  databasePoolMax: Math.max(1, Math.min(20, Number(process.env.DATABASE_POOL_MAX ?? 10) || 10)),
  updateDir: process.env.UPDATE_DIR ?? path.resolve(process.cwd(), "../desktop/release"),
  monitorSourceUrls: (process.env.MONITOR_SOURCE_URLS ?? "").split(",").map((value) => value.trim()).filter(Boolean),
  monitorIntervalMs: Math.max(15_000, Number(process.env.MONITOR_INTERVAL_SECONDS ?? 30) * 1_000),
  monitorRequestTimeoutMs: Math.max(2_000, Number(process.env.MONITOR_REQUEST_TIMEOUT_SECONDS ?? 10) * 1_000),
  publicCheckoutWebhookUrl: process.env.PUBLIC_CHECKOUT_WEBHOOK_URL ?? "",
  publicCheckoutAvatarPath: path.resolve(process.cwd(), process.env.PUBLIC_CHECKOUT_AVATAR_PATH ?? "../desktop/build/webhook-avatar.png"),
  betterAuthSecret: process.env.BETTER_AUTH_SECRET?.trim() ?? "",
  betterAuthUrl: process.env.BETTER_AUTH_URL?.trim() ?? "",
  bravaAppUrl: process.env.BRAVA_APP_URL?.trim() ?? "",
  polarAccessToken: process.env.POLAR_ACCESS_TOKEN?.trim() ?? "",
  polarProductId: process.env.POLAR_PRODUCT_ID?.trim() ?? "",
  polarServer: process.env.POLAR_SERVER === "production" ? "production" as const : "sandbox" as const,
  polarWebhookSecret: process.env.POLAR_WEBHOOK_SECRET?.trim() ?? "",
  production: process.env.NODE_ENV === "production",
};

export function assertProductionSecrets(): void {
  if (!config.production) return;
  const values = [config.licensePepper, config.tokenSecret, config.adminToken];
  if (values.some((value) => value.includes("development-") || value.length < 32)) {
    throw new Error("Production secrets must be unique and at least 32 characters long.");
  }
  if (config.licenseStorage === "postgres" && !config.databaseUrl) {
    throw new Error("DATABASE_URL is required when LICENSE_STORAGE=postgres.");
  }
  if (config.databaseUrl && (!config.betterAuthSecret || config.betterAuthSecret.length < 32 || !config.betterAuthUrl)) {
    throw new Error("BETTER_AUTH_SECRET (32+ characters) and BETTER_AUTH_URL are required when PostgreSQL is configured.");
  }
  const configuredSecrets = config.databaseUrl ? [...values, config.betterAuthSecret] : values;
  if (new Set(configuredSecrets).size !== configuredSecrets.length) {
    throw new Error("LICENSE_PEPPER, TOKEN_SECRET, ADMIN_TOKEN, and BETTER_AUTH_SECRET must be different values.");
  }
  const polarValues = [config.polarAccessToken, config.polarProductId, config.polarWebhookSecret];
  if (polarValues.some(Boolean)) {
    if (!polarValues.every(Boolean)) {
      throw new Error("POLAR_ACCESS_TOKEN, POLAR_PRODUCT_ID, and POLAR_WEBHOOK_SECRET must be configured together.");
    }
    if (config.licenseStorage !== "postgres") {
      throw new Error("LICENSE_STORAGE=postgres is required before Polar billing can be enabled.");
    }
  }
}
