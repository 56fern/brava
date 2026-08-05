import type { IncomingHttpHeaders } from "node:http";
import { checkout, polar, portal, webhooks } from "@polar-sh/better-auth";
import { Polar } from "@polar-sh/sdk";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { resolveBillingUrls } from "./auth-urls.js";
import { config } from "./config.js";
import { getDatabasePool } from "./database.js";
import { reconcilePolarCustomerState } from "./polar-entitlements.js";

export const authEnabled = Boolean(config.databaseUrl && config.betterAuthSecret && config.betterAuthUrl);
// Billing is considered ready only when checkout, product mapping, and signed
// subscription reconciliation are all configured. This avoids selling access
// before Brava can receive the entitlement webhook.
export const polarEnabled = authEnabled && config.licenseStorage === "postgres" && Boolean(
  config.polarAccessToken && config.polarProductId && config.polarWebhookSecret,
);

const baseUrl = config.betterAuthUrl.replace(/\/$/, "");
const billingUrls = authEnabled ? resolveBillingUrls(baseUrl, config.bravaAppUrl) : null;
export const authTrustedOrigins = billingUrls?.trustedOrigins ?? [];

function createPolarPlugin() {
  if (!polarEnabled) return null;
  const client = new Polar({ accessToken: config.polarAccessToken, server: config.polarServer });
  const checkoutPlugin = checkout({
    products: [{ productId: config.polarProductId, slug: "brava" }],
    authenticatedUsersOnly: true,
    successUrl: billingUrls!.checkoutSuccessUrl,
    returnUrl: billingUrls!.appReturnUrl,
  });
  const portalPlugin = portal({ returnUrl: billingUrls!.appReturnUrl });
  return polar({
    client,
    createCustomerOnSignUp: true,
    use: [
      checkoutPlugin,
      portalPlugin,
      webhooks({
        secret: config.polarWebhookSecret,
        onCustomerStateChanged: async (payload) => { await reconcilePolarCustomerState(payload); },
      }),
    ],
  });
}

const polarPlugin = createPolarPlugin();

export const auth = authEnabled
  ? betterAuth({
    appName: "Brava",
    baseURL: baseUrl,
    basePath: "/api/auth",
    secret: config.betterAuthSecret,
    database: getDatabasePool(),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    trustedOrigins: authTrustedOrigins,
    advanced: {
      useSecureCookies: config.production,
      cookiePrefix: "brava",
    },
    plugins: polarPlugin ? [polarPlugin] : [],
  })
  : null;

export async function runBetterAuthMigrations(): Promise<void> {
  if (!auth) return;
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
}

export type AuthenticatedUser = {
  id: string;
  email: string;
  name: string;
};

export async function getAuthenticatedUser(headers: Headers | IncomingHttpHeaders): Promise<AuthenticatedUser | null> {
  if (!auth) return null;
  const normalized = headers instanceof Headers ? headers : fromNodeHeaders(headers);
  const session = await auth.api.getSession({ headers: normalized });
  if (!session?.user) return null;
  return { id: session.user.id, email: session.user.email, name: session.user.name };
}

/** Mount this handler at `/api/auth/{*splat}` (and `/api/auth`). */
export function createAuthNodeHandler(): RequestHandler {
  if (!auth) {
    return (_request: Request, response: Response) => {
      response.status(503).json({ error: "account_auth_unavailable" });
    };
  }
  const handler = toNodeHandler(auth);
  return (request: Request, response: Response, next: NextFunction) => {
    void handler(request, response).catch(next);
  };
}
