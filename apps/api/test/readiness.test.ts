import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

// Readiness is Brava configuration behavior. Loading the full Better Auth and
// Polar SDK graphs for every isolated environment makes this test sensitive to
// unrelated full-workspace CPU contention, so keep their construction local.
vi.mock("@polar-sh/better-auth", () => ({
  checkout: vi.fn(() => ({})),
  polar: vi.fn(() => ({})),
  portal: vi.fn(() => ({})),
  webhooks: vi.fn(() => ({})),
}));
vi.mock("@polar-sh/sdk", () => ({
  Polar: class PolarStub {
    constructor(_options: unknown) {}
  },
}));
vi.mock("better-auth", () => ({
  betterAuth: vi.fn((options: unknown) => ({
    options,
    api: { getSession: vi.fn(async () => null) },
  })),
}));
vi.mock("better-auth/db/migration", () => ({
  getMigrations: vi.fn(async () => ({ runMigrations: vi.fn(async () => undefined) })),
}));
vi.mock("better-auth/node", () => ({
  fromNodeHeaders: vi.fn(() => new Headers()),
  toNodeHandler: vi.fn(() => vi.fn(async () => undefined)),
}));

const validSecret = "readiness-test-secret-that-is-at-least-32-characters";

function configureEnvironment(overrides: Record<string, string> = {}): void {
  const environment = {
    NODE_ENV: "test",
    LICENSE_PEPPER: `${validSecret}-pepper`,
    TOKEN_SECRET: `${validSecret}-token`,
    ADMIN_TOKEN: `${validSecret}-admin`,
    LICENSE_STORAGE: "json",
    DATABASE_URL: "",
    BETTER_AUTH_SECRET: "",
    BETTER_AUTH_URL: "",
    BRAVA_APP_URL: "",
    POLAR_ACCESS_TOKEN: "",
    POLAR_PRODUCT_ID: "",
    POLAR_WEBHOOK_SECRET: "",
    ...overrides,
  };
  for (const [name, value] of Object.entries(environment)) vi.stubEnv(name, value);
}

async function loadApp(databasePing: () => Promise<void> = async () => undefined) {
  const pingDatabase = vi.fn(databasePing);
  vi.doMock("../src/database.js", async () => {
    const actual = await vi.importActual<typeof import("../src/database.js")>("../src/database.js");
    return { ...actual, pingDatabase };
  });

  const [{ createApp }, { LicenseRepository }] = await Promise.all([
    import("../src/app.js"),
    import("../src/repository.js"),
  ]);
  const directory = await mkdtemp(join(tmpdir(), "brava-readiness-"));
  return {
    app: createApp(new LicenseRepository(join(directory, "licenses.json"))),
    pingDatabase,
  };
}

afterEach(async () => {
  try {
    const { closeDatabasePool } = await import("../src/database.js");
    await closeDatabasePool();
  } finally {
    vi.doUnmock("../src/database.js");
    vi.unstubAllEnvs();
    vi.resetModules();
  }
});

describe("API readiness", () => {
  it("reports account services as unconfigured without PostgreSQL settings", async () => {
    configureEnvironment();
    const { app, pingDatabase } = await loadApp();

    const health = await request(app).get("/health").expect(200);
    expect(health.body).toEqual({
      ok: true,
      service: "brava-license-api",
      storage: "json",
      database: "not_configured",
      auth: "not_configured",
      billing: "not_configured",
    });
    expect(pingDatabase).not.toHaveBeenCalled();
    await request(app).get("/api/auth")
      .expect(503, { error: "account_auth_unavailable" });
  });

  it("keeps Polar billing unavailable while licenses are stored as JSON", async () => {
    configureEnvironment({
      LICENSE_STORAGE: "json",
      DATABASE_URL: "postgresql://brava:test@database.invalid/brava",
      BETTER_AUTH_SECRET: validSecret,
      BETTER_AUTH_URL: "https://api.brava.test",
      BRAVA_APP_URL: "https://brava.test/account",
      POLAR_ACCESS_TOKEN: "polar-access-token",
      POLAR_PRODUCT_ID: "polar-product-id",
      POLAR_WEBHOOK_SECRET: "polar-webhook-secret",
    });
    const { app, pingDatabase } = await loadApp();

    const health = await request(app).get("/health").expect(200);
    expect(health.body).toEqual({
      ok: true,
      service: "brava-license-api",
      storage: "json",
      database: "connected",
      auth: "ready",
      billing: "not_configured",
    });
    expect(pingDatabase).toHaveBeenCalledOnce();

    await request(app).get("/v1/account/entitlement")
      .expect(503, { error: "account_billing_unavailable" });
    await request(app).post("/v1/account/license/provision")
      .expect(503, { error: "account_billing_unavailable" });
    await request(app).post("/v1/account/license/rotate")
      .expect(503, { error: "account_billing_unavailable" });
  });

  it("reports configured PostgreSQL, account auth, and billing as ready", async () => {
    configureEnvironment({
      LICENSE_STORAGE: "postgres",
      DATABASE_URL: "postgresql://brava:test@database.invalid/brava",
      BETTER_AUTH_SECRET: validSecret,
      BETTER_AUTH_URL: "https://api.brava.test",
      BRAVA_APP_URL: "https://brava.test/account",
      POLAR_ACCESS_TOKEN: "polar-access-token",
      POLAR_PRODUCT_ID: "polar-product-id",
      POLAR_WEBHOOK_SECRET: "polar-webhook-secret",
    });
    const { app, pingDatabase } = await loadApp();

    const health = await request(app).get("/health").expect(200);
    expect(health.body).toEqual({
      ok: true,
      service: "brava-license-api",
      storage: "postgres",
      database: "connected",
      auth: "ready",
      billing: "ready",
    });
    expect(pingDatabase).toHaveBeenCalledOnce();
  });

  it("returns unavailable when the configured database cannot be reached", async () => {
    configureEnvironment({
      LICENSE_STORAGE: "postgres",
      DATABASE_URL: "postgresql://brava:test@database.invalid/brava",
      BETTER_AUTH_SECRET: validSecret,
      BETTER_AUTH_URL: "https://api.brava.test",
    });
    const { app, pingDatabase } = await loadApp(async () => {
      throw new Error("database unavailable");
    });

    const health = await request(app).get("/health").expect(503);
    expect(health.body).toEqual({
      ok: false,
      service: "brava-license-api",
      storage: "postgres",
      database: "unavailable",
    });
    expect(pingDatabase).toHaveBeenCalledOnce();
  });
});

describe("production configuration", () => {
  it("rejects reused production secrets", async () => {
    configureEnvironment({
      NODE_ENV: "production",
      LICENSE_PEPPER: validSecret,
      TOKEN_SECRET: validSecret,
      ADMIN_TOKEN: `${validSecret}-admin`,
    });
    const { assertProductionSecrets } = await import("../src/config.js");

    expect(() => assertProductionSecrets())
      .toThrow("LICENSE_PEPPER, TOKEN_SECRET, ADMIN_TOKEN, and BETTER_AUTH_SECRET must be different values.");
  });

  it("rejects a complete Polar configuration until license storage uses PostgreSQL", async () => {
    configureEnvironment({
      NODE_ENV: "production",
      LICENSE_STORAGE: "json",
      DATABASE_URL: "postgresql://brava:test@database.invalid/brava",
      BETTER_AUTH_SECRET: validSecret,
      BETTER_AUTH_URL: "https://api.brava.test",
      POLAR_ACCESS_TOKEN: "polar-access-token",
      POLAR_PRODUCT_ID: "polar-product-id",
      POLAR_WEBHOOK_SECRET: "polar-webhook-secret",
    });
    const { assertProductionSecrets } = await import("../src/config.js");

    expect(() => assertProductionSecrets())
      .toThrow("LICENSE_STORAGE=postgres is required before Polar billing can be enabled.");
  });
});
