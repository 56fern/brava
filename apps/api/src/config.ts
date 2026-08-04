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
  updateDir: process.env.UPDATE_DIR ?? path.resolve(process.cwd(), "../desktop/release"),
  monitorSourceUrls: (process.env.MONITOR_SOURCE_URLS ?? "").split(",").map((value) => value.trim()).filter(Boolean),
  monitorIntervalMs: Math.max(15_000, Number(process.env.MONITOR_INTERVAL_SECONDS ?? 30) * 1_000),
  monitorRequestTimeoutMs: Math.max(2_000, Number(process.env.MONITOR_REQUEST_TIMEOUT_SECONDS ?? 10) * 1_000),
  publicCheckoutWebhookUrl: process.env.PUBLIC_CHECKOUT_WEBHOOK_URL ?? "",
  publicCheckoutAvatarPath: path.resolve(process.cwd(), process.env.PUBLIC_CHECKOUT_AVATAR_PATH ?? "../desktop/build/webhook-avatar.png"),
  production: process.env.NODE_ENV === "production",
};

export function assertProductionSecrets(): void {
  if (!config.production) return;
  const values = [config.licensePepper, config.tokenSecret, config.adminToken];
  if (values.some((value) => value.includes("development-") || value.length < 32)) {
    throw new Error("Production secrets must be unique and at least 32 characters long.");
  }
}
